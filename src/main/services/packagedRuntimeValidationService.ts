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
import type { ProcessPlatform } from "./processPlatform";
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

export class PackagedRuntimeValidationService
  implements PackagedRuntimeValidationServiceContract {
  private readonly markerTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly launchDetectTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly delay: (milliseconds: number) => Promise<void>;

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
    let processId: number | null = null;
    let validationStatus: Extract<
      RuntimeReleaseValidation,
      "VALIDATED" | "INCOMPATIBLE"
    > | null = null;
    let validationDetails: string | undefined;
    let operationError: unknown = null;
    let cleanupProblems: ModProblem[] = [];

    await this.writeEvidence(evidencePath, "discovery.json", discovery);

    const deployment =
      await this.deploymentService.prepareRuntimeValidationDeployment(discovery);
    await this.writeEvidence(evidencePath, "deployment-result.json", deployment);
    if (deployment.status !== "ok" || !deployment.manifest) {
      return validationResult("blocked", evidencePath, null, deployment.problems);
    }

    const logPath = getUe4ssLogPath(
      discovery.gameInstallPath,
      deployment.manifest.runtimeConfiguration
    );

    try {
      this.processSupervisor.markStarting();
      await this.platform.launchSteamApp(CLAWED_STEAM_APP_ID);
      const processInfo = await this.processSupervisor.waitForRunning(
        discovery.gameExecutable,
        this.launchDetectTimeoutMs,
        this.pollIntervalMs
      );
      if (!processInfo) {
        throw new Error("Steam launch was requested, but Clawed was not detected.");
      }

      processId = processInfo.processId;
      const logText = await waitForLogMarkers(
        logPath,
        packagedRuntimeValidationMarkers(),
        this.markerTimeoutMs,
        this.pollIntervalMs,
        this.delay
      );
      await writeFile(path.join(evidencePath, "UE4SS-packaged-runtime.log"), logText);
      validationStatus = "VALIDATED";
      validationDetails = "Minimal read-only Lua startup marker passed.";
    } catch (error) {
      operationError = error;
      validationDetails = error instanceof Error ? error.message : String(error);
      const logText = await readFile(logPath, "utf8").catch(() => "");
      if (logText.length > 0) {
        await writeFile(
          path.join(evidencePath, "UE4SS-packaged-runtime-failure.log"),
          logText
        );
      }
      if (processId !== null) {
        validationStatus = "INCOMPATIBLE";
      }
    } finally {
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

    if (!validationStatus) {
      return validationResult("failed", evidencePath, null, [
        modProblem(
          "error",
          "RUNTIME_VALIDATION_FAILED",
          "Packaged runtime validation did not complete.",
          operationError instanceof Error ? operationError.message : String(operationError)
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
    await this.writeEvidence(evidencePath, "runtime-validation-recording.json", recording);
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
}

async function waitForLogMarkers(
  logPath: string,
  markers: string[],
  timeoutMs: number,
  intervalMs: number,
  delay: (milliseconds: number) => Promise<void>
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let logText = "";

  while (Date.now() <= deadline) {
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
