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
import { createClawedModFixture } from "../../tests/helpers/clawedModFixture";

const execFileAsync = promisify(execFile);
const liveResearchEnabled =
  process.env.CMM_LIVE_CLAWED_CHARACTER_RESEARCH === "1";
const defaultClawedInstallPath =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clawed";
const bundledUe4ssVersion = "ue4ss-v3.0.1-lts";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

describe.runIf(liveResearchEnabled)("live Clawed character framework research", () => {
  it("runs a read-only UE4SS object discovery mod and restores vanilla", async () => {
    const evidenceRoot = path.resolve(
      ".codex",
      "live-validation",
      `${timestampForPath()}-character-research`
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
        status: "unvalidated",
        message:
          "Packaged UE4SS v3.0.1 LTS has not been validated as the current bundled default for this Clawed build."
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

      const fixture = await createCharacterResearchFixture(evidenceRoot);
      const imported = await modLibraryService.importModPackage({
        packagePath: fixture.packagePath
      });
      await writeJson(path.join(evidenceRoot, "mod-import-result.json"), imported);
      expect(imported.status).toBe("installed");

      await profileService.setModEnabled({
        id: fixture.manifest.id,
        version: fixture.manifest.version,
        enabled: true
      });

      const deploymentResult =
        await deploymentService.prepareModdedDeployment(discovery);
      deploymentApplied = deploymentResult.status === "ok";
      await writeJson(
        path.join(evidenceRoot, "deployment-result.json"),
        deploymentResult
      );
      expect(deploymentResult.status).toBe("ok");
      expect(deploymentResult.state).toBe("moddedReady");

      await launchClawedThroughSteam();
      const logText = await waitForLogMarkers(
        logPath,
        ["[CMMCharacterResearch] done|read-only snapshot complete"],
        120_000
      );
      const summary = parseCharacterResearchSummary(logText);
      await writeJson(
        path.join(evidenceRoot, "character-research-summary.json"),
        summary
      );
      await writeJson(
        path.join(evidenceRoot, "character-research-lines.json"),
        summary.records
      );
      await writeFile(path.join(evidenceRoot, "UE4SS-character-research-final.log"), logText);
      await copyFile(
        logPath,
        path.join(evidenceRoot, "UE4SS-character-research-live.log")
      );

      expect(summary.errors).toEqual([]);
      expect(summary.engineFound).toBe(true);
      expect(summary.objectScanCompleted).toBe(true);
      await writeJson(path.join(evidenceRoot, "launch-summary.json"), {
        logPath,
        markersObserved: true,
        processes: await getClawedProcesses()
      });
    } catch (error) {
      await preserveCharacterResearchLog(evidenceRoot, logPath, "failure");
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
            "Clawed did not exit after normal window close; live character research refused force-close and skipped file restore while the game was running."
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

async function createCharacterResearchFixture(evidenceRoot: string) {
  return createClawedModFixture(
    path.join(evidenceRoot, "fixtures", "ClawedCharacterResearch.clawedmod"),
    {
      manifest: {
        id: "ClawedCharacterResearch",
        name: "Clawed Character Research",
        version: timestampForVersion(),
        author: "Clawed Mod Manager",
        description: "Read-only UE4SS object discovery for character framework research.",
        loader: "ue4ss"
      },
      payloadText: characterResearchLua()
    }
  );
}

function characterResearchLua(): string {
  return [
    'local marker = "[CMMCharacterResearch] "',
    "local function log(event, value)",
    "    print(marker .. event .. \"|\" .. tostring(value))",
    "end",
    "",
    "local function full_name(object)",
    "    if object == nil then return \"<nil>\" end",
    "    local ok, value = pcall(function() return object:GetFullName() end)",
    "    if ok then return tostring(value) end",
    "    return \"<full-name-error:\" .. tostring(value) .. \">\"",
    "end",
    "",
    "local function class_name(object)",
    "    if object == nil then return \"<nil>\" end",
    "    local ok, value = pcall(function() return object:GetClass() end)",
    "    if ok and value ~= nil then return full_name(value) end",
    "    return \"<class-error:\" .. tostring(value) .. \">\"",
    "end",
    "",
    "local function collect_instances(className, limit)",
    "    if type(FindAllOf) ~= \"function\" then",
    "        log(\"error\", \"FindAllOf unavailable for \" .. className)",
    "        return",
    "    end",
    "    local ok, objects = pcall(function() return FindAllOf(className) end)",
    "    if not ok then",
    "        log(\"error\", \"FindAllOf \" .. className .. \" failed: \" .. tostring(objects))",
    "        return",
    "    end",
    "    local count = 0",
    "    if objects ~= nil then",
    "        for _, object in pairs(objects) do",
    "            count = count + 1",
    "            if count <= limit then",
    "                log(\"instance\", className .. \"|\" .. full_name(object) .. \"|\" .. class_name(object))",
    "            end",
    "        end",
    "    end",
    "    log(\"class_count\", className .. \"|\" .. tostring(count))",
    "end",
    "",
    "local function scan_relevant_objects()",
    "    log(\"object_scan\", \"targeted|0\")",
    "end",
    "",
    "local function run_snapshot()",
    "    log(\"start\", \"read-only snapshot begin\")",
    "    local engine = FindFirstOf(\"GameEngine\")",
    "    log(\"engine\", tostring(engine ~= nil) .. \"|\" .. full_name(engine))",
    "    local classNames = {",
    "        \"GameEngine\",",
    "        \"World\",",
    "        \"GameModeBase\",",
    "        \"GameMode\",",
    "        \"GameStateBase\",",
    "        \"GameState\",",
    "        \"PlayerController\",",
    "        \"PlayerState\",",
    "        \"Pawn\",",
    "        \"Character\",",
    "        \"SkeletalMeshComponent\",",
    "        \"BP_ThirdPersonCharacter_C\",",
    "        \"BP_ThirdPersonGameMode_C\",",
    "        \"BP_Gamestate_FRG_C\",",
    "        \"PlayerState_FDG_C\",",
    "        \"BP_CharacterEquipmentComponent_C\",",
    "        \"BP_InventoryCharacterComponent_C\",",
    "        \"BP_InventoryControllerComponent_C\",",
    "        \"BP_MenuSystemCharacter_C\",",
    "        \"BP_MenuSystemPlayerController_C\"",
    "    }",
    "    for _, className in ipairs(classNames) do",
    "        collect_instances(className, 12)",
    "    end",
    "    scan_relevant_objects()",
    "end",
    "",
    "local function run_guarded_snapshot()",
    "    local ok, err = pcall(run_snapshot)",
    "    if not ok then log(\"error\", tostring(err)) end",
    "    log(\"done\", \"read-only snapshot complete\")",
    "end",
    "",
    "ExecuteInGameThread(run_guarded_snapshot)"
  ].join("\n");
}

async function preserveCharacterResearchLog(
  evidenceRoot: string,
  logPath: string,
  suffix: string
): Promise<void> {
  const logText = await readFile(logPath, "utf8").catch(() => "");
  if (logText.length === 0) {
    return;
  }

  await writeFile(
    path.join(evidenceRoot, `UE4SS-character-research-${suffix}.log`),
    logText
  );
  await writeJson(
    path.join(evidenceRoot, `character-research-${suffix}-summary.json`),
    parseCharacterResearchSummary(logText)
  );
}

function parseCharacterResearchSummary(logText: string): CharacterResearchSummary {
  const records: CharacterResearchRecord[] = [];
  const classCounts: Record<string, number> = {};
  const objectCounts: Record<string, number> = {};
  const instanceSamples: Record<string, CharacterResearchSample[]> = {};
  const objectSamples: Record<string, CharacterResearchSample[]> = {};
  const errors: string[] = [];
  let engineFound = false;
  let objectScanCompleted = false;
  let objectScanTotal = 0;

  const markerPattern =
    /\[Lua\] \[CMMCharacterResearch\] ([\s\S]*?)(?=\[\d{4}-\d{2}-\d{2} |\r?\n|$)/g;
  for (const match of logText.matchAll(markerPattern)) {
    const payload = match[1];
    const [event, ...fields] = payload.split("|");
    const record = { event, fields };
    records.push(record);

    if (event === "error") {
      errors.push(fields.join("|"));
    } else if (event === "engine") {
      engineFound = fields[0] === "true";
    } else if (event === "class_count") {
      classCounts[fields[0]] = Number.parseInt(fields[1] ?? "0", 10);
    } else if (event === "object_count") {
      objectCounts[fields[0]] = Number.parseInt(fields[1] ?? "0", 10);
    } else if (event === "object_scan") {
      objectScanCompleted = true;
      objectScanTotal = Number.parseInt(fields[1] ?? "0", 10);
    } else if (event === "instance") {
      const [className, fullName, classFullName] = fields;
      instanceSamples[className] ??= [];
      instanceSamples[className].push({ fullName, classFullName });
    } else if (event === "object") {
      const [pattern, fullName, classFullName] = fields;
      objectSamples[pattern] ??= [];
      objectSamples[pattern].push({ fullName, classFullName });
    }
  }

  return {
    engineFound,
    objectScanCompleted,
    objectScanTotal,
    classCounts,
    objectCounts,
    instanceSamples,
    objectSamples,
    errors,
    records
  };
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
    `Timed out waiting for CMM character research markers in ${logPath}. Last log length: ${lastText.length}.`
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

function timestampForVersion(): string {
  return new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "");
}

interface CharacterResearchSample {
  fullName: string;
  classFullName: string;
}

interface CharacterResearchRecord {
  event: string;
  fields: string[];
}

interface CharacterResearchSummary {
  engineFound: boolean;
  objectScanCompleted: boolean;
  objectScanTotal: number;
  classCounts: Record<string, number>;
  objectCounts: Record<string, number>;
  instanceSamples: Record<string, CharacterResearchSample[]>;
  objectSamples: Record<string, CharacterResearchSample[]>;
  errors: string[];
  records: CharacterResearchRecord[];
}

interface ProcessInfo {
  Id: number;
  ProcessName: string;
  MainWindowTitle: string | null;
}
