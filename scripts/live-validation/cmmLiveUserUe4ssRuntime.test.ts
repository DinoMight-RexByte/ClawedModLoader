import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { ClawedGameAdapter } from "../../src/main/adapters/clawed/clawedGameAdapter";
import { LooseFileDeploymentAdapter } from "../../src/main/adapters/unreal/looseFileDeploymentAdapter";
import { PakDeploymentAdapter } from "../../src/main/adapters/unreal/pakDeploymentAdapter";
import { UE4SSDeploymentAdapter } from "../../src/main/adapters/ue4ss/ue4ssDeploymentAdapter";
import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalDeploymentService } from "../../src/main/services/deploymentService";
import { findUnrealShippingExecutable } from "../../src/main/services/gameExecutableDiscovery";
import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import {
  LocalLoadOrderService,
  LocalProfileService
} from "../../src/main/services/profileService";
import { LocalRuntimeManager } from "../../src/main/services/runtimeManager";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import {
  CLAWED_STEAM_APP_ID,
  type AppStorageLayout,
  type GameDiscovery,
  type RuntimeReleaseValidation
} from "../../src/shared/contracts/app";
import type { StorageServiceContract } from "../../src/shared/contracts/services";
import { createClawedModFixture } from "../../tests/helpers/clawedModFixture";

const execFileAsync = promisify(execFile);
const liveValidationEnabled =
  process.env.CMM_LIVE_CLAWED_USER_RUNTIME_VALIDATION === "1";
const defaultClawedInstallPath =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clawed";
const markerModId = "CMMUserRuntimeValidation";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

