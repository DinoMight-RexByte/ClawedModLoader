import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { ClawedGameAdapter } from "../../src/main/adapters/clawed/clawedGameAdapter";
import {
  listModPayloadFiles,
  stagePayloadFile
} from "../../src/main/adapters/packagePayload";
import { PakDeploymentAdapter } from "../../src/main/adapters/unreal/pakDeploymentAdapter";
import { UE4SSDeploymentAdapter } from "../../src/main/adapters/ue4ss/ue4ssDeploymentAdapter";
import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalDeploymentService } from "../../src/main/services/deploymentService";
import { findUnrealShippingExecutable } from "../../src/main/services/gameExecutableDiscovery";
import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import { modProblem } from "../../src/main/services/packageProblems";
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
  type InstalledModManifestRecord,
  type ModProblem,
  type Profile
} from "../../src/shared/contracts/app";
import type {
  DeploymentAdapterCapabilities,
  DeploymentAdapterContract,
  DeploymentAdapterDescriptor,
  DeploymentContext,
  PlannedDeploymentFile,
  RuntimeLoadOrder,
  StagedDeployment,
  ValidationResult
} from "../../src/shared/contracts/deployment";
import type { StorageServiceContract } from "../../src/shared/contracts/services";
import { createClawedModFixture } from "../../tests/helpers/clawedModFixture";

const execFileAsync = promisify(execFile);
const liveValidationEnabled =
  process.env.CMM_LIVE_CLAWED_RUNTIME_FEATURES === "1";
const defaultClawedInstallPath =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clawed";
const bundledUe4ssVersion = "ue4ss-v3.0.1-lts";
const probeModId = "CMMRuntimeFeatureProbe";
const looseTextureModId = "CMMLooseTextureAsset";
const bpLogicModId = "CMMBPLogicConfigs";
const bpLogicAlpha = "CMMBPLogicAlpha";
const bpLogicBeta = "CMMBPLogicBeta";
const looseTexturePackagePath = "/Game/UtahRaptor/Textures/T_Utah_Claws_D";
const looseTexturePackageName = path.posix.basename(looseTexturePackagePath);
const looseTextureAssetPath = `${looseTexturePackagePath}.${looseTexturePackageName}`;
const defaultLooseTextureCookedRoot = path.resolve(
  ".codex",
  "live-validation",
  "20260814-180950-pak-order",
  "generated-unreal-fixtures",
  "alpha",
  "Saved",
  "Cooked",
  "Windows",
  "Clawed",
  "Content",
  "UtahRaptor",
  "Textures"
);
const liveRuntimeFeaturesTimeoutMs = 12 * 60 * 1000;

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

const liveLooseCapabilities: DeploymentAdapterCapabilities = {
  supportsEnableDisable: true,
  supportsOrdering: false,
  supportsExternalStorage: false,
  supportsHotChanges: false,
  requiresRestart: true,
  requiresRuntime: false
};

class LiveLooseCookedAssetProbeAdapter implements DeploymentAdapterContract {
  readonly id = "loose";
  readonly version = "live-cooked-asset-probe";
  readonly capabilities = liveLooseCapabilities;
  readonly descriptor: DeploymentAdapterDescriptor = {
    id: this.id,
    label: "Live Loose Cooked Asset Probe Adapter",
    layer: "unreal",
    status: "ready",
    releaseValidation: "UNVALIDATED",
    capabilities: this.capabilities
  };

  async validateEnvironment(
    context: DeploymentContext
  ): Promise<ValidationResult> {
    const problems = await validateLiveLooseRecords(enabledLooseRecords(context));
    return {
      ok: problems.every((problem) => problem.severity !== "error"),
      messages: problems.map((problem) => problem.message)
    };
  }

  async generateLoadOrder(profile: Profile): Promise<RuntimeLoadOrder> {
    return {
      logicalOrder: profile.orderedModIds.filter(
        (modId) => profile.selectedMods[modId]?.enabled
      ),
      runtimeBaselineOrder: [],
      effectiveOrderKnown: false,
      messages: [
        "Live validation only: cooked loose assets are staged to test Clawed runtime behavior and remain blocked in production CMM."
      ],
      modsTxt: ""
    };
  }

