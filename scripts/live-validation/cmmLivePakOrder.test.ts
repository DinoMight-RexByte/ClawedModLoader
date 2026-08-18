import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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
const liveValidationEnabled = process.env.CMM_LIVE_CLAWED_PAK_ORDER === "1";
const defaultClawedInstallPath =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clawed";
const bundledUe4ssVersion = "ue4ss-experimental-latest-1c1a1497";
const defaultUnrealEditor =
  "C:\\Program Files\\Epic Games\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe";
const defaultUnrealPak =
  "C:\\Program Files\\Epic Games\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealPak.exe";
const defaultSevenZip = "C:\\Program Files\\7-Zip\\7z.exe";
const defaultSkeletalFixtureArchive =
  path.join(
    process.env.USERPROFILE ?? "",
    "Downloads",
    "Telegram Desktop",
    "Allosaurus Dinosaur Character Rig and Animations 4.27.rar"
  );
const livePakOrderTestTimeoutMs = 30 * 60 * 1000;
const alphaModId = "CMMOrderAlpha";
const betaModId = "CMMOrderBeta";
const probeModId = "CMMPakOrderProbe";
const probeKind = normalizeProbeKind(process.env.CMM_PAK_ORDER_PROBE_KIND);
const containerFormat = normalizeContainerFormat(
  process.env.CMM_PAK_ORDER_CONTAINER_FORMAT
);
const includeAssetRegistry =
  containerFormat === "pak" ||
  process.env.CMM_PAK_ORDER_INCLUDE_ASSET_REGISTRY === "1";
const singleFixtureVariant = normalizeSingleFixtureVariant(
  process.env.CMM_PAK_ORDER_SINGLE_FIXTURE
);
const defaultTextureProbePackagePath =
  "/Game/ShoppingMall/Textures/Tex_SlidingGates_D";
const defaultStaticMeshProbePackagePath =
  "/Game/ResearchMegaPack/ResearchFacility/Meshes/SM_Button_2";
const defaultSkeletalMeshProbePackagePath =
  "/Game/Characters/Mannequins/Meshes/SK_Mannequin";
const defaultProbePackagePath =
  probeKind === "skeletal-mesh"
    ? defaultSkeletalMeshProbePackagePath
    : probeKind === "static-mesh"
      ? defaultStaticMeshProbePackagePath
      : defaultTextureProbePackagePath;
const probePackagePath = normalizePackagePath(
  process.env.CMM_PAK_ORDER_PROBE_PACKAGE ?? defaultProbePackagePath
);
const probePackageDirectory = path.posix.dirname(probePackagePath);
const probePackageName = path.posix.basename(probePackagePath);
const probeAssetPath = `${probePackagePath}.${probePackageName}`;
const alphaPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAQCAYAAAB3AH1ZAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAuSURBVEhLY7ijofGfEqzgcYcizIBuIKkY3UBS8agDRh0w6oBRB4w6YNQBow4AALapbj3dPSTaAAAAAElFTkSuQmCC";
const betaPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAQCAYAAACm53kpAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABXSURBVFhH7dAhFQAgFMXQHwKNJg4RSUcN8Auwb564fmc11n2d5tmtikE2BtkygEE2BtkygEE2BtkygEE2BtkygEE2BtkygEE2BtkygEE2BtkygEE2Btk+DZVceftYtRAAAAAASUVORK5CYII=";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

describe.runIf(liveValidationEnabled)("live CMM Pak ordering", () => {
  it("deploys two generated cooked Pak/IoStore fixtures, observes the later logical mod winning, and restores vanilla", async () => {
    const evidenceRoot = path.resolve(
      ".codex",
      "live-validation",
      `${timestampForPath()}-pak-order`
    );
    const installPath = path.resolve(
      process.env.CMM_LIVE_CLAWED_INSTALL ?? defaultClawedInstallPath
    );
    const gameExecutable = await findUnrealShippingExecutable(installPath);
    expect(gameExecutable).toBeTruthy();

    const gameAdapter = new ClawedGameAdapter();
    const discovery = createLiveDiscovery(installPath, gameExecutable!);
    const gameLayout = gameAdapter.getLayout(discovery);
    expect(gameLayout.pakDirectory).toBeTruthy();

    const runtimeRoot = path.dirname(gameExecutable!);
    const paksRoot = gameLayout.pakDirectory!;
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

    const initialPakResidue = await inspectPakResidue(paksRoot);
    await writeJson(path.join(evidenceRoot, "initial-pak-residue.json"), {
      paksRoot,
      residue: initialPakResidue
    });
    expect(initialPakResidue).toEqual([]);

    await writeJson(path.join(evidenceRoot, "initial-pak-inventory.json"), {
      paksRoot,
      files: await listPaksDirectory(paksRoot)
    });

    const fixtures = await buildPakOrderFixtures(evidenceRoot);
    await writeJson(path.join(evidenceRoot, "fixture-summary.json"), fixtures);

    if (singleFixtureVariant) {
      const singlePass = await runPakOrderPass({
        evidenceRoot,
        passName: `${singleFixtureVariant}-only`,
        discovery,
        runtimeRoot,
        paksRoot,
        fixtures,
        logicalOrder: [
          probeModId,
          singleFixtureVariant === "alpha" ? alphaModId : betaModId
        ],
        expectedWinner: singleFixtureVariant
      });
      expect(singlePass.observedWinner).toBe(singleFixtureVariant);
      await writeJson(path.join(evidenceRoot, "pak-order-validation-summary.json"), {
        result: "VALIDATED",
        assetPath: probeAssetPath,
        probeKind,
        containerFormat,
        includeAssetRegistry,
        singleFixtureVariant,
        singlePass
      });
      return;
    }

    const alphaThenBeta = await runPakOrderPass({
      evidenceRoot,
      passName: "alpha-then-beta",
      discovery,
      runtimeRoot,
      paksRoot,
      fixtures,
      logicalOrder: [probeModId, alphaModId, betaModId],
      expectedWinner: "beta"
    });
    expect(alphaThenBeta.observedWinner).toBe("beta");

    const betaThenAlpha = await runPakOrderPass({
      evidenceRoot,
      passName: "beta-then-alpha",
      discovery,
      runtimeRoot,
      paksRoot,
      fixtures,
      logicalOrder: [probeModId, betaModId, alphaModId],
      expectedWinner: "alpha"
    });
    expect(betaThenAlpha.observedWinner).toBe("alpha");

    await writeJson(path.join(evidenceRoot, "pak-order-validation-summary.json"), {
      result: "VALIDATED",
      assetPath: probeAssetPath,
      probeKind,
      containerFormat,
      includeAssetRegistry,
      alphaThenBeta,
      betaThenAlpha
    });
  }, livePakOrderTestTimeoutMs);
});