describe.runIf(liveValidationEnabled)(
  "live user-imported UE4SS runtime validation",
  () => {
    it("imports a user UE4SS ZIP, deploys a read-only marker, records evidence, and restores vanilla", async () => {
      const runtimeZipPath = process.env.CMM_LIVE_CLAWED_USER_UE4SS_RUNTIME_ZIP;
      expect(runtimeZipPath).toBeTruthy();

      const evidenceRoot = path.resolve(
        ".codex",
        "live-validation",
        `${timestampForPath()}-user-ue4ss-runtime`
      );
      const installPath = path.resolve(
        process.env.CMM_LIVE_CLAWED_INSTALL ?? defaultClawedInstallPath
      );
      const gameExecutable = await findUnrealShippingExecutable(installPath);
      expect(gameExecutable).toBeTruthy();

      const runtimeRoot = path.dirname(gameExecutable!);
      await mkdir(evidenceRoot, { recursive: true });
      const initialProcesses = await getClawedProcesses();
      await writeJson(path.join(evidenceRoot, "initial-processes.json"), {
        processes: initialProcesses
      });
      expect(initialProcesses).toEqual([]);

      const initialResidue = await inspectRuntimeResidue(runtimeRoot);
      await writeJson(path.join(evidenceRoot, "initial-runtime-residue.json"), {
        runtimeRoot,
        residue: initialResidue
      });
      expect(initialResidue).toEqual([]);

      const storageService = new FakeStorageService(
        createStorageLayout(path.join(evidenceRoot, "user-data"))
      );
      const packageService = new ClawedModPackageService();
      const modLibraryService = new LocalModLibraryService(
        storageService,
        packageService
      );
      const profileService = new LocalProfileService(
        storageService,
        modLibraryService
      );
      const loadOrderService = new LocalLoadOrderService(profileService);
      const logger = new NullLifecycleLogger();
      const runtimeManager = new LocalRuntimeManager(storageService, logger);
      const gameAdapter = new ClawedGameAdapter();
      const deploymentService = new LocalDeploymentService(
        storageService,
        modLibraryService,
        profileService,
        loadOrderService,
        runtimeManager,
        [
          new UE4SSDeploymentAdapter(),
          new PakDeploymentAdapter(),
          new LooseFileDeploymentAdapter()
        ],
        logger,
        {},
        gameAdapter
      );

      const discovery = createLiveDiscovery(installPath, gameExecutable!);
      const fingerprint = await gameAdapter.getFingerprint(discovery);
      await writeJson(path.join(evidenceRoot, "game-fingerprint.json"), fingerprint);

      let deploymentApplied = false;
      let logPath: string | null = null;
      let validationStatus: Extract<
        RuntimeReleaseValidation,
        "VALIDATED" | "INCOMPATIBLE"
      > | null = null;
      let validationDetails: string | undefined;
      let operationError: unknown = null;
      let cleanupError: Error | null = null;
      try {
        const runtimeResult = await runtimeManager.importUe4ssRuntime({
          sourcePath: path.resolve(runtimeZipPath!)
        });
        await writeJson(
          path.join(evidenceRoot, "runtime-import-result.json"),
          runtimeResult
        );
        expect(runtimeResult.status).toBe("imported");
        expect(runtimeResult.runtime).toMatchObject({
          source: "user",
          releaseValidation: "UNVALIDATED"
        });

        const postImportRuntime = await runtimeManager.getRuntimeSnapshot(
          fingerprint.steamBuildId
        );
        await writeJson(
          path.join(evidenceRoot, "runtime-post-import-snapshot.json"),
          postImportRuntime
        );
        expect(postImportRuntime.status).toBe("unvalidated");

        const fixture = await createRuntimeValidationFixture(evidenceRoot);
        const imported = await modLibraryService.importModPackage({
          packagePath: fixture.packagePath
        });
        await writeJson(path.join(evidenceRoot, "mod-import-result.json"), imported);
        expect(imported.status).toBe("installed");
        expect(imported.mod).toMatchObject({
          id: markerModId,
          loader: "ue4ss"
        });

        await profileService.setModEnabled({
          id: markerModId,
          version: fixture.manifest.version,
          enabled: true
        });
        const activeProfile = await profileService.getActiveProfile();
        await writeJson(path.join(evidenceRoot, "active-profile.json"), activeProfile);
        expect(activeProfile.orderedModIds).toEqual([markerModId]);

        const deploymentResult =
          await deploymentService.prepareModdedDeployment(discovery);
        deploymentApplied = deploymentResult.status === "ok";
        await writeJson(
          path.join(evidenceRoot, "deployment-result.json"),
          deploymentResult
        );
        expect(deploymentResult.status).toBe("ok");
        expect(deploymentResult.state).toBe("runtimeUnvalidated");
        expect(deploymentResult.manifest?.runtimeConfiguration).toMatchObject({
          type: "ue4ss",
          releaseValidation: "UNVALIDATED",
          effectiveOrderKnown: false,
          logicalOrder: [markerModId]
        });

        logPath = getUe4ssLogPath(
          discovery.gameInstallPath!,
          deploymentResult.manifest!.runtimeConfiguration
        );
        await launchClawedThroughSteam();
        const logText = await waitForLogMarkers(
          logPath,
          validationMarkers(),
          100_000
        );
        await writeFile(
          path.join(evidenceRoot, "UE4SS-user-runtime-final.log"),
          logText
        );
        await copyFile(
          logPath,
          path.join(evidenceRoot, "UE4SS-user-runtime-live.log")
        );
        await writeJson(path.join(evidenceRoot, "launch-summary.json"), {
          logPath,
          markersObserved: true,
          processes: await getClawedProcesses()
        });
        validationStatus = "VALIDATED";
        validationDetails = "Minimal read-only Lua startup marker passed.";
      } catch (error) {
        operationError = error;
        validationDetails = error instanceof Error ? error.message : String(error);
        if (logPath) {
          await preserveRuntimeValidationLog(evidenceRoot, logPath, "failure");
        }
        if (deploymentApplied) {
          validationStatus = "INCOMPATIBLE";
        }
      } finally {
        if (deploymentApplied) {
          await requestClawedClose();
          const remainingProcesses = await waitForNoClawedProcesses(45_000);
          await writeJson(path.join(evidenceRoot, "close-summary.json"), {
            remainingProcesses
          });
          if (remainingProcesses.length > 0) {
            cleanupError = new Error(
              "Clawed did not exit after normal window close; user-runtime validation refused force-close and skipped file restore while the game was running."
            );
          } else {
            const vanillaResult =
              await deploymentService.prepareVanillaDeployment(discovery);
            await writeJson(
              path.join(evidenceRoot, "vanilla-restore-result.json"),
              vanillaResult
            );
            if (vanillaResult.status !== "ok") {
              cleanupError = new Error(
                `CMM vanilla restore failed with status ${vanillaResult.status}.`
              );
            }

            const finalResidue = await inspectRuntimeResidue(runtimeRoot);
            await writeJson(path.join(evidenceRoot, "final-runtime-residue.json"), {
              runtimeRoot,
              residue: finalResidue
            });
            if (finalResidue.length > 0) {
              cleanupError = new Error(
                `CMM vanilla restore left runtime residue: ${finalResidue.join(", ")}`
              );
            }
          }
        }
      }

      if (!cleanupError && validationStatus) {
        const recorded = await runtimeManager.recordUe4ssRuntimeValidation({
          status: validationStatus,
          steamBuildId: fingerprint.steamBuildId,
          fingerprintSha256: fingerprint.fingerprintSha256,
          evidencePath: evidenceRoot,
          markerModId,
          details: validationDetails
        });
        await writeJson(
          path.join(evidenceRoot, "runtime-validation-recording.json"),
          recorded
        );
        const finalRuntime = await runtimeManager.getRuntimeSnapshot(
          fingerprint.steamBuildId
        );
        await writeJson(
          path.join(evidenceRoot, "runtime-final-snapshot.json"),
          finalRuntime
        );
        expect(recorded.status).toBe("recorded");
        expect(finalRuntime.status).toBe(
          validationStatus === "VALIDATED" ? "validated" : "incompatible"
        );
      }

      if (cleanupError) {
        throw cleanupError;
      }
      if (operationError) {
        throw operationError;
      }
    }, 360_000);
  }
);

