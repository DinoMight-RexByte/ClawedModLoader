import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { describe, expect, it } from "vitest";

import { findUnrealShippingExecutable } from "../../src/main/services/gameExecutableDiscovery";
import { DeploymentManifestSchema } from "../../src/shared/contracts/app";
import type { CmmApi } from "../../src/shared/contracts/ipc";
import { createClawedModFixture } from "../../tests/helpers/clawedModFixture";

const execFileAsync = promisify(execFile);
const liveValidationEnabled =
  process.env.CMM_LIVE_CLAWED_ELECTRON_VALIDATION === "1";
const defaultClawedInstallPath =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clawed";

describe.runIf(liveValidationEnabled)("live CMM Electron deployment", () => {
  it("launches modded through the real Electron IPC path and restores vanilla", async () => {
    const evidenceRoot = path.resolve(
      ".codex",
      "live-validation",
      `${timestampForPath()}-cmm-electron-launch`
    );
    const userDataRoot = path.join(evidenceRoot, "user-data");
    const installPath = path.resolve(
      process.env.CMM_LIVE_CLAWED_INSTALL ?? defaultClawedInstallPath
    );
    const gameExecutable = await findUnrealShippingExecutable(installPath);
    expect(gameExecutable).toBeTruthy();
    const runtimeRoot = path.dirname(gameExecutable!);

    await mkdir(evidenceRoot, { recursive: true });
    expect(await getClawedProcesses()).toEqual([]);
    expect(await inspectRuntimeResidue(runtimeRoot)).toEqual([]);

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

      const packagePaths = await Promise.all([
        createElectronValidationFixture(evidenceRoot, {
          id: "CMMElectronAlpha",
          name: "CMM Electron Alpha",
          label: "Alpha"
        }),
        createElectronValidationFixture(evidenceRoot, {
          id: "CMMElectronBeta",
          name: "CMM Electron Beta",
          label: "Beta"
        })
      ]);

      const setup = await page.evaluate(
        async ({ installPath: gameDirectory, packagePaths: paths }) => {
          const api = (window as Window & { cmm: CmmApi }).cmm;
          const discovery = await api.setManualGameDirectory({
            gameDirectory
          });
          const runtime = await api.installBundledUe4ssRuntime();
          const imports = [];
          for (const packagePath of paths) {
            const imported = await api.importModPackage({ packagePath });
            imports.push(imported);
            if (imported.status === "installed" && imported.mod) {
              await api.setModEnabled({
                id: imported.mod.id,
                version: imported.mod.version,
                enabled: true
              });
            }
          }
          await api.moveModInActiveOrder({
            modId: "CMMElectronBeta",
            direction: "top"
          });
          const profile = await api.getActiveProfile();
          const launch = await api.runLaunchCommand({ kind: "launchModded" });
          return {
            discovery,
            runtime,
            imports,
            profile,
            launch
          };
        },
        {
          installPath,
          packagePaths
        }
      );
      await writeJson(path.join(evidenceRoot, "electron-setup-result.json"), setup);
      expect(setup.discovery.discoveryStatus).toBe("READY");
      expect(setup.runtime.runtime?.releaseValidation).toBe("VALIDATED");
      expect(setup.imports.map((result) => result.status)).toEqual([
        "installed",
        "installed"
      ]);
      expect(setup.profile.orderedModIds).toEqual([
        "CMMElectronBeta",
        "CMMElectronAlpha"
      ]);
      expect(["accepted", "completed"]).toContain(setup.launch.status);
      const activeManifest = await readActiveManifest(userDataRoot);
      await writeJson(path.join(evidenceRoot, "active-manifest.json"), activeManifest);
      expect(activeManifest.runtimeConfiguration).toMatchObject({
        type: "ue4ss",
        effectiveOrderKnown: true,
        logicalOrder: ["CMMElectronBeta", "CMMElectronAlpha"]
      });

      const logPath = path.join(runtimeRoot, "ue4ss", "UE4SS.log");
      const logText = await waitForLogMarkers(
        logPath,
        [
          "[CMMElectronBeta] Lua startup marker from CMM Electron launch",
          "[CMMElectronAlpha] Lua startup marker from CMM Electron launch",
          "[CMMElectronBeta] FindFirstOf(GameEngine) completed: true",
          "[CMMElectronAlpha] FindFirstOf(GameEngine) completed: true"
        ],
        100_000
      );
      const luaStartOrder = extractStartedLuaModOrder(logText, [
        "CMMElectronBeta",
        "CMMElectronAlpha"
      ]);
      await writeJson(path.join(evidenceRoot, "lua-start-order.json"), {
        luaStartOrder
      });
      expect(luaStartOrder).toEqual(["CMMElectronBeta", "CMMElectronAlpha"]);
      await writeFile(path.join(evidenceRoot, "UE4SS-cmm-electron-final.log"), logText);
      await copyFile(
        logPath,
        path.join(evidenceRoot, "UE4SS-cmm-electron-live.log")
      );
    } catch (error) {
      operationError = error;
    } finally {
      if (page) {
        const hasActiveManifest = await exists(getCurrentManifestPath(userDataRoot));

        if (hasActiveManifest) {
          await requestClawedClose();
          const remainingProcesses = await waitForNoClawedProcesses(45_000);
          await writeJson(path.join(evidenceRoot, "close-summary.json"), {
            remainingProcesses
          });
          if (remainingProcesses.length > 0) {
            cleanupError = new Error(
              "Clawed did not exit after normal window close; live Electron validation refused force-close and skipped file restore while the game was running."
            );
          } else {
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

      await app?.close().catch(() => undefined);
    }

    if (cleanupError) {
      throw cleanupError;
    }
    if (operationError) {
      throw operationError;
    }
  });
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

async function createElectronValidationFixture(
  evidenceRoot: string,
  options: {
    id: string;
    name: string;
    label: string;
  }
): Promise<string> {
  const fixture = await createClawedModFixture(
    path.join(evidenceRoot, "fixtures", `${options.id}.clawedmod`),
    {
      manifest: {
        id: options.id,
        name: options.name,
        version: timestampForVersion(),
        author: "Clawed Mod Manager",
        description: "Minimal read-only Lua marker for live Electron validation.",
        loader: "ue4ss"
      },
      payloadText: electronValidationLua(options.id, options.label)
    }
  );
  return fixture.packagePath;
}

function electronValidationLua(modId: string, label: string): string {
  return [
    `local marker = "[${modId}] "`,
    "local function cmm_log(message)",
    "    print(marker .. message)",
    "end",
    `cmm_log("Lua startup marker from CMM Electron launch (${label})")`,
    "ExecuteInGameThread(function()",
    '    cmm_log("ExecuteInGameThread callback marker")',
    '    local engine = FindFirstOf("GameEngine")',
    '    cmm_log("FindFirstOf(GameEngine) completed: " .. tostring(engine ~= nil))',
    "end)"
  ].join("\n");
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
    `Timed out waiting for CMM live Electron markers in ${logPath}. Last log length: ${lastText.length}.`
  );
}

function extractStartedLuaModOrder(
  logText: string,
  targetModIds: string[]
): string[] {
  const startPattern = /Starting Lua mod '([^']+)'/g;
  const targetSet = new Set(targetModIds);
  const matches = [...logText.matchAll(startPattern)]
    .map((match) => match[1])
    .filter((modId) => targetSet.has(modId));

  return matches.slice(0, targetModIds.length);
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