  async stage(context: DeploymentContext): Promise<StagedDeployment> {
    const records = enabledLooseRecords(context);
    const stagedGameRoot = path.join(context.stagingPath, "game");
    await mkdir(stagedGameRoot, { recursive: true });

    const problems = await validateLiveLooseRecords(records);
    if (problems.some((problem) => problem.severity === "error")) {
      throw new Error(problems[0].message);
    }

    const files: PlannedDeploymentFile[] = [];
    for (const record of records) {
      for (const payloadFile of await listModPayloadFiles(record)) {
        files.push(
          await stagePayloadFile({
            sourcePath: payloadFile.absolutePath,
            stagedGameRoot,
            targetRelativePath: payloadFile.payloadRelativePath
          })
        );
      }
    }

    const runtimeLoadOrder = await this.generateLoadOrder(context.profile);
    return {
      adapterId: this.id,
      adapterVersion: this.version,
      profileId: context.profile.id,
      stagedPath: context.stagingPath,
      files,
      runtimeConfiguration: {
        type: "loose",
        releaseValidation: "UNVALIDATED",
        effectiveOrderKnown: false,
        liveValidationOnly: true,
        logicalOrder: runtimeLoadOrder.logicalOrder,
        messages: runtimeLoadOrder.messages
      },
      sourcePackages: records.map((record) => ({
        id: record.manifest.id,
        version: record.manifest.version,
        sha256: record.mod.sha256,
        file: record.mod.packagePath
      })),
      messages: runtimeLoadOrder.messages
    };
  }
}

async function validateLiveLooseRecords(
  records: InstalledModManifestRecord[]
): Promise<ModProblem[]> {
  const problems: ModProblem[] = [];
  for (const record of records) {
    if ((await listModPayloadFiles(record)).length === 0) {
      problems.push(
        modProblem(
          "error",
          "LOOSE_PAYLOAD_EMPTY",
          `${record.manifest.name} does not contain deployable loose files.`
        )
      );
    }
  }
  return problems;
}

function enabledLooseRecords(
  context: DeploymentContext
): InstalledModManifestRecord[] {
  return context.installedMods.filter((record) => {
    const selection = context.profile.selectedMods[record.manifest.id];
    return (
      record.manifest.loader === "loose" &&
      selection?.enabled === true &&
      selection.version === record.manifest.version
    );
  });
}