function createLiveDiscovery(
  installPath: string,
  gameExecutable: string
): GameDiscovery {
  const steamAppsPath = path.dirname(path.dirname(installPath));
  const steamLibraryPath = path.dirname(steamAppsPath);
  const appManifestPath = path.join(
    steamAppsPath,
    `appmanifest_${CLAWED_STEAM_APP_ID}.acf`
  );

  return {
    appId: CLAWED_STEAM_APP_ID,
    steamPath: steamLibraryPath,
    steamLibrary: steamLibraryPath,
    steamLibraries: [{ path: steamLibraryPath, appManifestPath }],
    appManifestPath,
    gameInstallPath: installPath,
    gameExecutable,
    discoveryStatus: "READY",
    source: "manual",
    manualOverride: installPath,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}

async function createRuntimeValidationFixture(evidenceRoot: string) {
  return createClawedModFixture(
    path.join(evidenceRoot, "fixtures", `${markerModId}.clawedmod`),
    {
      manifest: {
        id: markerModId,
        name: "CMM User Runtime Validation",
        version: timestampForVersion(),
        author: "Clawed Mod Manager",
        description: "Minimal read-only Lua marker for user UE4SS validation.",
        loader: "ue4ss"
      },
      payloadText: runtimeValidationLua()
    }
  );
}

function runtimeValidationLua(): string {
  return [
    `local marker = "[${markerModId}] "`,
    "local function cmm_log(message)",
    "    print(marker .. message)",
    "end",
    'cmm_log("Lua startup marker from user UE4SS runtime validation")',
    "ExecuteInGameThread(function()",
    '    cmm_log("ExecuteInGameThread callback marker")',
    '    local engine = FindFirstOf("GameEngine")',
    '    cmm_log("FindFirstOf(GameEngine) completed: " .. tostring(engine ~= nil))',
    "end)"
  ].join("\n");
}

function validationMarkers(): string[] {
  return [
    `Starting Lua mod '${markerModId}'`,
    `[${markerModId}] Lua startup marker from user UE4SS runtime validation`,
    `[${markerModId}] ExecuteInGameThread callback marker`,
    `[${markerModId}] FindFirstOf(GameEngine) completed: true`
  ];
}

function getUe4ssLogPath(
  gameInstallPath: string,
  configuration: Record<string, unknown>
): string {
  const runtimeModsRelativePath =
    typeof configuration.runtimeModsRelativePath === "string"
      ? path.normalize(configuration.runtimeModsRelativePath)
      : "Mods";
  const runtimeTargetRelativePath =
    typeof configuration.runtimeTargetRelativePath === "string"
      ? path.normalize(configuration.runtimeTargetRelativePath)
      : "";
  const runtimeSubdirectory = path.dirname(runtimeModsRelativePath);
  const logRelativePath =
    runtimeSubdirectory === "."
      ? "UE4SS.log"
      : path.join(runtimeSubdirectory, "UE4SS.log");

  return path.join(gameInstallPath, runtimeTargetRelativePath, logRelativePath);
}

async function preserveRuntimeValidationLog(
  evidenceRoot: string,
  logPath: string,
  suffix: string
): Promise<void> {
  const logText = await readFile(logPath, "utf8").catch(() => "");
  if (logText.length === 0) {
    return;
  }

  await writeFile(
    path.join(evidenceRoot, `UE4SS-user-runtime-${suffix}.log`),
    logText
  );
}

async function launchClawedThroughSteam(): Promise<void> {
  await runPowerShell(`Start-Process 'steam://run/${CLAWED_STEAM_APP_ID}'`);
}

async function requestClawedClose(): Promise<void> {
  await runPowerShell(
    [
      "$processes = @(Get-Process | Where-Object { $_.ProcessName -eq 'Clawed-Win64-Shipping' })",
      "foreach ($process in $processes) { [void]$process.CloseMainWindow() }",
      "$processes.Count"
    ].join("; ")
  );
}

async function waitForNoClawedProcesses(timeoutMs: number): Promise<ProcessInfo[]> {
  const deadline = Date.now() + timeoutMs;
  let processes = await getClawedProcesses();

  while (processes.length > 0 && Date.now() < deadline) {
    await sleep(1_000);
    processes = await getClawedProcesses();
    if (processes.length > 0) {
      await requestClawedClose();
    }
  }

  return processes;
}

async function getClawedProcesses(): Promise<ProcessInfo[]> {
  const output = await runPowerShell(
    [
      "$processes = @(Get-Process | Where-Object { $_.ProcessName -eq 'Clawed-Win64-Shipping' } | Select-Object Id, ProcessName, MainWindowTitle)",
      "if ($processes.Count -eq 0) { '[]' } else { $processes | ConvertTo-Json -Compress }"
    ].join("; ")
  );
  const parsed = JSON.parse(output.length > 0 ? output : "[]") as
    | ProcessInfo
    | ProcessInfo[];

  return Array.isArray(parsed) ? parsed : [parsed];
}

async function waitForLogMarkers(
  logPath: string,
  markers: string[],
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = await readFile(logPath, "utf8").catch(() => "");
    if (markers.every((marker) => lastText.includes(marker))) {
      return lastText;
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for CMM user-runtime markers in ${logPath}. Last log length: ${lastText.length}.`
  );
}

async function inspectRuntimeResidue(runtimeRoot: string): Promise<string[]> {
  const candidatePaths = [
    "dwmapi.dll",
    "UE4SS.dll",
    "UE4SS-settings.ini",
    "UE4SS.log",
    "Mods",
    path.join("ue4ss", "dwmapi.dll"),
    path.join("ue4ss", "UE4SS.dll"),
    path.join("ue4ss", "UE4SS-settings.ini"),
    path.join("ue4ss", "UE4SS.log"),
    path.join("ue4ss", "Mods"),
    path.join("ue4ss", "UE4SS_Signatures")
  ];
  const residue: string[] = [];

  for (const candidatePath of candidatePaths) {
    if (await exists(path.join(runtimeRoot, candidatePath))) {
      residue.push(candidatePath);
    }
  }

  return residue;
}

async function runPowerShell(command: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true
    }
  );

  return stdout.trim();
}

async function writeJson(outputPath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function exists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampForPath(): string {
  return new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}

function timestampForVersion(): string {
  return new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "");
}

interface ProcessInfo {
  Id: number;
  ProcessName: string;
  MainWindowTitle: string | null;
}
