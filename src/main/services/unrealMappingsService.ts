import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  CLAWED_STEAM_APP_ID,
  CreatorMappingsDumpProgressSchema,
  CreatorMappingsDumpResultSchema,
  type CreatorMappingsDumpProgress,
  type CreatorMappingsDumpResult,
  type GameDiscovery,
  type ModProblem,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  DeploymentServiceContract,
  GameLocatorContract,
  StorageServiceContract,
  UnrealMappingsServiceContract
} from "../../shared/contracts/services";
import type { LifecycleLogger } from "./lifecycleLogger";
import { modProblem } from "./packageProblems";
import type { ProcessPlatform } from "./processPlatform";
import type { WindowsProcessSupervisor } from "./processSupervisor";
import { getUe4ssLogPath } from "./runtimeValidationProbe";
import { unrealMappingsDumpMarkers } from "./unrealMappingsDumpProbe";

export interface UnrealMappingsServiceOptions {
  mappingTimeoutMs?: number;
  closeTimeoutMs?: number;
  launchDetectTimeoutMs?: number;
  pollIntervalMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

type MappingsProgressEmitter = (
  progress: CreatorMappingsDumpProgress
) => void;

const stableMappingsFileName = "Mappings.usmap";

export class LocalUnrealMappingsService implements UnrealMappingsServiceContract {
  private readonly mappingTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly launchDetectTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly delay: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly gameLocator: GameLocatorContract,
    private readonly deploymentService: DeploymentServiceContract,
    private readonly processSupervisor: WindowsProcessSupervisor,
    private readonly platform: ProcessPlatform,
    private readonly logger: LifecycleLogger,
    options?: UnrealMappingsServiceOptions
  ) {
    this.mappingTimeoutMs = options?.mappingTimeoutMs ?? 180_000;
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
      id: "unrealMappingsService",
      label: "Unreal Mappings Service",
      status: "ready",
      detail: "Stages a temporary UE4SS task to generate Mappings.usmap."
    };
  }

  async generateMappings(
    onProgress?: MappingsProgressEmitter
  ): Promise<CreatorMappingsDumpResult> {
    emitProgress(onProgress, {
      stage: "checking",
      status: "running",
      message: "Checking Clawed install and existing mappings."
    });
    const discovery = await this.gameLocator.rescan();
    const blocked = await this.blockIfNotReady(discovery);
    if (blocked) {
      emitProgress(onProgress, {
        stage: "blocked",
        status: "blocked",
        message: blocked[0]?.message ?? "Mappings generation is blocked.",
        detail: blocked[0]?.technicalDetail ?? null
      });
      return result("blocked", null, null, blocked);
    }

    const existing = await findMappingsPath(discovery);
    if (existing) {
      emitProgress(onProgress, {
        stage: "complete",
        status: "done",
        message: "Mappings.usmap already exists.",
        mappingsPath: existing
      });
      return result("ready", existing, null, []);
    }

    const evidencePath = await this.createEvidencePath();
    emitProgress(onProgress, {
      stage: "checking",
      status: "done",
      message: "No existing Mappings.usmap was found.",
      evidencePath
    });
    await this.writeEvidence(evidencePath, "discovery.json", discovery);

    let processId: number | null = null;
    let cleanupProblems: ModProblem[] = [];
    let mappingsPath: string | null = null;

    emitProgress(onProgress, {
      stage: "staging",
      status: "running",
      message: "Staging temporary UE4SS mapping dump.",
      evidencePath
    });
    const deployment =
      await this.deploymentService.prepareUnrealMappingsDumpDeployment(discovery);
    await this.writeEvidence(evidencePath, "deployment-result.json", deployment);
    if (deployment.status !== "ok" || !deployment.manifest) {
      emitProgress(onProgress, {
        stage: "blocked",
        status: "blocked",
        message:
          deployment.problems[0]?.message ??
          "CMM could not stage the mapping dump deployment.",
        detail: deployment.problems[0]?.technicalDetail ?? null,
        evidencePath
      });
      return result("blocked", null, evidencePath, deployment.problems);
    }
    emitProgress(onProgress, {
      stage: "staging",
      status: "done",
      message: "Temporary UE4SS mapping dump is staged.",
      evidencePath
    });

    const logPath = getUe4ssLogPath(
      discovery.gameInstallPath as string,
      deployment.manifest.runtimeConfiguration
    );

    let activeStage: CreatorMappingsDumpProgress["stage"] = "launching";
    try {
      this.processSupervisor.markStarting();
      this.processSupervisor.markAppExitManagedLaunch(
        discovery.gameExecutable as string
      );
      activeStage = "launching";
      emitProgress(onProgress, {
        stage: "launching",
        status: "running",
        message: "Launching Clawed through Steam.",
        evidencePath
      });
      await this.platform.launchSteamApp(CLAWED_STEAM_APP_ID);
      activeStage = "waitingForGame";
      emitProgress(onProgress, {
        stage: "waitingForGame",
        status: "running",
        message: "Waiting for Clawed to start.",
        evidencePath
      });
      const processInfo = await this.processSupervisor.waitForRunning(
        discovery.gameExecutable as string,
        this.launchDetectTimeoutMs,
        this.pollIntervalMs,
        { appExitManaged: true }
      );
      if (!processInfo) {
        throw new Error("Steam launch was requested, but Clawed was not detected.");
      }

      processId = processInfo.processId;
      activeStage = "waitingForMappings";
      emitProgress(onProgress, {
        stage: "waitingForMappings",
        status: "running",
        message: "Waiting for UE4SS to write a .usmap file.",
        detail: `Timeout: ${Math.round(this.mappingTimeoutMs / 1000)} seconds.`,
        evidencePath
      });
      mappingsPath = await waitForMappings(discovery, {
        timeoutMs: this.mappingTimeoutMs,
        intervalMs: this.pollIntervalMs,
        delay: this.delay
      });
      emitProgress(onProgress, {
        stage: "waitingForMappings",
        status: "done",
        message: "Mappings.usmap was generated.",
        mappingsPath,
        evidencePath
      });
      const logText = await readFile(logPath, "utf8").catch(() => "");
      if (logText) {
        await writeFile(path.join(evidencePath, "UE4SS-unreal-mappings.log"), logText);
      }
      await this.writeEvidence(evidencePath, "mappings-result.json", {
        mappingsPath,
        markers: unrealMappingsDumpMarkers().filter((marker) =>
          logText.includes(marker)
        )
      });
    } catch (error) {
      const logText = await readFile(logPath, "utf8").catch(() => "");
      if (logText) {
        await writeFile(
          path.join(evidencePath, "UE4SS-unreal-mappings-failure.log"),
          logText
        );
      }
      cleanupProblems = [
        modProblem(
          "error",
          "UNREAL_MAPPINGS_DUMP_FAILED",
          "CMM could not generate Mappings.usmap through UE4SS.",
          error instanceof Error ? error.message : String(error)
        )
      ];
      emitProgress(onProgress, {
        stage: activeStage,
        status: "failed",
        message: cleanupProblems[0]?.message ?? "Mappings generation failed.",
        detail: cleanupProblems[0]?.technicalDetail ?? null,
        evidencePath
      });
    } finally {
      if (processId !== null) {
        emitProgress(onProgress, {
          stage: "closingGame",
          status: "running",
          message: "Asking Clawed to close.",
          evidencePath
        });
        await this.processSupervisor.requestGracefulShutdown(processId);
        const closed = await this.processSupervisor.waitForExit(
          processId,
          this.closeTimeoutMs,
          this.pollIntervalMs
        );
        if (!closed) {
          const problem = modProblem(
            "error",
            "UNREAL_MAPPINGS_CLOSE_TIMEOUT",
            "Clawed did not close after mappings generation.",
            "CMM did not force-close the game. Close Clawed manually, then restore vanilla from Diagnostics."
          );
          cleanupProblems.push(problem);
          emitProgress(onProgress, {
            stage: "failed",
            status: "failed",
            message: problem.message,
            detail: problem.technicalDetail ?? null,
            evidencePath
          });
        } else {
          emitProgress(onProgress, {
            stage: "closingGame",
            status: "done",
            message: "Clawed closed.",
            evidencePath
          });
        }
      }

      if (
        !cleanupProblems.some(
          (problem) => problem.code === "UNREAL_MAPPINGS_CLOSE_TIMEOUT"
        )
      ) {
        emitProgress(onProgress, {
          stage: "restoringVanilla",
          status: "running",
          message: "Restoring vanilla deployment state.",
          evidencePath
        });
        const vanilla =
          await this.deploymentService.prepareVanillaDeployment(discovery);
        await this.writeEvidence(evidencePath, "vanilla-restore-result.json", vanilla);
        if (vanilla.status !== "ok") {
          cleanupProblems.push(...vanilla.problems);
          emitProgress(onProgress, {
            stage: "failed",
            status: "failed",
            message:
              vanilla.problems[0]?.message ??
              "CMM could not restore vanilla deployment state.",
            detail: vanilla.problems[0]?.technicalDetail ?? null,
            evidencePath
          });
        } else {
          emitProgress(onProgress, {
            stage: "restoringVanilla",
            status: "done",
            message: "Vanilla deployment state restored.",
            evidencePath
          });
        }
      }
    }

    if (cleanupProblems.length > 0) {
      await this.logger.log({
        category: "unrealMappingsService",
        action: "unreal_mappings_dump_failed",
        result: "failed",
        errorCode: cleanupProblems[0]?.code,
        message: cleanupProblems[0]?.message,
        details: { evidencePath }
      });
      return result("failed", mappingsPath, evidencePath, cleanupProblems);
    }

    await this.logger.log({
      category: "unrealMappingsService",
      action: "unreal_mappings_dump_generated",
      result: "ok",
      details: { evidencePath, mappingsPath }
    });
    emitProgress(onProgress, {
      stage: "complete",
      status: "done",
      message: "Mappings generation complete.",
      mappingsPath,
      evidencePath
    });
    return result("generated", mappingsPath, evidencePath, []);
  }

  private async blockIfNotReady(
    discovery: GameDiscovery
  ): Promise<ModProblem[] | null> {
    if (!discovery.gameInstallPath || !discovery.gameExecutable) {
      return [
        modProblem(
          "error",
          "GAME_INSTALL_MISSING",
          "Clawed must be detected before CMM can generate Unreal mappings."
        )
      ];
    }

    if (await this.processSupervisor.findGameProcess(discovery.gameExecutable)) {
      return [
        modProblem(
          "error",
          "UNREAL_MAPPINGS_GAME_RUNNING",
          "Close Clawed before generating Unreal mappings."
        )
      ];
    }

    return null;
  }

  private async createEvidencePath(): Promise<string> {
    const layout = await this.storageService.getLayout();
    const evidencePath = path.join(
      layout.directories.logs,
      "unreal-mappings",
      new Date().toISOString().replace(/[:.]/g, "-")
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

async function waitForMappings(
  discovery: GameDiscovery,
  options: {
    timeoutMs: number;
    intervalMs: number;
    delay: (milliseconds: number) => Promise<void>;
  }
): Promise<string> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() <= deadline) {
    const mappingsPath = await findMappingsPath(discovery);
    if (mappingsPath) {
      return mappingsPath;
    }
    await options.delay(options.intervalMs);
  }

  throw new Error("Timed out waiting for a generated .usmap file.");
}

