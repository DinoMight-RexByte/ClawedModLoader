import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { describe, expect, it } from "vitest";

import { hashFileSha256 } from "../../src/main/services/clawedModPackageService";
import { findUnrealShippingExecutable } from "../../src/main/services/gameExecutableDiscovery";
import { isPathInside } from "../../src/main/services/packagePaths";
import {
  DeploymentManifestSchema,
  type LaunchCommandResult
} from "../../src/shared/contracts/app";
import type { CmmApi } from "../../src/shared/contracts/ipc";
import {
  createVisibleValidationFixture,
  visibleMessage,
  visibleModId,
  visibleValidationMarkers
} from "./visibleValidationFixture";

const execFileAsync = promisify(execFile);
const liveValidationEnabled =
  process.env.CMM_LIVE_CLAWED_ELECTRON_VISIBLE_VALIDATION === "1";
const defaultClawedInstallPath =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clawed";

describe.runIf(liveValidationEnabled)("live CMM Electron visible mod deployment", () => {
  it("imports a visible UE4SS .clawedmod through Electron IPC, launches modded, captures evidence, and restores vanilla", async () => {
    const evidenceRoot = path.resolve(
      ".codex",
      "live-validation",
      `${timestampForPath()}-cmm-electron-visible`
    );
    const userDataRoot = path.join(evidenceRoot, "user-data");
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

    let app: ElectronApplication | null = null;
    let page: Page | null = null;
    let operationError: unknown = null;
    let cleanupError: Error | null = null;

    try {
      app = await electron.launch({
        args: [path.resolve(".")],
        cwd: path.resolve("."),
        env: {
          ...process.env,
          CMM_ALLOW_USER_DATA_OVERRIDE: "1",
          CMM_USER_DATA_DIR: userDataRoot
        }
      });
      page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForFunction(() => "cmm" in window);
      await page.setViewportSize({ width: 1280, height: 820 }).catch(
        () => undefined
      );
      const initialWindowState = await writeElectronWindowEvidence(
        page,
        evidenceRoot,
        "01-first-run-initial"
      );
      expect(initialWindowState.window.onboardingVisible).toBe(true);

      const fixture = await createVisibleValidationFixture(evidenceRoot);
      const manualDiscovery = await page.evaluate(
        async ({ installPath: gameDirectory }) => {
          const api = (window as Window & { cmm: CmmApi }).cmm;
          return api.setManualGameDirectory({
            gameDirectory
          });
        },
        {
          installPath
        }
      );
      await writeJson(
        path.join(evidenceRoot, "manual-game-directory-result.json"),
        manualDiscovery
      );
      expect(manualDiscovery.discoveryStatus).toBe("READY");

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => "cmm" in window);
      const afterManualDirectoryState = await writeElectronWindowEvidence(
        page,
        evidenceRoot,
        "02-after-manual-game-directory"
      );
      expect(afterManualDirectoryState.window.onboardingVisible).toBe(true);
      expect(afterManualDirectoryState.cmm.discoveryStatus).toBe("READY");

      const onboardingState = await completeFirstRunOnboarding(page, evidenceRoot);
      expect(onboardingState.window.onboardingVisible).toBe(false);
      expect(onboardingState.cmm.runtimeStatus).toBe("configured");
      expect(onboardingState.cmm.runtimeReleaseValidation).toBe("VALIDATED");

      const modSetup = await page.evaluate(
        async ({ packagePath }) => {
          const api = (window as Window & { cmm: CmmApi }).cmm;
          const imported = await api.importModPackage({ packagePath });
          if (imported.status === "installed" && imported.mod) {
            await api.setModEnabled({
              id: imported.mod.id,
              version: imported.mod.version,
              enabled: true
            });
          }
          const [mods, profile, loadOrder, play, deployment] = await Promise.all([
            api.listInstalledMods(),
            api.getActiveProfile(),
            api.getLoadOrderSnapshot(),
            api.getPlaySnapshot(),
            api.getDeploymentSnapshot()
          ]);
          return {
            imported,
            mods,
            profile,
            loadOrder,
            play,
            deployment
          };
        },
        {
          packagePath: fixture.packagePath
        }
      );
      await writeJson(
        path.join(evidenceRoot, "electron-visible-mod-setup-result.json"),
        modSetup
      );
      expect(modSetup.imported.status).toBe("installed");
      expect(modSetup.imported.mod).toMatchObject({
        id: visibleModId,
        loader: "ue4ss"
      });
      expect(modSetup.profile.orderedModIds).toEqual([visibleModId]);

      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      const beforeLaunchState = await writeElectronWindowEvidence(
        page,
        evidenceRoot,
        "09-before-play-launch"
      );
      expect(beforeLaunchState.window.onboardingVisible).toBe(false);
      expect(beforeLaunchState.cmm.enabledMods).toBe(1);
      expect(beforeLaunchState.cmm.deploymentState).toBe("deploymentRequired");

      const launch = await launchModdedFromPlayPage(page, evidenceRoot);
      expect(["accepted", "completed"]).toContain(launch.status);

      const activeManifest = await readActiveManifest(userDataRoot);
      await writeJson(path.join(evidenceRoot, "active-manifest.json"), activeManifest);
      expect(activeManifest.runtimeConfiguration).toMatchObject({
        type: "ue4ss",
        effectiveOrderKnown: true,
        logicalOrder: [visibleModId]
      });

      const logPath = path.join(runtimeRoot, "ue4ss", "UE4SS.log");
      const logText = await waitForLogMarkers(
        logPath,
        visibleValidationMarkers(),
        100_000
      );
      await writeFile(path.join(evidenceRoot, "UE4SS-cmm-electron-visible-final.log"), logText);
      await copyFile(
        logPath,
        path.join(evidenceRoot, "UE4SS-cmm-electron-visible-live.log")
      );

      await sleep(500);
      const screenshotPath = path.join(evidenceRoot, "visible-mod-screenshot.png");
      const screenshot = await captureClawedWindowScreenshot(screenshotPath);
      await writeJson(path.join(evidenceRoot, "visible-screenshot.json"), screenshot);
      const screenshotStats = await stat(screenshotPath);
      expect(screenshotStats.size).toBeGreaterThan(10_000);

      await sleep(5_000);
      const delayedLogText = await readFile(logPath, "utf8");
      await writeFile(
        path.join(evidenceRoot, "UE4SS-cmm-electron-visible-delayed.log"),
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
        delayedScreenshotPath,
        markersObserved: true,
        processes: await getClawedProcesses()
      });
    } catch (error) {
      operationError = error;
    } finally {
      if (page) {
        const hasActiveManifest = await exists(getCurrentManifestPath(userDataRoot));
        const runtimeResidueBeforeCleanup = await inspectRuntimeResidue(runtimeRoot);
        const cleanupNeeded =
          hasActiveManifest || runtimeResidueBeforeCleanup.length > 0;

        if (cleanupNeeded) {
          await requestClawedClose();
          const remainingProcesses = await waitForNoClawedProcesses(45_000);
          await writeJson(path.join(evidenceRoot, "close-summary.json"), {
            hadActiveManifest: hasActiveManifest,
            runtimeResidueBeforeCleanup,
            remainingProcesses
          });
          if (remainingProcesses.length > 0) {
            cleanupError = new Error(
              "Clawed did not exit after normal window close; live Electron visible validation refused force-close and skipped file restore while the game was running."
            );
          } else if (hasActiveManifest) {
            const vanillaResult = await page.evaluate(async () => {
              const api = (window as Window & { cmm: CmmApi }).cmm;
              return api.prepareVanillaDeployment();
            });
            await writeJson(
              path.join(evidenceRoot, "vanilla-restore-result.json"),
              vanillaResult
            );
            if (vanillaResult.status !== "ok") {
              cleanupError = new Error(
                `CMM vanilla restore failed with status ${vanillaResult.status}.`
              );
            }
          } else {
            await app?.close().catch(() => undefined);
            app = null;
            const partialCleanup = await cleanupPartialStagedDeployment({
              evidenceRoot,
              runtimeRoot,
              userDataRoot
            });
            await writeJson(
              path.join(evidenceRoot, "partial-deployment-cleanup.json"),
              partialCleanup
            );
            const unsafeSkipped = partialCleanup.skipped.filter(
              (skipped) => skipped.reason !== "missing"
            );
            if (unsafeSkipped.length > 0) {
              cleanupError = new Error(
                `Partial deployment cleanup skipped non-missing files: ${unsafeSkipped
                  .map((skipped) => `${skipped.relative}:${skipped.reason}`)
                  .join(", ")}`
              );
            }
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

      await app?.close().catch(() => undefined);
    }

    if (cleanupError) {
      throw cleanupError;
    }
    if (operationError) {
      throw operationError;
    }
  }, 360_000);
});

async function readActiveManifest(userDataRoot: string) {
  return DeploymentManifestSchema.parse(
    JSON.parse(await readFile(getCurrentManifestPath(userDataRoot), "utf8"))
  );
}

function getCurrentManifestPath(userDataRoot: string): string {
  return path.join(
    userDataRoot,
    "runtime",
    "deployments",
    "current-deployment.json"
  );
}

async function cleanupPartialStagedDeployment({
  evidenceRoot,
  runtimeRoot,
  userDataRoot
}: {
  evidenceRoot: string;
  runtimeRoot: string;
  userDataRoot: string;
}): Promise<PartialDeploymentCleanupResult> {
  const stagingRoot = path.join(userDataRoot, "staging");
  const deploymentRoots = await findRetainedDeploymentStagingRoots(stagingRoot);
  const removed: string[] = [];
  const skipped: PartialDeploymentCleanupResult["skipped"] = [];
  const prunedDirectories: string[] = [];

  for (const deploymentRoot of deploymentRoots) {
    const stagedRuntimeRoot = path.join(
      deploymentRoot,
      "game",
      "Clawed",
      "Binaries",
      "Win64"
    );
    if (!(await exists(stagedRuntimeRoot))) {
      continue;
    }

    for (const sourcePath of await listFilesRecursively(stagedRuntimeRoot)) {
      const relative = path.relative(stagedRuntimeRoot, sourcePath);
      const targetPath = path.resolve(runtimeRoot, relative);
      if (!isPathInside(runtimeRoot, targetPath)) {
        throw new Error(`Refusing partial cleanup outside runtime root: ${targetPath}`);
      }

      if (!(await exists(targetPath))) {
        skipped.push({ relative, reason: "missing" });
        continue;
      }

      const [sourceHash, targetHash] = await Promise.all([
        hashFileSha256(sourcePath),
        hashFileSha256(targetPath)
      ]);
      if (sourceHash.toLowerCase() !== targetHash.toLowerCase()) {
        skipped.push({ relative, reason: "hashMismatch" });
        continue;
      }

      await rm(targetPath, { force: true });
      removed.push(relative);
    }
  }

  prunedDirectories.push(
    ...(await pruneEmptyDirectories(path.join(runtimeRoot, "ue4ss"), runtimeRoot))
  );

  return {
    evidenceRoot,
    stagingRoot,
    deploymentRoots,
    removed,
    skipped,
    prunedDirectories
  };
}

async function completeFirstRunOnboarding(
  page: Page,
  evidenceRoot: string
): Promise<ElectronWindowEvidence> {
  const dialog = page.getByRole("dialog", { name: "First-Run Setup" });
  await dialog.waitFor({ state: "visible", timeout: 15_000 });

  const findState = await writeElectronWindowEvidence(
    page,
    evidenceRoot,
    "03-onboarding-find-ready"
  );
  expect(findState.cmm.discoveryStatus).toBe("READY");

  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("heading", { name: "Configure Runtime" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await writeElectronWindowEvidence(
    page,
    evidenceRoot,
    "04-onboarding-runtime-before-click"
  );

  await page.getByRole("button", { name: "Use Packaged Runtime" }).click();
  const runtimeState = await waitForElectronWindowState(
    page,
    (state) =>
      state.cmm.runtimeStatus === "unvalidated" &&
      state.cmm.runtimeReleaseValidation === "UNVALIDATED",
    120_000,
    "Timed out waiting for first-run packaged runtime setup to configure an unvalidated runtime"
  );
  await writeElectronWindowEvidence(
    page,
    evidenceRoot,
    "05-onboarding-runtime-configured"
  );
  expect(runtimeState.cmm.runtimeStatus).toBe("unvalidated");

  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("heading", { name: "Import or Create Profile" })
    .waitFor({ state: "visible", timeout: 15_000 });
  const profileState = await writeElectronWindowEvidence(
    page,
    evidenceRoot,
    "06-onboarding-profile-ready"
  );
  expect(profileState.cmm.profileCount).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("heading", { name: "Ready to Play" })
    .waitFor({ state: "visible", timeout: 15_000 });
  const readyState = await writeElectronWindowEvidence(
    page,
    evidenceRoot,
    "07-onboarding-ready"
  );
  expect(readyState.cmm.discoveryStatus).toBe("READY");
  expect(readyState.cmm.runtimeStatus).toBe("configured");
  expect(readyState.cmm.profileCount).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Open Play" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
  return writeElectronWindowEvidence(
    page,
    evidenceRoot,
    "08-after-onboarding-dismissed"
  );
}

async function launchModdedFromPlayPage(
  page: Page,
  evidenceRoot: string
): Promise<LaunchCommandResult> {
  const beforeClickState = await writeElectronWindowEvidence(
    page,
    evidenceRoot,
    "10-before-launch-click"
  );
  expect(beforeClickState.window.onboardingVisible).toBe(false);

  await page.getByRole("button", { name: "Launch Modded" }).click();
  await page.screenshot({
    path: path.join(evidenceRoot, "11-after-launch-click-immediate.png"),
    fullPage: true
  });
  await page
    .getByText(
      /Clawed is running|Launch requested through Steam|Modded deployment is not ready|Clawed is not ready to launch|Another game action is already running/
    )
    .first()
    .waitFor({ state: "visible", timeout: 180_000 });
  const launchState = await writeElectronWindowEvidence(
    page,
    evidenceRoot,
    "12-after-launch-command"
  );
  const launch = launchState.cmm.lastCommand;
  if (!launch) {
    throw new Error("Launch Modded did not produce a recorded launch command.");
  }

  return launch;
}

async function writeElectronWindowEvidence(
  page: Page,
  evidenceRoot: string,
  name: string
): Promise<ElectronWindowEvidence> {
  const screenshotPath = path.join(evidenceRoot, `${name}.png`);
  const state = {
    ...(await collectElectronWindowState(page)),
    screenshotPath
  };
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeJson(path.join(evidenceRoot, `${name}.json`), state);
  return state;
}

async function waitForElectronWindowState(
  page: Page,
  predicate: (state: ElectronWindowState) => boolean,
  timeoutMs: number,
  description: string
): Promise<ElectronWindowState> {
  const deadline = Date.now() + timeoutMs;
  let lastState: ElectronWindowState | null = null;

  while (Date.now() < deadline) {
    lastState = await collectElectronWindowState(page);
    if (predicate(lastState)) {
      return lastState;
    }
    await sleep(500);
  }

  throw new Error(
    `${description}. Last app state: ${JSON.stringify(lastState, null, 2)}`
  );
}

async function collectElectronWindowState(
  page: Page
): Promise<ElectronWindowState> {
  return page.evaluate(async () => {
    const normalizeText = (text: string | null | undefined): string | null => {
      const normalized = text?.replace(/\s+/g, " ").trim();
      return normalized && normalized.length > 0 ? normalized : null;
    };
    const buttonNamed = (label: string): HTMLButtonElement | null =>
      Array.from(document.querySelectorAll("button")).find(
        (button) => normalizeText(button.textContent) === label
      ) ?? null;
    const dialog = document.querySelector(
      '[role="dialog"][aria-labelledby="first-run-title"]'
    );
    const activeStepButton = document.querySelector(
      '[aria-label="Onboarding steps"] [aria-current="step"]'
    );
    const activePageButton = document.querySelector(
      'nav[aria-label="Primary"] [aria-current="page"]'
    );
    const statusMessage = dialog?.querySelector('[role="status"]') ?? null;
    const api = (window as Window & { cmm?: CmmApi }).cmm;
    const cmm: ElectronCmmEvidence = {
      apiAvailable: Boolean(api),
      discoveryStatus: null,
      gameInstallPath: null,
      runtimeStatus: null,
      runtimeReleaseValidation: null,
      profileCount: null,
      activeProfileId: null,
      activeProfileName: null,
      installedMods: [],
      enabledMods: null,
      deploymentState: null,
      gameState: null,
      processId: null,
      lastCommand: null,
      error: null
    };

    if (api) {
      try {
        const discovery = await api.getGameDiscovery();
        const runtime = await api.getRuntimeSnapshot();
        const profiles = await api.listProfiles();
        const mods = await api.listInstalledMods();
        const play = await api.getPlaySnapshot();
        const deployment = await api.getDeploymentSnapshot();
        const activeProfile = profiles.profiles.find(
          (profile) => profile.id === profiles.activeProfileId
        );

        cmm.discoveryStatus = discovery.discoveryStatus;
        cmm.gameInstallPath = discovery.gameInstallPath;
        cmm.runtimeStatus = runtime.status;
        cmm.runtimeReleaseValidation = runtime.ue4ss?.releaseValidation ?? null;
        cmm.profileCount = profiles.profiles.length;
        cmm.activeProfileId = profiles.activeProfileId;
        cmm.activeProfileName = activeProfile?.name ?? null;
        cmm.installedMods = mods.mods.map((mod) => ({
          id: mod.id,
          version: mod.version,
          loader: mod.loader,
          enabled: mod.enabled
        }));
        cmm.enabledMods = play.enabledMods;
        cmm.deploymentState = deployment.state;
        cmm.gameState = play.gameState;
        cmm.processId = play.process.processId;
        cmm.lastCommand = play.lastCommand;
      } catch (error) {
        cmm.error = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      capturedAt: new Date().toISOString(),
      window: {
        title: document.title,
        activePage: normalizeText(activePageButton?.textContent ?? null),
        onboardingVisible: dialog !== null,
        onboardingStep: normalizeText(activeStepButton?.textContent ?? null),
        onboardingStatusMessage: normalizeText(statusMessage?.textContent ?? null),
        openPlayVisible: buttonNamed("Open Play") !== null,
        launchModdedVisible: buttonNamed("Launch Modded") !== null
      },
      cmm
    };
  });
}

async function findRetainedDeploymentStagingRoots(
  stagingRoot: string
): Promise<string[]> {
  const entries = await readdir(stagingRoot, { withFileTypes: true }).catch(
    () => []
  );

  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("deployment-"))
    .map((entry) => path.join(stagingRoot, entry.name));
}

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function pruneEmptyDirectories(
  root: string,
  containmentRoot: string
): Promise<string[]> {
  if (!(await exists(root))) {
    return [];
  }
  if (!isPathInside(containmentRoot, root)) {
    throw new Error(`Refusing directory cleanup outside runtime root: ${root}`);
  }

  const pruned: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      pruned.push(
        ...(await pruneEmptyDirectories(path.join(root, entry.name), containmentRoot))
      );
    }
  }

  if ((await readdir(root)).length === 0) {
    await rm(root, { force: true });
    pruned.push(path.relative(containmentRoot, root));
  }

  return pruned;
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
    `Timed out waiting for CMM Electron visible validation markers in ${logPath}. Last log length: ${lastText.length}.`
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

interface ElectronWindowState {
  capturedAt: string;
  window: {
    title: string;
    activePage: string | null;
    onboardingVisible: boolean;
    onboardingStep: string | null;
    onboardingStatusMessage: string | null;
    openPlayVisible: boolean;
    launchModdedVisible: boolean;
  };
  cmm: ElectronCmmEvidence;
}

interface ElectronWindowEvidence extends ElectronWindowState {
  screenshotPath: string;
}

interface ElectronCmmEvidence {
  apiAvailable: boolean;
  discoveryStatus: string | null;
  gameInstallPath: string | null;
  runtimeStatus: string | null;
  runtimeReleaseValidation: string | null;
  profileCount: number | null;
  activeProfileId: string | null;
  activeProfileName: string | null;
  installedMods: Array<{
    id: string;
    version: string;
    loader: string;
    enabled: boolean;
  }>;
  enabledMods: number | null;
  deploymentState: string | null;
  gameState: string | null;
  processId: number | null;
  lastCommand: LaunchCommandResult | null;
  error: string | null;
}

interface PartialDeploymentCleanupResult {
  evidenceRoot: string;
  stagingRoot: string;
  deploymentRoots: string[];
  removed: string[];
  skipped: Array<{
    relative: string;
    reason: "missing" | "hashMismatch";
  }>;
  prunedDirectories: string[];
}

interface ProcessInfo {
  Id: number;
  ProcessName: string;
  MainWindowTitle: string | null;
}
