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
  type GameDiscovery
} from "../../src/shared/contracts/app";
import type { StorageServiceContract } from "../../src/shared/contracts/services";
import {
  createVisibleValidationFixture,
  visibleMessage,
  visibleModId,
  visibleValidationMarkers
} from "./visibleValidationFixture";

const execFileAsync = promisify(execFile);
const liveValidationEnabled =
  process.env.CMM_LIVE_CLAWED_VISIBLE_MOD_VALIDATION === "1";
const defaultClawedInstallPath =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clawed";
const bundledUe4ssVersion = "ue4ss-experimental-latest-1c1a1497";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

describe.runIf(liveValidationEnabled)("live visible UE4SS validation mod", () => {
  it("deploys a visible .clawedmod, observes the on-screen marker path, captures evidence, and restores vanilla", async () => {
    const evidenceRoot = path.resolve(
      ".codex",
      "live-validation",
      `${timestampForPath()}-visible-mod`
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
    const runtimeManager = new LocalRuntimeManager(storageService, logger, {
      bundledUe4ssRuntimePath: path.resolve(
        "assets",
        "runtime",
        "ue4ss",
        "default"
      ),
      bundledUe4ssVersion,
      bundledUe4ssCompatibility: {
        status: "validated",
        message:
          "Packaged UE4SS experimental-latest commit 1c1a1497 loads Lua mods and honors generated mods.txt Lua startup order on Clawed build 24719259.",
        technicalDetail:
          "Live validation on 2026-08-13 loaded the official nested layout through the local dwmapi proxy and observed generated .clawedmod Lua startup in CMM profile order."
      }
    });
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
    const logPath = path.join(runtimeRoot, "ue4ss", "UE4SS.log");

    let deploymentApplied = false;
    let operationError: unknown = null;
    let cleanupError: Error | null = null;
    try {
      const runtimeResult = await runtimeManager.installBundledUe4ssRuntime();
      await writeJson(path.join(evidenceRoot, "runtime-install-result.json"), runtimeResult);
      expect(runtimeResult.status).toBe("imported");

      const fixture = await createVisibleValidationFixture(evidenceRoot);
      const imported = await modLibraryService.importModPackage({
        packagePath: fixture.packagePath
      });
      await writeJson(path.join(evidenceRoot, "mod-import-result.json"), imported);
      expect(imported.status).toBe("installed");
      expect(imported.mod).toMatchObject({
        id: visibleModId,
        loader: "ue4ss"
      });

      await profileService.setModEnabled({
        id: visibleModId,
        version: fixture.manifest.version,
        enabled: true
      });
      const activeProfile = await profileService.getActiveProfile();
      await writeJson(path.join(evidenceRoot, "active-profile.json"), activeProfile);
      expect(activeProfile.orderedModIds).toEqual([visibleModId]);

      const deploymentResult =
        await deploymentService.prepareModdedDeployment(discovery);
      deploymentApplied = deploymentResult.status === "ok";
      await writeJson(
        path.join(evidenceRoot, "deployment-result.json"),
        deploymentResult
      );
      expect(deploymentResult.status).toBe("ok");
      expect(deploymentResult.state).toBe("moddedReady");
      expect(deploymentResult.manifest?.runtimeConfiguration).toMatchObject({
        type: "ue4ss",
        effectiveOrderKnown: true,
        logicalOrder: [visibleModId]
      });

      await launchClawedThroughSteam();
      const logText = await waitForLogMarkers(
        logPath,
        visibleValidationMarkers(),
        100_000
      );
      await writeFile(path.join(evidenceRoot, "UE4SS-visible-mod-final.log"), logText);
      await copyFile(logPath, path.join(evidenceRoot, "UE4SS-visible-mod-live.log"));

      await sleep(500);
      const screenshotPath = path.join(evidenceRoot, "visible-mod-screenshot.png");
      const screenshot = await captureClawedWindowScreenshot(screenshotPath);
      await writeJson(path.join(evidenceRoot, "visible-screenshot.json"), screenshot);
      const screenshotStats = await stat(screenshotPath);
      expect(screenshotStats.size).toBeGreaterThan(10_000);

      await sleep(5_000);
      const delayedLogText = await readFile(logPath, "utf8");
      await writeFile(
        path.join(evidenceRoot, "UE4SS-visible-mod-delayed.log"),
        delayedLogText
      );
      const delayedScreenshotPath = path.join(
        evidenceRoot,
        "visible-mod-screenshot-delayed.png"
      );
      const delayedScreenshot =
        await captureClawedWindowScreenshot(delayedScreenshotPath);
      await writeJson(
        path.join(evidenceRoot, "visible-screenshot-delayed.json"),
        delayedScreenshot
      );

      await writeJson(path.join(evidenceRoot, "launch-summary.json"), {
        logPath,
        visibleMessage,
        screenshotPath,
        markersObserved: true,
        processes: await getClawedProcesses()
      });
    } catch (error) {
      await preserveVisibleValidationLog(evidenceRoot, logPath, "failure");
      operationError = error;
    } finally {
      if (deploymentApplied) {
        await requestClawedClose();
        const remainingProcesses = await waitForNoClawedProcesses(45_000);
        await writeJson(path.join(evidenceRoot, "close-summary.json"), {
          remainingProcesses
        });
        if (remainingProcesses.length > 0) {
          cleanupError = new Error(
            "Clawed did not exit after normal window close; live visible validation refused force-close and skipped file restore while the game was running."
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

    if (cleanupError) {
      throw cleanupError;
    }
    if (operationError) {
      throw operationError;
    }
  }, 360_000);
});

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

async function preserveVisibleValidationLog(
  evidenceRoot: string,
  logPath: string,
  suffix: string
): Promise<void> {
  const logText = await readFile(logPath, "utf8").catch(() => "");
  if (logText.length === 0) {
    return;
  }

  await writeFile(
    path.join(evidenceRoot, `UE4SS-visible-mod-${suffix}.log`),
    logText
  );
}

async function captureClawedWindowScreenshot(
  outputPath: string
): Promise<ScreenshotMetadata> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const script = [
    `$outputPath = ${powerShellString(outputPath)}`,
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class CmmUser32 {",
    "    [StructLayout(LayoutKind.Sequential)]",
    "    public struct RECT {",
    "        public int Left;",
    "        public int Top;",
    "        public int Right;",
    "        public int Bottom;",
    "    }",
    "    [DllImport(\"user32.dll\")]",
    "    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);",
    "    [DllImport(\"user32.dll\")]",
    "    public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "}",
    "'@",
    "$processes = @(Get-Process | Where-Object { $_.ProcessName -like '*Clawed*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1)",
    "if ($processes.Count -eq 0) { throw 'No visible Clawed window found for screenshot capture.' }",
    "$process = $processes[0]",
    "[void][CmmUser32]::SetForegroundWindow($process.MainWindowHandle)",
    "Start-Sleep -Milliseconds 750",
    "$rect = New-Object CmmUser32+RECT",
    "if (-not [CmmUser32]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) { throw 'Unable to read Clawed window bounds.' }",
    "$width = $rect.Right - $rect.Left",
    "$height = $rect.Bottom - $rect.Top",
    "if ($width -le 0 -or $height -le 0) { throw \"Invalid Clawed window bounds: $width x $height.\" }",
    "$bitmap = New-Object System.Drawing.Bitmap $width, $height",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "try {",
    "    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)",
    "    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)",
    "} finally {",
    "    $graphics.Dispose()",
    "    $bitmap.Dispose()",
    "}",
    "[pscustomobject]@{ path = $outputPath; width = $width; height = $height } | ConvertTo-Json -Compress"
  ].join("\n");
  const output = await runPowerShell(script);
  return JSON.parse(output) as ScreenshotMetadata;
}

async function launchClawedThroughSteam(): Promise<void> {
  await runPowerShell(`Start-Process 'steam://run/${CLAWED_STEAM_APP_ID}'`);
}

async function requestClawedClose(): Promise<void> {
  await runPowerShell(
    [
      "$processes = @(Get-Process | Where-Object { $_.ProcessName -like '*Clawed*' })",
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
      "$processes = @(Get-Process | Where-Object { $_.ProcessName -like '*Clawed*' } | Select-Object Id, ProcessName, MainWindowTitle)",
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
    `Timed out waiting for CMM visible validation markers in ${logPath}. Last log length: ${lastText.length}.`
  );
}

async function inspectRuntimeResidue(runtimeRoot: string): Promise<string[]> {
  const candidatePaths = [
    "dwmapi.dll",
    "UE4SS.dll",
    "UE4SS-settings.ini",
    "UE4SS.log",
    "Mods",
    "ue4ss"
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

function powerShellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

interface ScreenshotMetadata {
  path: string;
  width: number;
  height: number;
}

interface ProcessInfo {
  Id: number;
  ProcessName: string;
  MainWindowTitle: string | null;
}
