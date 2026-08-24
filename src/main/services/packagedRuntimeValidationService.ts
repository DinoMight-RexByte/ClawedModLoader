import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CLAWED_STEAM_APP_ID,
  type GameDiscovery,
  type ModProblem,
  type RecordUe4ssRuntimeValidationResult,
  type RuntimeReleaseValidation,
  type ServiceStatus,
  type ValidatePackagedRuntimeResult
} from "../../shared/contracts/app";
import type {
  DeploymentServiceContract,
  PackagedRuntimeValidationServiceContract,
  RuntimeManagerContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import type { LifecycleLogger } from "./lifecycleLogger";
import { modProblem } from "./packageProblems";
import type { GameProcessInfo, ProcessPlatform } from "./processPlatform";
import type { WindowsProcessSupervisor } from "./processSupervisor";
import {
  getUe4ssLogPath,
  PACKAGED_RUNTIME_VALIDATION_MOD_ID,
  packagedRuntimeValidationMarkers
} from "./runtimeValidationProbe";

export type PackagedRuntimeValidationResult = ValidatePackagedRuntimeResult;

export interface PackagedRuntimeValidationOptions {
  markerTimeoutMs?: number;
  closeTimeoutMs?: number;
  launchDetectTimeoutMs?: number;
  pollIntervalMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

export interface PackagedRuntimeFailureAnalysis {
  recordAsIncompatible: boolean;
  code: string;
  message: string;
  details: string;
}

interface ActivePackagedRuntimeValidationRun {
  evidencePath: string;
  cancelRequested: boolean;
  steamLaunchRequested: boolean;
  processId: number | null;
}

class PackagedRuntimeValidationCancelledError extends Error {
  constructor() {
    super("Packaged runtime validation was cancelled.");
    this.name = "PackagedRuntimeValidationCancelledError";
  }
}

export class PackagedRuntimeValidationService
  implements PackagedRuntimeValidationServiceContract {
  private readonly markerTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly launchDetectTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private activeRun: ActivePackagedRuntimeValidationRun | null = null;

  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly deploymentService: DeploymentServiceContract,
    private readonly runtimeManager: RuntimeManagerContract,
    private readonly processSupervisor: WindowsProcessSupervisor,
    private readonly platform: ProcessPlatform,
    private readonly logger: LifecycleLogger,
    options?: PackagedRuntimeValidationOptions
  ) {
    this.markerTimeoutMs = options?.markerTimeoutMs ?? 100_000;
    this.closeTimeoutMs = options?.closeTimeoutMs ?? 45_000;
    this.launchDetectTimeoutMs = options?.launchDetectTimeoutMs ?? 30_000;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1_000;
    this.delay =
      options?.delay ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
  }

  getStatus(): ServiceStatus {
    return {
      id: "packagedRuntimeValidationService",
      label: "Packaged Runtime Validation Service",
      status: "ready",
      detail:
        "Runs the user-approved packaged UE4SS runtime validation workflow."
    };
  }

  async validate(
    discovery: GameDiscovery
  ): Promise<PackagedRuntimeValidationResult> {
    if (this.activeRun) {
      return validationResult("blocked", this.activeRun.evidencePath, null, [
        modProblem(
          "warning",
          "RUNTIME_VALIDATION_ALREADY_RUNNING",
          "Packaged runtime validation is already running."
        )
      ]);
    }

    if (!discovery.gameInstallPath || !discovery.gameExecutable) {
      return validationResult("blocked", null, null, [
        modProblem(
          "error",
          "GAME_INSTALL_MISSING",
          "Clawed must be detected before CMM can validate the packaged runtime."
        )
      ]);
    }

    if (await this.processSupervisor.findGameProcess(discovery.gameExecutable)) {
      return validationResult("blocked", null, null, [
        modProblem(
          "error",
          "RUNTIME_VALIDATION_GAME_RUNNING",
          "Close Clawed before CMM validates the packaged runtime."
        )
      ]);
    }

    const evidencePath = await this.createEvidencePath();
    const run: ActivePackagedRuntimeValidationRun = {
      evidencePath,
      cancelRequested: false,
      steamLaunchRequested: false,
      processId: null
    };
    let processId: number | null = null;
    let validationStatus: Extract<
      RuntimeReleaseValidation,
      "VALIDATED" | "INCOMPATIBLE"
    > | null = null;
    let validationDetails: string | undefined;
    let operationError: unknown = null;
    let failureAnalysis: PackagedRuntimeFailureAnalysis | null = null;
    let cleanupProblems: ModProblem[] = [];

    this.activeRun = run;

    try {
      await this.writeEvidence(evidencePath, "discovery.json", discovery);

      const deployment =
        await this.deploymentService.prepareRuntimeValidationDeployment(discovery);
      await this.writeEvidence(evidencePath, "deployment-result.json", deployment);
      if (deployment.status !== "ok" || !deployment.manifest) {
        return run.cancelRequested
          ? await this.cancelledResult(evidencePath)
          : validationResult("blocked", evidencePath, null, deployment.problems);
      }

      throwIfCancelled(run);
      const logPath = getUe4ssLogPath(
        discovery.gameInstallPath,
        deployment.manifest.runtimeConfiguration
      );

      try {
        this.processSupervisor.markStarting();
        run.steamLaunchRequested = true;
        await this.platform.launchSteamApp(CLAWED_STEAM_APP_ID);
        throwIfCancelled(run);
        const processInfo = await this.waitForValidationProcess(
          discovery.gameExecutable,
          run
        );
        if (!processInfo) {
          throw new Error("Steam launch was requested, but Clawed was not detected.");
        }

        processId = processInfo.processId;
        run.processId = processId;
        const logText = await waitForLogMarkers(
          logPath,
          packagedRuntimeValidationMarkers(),
          this.markerTimeoutMs,
          this.pollIntervalMs,
          this.delay,
          () => run.cancelRequested
        );
        await writeFile(
          path.join(evidencePath, "UE4SS-packaged-runtime.log"),
          logText
        );
        validationStatus = "VALIDATED";
        validationDetails = "Minimal read-only Lua startup marker passed.";
      } catch (error) {
        operationError = error;
        const logText = await readFile(logPath, "utf8").catch(() => "");
        if (logText.length > 0) {
          await writeFile(
            path.join(evidencePath, "UE4SS-packaged-runtime-failure.log"),
            logText
          );
        }

        if (error instanceof PackagedRuntimeValidationCancelledError) {
          validationDetails = error.message;
        } else {
          const errorMessage = error instanceof Error ? error.message : String(error);
          failureAnalysis = classifyPackagedRuntimeValidationFailure({
            logText,
            errorMessage,
            logPath,
            evidencePath,
            markers: packagedRuntimeValidationMarkers()
          });
          validationDetails = failureAnalysis.details;
          if (processId !== null && failureAnalysis.recordAsIncompatible) {
            validationStatus = "INCOMPATIBLE";
          }
        }
      } finally {
        if (processId === null && run.steamLaunchRequested && run.cancelRequested) {
          const processInfo = await this.waitForCancelledLaunchProcess(
            discovery.gameExecutable
          );
          processId = processInfo?.processId ?? null;
          run.processId = processId;
        }

        if (processId !== null) {
          await this.processSupervisor.requestGracefulShutdown(processId);
          const closed = await this.processSupervisor.waitForExit(
            processId,
            this.closeTimeoutMs,
            this.pollIntervalMs
          );
          if (!closed) {
            cleanupProblems = [
              modProblem(
                "error",
                "RUNTIME_VALIDATION_CLOSE_TIMEOUT",
                "Clawed did not close after the packaged runtime validation launch.",
                "CMM did not force-close the game and did not record validation evidence."
              )
            ];
          }
        }

        if (cleanupProblems.length === 0) {
          const vanillaResult =
            await this.deploymentService.prepareVanillaDeployment(discovery);
          await this.writeEvidence(
            evidencePath,
            "vanilla-restore-result.json",
            vanillaResult
          );
          if (vanillaResult.status !== "ok") {
            cleanupProblems = vanillaResult.problems.length
              ? vanillaResult.problems
              : [
                  modProblem(
                    "error",
                    "RUNTIME_VALIDATION_RESTORE_FAILED",
                    "CMM could not restore vanilla state after packaged runtime validation."
                  )
                ];
          }
        }
      }

      if (cleanupProblems.length > 0) {
        return validationResult("failed", evidencePath, null, cleanupProblems);
      }

      if (run.cancelRequested) {
        return this.cancelledResult(evidencePath);
      }

      if (!validationStatus) {
        return validationResult("failed", evidencePath, null, [
          failureAnalysis
            ? modProblem(
                "error",
                failureAnalysis.code,
                failureAnalysis.message,
                failureAnalysis.details
              )
            : modProblem(
                "error",
                "RUNTIME_VALIDATION_FAILED",
                "Packaged runtime validation did not complete.",
                operationError instanceof Error
                  ? operationError.message
                  : String(operationError)
              )
        ]);
      }

      const fingerprint = deployment.manifest.gameFingerprint;
      const recording = await this.runtimeManager.recordBundledUe4ssRuntimeValidation({
        status: validationStatus,
        steamBuildId: fingerprint.steamBuildId ?? null,
        fingerprintSha256: fingerprint.fingerprintSha256 ?? null,
        evidencePath,
        markerModId: PACKAGED_RUNTIME_VALIDATION_MOD_ID,
        details: validationDetails
      });
      await this.writeEvidence(
        evidencePath,
        "runtime-validation-recording.json",
        recording
      );
      await this.logger.log({
        category: "RUNTIME",
        action:
          validationStatus === "VALIDATED"
            ? "ue4ss_packaged_runtime_validated"
            : "ue4ss_packaged_runtime_incompatible",
        result: validationStatus === "VALIDATED" ? "ok" : "blocked",
        errorCode:
          validationStatus === "INCOMPATIBLE"
            ? "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE"
            : undefined
      });

      if (recording.status !== "recorded") {
        return validationResult("failed", evidencePath, recording, recording.problems);
      }

      return validationResult(
        validationStatus === "VALIDATED" ? "validated" : "incompatible",
        evidencePath,
        recording,
        recording.problems
      );
    } finally {
      if (this.activeRun === run) {
        this.activeRun = null;
      }
    }
  }

  async cancel(): Promise<PackagedRuntimeValidationResult> {
    if (!this.activeRun) {
      return validationResult("blocked", null, null, [
        modProblem(
          "warning",
          "RUNTIME_VALIDATION_NOT_RUNNING",
          "Packaged runtime validation is not running."
        )
      ]);
    }

    this.activeRun.cancelRequested = true;
    await this.logger.log({
      category: "RUNTIME",
      action: "ue4ss_packaged_runtime_validation_cancel_requested",
      result: "requested"
    });

    return validationResult("cancelled", this.activeRun.evidencePath, null, [
      modProblem(
        "warning",
        "RUNTIME_VALIDATION_CANCEL_REQUESTED",
        "Packaged runtime validation is cancelling.",
        "CMM will request a normal close if Clawed has started, then restore vanilla before finishing."
      )
    ]);
  }

  private async createEvidencePath(): Promise<string> {
    const layout = await this.storageService.getLayout();
    const evidencePath = path.join(
      layout.directories.logs,
      "runtime-validation",
      timestampForPath()
    );
    await mkdir(evidencePath, { recursive: true });
    return evidencePath;
  }

  private async writeEvidence(
    evidencePath: string,
    fileName: string,
    data: unknown
  ): Promise<void> {
    await writeFile(
      path.join(evidencePath, fileName),
      `${JSON.stringify(data, null, 2)}\n`
    );
  }

  private async waitForValidationProcess(
    gameExecutable: string,
    run: ActivePackagedRuntimeValidationRun
  ): Promise<GameProcessInfo | null> {
    const deadline = Date.now() + this.launchDetectTimeoutMs;

    while (Date.now() <= deadline) {
      throwIfCancelled(run);
      const processInfo = await this.processSupervisor.waitForRunning(
        gameExecutable,
        1,
        0
      );
      if (processInfo) {
        return processInfo;
      }
      await this.delay(this.pollIntervalMs);
    }

    return null;
  }

  private async waitForCancelledLaunchProcess(
    gameExecutable: string
  ): Promise<GameProcessInfo | null> {
    const deadline = Date.now() + Math.min(this.launchDetectTimeoutMs, 5_000);

    while (Date.now() <= deadline) {
      const processInfo = await this.processSupervisor.waitForRunning(
        gameExecutable,
        1,
        0
      );
      if (processInfo) {
        return processInfo;
      }
      await this.delay(this.pollIntervalMs);
    }

    return null;
  }

  private async cancelledResult(
    evidencePath: string
  ): Promise<PackagedRuntimeValidationResult> {
    const result = validationResult("cancelled", evidencePath, null, [
      modProblem(
        "warning",
        "RUNTIME_VALIDATION_CANCELLED",
        "Packaged runtime validation was cancelled.",
        "CMM restored vanilla state and did not record runtime compatibility evidence."
      )
    ]);
    await this.writeEvidence(
      evidencePath,
      "runtime-validation-cancelled.json",
      result
    );
    await this.logger.log({
      category: "RUNTIME",
      action: "ue4ss_packaged_runtime_validation_cancelled",
      result: "ok"
    });
    return result;
  }
}

export function classifyPackagedRuntimeValidationFailure({
  logText,
  errorMessage,
  logPath,
  evidencePath,
  markers
}: {
  logText: string;
  errorMessage: string;
  logPath: string;
  evidencePath: string;
  markers: string[];
}): PackagedRuntimeFailureAnalysis {
  const missingSignatures = unique(
    [...logText.matchAll(/\[PS\] Failed to find (.+?): expected at least one value/g)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value))
  );
  const fatalError = logText.match(/Fatal Error:\s*(.+)/i)?.[1]?.trim();
  const engineVersion = logText.match(/\[PS\] Found EngineVersion:\s*([^\r\n]+)/i)?.[1]?.trim();

  if (
    missingSignatures.length > 0 ||
    /Fatal Error:\s*PS scan timed out/i.test(logText)
  ) {
    return {
      recordAsIncompatible: true,
      code: "UE4SS_BUNDLED_RUNTIME_PATTERN_SCAN_FAILED",
      message:
        "The packaged UE4SS runtime failed pattern scanning before the validation marker could run.",
      details: [
        "UE4SS pattern scan failed before the packaged validation Lua marker could run.",
        engineVersion ? `Engine version: ${engineVersion}.` : null,
        missingSignatures.length
          ? `Missing signatures: ${missingSignatures.join(", ")}.`
          : null,
        fatalError ? `Fatal error: ${fatalError}.` : null,
        `Evidence: ${evidencePath}.`,
        `Log: ${logPath}.`
      ].filter((part): part is string => part !== null).join(" ")
    };
  }

  const missingMarkers = markers.filter((marker) => !logText.includes(marker));
  const luaStarted = logText.includes(markers[0] ?? "");
  const markerPrefix = `[${PACKAGED_RUNTIME_VALIDATION_MOD_ID}]`;

  if (luaStarted || logText.includes(markerPrefix)) {
    return {
      recordAsIncompatible: true,
      code: "UE4SS_BUNDLED_RUNTIME_MARKER_INCOMPLETE",
      message:
        "The packaged UE4SS runtime started Lua but did not pass all read-only validation markers.",
      details: [
        "UE4SS reached the packaged validation Lua marker, but the required read-only runtime checks did not complete.",
        missingMarkers.length ? `Missing markers: ${missingMarkers.join(" | ")}.` : null,
        `Evidence: ${evidencePath}.`,
        `Log: ${logPath}.`
      ].filter((part): part is string => part !== null).join(" ")
    };
  }

  if (logText.trim().length === 0) {
    return {
      recordAsIncompatible: false,
      code: "UE4SS_BUNDLED_RUNTIME_LOG_MISSING",
      message: "CMM could not find UE4SS log output for packaged runtime validation.",
      details: `${errorMessage} Evidence: ${evidencePath}. Expected log: ${logPath}.`
    };
  }

  return {
    recordAsIncompatible: false,
    code: "UE4SS_BUNDLED_RUNTIME_MARKER_TIMEOUT",
    message:
      "Packaged runtime validation timed out before all read-only markers were observed.",
    details: [
      errorMessage,
      missingMarkers.length ? `Missing markers: ${missingMarkers.join(" | ")}.` : null,
      `Evidence: ${evidencePath}.`,
      `Log: ${logPath}.`
    ].filter((part): part is string => part !== null).join(" ")
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function waitForLogMarkers(
  logPath: string,
  markers: string[],
  timeoutMs: number,
  intervalMs: number,
  delay: (milliseconds: number) => Promise<void>,
  shouldCancel: () => boolean = () => false
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let logText = "";

  while (Date.now() <= deadline) {
    if (shouldCancel()) {
      throw new PackagedRuntimeValidationCancelledError();
    }
    logText = await readFile(logPath, "utf8").catch(() => "");
    if (markers.every((marker) => logText.includes(marker))) {
      return logText;
    }
    await delay(intervalMs);
  }

  throw new Error(
    `Timed out waiting for packaged runtime validation markers in ${logPath}.`
  );
}

function throwIfCancelled(run: ActivePackagedRuntimeValidationRun): void {
  if (run.cancelRequested) {
    throw new PackagedRuntimeValidationCancelledError();
  }
}

function validationResult(
  status: PackagedRuntimeValidationResult["status"],
  evidencePath: string | null,
  recording: RecordUe4ssRuntimeValidationResult | null,
  problems: ModProblem[]
): PackagedRuntimeValidationResult {
  return {
    status,
    evidencePath,
    recording,
    problems
  };
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