describe.runIf(liveValidationEnabled)("live CMM runtime feature validation", () => {
  it("probes cooked loose texture loading, BPModLoader LogicMods order, and UE4SS gameplay hooks", async () => {
    const evidenceRoot = path.resolve(
      ".codex",
      "live-validation",
      `${timestampForPath()}-runtime-features`
    );
    const installPath = path.resolve(
      process.env.CMM_LIVE_CLAWED_INSTALL ?? defaultClawedInstallPath
    );
    const gameExecutable = await findUnrealShippingExecutable(installPath);
    expect(gameExecutable).toBeTruthy();

    const gameAdapter = new ClawedGameAdapter();
    const discovery = createLiveDiscovery(installPath, gameExecutable!);
    const gameLayout = gameAdapter.getLayout(discovery);
    const runtimeRoot = path.dirname(gameExecutable!);
    await mkdir(evidenceRoot, { recursive: true });

    const initialProcesses = await getClawedProcesses();
    await writeJson(path.join(evidenceRoot, "initial-processes.json"), {
      processes: initialProcesses
    });
    expect(initialProcesses).toEqual([]);

    const initialRuntimeResidue = await inspectRuntimeResidue(runtimeRoot);
    await writeJson(path.join(evidenceRoot, "initial-runtime-residue.json"), {
      runtimeRoot,
      residue: initialRuntimeResidue
    });
    expect(initialRuntimeResidue).toEqual([]);

    const customRuntimePath = await createRuntimeWithBpLoadOrder(evidenceRoot);
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
      bundledUe4ssRuntimePath: customRuntimePath,
      bundledUe4ssVersion,
      bundledUe4ssCompatibility: {
        status: "unvalidated",
        message:
          "Packaged UE4SS v3.0.1 LTS has not been validated as the current bundled default for this Clawed build."
      }
    });
    const deploymentService = new LocalDeploymentService(
      storageService,
      modLibraryService,
      profileService,
      loadOrderService,
      runtimeManager,
      [
        new UE4SSDeploymentAdapter(),
        new PakDeploymentAdapter(),
        new LiveLooseCookedAssetProbeAdapter()
      ],
      logger,
      {},
      gameAdapter
    );

    let deploymentApplied = false;
    let operationError: unknown = null;
    let cleanupError: Error | null = null;
    const logPath = path.join(runtimeRoot, "ue4ss", "UE4SS.log");

    try {
      const runtimeResult = await runtimeManager.installBundledUe4ssRuntime();
      await writeJson(path.join(evidenceRoot, "runtime-install-result.json"), runtimeResult);
      expect(runtimeResult.status).toBe("imported");

      const fixtures = await Promise.all([
        createRuntimeProbeFixture(evidenceRoot),
        createLooseTextureFixture(evidenceRoot),
        createBpLogicModsFixture(evidenceRoot)
      ]);
      const importResults = [];
      for (const fixture of fixtures) {
        const imported = await modLibraryService.importModPackage({
          packagePath: fixture.packagePath
        });
        importResults.push(imported);
        expect(imported.status).toBe("installed");
        await profileService.setModEnabled({
          id: fixture.manifest.id,
          version: fixture.manifest.version,
          enabled: true
        });
      }
      await writeJson(path.join(evidenceRoot, "mod-import-results.json"), importResults);

      const deploymentResult =
        await deploymentService.prepareModdedDeployment(discovery);
      deploymentApplied = deploymentResult.status === "ok";
      await writeJson(
        path.join(evidenceRoot, "deployment-result.json"),
        deploymentResult
      );
      expect(deploymentResult.status).toBe("ok");
      expect(deploymentResult.state).toBe("moddedReady");

      const deployedFiles =
        deploymentResult.manifest?.filesCreated.map((file) => file.relativePath) ??
        [];
      await writeJson(path.join(evidenceRoot, "deployed-feature-files.json"), {
        looseTexturePackagePath,
        paksRoot: gameLayout.pakDirectory,
        files: deployedFiles.filter(
          (file) =>
            file.includes("LogicMods") ||
            file.includes("BPModLoaderMod") ||
            file.includes("T_Utah_Claws_D") ||
            file.includes(probeModId)
        )
      });
      expect(
        deployedFiles.some((file) => file.endsWith("T_Utah_Claws_D.uasset"))
      ).toBe(true);
      expect(
        deployedFiles.some((file) =>
          file.endsWith(
            path.join("LogicMods", bpLogicAlpha, "config.lua")
          )
        )
      ).toBe(true);

      await launchClawedThroughSteam();
      const logText = await waitForLogMarkers(
        logPath,
        [
          `Starting Lua mod '${probeModId}'`,
          `[${probeModId}] loose_texture|winner|`,
          `[${probeModId}] hook_summary|`,
          `[BPModLoaderMod] Mod: ${bpLogicAlpha}`,
          `[BPModLoaderMod] Mod: ${bpLogicBeta}`,
          `[BPModLoaderMod] Loading mod [Priority: #1]: ${bpLogicBeta}`,
          `[BPModLoaderMod] Loading mod [Priority: #2]: ${bpLogicAlpha}`
        ],
        140_000
      );
      await writeFile(
        path.join(evidenceRoot, "UE4SS-runtime-features-final.log"),
        logText
      );
      await copyFile(
        logPath,
        path.join(evidenceRoot, "UE4SS-runtime-features-live.log")
      );

      const hookCallbackCount = extractLastNumber(
        logText,
        /\[CMMRuntimeFeatureProbe\] hook_summary\|callback_count\|(\d+)/g
      );
      expect(hookCallbackCount).toBeGreaterThan(0);
      const looseTextureWinner = extractLastValue(
        logText,
        /\[CMMRuntimeFeatureProbe\] loose_texture\|winner\|(alpha|missing|unknown)/g
      );
      expect(looseTextureWinner).toBeTruthy();

      const summary = {
        result:
          looseTextureWinner === "alpha"
            ? "VALIDATED_SINGLE_CLIENT"
            : "VALIDATED_WITH_NEGATIVE_LOOSE_ASSET_RESULT",
        looseTexture: {
          result: looseTextureWinner === "alpha" ? "VALIDATED" : "NOT_LOADED",
          loader: "loose",
          assetPath: looseTextureAssetPath,
          expectedWinner: "alpha",
          observedWinner: looseTextureWinner
        },
        bpModLoaderLogicMods: {
          result: "VALIDATED_CONFIG_DISCOVERY_AND_PRIORITY_ORDER",
          orderedMods: [bpLogicBeta, bpLogicAlpha],
          actorSpawn: "not_claimed; fixture intentionally points to missing actor classes"
        },
        gameplayHooks: {
          result: "VALIDATED",
          callbackCount: hookCallbackCount
        },
        multiplayerReplication: {
          result: "NOT_VALIDATED",
          reason:
            "Single-client runtime evidence cannot validate host/client replication."
        },
        processes: await getClawedProcesses()
      };
      await writeJson(
        path.join(evidenceRoot, "runtime-feature-validation-summary.json"),
        summary
      );
    } catch (error) {
      await preserveLog(evidenceRoot, logPath, "failure");
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
            "Clawed did not exit after normal window close; live runtime feature validation refused force-close and skipped file restore while the game was running."
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

          const finalRuntimeResidue = await inspectRuntimeResidue(runtimeRoot);
          await writeJson(path.join(evidenceRoot, "final-runtime-residue.json"), {
            runtimeRoot,
            residue: finalRuntimeResidue
          });
          if (finalRuntimeResidue.length > 0) {
            cleanupError = new Error(
              `CMM vanilla restore left runtime residue: ${finalRuntimeResidue.join(", ")}`
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
  }, liveRuntimeFeaturesTimeoutMs);
});

async function createRuntimeWithBpLoadOrder(evidenceRoot: string): Promise<string> {
  const sourceRuntime = path.resolve("assets", "runtime", "ue4ss", "default");
  const runtimeCopy = path.join(evidenceRoot, "runtime-source");
  await copyDirectory(sourceRuntime, runtimeCopy);
  await writeFile(
    path.join(
      runtimeCopy,
      "ue4ss",
      "Mods",
      "BPModLoaderMod",
      "load_order.txt"
    ),
    [
      "; Generated by CMM live runtime feature validation.",
      bpLogicBeta,
      bpLogicAlpha,
      ""
    ].join("\n"),
    "ascii"
  );
  return runtimeCopy;
}

async function createRuntimeProbeFixture(evidenceRoot: string) {
  return createClawedModFixture(
    path.join(evidenceRoot, "fixtures", `${probeModId}.clawedmod`),
    {
      manifest: {
        id: probeModId,
        name: "CMM Runtime Feature Probe",
        version: timestampForVersion(),
        author: "Clawed Mod Manager",
        description:
          "Read-only UE4SS probe for loose asset loading and hook callbacks.",
        loader: "ue4ss"
      },
      payloadText: runtimeProbeLua()
    }
  );
}

async function createLooseTextureFixture(evidenceRoot: string) {
  const sourceRoot = path.resolve(
    process.env.CMM_LOOSE_TEXTURE_COOKED_ROOT ?? defaultLooseTextureCookedRoot
  );
  const entries = await looseTexturePayloadEntries(sourceRoot);
  return createClawedModFixture(
    path.join(evidenceRoot, "fixtures", `${looseTextureModId}.clawedmod`),
    {
      manifest: {
        id: looseTextureModId,
        name: "CMM Loose Texture Asset",
        version: timestampForVersion(),
        author: "Clawed Mod Manager",
        description:
          "Generated cooked Texture2D override staged as loose files for live validation.",
        loader: "loose"
      },
      payloadEntries: entries
    }
  );
}

async function createBpLogicModsFixture(evidenceRoot: string) {
  return createClawedModFixture(
    path.join(evidenceRoot, "fixtures", `${bpLogicModId}.clawedmod`),
    {
      manifest: {
        id: bpLogicModId,
        name: "CMM BPModLoader LogicMods Configs",
        version: timestampForVersion(),
        author: "Clawed Mod Manager",
        description:
          "Loose LogicMods config fixtures for BPModLoader discovery and priority-order validation.",
        loader: "loose"
      },
      payloadEntries: [
        {
          name: toZipPath(
            path.join(
              "Clawed",
              "Binaries",
              "Win64",
              "Mods",
              "BPModLoaderMod",
              "load_order.txt"
            )
          ),
          content: [
            "; Generated by CMM live runtime feature validation.",
            bpLogicBeta,
            bpLogicAlpha,
            ""
          ].join("\n")
        },
        {
          name: toZipPath(
            path.join(
              "Clawed",
              "Content",
              "Paks",
              "LogicMods",
              bpLogicAlpha,
              "config.lua"
            )
          ),
          content: bpLogicConfigLua(bpLogicAlpha)
        },
        {
          name: toZipPath(
            path.join(
              "Clawed",
              "Content",
              "Paks",
              "LogicMods",
              bpLogicBeta,
              "config.lua"
            )
          ),
          content: bpLogicConfigLua(bpLogicBeta)
        }
      ]
    }
  );
}

async function looseTexturePayloadEntries(sourceRoot: string) {
  const sourceFiles = [
    path.join(sourceRoot, `${looseTexturePackageName}.uasset`),
    path.join(sourceRoot, `${looseTexturePackageName}.uexp`)
  ];
  for (const sourceFile of sourceFiles) {
    expect(await exists(sourceFile), `${sourceFile} must exist`).toBe(true);
  }

  const targetDirectory = path.join(
    "Clawed",
    "Content",
    ...path.posix
      .dirname(looseTexturePackagePath)
      .replace(/^\/Game\/?/, "")
      .split("/")
  );
  return Promise.all(
    sourceFiles.map(async (sourceFile) => ({
      name: toZipPath(path.join(targetDirectory, path.basename(sourceFile))),
      content: await readFile(sourceFile)
    }))
  );
}

function bpLogicConfigLua(modName: string): string {
  return [
    `Mods["${modName}"] = {}`,
    `Mods["${modName}"].AssetName = "Missing_${modName}_C"`,
    `Mods["${modName}"].AssetPath = "/Game/CMMRuntimeFeatureValidation/${modName}/MissingActor"`,
    ""
  ].join("\n");
}

function runtimeProbeLua(): string {
  return [
    'local UEHelpers = require("UEHelpers")',
    `local marker = "[${probeModId}] "`,
    "local hook_callback_count = 0",
    "local function log(event, value)",
    '    print(marker .. event .. "|" .. tostring(value))',
    "end",
    "local function is_valid(object)",
    "    return object ~= nil and object.IsValid ~= nil and object:IsValid()",
    "end",
    "local function full_name(object)",
    "    if object == nil then return '<nil>' end",
    "    local ok, value = pcall(function() return object:GetFullName() end)",
    "    if ok then return tostring(value) end",
    "    return '<full-name-error:' .. tostring(value) .. '>'",
    "end",
    "local function hook_event(name, value)",
    "    hook_callback_count = hook_callback_count + 1",
    "    log('hook', name .. '|' .. tostring(value))",
    "end",
    "local function call_size_method(texture, method)",
    "    local callable = texture[method]",
    "    if callable == nil then return nil end",
    "    local ok, value = pcall(function() return callable(texture) end)",
    "    if ok then return value end",
    "    return nil",
    "end",
    "local function read_texture_size(texture)",
    "    local x = call_size_method(texture, 'Blueprint_GetSizeX')",
    "    local y = call_size_method(texture, 'Blueprint_GetSizeY')",
    "    if x ~= nil and y ~= nil then return x, y, 'Blueprint_GetSize' end",
    "    x = call_size_method(texture, 'GetSizeX')",
    "    y = call_size_method(texture, 'GetSizeY')",
    "    if x ~= nil and y ~= nil then return x, y, 'GetSize' end",
    "    return nil, nil, 'unreadable'",
    "end",
    "local function probe_loose_texture()",
    "    local asset_paths = {",
    `        "${looseTextureAssetPath}",`,
    `        "${looseTexturePackagePath}",`,
    `        "Texture2D'${looseTextureAssetPath}'"`,
    "    }",
    "    local asset = nil",
    "    for _, asset_path in ipairs(asset_paths) do",
    "        local ok, err = pcall(function() asset = LoadAsset(asset_path) end)",
    "        if ok and is_valid(asset) then log('loose_texture', 'load|ok|' .. asset_path); break end",
    "        if not ok then log('loose_texture', 'load|error|' .. tostring(err)) end",
    "    end",
    "    if not is_valid(asset) then log('loose_texture', 'winner|missing'); return end",
    "    local x, y, method = read_texture_size(asset)",
    "    log('loose_texture', 'size|' .. tostring(method) .. '|' .. tostring(x) .. '|' .. tostring(y))",
    "    if tonumber(x) == 32 and tonumber(y) == 16 then",
    "        log('loose_texture', 'winner|alpha')",
    "    else",
    "        log('loose_texture', 'winner|unknown')",
    "    end",
    "end",
    "local function register_hooks()",
    "    local ok, err = pcall(function()",
    "        RegisterHook('/Script/Engine.PlayerController:ClientRestart', function(self, NewPawn)",
    "            hook_event('client_restart', full_name(self:get()))",
    "        end)",
    "    end)",
    "    log('hook_register', 'client_restart|' .. tostring(ok) .. '|' .. tostring(err))",
    "    ok, err = pcall(function()",
    "        RegisterBeginPlayPostHook(function(ContextParam)",
    "            local context = ContextParam:get()",
    "            if hook_callback_count < 12 then hook_event('beginplay', full_name(context)) end",
    "        end)",
    "    end)",
    "    log('hook_register', 'beginplay|' .. tostring(ok) .. '|' .. tostring(err))",
    "    ok, err = pcall(function()",
    "        RegisterLoadMapPostHook(function(Engine, World)",
    "            hook_event('loadmap', full_name(World:get()))",
    "        end)",
    "    end)",
    "    log('hook_register', 'loadmap|' .. tostring(ok) .. '|' .. tostring(err))",
    "    ok, err = pcall(function()",
    "        NotifyOnNewObject('/Script/Engine.PlayerController', function(object)",
    "            hook_event('notify_playercontroller', full_name(object))",
    "        end)",
    "    end)",
    "    log('hook_register', 'notify_playercontroller|' .. tostring(ok) .. '|' .. tostring(err))",
    "end",
    "register_hooks()",
    "ExecuteInGameThread(function()",
    "    log('game_thread', 'true')",
    "    probe_loose_texture()",
    "    local game_state = FindFirstOf('GameStateBase')",
    "    local player_state = FindFirstOf('PlayerState')",
    "    log('replication_preflight', 'gamestate|' .. tostring(is_valid(game_state)))",
    "    log('replication_preflight', 'playerstate|' .. tostring(is_valid(player_state)))",
    "end)",
    "ExecuteWithDelay(6000, function()",
    "    ExecuteInGameThread(function()",
    "        local player_controller = UEHelpers.GetPlayerController()",
    "        if is_valid(player_controller) then log('hook_observed', 'playercontroller|' .. full_name(player_controller)) end",
    "        log('hook_summary', 'callback_count|' .. tostring(hook_callback_count))",
    "    end)",
    "end)"
  ].join("\n");
}

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
    `Timed out waiting for CMM runtime feature markers in ${logPath}. Last log length: ${lastText.length}.`
  );
}

async function preserveLog(
  evidenceRoot: string,
  logPath: string,
  suffix: string
): Promise<void> {
  const logText = await readFile(logPath, "utf8").catch(() => "");
  if (logText.length === 0) {
    return;
  }

  await writeFile(
    path.join(evidenceRoot, `UE4SS-runtime-features-${suffix}.log`),
    logText
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

async function copyDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
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

function extractLastNumber(logText: string, pattern: RegExp): number {
  const matches = [...logText.matchAll(pattern)];
  const lastMatch = matches.at(-1)?.[1];
  return lastMatch ? Number.parseInt(lastMatch, 10) : 0;
}

function extractLastValue(logText: string, pattern: RegExp): string {
  const matches = [...logText.matchAll(pattern)];
  return matches.at(-1)?.[1]?.trim() ?? "";
}

function toZipPath(value: string): string {
  return value.replaceAll("\\", "/");
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