async function runPakOrderPass({
  evidenceRoot,
  passName,
  discovery,
  runtimeRoot,
  paksRoot,
  fixtures,
  logicalOrder,
  expectedWinner
}: {
  evidenceRoot: string;
  passName: string;
  discovery: GameDiscovery;
  runtimeRoot: string;
  paksRoot: string;
  fixtures: PakOrderFixtureSet;
  logicalOrder: string[];
  expectedWinner: "alpha" | "beta";
}): Promise<PakOrderPassSummary> {
  const passRoot = path.join(evidenceRoot, passName);
  await mkdir(passRoot, { recursive: true });
  const storageService = new FakeStorageService(
    createStorageLayout(path.join(passRoot, "user-data"))
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
    new ClawedGameAdapter()
  );

  let deploymentApplied = false;
  let operationError: unknown = null;
  let cleanupError: Error | null = null;
  const logPath = path.join(runtimeRoot, "ue4ss", "UE4SS.log");
  let observedWinner: "alpha" | "beta" | "unknown" = "unknown";

  try {
    const runtimeResult = await runtimeManager.installBundledUe4ssRuntime();
    await writeJson(path.join(passRoot, "runtime-install-result.json"), runtimeResult);
    expect(runtimeResult.status).toBe("imported");

    const packages = [await createProbeFixture(passRoot)];
    if (logicalOrder.includes(alphaModId)) {
      packages.push(await createPakFixture(passRoot, {
        id: alphaModId,
        name: "CMM Pak Order Alpha",
        fixture: fixtures.alpha
      }));
    }
    if (logicalOrder.includes(betaModId)) {
      packages.push(await createPakFixture(passRoot, {
        id: betaModId,
        name: "CMM Pak Order Beta",
        fixture: fixtures.beta
      }));
    }
    const importResults = [];
    for (const fixture of packages) {
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
    await writeJson(path.join(passRoot, "mod-import-results.json"), importResults);

    for (let index = 0; index < logicalOrder.length; index += 1) {
      await profileService.setModActiveOrderPosition({
        modId: logicalOrder[index],
        position: index + 1
      });
    }
    const activeProfile = await profileService.getActiveProfile();
    await writeJson(path.join(passRoot, "active-profile.json"), activeProfile);
    expect(activeProfile.orderedModIds).toEqual(logicalOrder);

    const deploymentResult =
      await deploymentService.prepareModdedDeployment(discovery);
    deploymentApplied = deploymentResult.status === "ok";
    await writeJson(path.join(passRoot, "deployment-result.json"), deploymentResult);
    expect(deploymentResult.status).toBe("ok");
    expect(deploymentResult.state).toBe("moddedReady");

    const deployedPakFiles = deploymentResult.manifest?.filesCreated
      .map((file) => file.relativePath)
      .filter((relativePath) =>
        [".pak", ".utoc", ".ucas"].includes(path.extname(relativePath).toLowerCase())
      ) ?? [];
    await writeJson(path.join(passRoot, "deployed-pak-files.json"), {
      files: deployedPakFiles
    });
    const expectedDeployedContainerCount =
      (logicalOrder.includes(alphaModId)
        ? fixtures.alpha.containerPayloadPaths.length
        : 0) +
      (logicalOrder.includes(betaModId)
        ? fixtures.beta.containerPayloadPaths.length
        : 0);
    expect(deployedPakFiles).toHaveLength(expectedDeployedContainerCount);
    expect(deployedPakFiles.every((file) => file.includes("Clawed-zz-CMM"))).toBe(
      true
    );
    const expectedPakNamePatterns = logicalOrder
      .filter((modId) => modId === alphaModId || modId === betaModId)
      .map((modId, index) => {
        const orderedPosition = (index + 2).toString().padStart(6, "0");
        const escapedModId = escapeRegExp(modId);
        return new RegExp(
          `${orderedPosition}-${escapedModId}-01-${escapedModId}_${orderedPosition}_P\\.pak$`
        );
      });
    expect(
      deployedPakFiles.filter((file) => path.extname(file).toLowerCase() === ".pak")
    ).toEqual(
      expect.arrayContaining(
        expectedPakNamePatterns.map((pattern) => expect.stringMatching(pattern))
      )
    );

    await launchClawedThroughSteam();
    const logText = await waitForLogMarkers(
      logPath,
      [
        `Starting Lua mod '${probeModId}'`,
        `[${probeModId}] load|ok`,
        `[${probeModId}] winner|${expectedWinner}`
      ],
      120_000
    );
    await writeFile(path.join(passRoot, "UE4SS-pak-order-final.log"), logText);
    await copyFile(logPath, path.join(passRoot, "UE4SS-pak-order-live.log"));

    observedWinner = extractWinner(logText);
    await writeJson(path.join(passRoot, "pak-order-result.json"), {
      expectedWinner,
      observedWinner,
      assetPath: probeAssetPath,
      processes: await getClawedProcesses()
    });
  } catch (error) {
    await preserveLog(passRoot, logPath, "failure");
    operationError = error;
  } finally {
    if (deploymentApplied) {
      await requestClawedClose();
      const remainingProcesses = await waitForNoClawedProcesses(45_000);
      await writeJson(path.join(passRoot, "close-summary.json"), {
        remainingProcesses
      });
      if (remainingProcesses.length > 0) {
        cleanupError = new Error(
          "Clawed did not exit after normal window close; live Pak ordering validation refused force-close and skipped file restore while the game was running."
        );
      } else {
        const vanillaResult =
          await deploymentService.prepareVanillaDeployment(discovery);
        await writeJson(
          path.join(passRoot, "vanilla-restore-result.json"),
          vanillaResult
        );
        if (vanillaResult.status !== "ok") {
          cleanupError = new Error(
            `CMM vanilla restore failed with status ${vanillaResult.status}.`
          );
        }

        const finalRuntimeResidue = await inspectRuntimeResidue(runtimeRoot);
        await writeJson(path.join(passRoot, "final-runtime-residue.json"), {
          runtimeRoot,
          residue: finalRuntimeResidue
        });
        if (finalRuntimeResidue.length > 0) {
          cleanupError = new Error(
            `CMM vanilla restore left runtime residue: ${finalRuntimeResidue.join(", ")}`
          );
        }

        const finalPakResidue = await inspectPakResidue(paksRoot);
        await writeJson(path.join(passRoot, "final-pak-residue.json"), {
          paksRoot,
          residue: finalPakResidue
        });
        if (finalPakResidue.length > 0) {
          cleanupError = new Error(
            `CMM vanilla restore left Pak residue: ${finalPakResidue.join(", ")}`
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

  return {
    passName,
    logicalOrder,
    expectedWinner,
    observedWinner
  };
}

async function buildPakOrderFixtures(
  evidenceRoot: string
): Promise<PakOrderFixtureSet> {
  const fixtureRoot = path.join(evidenceRoot, "generated-unreal-fixtures");
  const unrealEditor =
    process.env.CMM_UNREAL_EDITOR_CMD ?? defaultUnrealEditor;
  const unrealPak = process.env.CMM_UNREAL_PAK_EXE ?? defaultUnrealPak;
  await expectPath(unrealEditor);
  await expectPath(unrealPak);

  const alpha = await buildPakOrderFixtureVariant({
    fixtureRoot,
    unrealEditor,
    unrealPak,
    variant: "alpha",
    pngBase64: alphaPngBase64,
    width:
      probeKind === "skeletal-mesh"
        ? 25
        : probeKind === "static-mesh"
          ? 80
          : 32,
    height: 16
  });
  const beta = await buildPakOrderFixtureVariant({
    fixtureRoot,
    unrealEditor,
    unrealPak,
    variant: "beta",
    pngBase64: betaPngBase64,
    width:
      probeKind === "skeletal-mesh"
        ? 5000
        : probeKind === "static-mesh"
          ? 480
          : 64,
    height: 16
  });

  return {
    probeKind,
    unrealEditor,
    unrealPak,
    alpha,
    beta
  };
}

async function buildPakOrderFixtureVariant({
  fixtureRoot,
  unrealEditor,
  unrealPak,
  variant,
  pngBase64,
  width,
  height
}: {
  fixtureRoot: string;
  unrealEditor: string;
  unrealPak: string;
  variant: "alpha" | "beta";
  pngBase64: string;
  width: number;
  height: number;
}): Promise<PakOrderFixtureVariant> {
  const variantRoot = path.join(fixtureRoot, variant);
  const projectPath = path.join(variantRoot, "Clawed.uproject");
  const sourceAssetPath = path.join(
    variantRoot,
    probeKind === "static-mesh" ? `${variant}.obj` : `${variant}.png`
  );
  const importScriptPath = path.join(
    variantRoot,
    probeKind === "skeletal-mesh"
      ? "duplicate_skeletal_mesh.py"
      : probeKind === "static-mesh"
        ? "import_static_mesh.py"
        : "import_texture.py"
  );
  const configRoot = path.join(variantRoot, "Config");
  const contentProbeRoot = path.join(
    variantRoot,
    "Content",
    ...probePackageDirectory.replace(/^\/Game\/?/, "").split("/")
  );
  await mkdir(configRoot, { recursive: true });
  await mkdir(contentProbeRoot, { recursive: true });
  await writeFile(
    projectPath,
    `${JSON.stringify(
      {
        FileVersion: 3,
        EngineAssociation: "5.5",
        Category: "",
        Description: "Generated legal CMM Pak ordering fixture project.",
        Plugins: [{ Name: "PythonScriptPlugin", Enabled: true }]
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(configRoot, "DefaultGame.ini"),
    [
      "[/Script/UnrealEd.ProjectPackagingSettings]",
      `+DirectoriesToAlwaysCook=(Path="${probePackageDirectory}")`,
      "bCookMapsOnly=False"
    ].join("\n"),
    "ascii"
  );
  if (probeKind === "skeletal-mesh") {
    const sevenZip = process.env.CMM_SEVEN_ZIP_EXE ?? defaultSevenZip;
    const skeletalFixtureArchive =
      process.env.CMM_SKELETAL_FIXTURE_ARCHIVE ?? defaultSkeletalFixtureArchive;
    await expectPath(sevenZip);
    await expectPath(skeletalFixtureArchive);
    await runLogged(
      sevenZip,
      [
        "x",
        skeletalFixtureArchive,
        `-o${path.join(variantRoot, "Content")}`,
        "-y"
      ],
      path.join(variantRoot, "extract-skeletal-source.log")
    );
    await writeFile(
      importScriptPath,
      [
        "import unreal",
        "source_asset = '/Game/Allosaurus/Rigs/Allosaurus_Rig'",
        `target_asset = '${probePackagePath}'`,
        `target_directory = '${probePackageDirectory}'`,
        `bounds_extension_x = ${width.toFixed(1)}`,
        "asset = unreal.load_asset(source_asset)",
        "if asset is None:",
        "    raise RuntimeError('source skeletal mesh failed to load')",
        "unreal.EditorAssetLibrary.make_directory(target_directory)",
        "if unreal.EditorAssetLibrary.does_asset_exist(target_asset):",
        "    unreal.EditorAssetLibrary.delete_asset(target_asset)",
        "duplicated = unreal.EditorAssetLibrary.duplicate_asset(source_asset, target_asset)",
        "if not duplicated:",
        "    raise RuntimeError('skeletal mesh duplicate failed')",
        "target = unreal.load_asset(target_asset)",
        "if target is None:",
        "    raise RuntimeError('target skeletal mesh failed to load')",
        "try:",
        "    extension = unreal.Vector(bounds_extension_x, 0.0, 0.0)",
        "    target.set_editor_property('positive_bounds_extension', extension)",
        "    target.set_editor_property('negative_bounds_extension', extension)",
        "except Exception as exc:",
        "    unreal.log_warning('bounds extension skipped: {}'.format(exc))",
        "unreal.EditorAssetLibrary.save_loaded_asset(target)",
        "unreal.log('CMM_PAK_FIXTURE_IMPORTED {}'.format(target.get_path_name()))"
      ].join("\n"),
      "ascii"
    );
  } else if (probeKind === "static-mesh") {
    await writeFile(
      sourceAssetPath,
      staticMeshObj(width / 2, 40, 40),
      "ascii"
    );
    await writeFile(
      importScriptPath,
      [
        "import unreal",
        `source = r'${sourceAssetPath.replaceAll("\\", "\\\\")}'`,
        `asset_path = '${probePackagePath}'`,
        "task = unreal.AssetImportTask()",
        "task.filename = source",
        `task.destination_path = '${probePackageDirectory}'`,
        `task.destination_name = '${probePackageName}'`,
        "task.automated = True",
        "task.save = True",
        "task.replace_existing = True",
        "options = unreal.FbxImportUI()",
        "options.import_mesh = True",
        "options.import_materials = False",
        "options.import_textures = False",
        "options.import_as_skeletal = False",
        "task.options = options",
        "unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])",
        "asset = unreal.load_asset(asset_path)",
        "if asset is None:",
        "    raise RuntimeError('static mesh import failed')",
        "unreal.EditorAssetLibrary.save_loaded_asset(asset)",
        "unreal.log('CMM_PAK_FIXTURE_IMPORTED {}'.format(asset.get_path_name()))"
      ].join("\n"),
      "ascii"
    );
  } else {
    await writeFile(sourceAssetPath, Buffer.from(pngBase64, "base64"));
    await writeFile(
      importScriptPath,
      [
        "import unreal",
        `source = r'${sourceAssetPath.replaceAll("\\", "\\\\")}'`,
        `asset_path = '${probePackagePath}'`,
        "task = unreal.AssetImportTask()",
        "task.filename = source",
        `task.destination_path = '${probePackageDirectory}'`,
        `task.destination_name = '${probePackageName}'`,
        "task.automated = True",
        "task.save = True",
        "task.replace_existing = True",
        "unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])",
        "asset = unreal.load_asset(asset_path)",
        "if asset is None:",
        "    raise RuntimeError('texture import failed')",
        "try:",
        "    asset.set_editor_property('mip_gen_settings', unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)",
        "except Exception as exc:",
        "    unreal.log_warning('mip setting skipped: {}'.format(exc))",
        "unreal.EditorAssetLibrary.save_loaded_asset(asset)",
        "unreal.log('CMM_PAK_FIXTURE_IMPORTED {}'.format(asset.get_path_name()))"
      ].join("\n"),
      "ascii"
    );
  }

  await runLogged(
    unrealEditor,
    [
      toUnrealPath(projectPath),
      "-run=pythonscript",
      `-script=${toUnrealPath(importScriptPath)}`,
      "-unattended",
      "-nop4",
      "-nosplash",
      "-NoLogTimes"
    ],
    path.join(variantRoot, "import.log")
  );
  await runLogged(
    unrealEditor,
    [
      toUnrealPath(projectPath),
      "-run=cook",
      "-targetplatform=Windows",
      `-COOKDIR=${toUnrealPath(contentProbeRoot)}`,
      "-unversioned",
      "-SkipCookingEditorContent",
      "-NoDefaultMaps",
      "-unattended",
      "-nop4",
      "-nosplash",
      "-NoLogTimes"
    ],
    path.join(variantRoot, "cook.log")
  );

  const cookedPlatformRoot = path.join(
    variantRoot,
    "Saved",
    "Cooked",
    "Windows"
  );
  const cookedProjectRoot = path.join(cookedPlatformRoot, "Clawed");
  const cookedProbeFiles =
    probeKind === "skeletal-mesh"
      ? await findCookedAssetPayloadFiles(cookedProjectRoot)
      : await findCookedProbeFiles(cookedProjectRoot, probePackageName);
  const cookedAssetPath = cookedProbeFiles.find(
    (cookedFile) =>
      path.basename(cookedFile).toLowerCase() ===
      `${probePackageName.toLowerCase()}.uasset`
  );
  expect(cookedAssetPath).toBeTruthy();
  const cookedProbeEntries = cookedProbeFiles.map((cookedFile) => ({
    cookedFile,
    mountPath: `../../../${toUnrealPath(
      path.relative(cookedPlatformRoot, cookedFile)
    )}`
  })
  );
  const cookedAssetRegistryPath = path.join(cookedProjectRoot, "AssetRegistry.bin");
  const pakMountedMetadataEntries =
    includeAssetRegistry && (await exists(cookedAssetRegistryPath))
      ? [
          {
            cookedFile: cookedAssetRegistryPath,
            mountPath: "../../../Clawed/AssetRegistry.bin"
          }
        ]
      : [];
  const containerStem =
    variant === "alpha" ? "CMMOrderAlpha" : "CMMOrderBeta";
  const pakPath = path.join(variantRoot, `${containerStem}.pak`);
  const markerPath = path.join(variantRoot, `${containerStem}.marker`);
  const pakResponsePath = path.join(variantRoot, "pak-response.txt");
  await writeFile(
    markerPath,
    `Generated CMM live Pak/IoStore ordering marker for ${variant}.\n`,
    "ascii"
  );
  await writeFile(
    pakResponsePath,
    [
      `"${markerPath}" "../../../Clawed/Content/CMM/${containerStem}.marker"`,
      ...(containerFormat === "pak"
        ? cookedProbeEntries
        : pakMountedMetadataEntries
      ).map(
            (entry) => `"${entry.cookedFile}" "${entry.mountPath}" -compress`
          )
    ].join("\n") + "\n",
    "ascii"
  );
  await runLogged(
    unrealPak,
    [pakPath, `-Create=${pakResponsePath}`, "-compress"],
    path.join(variantRoot, "unrealpak-create.log")
  );
  await runLogged(
    unrealPak,
    [pakPath, "-List"],
    path.join(variantRoot, "unrealpak-list.log")
  );

  let utocPath: string | null = null;
  let ucasPath: string | null = null;
  let globalUtocPath: string | null = null;
  let globalUcasPath: string | null = null;
  if (containerFormat === "iostore") {
    const metadataRoot = path.join(cookedPlatformRoot, "Clawed", "Metadata");
    const ioStoreRoot = path.join(variantRoot, "iostore");
    await mkdir(ioStoreRoot, { recursive: true });
    const ioStoreResponsePath = path.join(ioStoreRoot, "iostore-response.txt");
    const ioStoreCommandsPath = path.join(ioStoreRoot, "IoStoreCommands.txt");
    utocPath = path.join(ioStoreRoot, `${containerStem}.utoc`);
    ucasPath = path.join(ioStoreRoot, `${containerStem}.ucas`);
    globalUtocPath = path.join(ioStoreRoot, "global.utoc");
    globalUcasPath = path.join(ioStoreRoot, "global.ucas");
    await writeFile(
      ioStoreResponsePath,
      `${cookedProbeEntries
        .map(
          (entry) =>
            `"${entry.cookedFile}" "${entry.mountPath}" -compress`
        )
        .join("\n")}\n`,
      "ascii"
    );
    await writeFile(
      ioStoreCommandsPath,
      `-Output="${utocPath}" -ContainerName=${containerStem} -ResponseFile="${ioStoreResponsePath}"\n`,
      "ascii"
    );
    await runLogged(
      unrealPak,
      [
        toUnrealPath(projectPath),
        `-CreateGlobalContainer=${toUnrealPath(globalUtocPath)}`,
        `-PackageStoreManifest=${toUnrealPath(
          path.join(metadataRoot, "packagestore.manifest")
        )}`,
        `-CookedDirectory=${toUnrealPath(cookedPlatformRoot)}`,
        `-Commands=${toUnrealPath(ioStoreCommandsPath)}`,
        `-ScriptObjects=${toUnrealPath(path.join(metadataRoot, "scriptobjects.bin"))}`,
        "-unattended"
      ],
      path.join(ioStoreRoot, "unrealpak-iostore.log")
    );
    await runLogged(
      unrealPak,
      [
        "IoStore",
        `-List=${toUnrealPath(utocPath)}`,
        `-CSV=${toUnrealPath(path.join(ioStoreRoot, "iostore-list.csv"))}`
      ],
      path.join(ioStoreRoot, "unrealpak-iostore-list.log")
    );
    await runLogged(
      unrealPak,
      [
        "IoStore",
        `-Describe=${toUnrealPath(globalUtocPath)}`,
        `-DumpToFile=${toUnrealPath(path.join(ioStoreRoot, "iostore-describe.txt"))}`
      ],
      path.join(ioStoreRoot, "unrealpak-iostore-describe.log")
    );
    await expectPath(utocPath);
    await expectPath(ucasPath);
  }
  const containerPayloadPaths = [pakPath, utocPath, ucasPath].filter(
    (containerPath): containerPath is string => containerPath !== null
  );

  return {
    variant,
    width,
    height,
    projectPath,
    pakPath,
    utocPath,
    ucasPath,
    globalUtocPath,
    globalUcasPath,
    containerFormat,
    cookedFiles: cookedProbeEntries.map((entry) => entry.mountPath),
    mountedMetadataFiles: pakMountedMetadataEntries.map((entry) => entry.mountPath),
    containerPayloadPaths
  };
}

async function findCookedProbeFiles(
  cookedProjectRoot: string,
  packageName: string
): Promise<string[]> {
  const files = await listFilesRecursive(cookedProjectRoot);
  const expectedPrefix = `${packageName.toLowerCase()}.`;
  const probeFiles = files.filter((file) =>
    path.basename(file).toLowerCase().startsWith(expectedPrefix)
  );

  expect(
    probeFiles.length,
    `cooked ${packageName} files must exist`
  ).toBeGreaterThan(0);
  return probeFiles.sort((left, right) => left.localeCompare(right));
}

async function findCookedAssetPayloadFiles(
  cookedProjectRoot: string
): Promise<string[]> {
  const files = await listFilesRecursive(cookedProjectRoot);
  const payloadFiles = files.filter((file) =>
    [".uasset", ".uexp", ".ubulk"].includes(path.extname(file).toLowerCase())
  );

  expect(payloadFiles.length, "cooked asset payload files must exist").toBeGreaterThan(
    0
  );
  return payloadFiles.sort((left, right) => left.localeCompare(right));
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function normalizePackagePath(packagePath: string): string {
  const normalized = packagePath.replaceAll("\\", "/").replace(/\..*$/, "");
  return normalized.startsWith("/Game/")
    ? normalized
    : `/Game/${normalized.replace(/^\/+/, "")}`;
}

function normalizeProbeKind(value: string | undefined): PakOrderProbeKind {
  if (value === undefined || value === "" || value === "texture") {
    return "texture";
  }

  if (value === "static-mesh" || value === "skeletal-mesh") {
    return value;
  }

  throw new Error(
    `Unsupported CMM_PAK_ORDER_PROBE_KIND '${value}'. Expected 'texture', 'static-mesh', or 'skeletal-mesh'.`
  );
}

function normalizeContainerFormat(value: string | undefined): PakOrderContainerFormat {
  if (value === undefined || value === "" || value === "iostore") {
    return "iostore";
  }

  if (value === "pak") {
    return value;
  }

  throw new Error(
    `Unsupported CMM_PAK_ORDER_CONTAINER_FORMAT '${value}'. Expected 'iostore' or 'pak'.`
  );
}

function normalizeSingleFixtureVariant(
  value: string | undefined
): "alpha" | "beta" | null {
  if (value === undefined || value === "") {
    return null;
  }

  if (value === "alpha" || value === "beta") {
    return value;
  }

  throw new Error(
    `Unsupported CMM_PAK_ORDER_SINGLE_FIXTURE '${value}'. Expected 'alpha' or 'beta'.`
  );
}

function staticMeshObj(extentX: number, extentY: number, extentZ: number): string {
  return [
    "o CMM_StaticMesh_Probe",
    `v ${-extentX} ${-extentY} ${-extentZ}`,
    `v ${extentX} ${-extentY} ${-extentZ}`,
    `v ${extentX} ${extentY} ${-extentZ}`,
    `v ${-extentX} ${extentY} ${-extentZ}`,
    `v ${-extentX} ${-extentY} ${extentZ}`,
    `v ${extentX} ${-extentY} ${extentZ}`,
    `v ${extentX} ${extentY} ${extentZ}`,
    `v ${-extentX} ${extentY} ${extentZ}`,
    "vn 0 0 -1",
    "vn 0 0 1",
    "vn 0 -1 0",
    "vn 0 1 0",
    "vn -1 0 0",
    "vn 1 0 0",
    "f 1//1 2//1 3//1 4//1",
    "f 5//2 8//2 7//2 6//2",
    "f 1//3 5//3 6//3 2//3",
    "f 4//4 3//4 7//4 8//4",
    "f 1//5 4//5 8//5 5//5",
    "f 2//6 6//6 7//6 3//6",
    ""
  ].join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createProbeFixture(evidenceRoot: string) {
  return createClawedModFixture(
    path.join(evidenceRoot, "fixtures", `${probeModId}.clawedmod`),
    {
      manifest: {
        id: probeModId,
        name: "CMM Pak Order Probe",
        version: timestampForVersion(),
        author: "Clawed Mod Manager",
        description:
          probeKind === "skeletal-mesh"
            ? "Read-only UE4SS probe that loads a generated override SkeletalMesh from Pak fixtures."
            : probeKind === "static-mesh"
            ? "Read-only UE4SS probe that loads a generated override StaticMesh from Pak fixtures."
            : "Read-only UE4SS probe that loads a generated override texture from Pak fixtures.",
        loader: "ue4ss"
      },
      payloadText: probeLua()
    }
  );
}

async function createPakFixture(
  evidenceRoot: string,
  options: {
    id: string;
    name: string;
    fixture: PakOrderFixtureVariant;
  }
) {
  return createClawedModFixture(
    path.join(evidenceRoot, "fixtures", `${options.id}.clawedmod`),
    {
      manifest: {
        id: options.id,
        name: options.name,
        version: timestampForVersion(),
        author: "Clawed Mod Manager",
        description:
          probeKind === "skeletal-mesh"
            ? "Generated cooked SkeletalMesh override Pak/IoStore fixture for live CMM ordering validation."
            : probeKind === "static-mesh"
            ? "Generated cooked StaticMesh override Pak/IoStore fixture for live CMM ordering validation."
            : "Generated cooked Texture2D override Pak/IoStore fixture for live CMM ordering validation.",
        loader: "pak"
      },
      payloadEntries: await Promise.all(
        options.fixture.containerPayloadPaths.map(async (containerPath) => ({
          name: `Content/Paks/${path.basename(containerPath)}`,
          content: await readFile(containerPath)
        }))
      )
    }
  );
}

function probeLua(): string {
  if (probeKind === "skeletal-mesh") {
    return meshProbeLua("SkeletalMesh", 2000);
  }

  if (probeKind === "static-mesh") {
    return meshProbeLua("StaticMesh", 120);
  }

  return textureProbeLua();
}

function textureProbeLua(): string {
  return [
    'local UEHelpers = require("UEHelpers")',
    `local marker = "[${probeModId}] "`,
    "local asset_paths = {",
    `    "${probeAssetPath}",`,
    `    "${probePackagePath}",`,
    `    "Texture2D'${probeAssetPath}'"`,
    "}",
    "local function log(event, value)",
    '    print(marker .. event .. "|" .. tostring(value))',
    "end",
    "local function is_valid(object)",
    "    return object ~= nil and object.IsValid ~= nil and object:IsValid()",
    "end",
    "local function load_from_registry()",
    '    local helpers = StaticFindObject("/Script/AssetRegistry.Default__AssetRegistryHelpers")',
    '    if not is_valid(helpers) then log("asset_registry", "helpers_missing"); return nil end',
    "    local asset_data = {",
    `        ["PackageName"] = UEHelpers.FindOrAddFName("${probePackagePath}"),`,
    `        ["AssetName"] = UEHelpers.FindOrAddFName("${probePackageName}")`,
    "    }",
    "    local ok, asset = pcall(function() return helpers:GetAsset(asset_data) end)",
    '    if ok and is_valid(asset) then log("asset_registry", "get_asset|ok"); return asset end',
    '    log("asset_registry", "get_asset|missing|" .. tostring(ok) .. "|" .. tostring(asset))',
    "    return nil",
    "end",
    "local function call_size_method(texture, method)",
    "    local callable = texture[method]",
    "    if callable == nil then return nil, nil end",
    "    local ok, value = pcall(function() return callable(texture) end)",
    "    if ok then return value, nil end",
    "    return nil, value",
    "end",
    "local function read_size(texture)",
    '    local x = call_size_method(texture, "Blueprint_GetSizeX")',
    '    local y = call_size_method(texture, "Blueprint_GetSizeY")',
    '    if x ~= nil and y ~= nil then return x, y, "Blueprint_GetSize" end',
    '    x = call_size_method(texture, "GetSizeX")',
    '    y = call_size_method(texture, "GetSizeY")',
    '    if x ~= nil and y ~= nil then return x, y, "GetSize" end',
    "    local ok, imported = pcall(function() return texture.ImportedSize end)",
    "    if ok and imported ~= nil then",
    "        local ok_x, imported_x = pcall(function() return imported.X end)",
    "        local ok_y, imported_y = pcall(function() return imported.Y end)",
    "        if ok_x and ok_y then return imported_x, imported_y, \"ImportedSize\" end",
    "    end",
    '    return nil, nil, "unreadable"',
    "end",
    "local function probe_once(label)",
    '    log("probe", label)',
    "    local asset = nil",
    "    for _, asset_path in ipairs(asset_paths) do",
    '        log("attempt", asset_path)',
    "        local ok, err = pcall(function() asset = LoadAsset(asset_path) end)",
    '        if ok and is_valid(asset) then log("load", "ok|" .. asset_path); break end',
    '        if not ok then log("load", "error|" .. tostring(err)) end',
    "    end",
    "    if not is_valid(asset) then asset = load_from_registry() end",
    '    if not is_valid(asset) then log("load", "missing"); return end',
    "    local full_name = nil",
    "    pcall(function() full_name = asset:GetFullName() end)",
    '    log("asset", tostring(full_name))',
    "    local x, y, method = read_size(asset)",
    '    log("size", tostring(method) .. "|" .. tostring(x) .. "|" .. tostring(y))',
    "    if tonumber(x) == 32 and tonumber(y) == 16 then",
    '        log("winner", "alpha")',
    "    elseif tonumber(x) == 64 and tonumber(y) == 16 then",
    '        log("winner", "beta")',
    "    else",
    '        log("winner", "unknown")',
    "    end",
    "end",
    "ExecuteInGameThread(function()",
    '    probe_once("initial")',
    "end)",
    "ExecuteWithDelay(3000, function()",
    "    ExecuteInGameThread(function()",
    '        probe_once("delayed")',
    "    end)",
    "end)"
  ].join("\n");
}

function meshProbeLua(assetClassName: "SkeletalMesh" | "StaticMesh", betaThreshold: number): string {
  return [
    'local UEHelpers = require("UEHelpers")',
    `local marker = "[${probeModId}] "`,
    "local asset_paths = {",
    `    "${probeAssetPath}",`,
    `    "${probePackagePath}",`,
    `    "${assetClassName}'${probeAssetPath}'"`,
    "}",
    "local function log(event, value)",
    '    print(marker .. event .. "|" .. tostring(value))',
    "end",
    "local function is_valid(object)",
    "    return object ~= nil and object.IsValid ~= nil and object:IsValid()",
    "end",
    "local function load_from_registry()",
    '    local helpers = StaticFindObject("/Script/AssetRegistry.Default__AssetRegistryHelpers")',
    '    if not is_valid(helpers) then log("asset_registry", "helpers_missing"); return nil end',
    "    local asset_data = {",
    `        ["PackageName"] = UEHelpers.FindOrAddFName("${probePackagePath}"),`,
    `        ["AssetName"] = UEHelpers.FindOrAddFName("${probePackageName}")`,
    "    }",
    "    local ok, asset = pcall(function() return helpers:GetAsset(asset_data) end)",
    '    if ok and is_valid(asset) then log("asset_registry", "get_asset|ok"); return asset end',
    '    log("asset_registry", "get_asset|missing|" .. tostring(ok) .. "|" .. tostring(asset))',
    "    return nil",
    "end",
    "local function read_component(object, field)",
    "    if object == nil then return nil end",
    "    local ok, value = pcall(function() return object[field] end)",
    "    if ok then return tonumber(value) end",
    "    return nil",
    "end",
    "local function read_extent_x(static_mesh)",
    "    local ok_bounds, bounds = pcall(function() return static_mesh:GetBounds() end)",
    "    if ok_bounds and bounds ~= nil then",
    "        local ok_extent, extent = pcall(function() return bounds.BoxExtent end)",
    "        local x = read_component(ok_extent and extent or nil, \"X\")",
    "        if x ~= nil then return x, \"GetBounds.BoxExtent\" end",
    "    end",
    "    local ok_box, box = pcall(function() return static_mesh:GetBoundingBox() end)",
    "    if ok_box and box ~= nil then",
    "        local ok_min, min = pcall(function() return box.Min end)",
    "        local ok_max, max = pcall(function() return box.Max end)",
    "        local min_x = read_component(ok_min and min or nil, \"X\")",
    "        local max_x = read_component(ok_max and max or nil, \"X\")",
    "        if min_x ~= nil and max_x ~= nil then return math.abs(max_x - min_x), \"GetBoundingBox.Width\" end",
    "    end",
    "    return nil, \"unreadable\"",
    "end",
    "local function probe_once(label)",
    '    log("probe", label)',
    "    local asset = nil",
    "    for _, asset_path in ipairs(asset_paths) do",
    '        log("attempt", asset_path)',
    "        local ok, err = pcall(function() asset = LoadAsset(asset_path) end)",
    '        if ok and is_valid(asset) then log("load", "ok|" .. asset_path); break end',
    '        if not ok then log("load", "error|" .. tostring(err)) end',
    "    end",
    "    if not is_valid(asset) then asset = load_from_registry() end",
    '    if not is_valid(asset) then log("load", "missing"); return end',
    "    local full_name = nil",
    "    pcall(function() full_name = asset:GetFullName() end)",
    '    log("asset", tostring(full_name))',
    "    local extent_x, method = read_extent_x(asset)",
    '    log("extent_x", tostring(method) .. "|" .. tostring(extent_x))',
    `    if tonumber(extent_x) ~= nil and tonumber(extent_x) > ${betaThreshold} then`,
    '        log("winner", "beta")',
    "    elseif tonumber(extent_x) ~= nil and tonumber(extent_x) > 20 then",
    '        log("winner", "alpha")',
    "    else",
    '        log("winner", "unknown")',
    "    end",
    "end",
    "ExecuteInGameThread(function()",
    '    probe_once("initial")',
    "end)",
    "ExecuteWithDelay(3000, function()",
    "    ExecuteInGameThread(function()",
    '        probe_once("delayed")',
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
    `Timed out waiting for CMM Pak order markers in ${logPath}. Last log length: ${lastText.length}.`
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

  await writeFile(path.join(evidenceRoot, `UE4SS-pak-order-${suffix}.log`), logText);
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

async function inspectPakResidue(paksRoot: string): Promise<string[]> {
  const files = await listPaksDirectory(paksRoot);
  return files
    .map((file) => file.name)
    .filter((name) => /^Clawed-zz-CMM-|^zz-CMM-|^CMMOrder/i.test(name));
}

async function listPaksDirectory(paksRoot: string): Promise<PakInventoryFile[]> {
  const entries = await readdir(paksRoot, { withFileTypes: true }).catch(() => []);
  const files: PakInventoryFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(paksRoot, entry.name);
    const fileStat = await stat(filePath);
    files.push({
      name: entry.name,
      size: fileStat.size
    });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
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

async function runLogged(
  command: string,
  args: string[],
  logPath: string
): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  const { stdout, stderr } = await execFileAsync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
  await writeFile(logPath, `${stdout}${stderr}`, "utf8");
}

async function writeJson(outputPath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function expectPath(targetPath: string): Promise<void> {
  expect(await exists(targetPath), `${targetPath} must exist`).toBe(true);
}

async function exists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

function extractWinner(logText: string): "alpha" | "beta" | "unknown" {
  const matches = [...logText.matchAll(/\[CMMPakOrderProbe\] winner\|(alpha|beta|unknown)/g)];
  return (matches.at(-1)?.[1] ?? "unknown") as "alpha" | "beta" | "unknown";
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

function toUnrealPath(targetPath: string): string {
  return targetPath.replaceAll("\\", "/");
}

interface PakOrderFixtureSet {
  probeKind: PakOrderProbeKind;
  unrealEditor: string;
  unrealPak: string;
  alpha: PakOrderFixtureVariant;
  beta: PakOrderFixtureVariant;
}

type PakOrderProbeKind = "texture" | "static-mesh" | "skeletal-mesh";
type PakOrderContainerFormat = "iostore" | "pak";

interface PakOrderFixtureVariant {
  variant: "alpha" | "beta";
  width: number;
  height: number;
  projectPath: string;
  pakPath: string;
  utocPath: string | null;
  ucasPath: string | null;
  globalUtocPath: string | null;
  globalUcasPath: string | null;
  containerFormat: PakOrderContainerFormat;
  cookedFiles: string[];
  mountedMetadataFiles: string[];
  containerPayloadPaths: string[];
}

interface PakOrderPassSummary {
  passName: string;
  logicalOrder: string[];
  expectedWinner: "alpha" | "beta";
  observedWinner: "alpha" | "beta" | "unknown";
}

interface PakInventoryFile {
  name: string;
  size: number;
}

interface ProcessInfo {
  Id: number;
  ProcessName: string;
  MainWindowTitle: string | null;
}