async function findMappingsPath(discovery: GameDiscovery): Promise<string | null> {
  if (!discovery.gameExecutable) {
    return null;
  }

  const binaryDirectory = path.dirname(discovery.gameExecutable);
  const stablePath = path.join(binaryDirectory, stableMappingsFileName);
  const stableInfo = await stat(stablePath).catch(() => null);
  if (stableInfo?.isFile() && stableInfo.size > 0) {
    return stablePath;
  }

  const generatedPath = await findGeneratedMappingsPath(binaryDirectory);
  if (!generatedPath) {
    return null;
  }

  if (path.resolve(generatedPath) !== path.resolve(stablePath)) {
    await copyFile(generatedPath, stablePath);
  }

  const normalizedInfo = await stat(stablePath).catch(() => null);
  return normalizedInfo?.isFile() && normalizedInfo.size > 0 ? stablePath : null;
}

async function findGeneratedMappingsPath(
  binaryDirectory: string
): Promise<string | null> {
  const candidates = await Promise.all(
    [binaryDirectory, path.join(binaryDirectory, "ue4ss")].map(async (directory) => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(
        () => []
      );
      return Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isFile() && entry.name.toLowerCase().endsWith(".usmap")
          )
          .map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            const info = await stat(filePath).catch(() => null);
            return info?.isFile() && info.size > 0
              ? { filePath, mtimeMs: info.mtimeMs }
              : null;
          })
      );
    })
  );
  return candidates
    .flat()
    .filter((candidate): candidate is { filePath: string; mtimeMs: number } =>
      Boolean(candidate)
    )
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath ?? null;
}

function result(
  status: CreatorMappingsDumpResult["status"],
  mappingsPath: string | null,
  evidencePath: string | null,
  problems: ModProblem[]
): CreatorMappingsDumpResult {
  return CreatorMappingsDumpResultSchema.parse({
    status,
    mappingsPath,
    evidencePath,
    problems
  });
}

function emitProgress(
  onProgress: MappingsProgressEmitter | undefined,
  progress: {
    stage: CreatorMappingsDumpProgress["stage"];
    status: CreatorMappingsDumpProgress["status"];
    message: string;
    detail?: string | null;
    mappingsPath?: string | null;
    evidencePath?: string | null;
  }
): void {
  onProgress?.(
    CreatorMappingsDumpProgressSchema.parse({
      detail: null,
      mappingsPath: null,
      evidencePath: null,
      ...progress
    })
  );
}
