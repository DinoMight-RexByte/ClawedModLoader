import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

import { afterEach, describe, expect, it } from "vitest";

import { ClawedGameAdapter } from "../../src/main/adapters/clawed/clawedGameAdapter";
import { LooseFileDeploymentAdapter } from "../../src/main/adapters/unreal/looseFileDeploymentAdapter";
import { PakDeploymentAdapter } from "../../src/main/adapters/unreal/pakDeploymentAdapter";
import { UE4SSDeploymentAdapter } from "../../src/main/adapters/ue4ss/ue4ssDeploymentAdapter";
import { LocalBackupService } from "../../src/main/services/backupService";
import {
  ClawedModPackageService,
  hashFileSha256
} from "../../src/main/services/clawedModPackageService";
import {
  LocalDeploymentService,
  type DeploymentServiceOptions
} from "../../src/main/services/deploymentService";
import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import {
  LocalLoadOrderService,
  LocalProfileService
} from "../../src/main/services/profileService";
import {
  LocalRuntimeManager,
  type LocalRuntimeManagerOptions
} from "../../src/main/services/runtimeManager";
import { PACKAGED_RUNTIME_VALIDATION_MOD_ID } from "../../src/main/services/runtimeValidationProbe";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import { UNREAL_MAPPINGS_DUMP_MOD_ID } from "../../src/main/services/unrealMappingsDumpProbe";
import {
  CLAWED_STEAM_APP_ID,
  type AppSettings,
  type AppStorageLayout,
  type ClawedModManifestV1,
  type GameDiscovery
} from "../../src/shared/contracts/app";
import type {
  SettingsServiceContract,
  StorageServiceContract
} from "../../src/shared/contracts/services";
import {
  createClawedModFixture,
  type ClawedModFixtureOptions
} from "../helpers/clawedModFixture";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

class FakeSettingsService implements SettingsServiceContract {
  constructor(
    private settings: AppSettings = {
      manualGameDirectory: null,
      autoUpdatePackagedRuntime: true,
      autoValidatePackagedRuntime: false
    }
  ) {}

  async getSettings(): Promise<AppSettings> {
    return this.settings;
  }

  async setManualGameDirectory(
    gameDirectory: string | null
  ): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      manualGameDirectory: gameDirectory
    };
    return this.settings;
  }

  async setAutoUpdatePackagedRuntime(
    enabled: boolean
  ): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      autoUpdatePackagedRuntime: enabled
    };
    return this.settings;
  }

  async setAutoValidatePackagedRuntime(
    enabled: boolean
  ): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      autoValidatePackagedRuntime: enabled
    };
    return this.settings;
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

async function makeServices(
  options?: DeploymentServiceOptions,
  runtimeOptions?: (
    root: string
  ) => Promise<LocalRuntimeManagerOptions> | LocalRuntimeManagerOptions,
  settings?: Partial<AppSettings>
): Promise<{
  root: string;
  backupService: LocalBackupService;
  deploymentService: LocalDeploymentService;
  modLibraryService: LocalModLibraryService;
  profileService: LocalProfileService;
  runtimeManager: LocalRuntimeManager;
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-deployment-"));
  const storageService = new FakeStorageService(createStorageLayout(tempRoot));
  const settingsService = new FakeSettingsService({
    manualGameDirectory: null,
    autoUpdatePackagedRuntime: true,
    autoValidatePackagedRuntime: false,
    ...settings
  });
  const resolvedRuntimeOptions = runtimeOptions
    ? await runtimeOptions(tempRoot)
    : undefined;
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
  const runtimeManager = new LocalRuntimeManager(
    storageService,
    undefined,
    resolvedRuntimeOptions
  );
  const backupService = new LocalBackupService(storageService);
  const gameAdapter = new ClawedGameAdapter();

  return {
    root: tempRoot,
    backupService,
    deploymentService: new LocalDeploymentService(
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
      new NullLifecycleLogger(),
      { ...options, settingsService },
      gameAdapter
    ),
    modLibraryService,
    profileService,
    runtimeManager
  };
}

async function createFakeGame(root: string): Promise<GameDiscovery> {
  const gameInstallPath = path.join(root, "fake-game");
  const gameExecutable = path.join(gameInstallPath, "ClawedFake.exe");
  await mkdir(gameInstallPath, { recursive: true });
  await writeFile(gameExecutable, "fake executable");

  return {
    appId: CLAWED_STEAM_APP_ID,
    steamPath: path.join(root, "Steam"),
    steamLibrary: root,
    steamLibraries: [{ path: root, appManifestPath: null }],
    appManifestPath: null,
    gameInstallPath,
    gameExecutable,
    discoveryStatus: "READY",
    source: "manual",
    manualOverride: gameInstallPath,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}

async function createFakeSteamGame(root: string): Promise<GameDiscovery> {
  const discovery = await createFakeGame(root);
  const appManifestPath = path.join(
    root,
    "steamapps",
    `appmanifest_${CLAWED_STEAM_APP_ID}.acf`
  );
  await writeAppManifest(appManifestPath, "24742251", "100");

  return {
    ...discovery,
    appManifestPath,
    steamLibraries: [{ path: root, appManifestPath }],
    source: "steam",
    manualOverride: null
  };
}

async function writeAppManifest(
  appManifestPath: string,
  buildId: string,
  lastUpdated: string
): Promise<void> {
  await mkdir(path.dirname(appManifestPath), { recursive: true });
  await writeFile(
    appManifestPath,
    `"AppState"
{
  "appid" "${CLAWED_STEAM_APP_ID}"
  "name" "Clawed"
  "installdir" "fake-game"
  "buildid" "${buildId}"
  "LastUpdated" "${lastUpdated}"
}
`
  );
}

async function createReleaseLayoutFakeGame(root: string): Promise<GameDiscovery> {
  const gameInstallPath = path.join(root, "fake-release-game");
  const gameExecutable = path.join(
    gameInstallPath,
    "Clawed",
    "Binaries",
    "Win64",
    "Clawed-Win64-Shipping.exe"
  );
  await mkdir(path.dirname(gameExecutable), { recursive: true });
  await writeFile(gameExecutable, "fake release executable");

  return {
    appId: CLAWED_STEAM_APP_ID,
    steamPath: path.join(root, "Steam"),
    steamLibrary: root,
    steamLibraries: [{ path: root, appManifestPath: null }],
    appManifestPath: null,
    gameInstallPath,
    gameExecutable,
    discoveryStatus: "READY",
    source: "manual",
    manualOverride: gameInstallPath,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}

async function createRuntimeZip(outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const zip = new JSZip();
  zip.file("UE4SS/xinput1_3.dll", "fake runtime dll");
  zip.file("UE4SS/UE4SS-settings.ini", "[UE4SS]\n");
  zip.file("UE4SS/Mods/example-runtime-file.txt", "runtime fixture");
  zip.file("UE4SS/Mods/mods.txt", "BPModLoaderMod : 1\nKeybinds : 1\n");
  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
  return outputPath;
}

async function createNestedRuntimeZip(outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const zip = new JSZip();
  zip.file("dwmapi.dll", "fake proxy dll");
  zip.file("ue4ss/UE4SS.dll", "fake nested ue4ss dll");
  zip.file("ue4ss/UE4SS-settings.ini", "[UE4SS]\n");
  zip.file("ue4ss/Mods/mods.txt", "BPModLoaderMod : 1\nKeybinds : 1\n");
  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
  return outputPath;
}

async function createBundledNestedRuntimeRoot(runtimeRoot: string): Promise<void> {
  await mkdir(path.join(runtimeRoot, "ue4ss", "Mods"), { recursive: true });
  await writeFile(path.join(runtimeRoot, "dwmapi.dll"), "fake proxy dll");
  await writeFile(
    path.join(runtimeRoot, "ue4ss", "UE4SS.dll"),
    "fake nested ue4ss dll"
  );
  await writeFile(
    path.join(runtimeRoot, "ue4ss", "UE4SS-settings.ini"),
    "[UE4SS]\n"
  );
  await writeFile(
    path.join(runtimeRoot, "ue4ss", "Mods", "mods.txt"),
    "BPModLoaderMod : 1\n"
  );
}

async function importRuntime(
  root: string,
  runtimeManager: LocalRuntimeManager
): Promise<void> {
  const runtimeZip = await createRuntimeZip(
    path.join(root, "fixtures", "UE4SS.zip")
  );
  const result = await runtimeManager.importUe4ssRuntime({
    sourcePath: runtimeZip
  });
  expect(result.status).toBe("imported");
}

async function importNestedRuntime(
  root: string,
  runtimeManager: LocalRuntimeManager
): Promise<void> {
  const runtimeZip = await createNestedRuntimeZip(
    path.join(root, "fixtures", "UE4SS-experimental.zip")
  );
  const result = await runtimeManager.importUe4ssRuntime({
    sourcePath: runtimeZip
  });
  expect(result.status).toBe("imported");
}

async function importAndEnable(
  root: string,
  modLibraryService: LocalModLibraryService,
  profileService: LocalProfileService,
  manifest: Partial<ClawedModManifestV1>,
  fixtureOptions?: Omit<ClawedModFixtureOptions, "manifest">
): Promise<void> {
  const fixture = await createClawedModFixture(
    path.join(root, "fixtures", `${manifest.id}.clawedmod`),
    { ...fixtureOptions, manifest }
  );
  const imported = await modLibraryService.importModPackage({
    packagePath: fixture.packagePath
  });
  expect(imported.status).toBe("installed");
  await profileService.setModEnabled({
    id: fixture.manifest.id,
    version: fixture.manifest.version,
    enabled: true
  });
}

async function exists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

describe("deployment and runtime management", () => {
  it("applies a traceable deployment transaction with deterministic load order", async () => {
    const {
      root,
      backupService,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createFakeGame(root);
    await importRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    await importAndEnable(root, modLibraryService, profileService, {
      id: "character",
      name: "Character",
      version: "1.0.0"
    });
    await profileService.moveModInActiveOrder({
      modId: "character",
      direction: "top"
    });

    const modsTxtPath = path.join(discovery.gameInstallPath!, "Mods", "mods.txt");
    const unknownFilePath = path.join(
      discovery.gameInstallPath!,
      "Mods",
      "unknown.txt"
    );
    await mkdir(path.dirname(modsTxtPath), { recursive: true });
    await writeFile(modsTxtPath, "user-managed order\n");
    await writeFile(unknownFilePath, "preserve me");

    const result = await deploymentService.prepareModdedDeployment(discovery);

    expect(result.status).toBe("ok");
    expect(result.state).toBe("runtimeUnvalidated");
    expect(result.manifest?.filesCreated.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining([
        "UE4SS-settings.ini",
        "xinput1_3.dll",
        path.join("Mods", "cmm-profile.json")
      ])
    );
    expect(result.manifest?.filesModified.map((file) => file.relativePath)).toContain(
      path.join("Mods", "mods.txt")
    );
    expect(result.manifest?.backups[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest?.backups[0]?.originalSha256).toBe(
      await hashFileSha256(result.manifest!.backups[0].backupPath)
    );
    expect(await backupService.countTrackedBackups()).toBe(1);
    expect(await readFile(unknownFilePath, "utf8")).toBe("preserve me");

    const generatedModsTxt = await readFile(modsTxtPath, "utf8");
    expect(generatedModsTxt.indexOf("BPModLoaderMod : 1")).toBeLessThan(
      generatedModsTxt.indexOf("character : 1")
    );
    expect(generatedModsTxt.indexOf("Keybinds : 1")).toBeLessThan(
      generatedModsTxt.indexOf("character : 1")
    );
    expect(generatedModsTxt.indexOf("character : 1")).toBeLessThan(
      generatedModsTxt.indexOf("core : 1")
    );
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      releaseValidation: "UNVALIDATED",
      effectiveOrderKnown: false,
      runtimeBaselineOrder: ["BPModLoaderMod", "Keybinds"],
      logicalOrder: ["character", "core"]
    });

    const currentManifestPath = path.join(
      root,
      "runtime",
      "deployments",
      "current-deployment.json"
    );
    expect(await exists(currentManifestPath)).toBe(true);
  });

  it("deploys UE4SS runtime files beside the release shipping executable", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createReleaseLayoutFakeGame(root);
    await importRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const result = await deploymentService.prepareModdedDeployment(discovery);
    const runtimeRoot = path.join(
      discovery.gameInstallPath!,
      "Clawed",
      "Binaries",
      "Win64"
    );

    expect(result.status).toBe("ok");
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      runtimeTargetRelativePath: path.join("Clawed", "Binaries", "Win64")
    });
    expect(await exists(path.join(runtimeRoot, "xinput1_3.dll"))).toBe(true);
    expect(await exists(path.join(runtimeRoot, "UE4SS-settings.ini"))).toBe(true);
    expect(await exists(path.join(runtimeRoot, "Mods", "mods.txt"))).toBe(true);
    expect(await exists(path.join(discovery.gameInstallPath!, "xinput1_3.dll"))).toBe(
      false
    );
  });

  it("stages official nested UE4SS layout mods under the nested runtime folder", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createReleaseLayoutFakeGame(root);
    await importNestedRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const result = await deploymentService.prepareModdedDeployment(discovery);
    const runtimeRoot = path.join(
      discovery.gameInstallPath!,
      "Clawed",
      "Binaries",
      "Win64"
    );

    expect(result.status).toBe("ok");
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      runtimeLayout: "modern-subdirectory",
      runtimeModsRelativePath: path.join("ue4ss", "Mods")
    });
    expect(await exists(path.join(runtimeRoot, "dwmapi.dll"))).toBe(true);
    expect(await exists(path.join(runtimeRoot, "ue4ss", "UE4SS.dll"))).toBe(
      true
    );
    expect(
      await exists(path.join(runtimeRoot, "ue4ss", "Mods", "mods.txt"))
    ).toBe(true);
    expect(
      await exists(
        path.join(runtimeRoot, "ue4ss", "Mods", "core", "Scripts", "main.lua")
      )
    ).toBe(true);
    expect(await exists(path.join(runtimeRoot, "Mods", "mods.txt"))).toBe(false);
  });

  it("auto-installs the packaged runtime before modded deployment", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService
    } = await makeServices(undefined, async (serviceRoot) => {
      const bundleRoot = path.join(serviceRoot, "bundled-runtime");
      await createBundledNestedRuntimeRoot(bundleRoot);
      return {
        bundledUe4ssRuntimePath: bundleRoot,
        bundledUe4ssVersion: "auto-packaged-runtime",
        bundledUe4ssCompatibility: {
          status: "validated",
          validatedSteamBuildIds: ["24742251"],
          message: "Packaged runtime is validated for this fake build."
        }
      };
    });
    const discovery = await createFakeSteamGame(root);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const result = await deploymentService.prepareModdedDeployment(discovery);
    const runtimeRoot = path.join(discovery.gameInstallPath!, "ue4ss");

    expect(result.status).toBe("ok");
    expect(result.state).toBe("moddedReady");
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      releaseValidation: "VALIDATED",
      targetSteamBuildId: "24742251"
    });
    expect(await exists(path.join(runtimeRoot, "UE4SS.dll"))).toBe(true);
    await expect(
      readFile(path.join(runtimeRoot, "Mods", "cmm-profile.json"), "utf8")
    ).resolves.toContain('"targetSteamBuildId": "24742251"');
  });

  it("allows packaged runtime deployment for an unvalidated build with warnings", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices(undefined, async (serviceRoot) => {
      const bundleRoot = path.join(serviceRoot, "bundled-runtime");
      await createBundledNestedRuntimeRoot(bundleRoot);
      return {
        bundledUe4ssRuntimePath: bundleRoot,
        bundledUe4ssVersion: "prompt-packaged-runtime",
        bundledUe4ssCompatibility: {
          status: "validated",
          validatedSteamBuildIds: ["24742251"]
        }
      };
    });
    const discovery = await createFakeSteamGame(root);
    await writeAppManifest(discovery.appManifestPath!, "99999999", "101");
    await runtimeManager.installBundledUe4ssRuntime();
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const result = await deploymentService.prepareModdedDeployment(discovery);
    const runtimeRoot = path.join(discovery.gameInstallPath!, "ue4ss");

    expect(result.status).toBe("ok");
    expect(result.state).toBe("runtimeUnvalidated");
    expect(result.manifest).not.toBeNull();
    expect(result.problems.some((problem) =>
      problem.code === "UE4SS_BUNDLED_RUNTIME_BUILD_UNVALIDATED"
    )).toBe(true);
    expect(await exists(path.join(runtimeRoot, "Mods", "core"))).toBe(true);
    expect(await exists(path.join(runtimeRoot, "Mods", "cmm-profile.json"))).toBe(
      true
    );
  });

  it("blocks packaged runtime deployment for scoped incompatible metadata", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService
    } = await makeServices(undefined, async (serviceRoot) => {
      const bundleRoot = path.join(serviceRoot, "bundled-runtime");
      await createBundledNestedRuntimeRoot(bundleRoot);
      return {
        bundledUe4ssRuntimePath: bundleRoot,
        bundledUe4ssVersion: "known-incompatible-runtime",
        bundledUe4ssCompatibility: {
          status: "unvalidated",
          scopedIncompatibilities: [
            {
              steamBuildIds: ["24742251"],
              message:
                "Packaged UE4SS v3.0.1 LTS cannot initialize on this Clawed build.",
              technicalDetail:
                "Missing signatures: GUObjectArray, FText::FText(FString&&)."
            }
          ]
        }
      };
    });
    const discovery = await createFakeSteamGame(root);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const result = await deploymentService.prepareModdedDeployment(discovery);

    expect(result.status).toBe("blocked");
    expect(result.state).toBe("runtimeIncompatible");
    expect(result.problems[0]).toMatchObject({
      code: "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE",
      technicalDetail: expect.stringContaining("Missing signatures")
    });
    expect(await exists(path.join(discovery.gameInstallPath!, "dwmapi.dll"))).toBe(
      false
    );
    expect(
      await exists(path.join(discovery.gameInstallPath!, "ue4ss", "UE4SS.dll"))
    ).toBe(false);
  });

  it("stages a temporary packaged runtime validation deployment for a new Steam build", async () => {
    const { root, deploymentService, runtimeManager } = await makeServices(
      undefined,
      async (serviceRoot) => {
        const bundleRoot = path.join(serviceRoot, "bundled-runtime");
        await createBundledNestedRuntimeRoot(bundleRoot);
        return {
          bundledUe4ssRuntimePath: bundleRoot,
          bundledUe4ssVersion: "auto-validation-runtime",
          bundledUe4ssCompatibility: {
            status: "validated",
            validatedSteamBuildIds: ["24742251"]
          }
        };
      }
    );
    const discovery = await createFakeSteamGame(root);
    await writeAppManifest(discovery.appManifestPath!, "99999999", "101");
    await runtimeManager.installBundledUe4ssRuntime();

    const result =
      await deploymentService.prepareRuntimeValidationDeployment(discovery);
    const markerPath = path.join(
      discovery.gameInstallPath!,
      "ue4ss",
      "Mods",
      PACKAGED_RUNTIME_VALIDATION_MOD_ID,
      "Scripts",
      "main.lua"
    );

    expect(result.status).toBe("ok");
    expect(result.state).toBe("runtimeUnvalidated");
    expect(result.manifest?.profileId).toBe("cmm-runtime-validation");
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      releaseValidation: "UNVALIDATED",
      targetSteamBuildId: "99999999",
      logicalOrder: [PACKAGED_RUNTIME_VALIDATION_MOD_ID]
    });
    await expect(readFile(markerPath, "utf8")).resolves.toContain(
      "packaged UE4SS runtime validation"
    );

    const vanilla = await deploymentService.prepareVanillaDeployment(discovery);
    expect(vanilla.status).toBe("ok");
    expect(await exists(markerPath)).toBe(false);
  });

  it("allows explicit packaged runtime validation for scoped incompatible metadata", async () => {
    const { root, deploymentService, runtimeManager } = await makeServices(
      undefined,
      async (serviceRoot) => {
        const bundleRoot = path.join(serviceRoot, "bundled-runtime");
        await createBundledNestedRuntimeRoot(bundleRoot);
        return {
          bundledUe4ssRuntimePath: bundleRoot,
          bundledUe4ssVersion: "metadata-retest-runtime",
          bundledUe4ssCompatibility: {
            status: "unvalidated",
            scopedIncompatibilities: [
              {
                steamBuildIds: ["24742251"],
                message:
                  "Packaged UE4SS v3.0.1 LTS cannot initialize on this Clawed build."
              }
            ]
          }
        };
      }
    );
    const discovery = await createFakeSteamGame(root);
    await runtimeManager.installBundledUe4ssRuntime();

    const result =
      await deploymentService.prepareRuntimeValidationDeployment(discovery);
    const markerPath = path.join(
      discovery.gameInstallPath!,
      "ue4ss",
      "Mods",
      PACKAGED_RUNTIME_VALIDATION_MOD_ID,
      "Scripts",
      "main.lua"
    );

    expect(result.status).toBe("ok");
    expect(result.state).toBe("runtimeUnvalidated");
    expect(
      result.problems.some(
        (problem) => problem.code === "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE"
      )
    ).toBe(false);
    expect(result.problems[0].code).toBe("DEPLOYMENT_ADAPTER_MESSAGE");
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      releaseValidation: "UNVALIDATED",
      targetSteamBuildId: "24742251",
      logicalOrder: [PACKAGED_RUNTIME_VALIDATION_MOD_ID]
    });
    const snapshot = await deploymentService.getSnapshot();
    expect(snapshot.state).toBe("runtimeUnvalidated");
    expect(snapshot.activeManifest?.profileId).toBe("cmm-runtime-validation");
    expect(
      snapshot.problems.some(
        (problem) => problem.code === "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE"
      )
    ).toBe(false);
    await expect(readFile(markerPath, "utf8")).resolves.toContain(
      "packaged UE4SS runtime validation"
    );
  });

  it("allows explicit packaged runtime validation after incompatible evidence", async () => {
    const { root, deploymentService, runtimeManager } = await makeServices(
      undefined,
      async (serviceRoot) => {
        const bundleRoot = path.join(serviceRoot, "bundled-runtime");
        await createBundledNestedRuntimeRoot(bundleRoot);
        return {
          bundledUe4ssRuntimePath: bundleRoot,
          bundledUe4ssVersion: "retest-packaged-runtime",
          bundledUe4ssCompatibility: {
            status: "validated",
            validatedSteamBuildIds: ["24742251"]
          }
        };
      }
    );
    const discovery = await createFakeSteamGame(root);
    const fingerprint = await new ClawedGameAdapter().getFingerprint(discovery);
    await runtimeManager.installBundledUe4ssRuntime();
    await runtimeManager.recordBundledUe4ssRuntimeValidation({
      status: "INCOMPATIBLE",
      steamBuildId: fingerprint.steamBuildId,
      fingerprintSha256: fingerprint.fingerprintSha256,
      evidencePath: path.join(root, "evidence"),
      markerModId: PACKAGED_RUNTIME_VALIDATION_MOD_ID,
      details:
        "UE4SS pattern scan failed before the packaged validation Lua marker could run."
    });

    const result =
      await deploymentService.prepareRuntimeValidationDeployment(discovery);
    const markerPath = path.join(
      discovery.gameInstallPath!,
      "ue4ss",
      "Mods",
      PACKAGED_RUNTIME_VALIDATION_MOD_ID,
      "Scripts",
      "main.lua"
    );

    expect(result.status).toBe("ok");
    expect(result.state).toBe("runtimeUnvalidated");
    expect(result.manifest?.profileId).toBe("cmm-runtime-validation");
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      releaseValidation: "UNVALIDATED",
      targetSteamBuildId: "24742251",
      logicalOrder: [PACKAGED_RUNTIME_VALIDATION_MOD_ID]
    });
    await expect(readFile(markerPath, "utf8")).resolves.toContain(
      "packaged UE4SS runtime validation"
    );

    const vanilla = await deploymentService.prepareVanillaDeployment(discovery);
    expect(vanilla.status).toBe("ok");
    expect(await exists(markerPath)).toBe(false);
  });

  it("stages a temporary Unreal mappings dump deployment without retained runtime validation", async () => {
    const { root, deploymentService, runtimeManager } = await makeServices(
      undefined,
      async (serviceRoot) => {
        const bundleRoot = path.join(serviceRoot, "bundled-runtime");
        await createBundledNestedRuntimeRoot(bundleRoot);
        return {
          bundledUe4ssRuntimePath: bundleRoot,
          bundledUe4ssVersion: "mappings-runtime",
          bundledUe4ssCompatibility: {
            status: "validated",
            validatedSteamBuildIds: ["24742251"]
          }
        };
      }
    );
    const discovery = await createFakeSteamGame(root);
    await writeAppManifest(discovery.appManifestPath!, "99999999", "101");
    await runtimeManager.installBundledUe4ssRuntime();

    const result =
      await deploymentService.prepareUnrealMappingsDumpDeployment(discovery);
    const markerPath = path.join(
      discovery.gameInstallPath!,
      "ue4ss",
      "Mods",
      UNREAL_MAPPINGS_DUMP_MOD_ID,
      "Scripts",
      "main.lua"
    );

    expect(result.status).toBe("ok");
    expect(result.state).toBe("runtimeUnvalidated");
    expect(result.manifest?.profileId).toBe("cmm-unreal-mappings-dump");
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      releaseValidation: "UNVALIDATED",
      targetSteamBuildId: "99999999",
      logicalOrder: [UNREAL_MAPPINGS_DUMP_MOD_ID]
    });
    await expect(readFile(markerPath, "utf8")).resolves.toContain("DumpUSMAP");

    const vanilla = await deploymentService.prepareVanillaDeployment(discovery);
    expect(vanilla.status).toBe("ok");
    expect(await exists(markerPath)).toBe(false);
  });

  it("treats a user runtime validated for the current build as modded ready", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createFakeSteamGame(root);
    await importRuntime(root, runtimeManager);
    const fingerprint = await new ClawedGameAdapter().getFingerprint(discovery);
    const recorded = await runtimeManager.recordUe4ssRuntimeValidation({
      status: "VALIDATED",
      steamBuildId: "24742251",
      fingerprintSha256: fingerprint.fingerprintSha256,
      evidencePath: path.join(root, "evidence"),
      markerModId: "CMMUserRuntimeValidation"
    });
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const result = await deploymentService.prepareModdedDeployment(discovery);

    expect(recorded.runtime?.source).toBe("user");
    expect(result.status).toBe("ok");
    expect(result.state).toBe("moddedReady");
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "ue4ss",
      releaseValidation: "VALIDATED",
      effectiveOrderKnown: true
    });
  });

  it("blocks an incompatible user runtime before deployment writes", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createFakeSteamGame(root);
    await importRuntime(root, runtimeManager);
    const fingerprint = await new ClawedGameAdapter().getFingerprint(discovery);
    await runtimeManager.recordUe4ssRuntimeValidation({
      status: "INCOMPATIBLE",
      steamBuildId: "24742251",
      fingerprintSha256: fingerprint.fingerprintSha256,
      evidencePath: path.join(root, "evidence"),
      markerModId: "CMMUserRuntimeValidation",
      details: "UE4SS log did not contain the marker."
    });
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const result = await deploymentService.prepareModdedDeployment(discovery);

    expect(result.status).toBe("blocked");
    expect(result.state).toBe("runtimeIncompatible");
    expect(result.problems[0].code).toBe("UE4SS_USER_RUNTIME_INCOMPATIBLE");
    expect(await exists(path.join(discovery.gameInstallPath!, "xinput1_3.dll"))).toBe(
      false
    );
  });

  it("leaves packaged runtime updates manual when auto update is disabled", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService
    } = await makeServices(
      undefined,
      async (serviceRoot) => {
        const bundleRoot = path.join(serviceRoot, "bundled-runtime");
        await createBundledNestedRuntimeRoot(bundleRoot);
        return {
          bundledUe4ssRuntimePath: bundleRoot,
          bundledUe4ssVersion: "manual-packaged-runtime",
          bundledUe4ssCompatibility: {
            status: "validated",
            validatedSteamBuildIds: ["24742251"]
          }
        };
      },
      { autoUpdatePackagedRuntime: false }
    );
    const discovery = await createFakeSteamGame(root);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const result = await deploymentService.prepareModdedDeployment(discovery);
    const runtimeRoot = path.join(discovery.gameInstallPath!, "ue4ss");

    expect(result.status).toBe("blocked");
    expect(result.state).toBe("runtimeIncompatible");
    expect(
      result.problems.some(
        (problem) => problem.code === "UE4SS_AUTO_RUNTIME_UPDATE_DISABLED"
      )
    ).toBe(true);
    expect(await exists(path.join(runtimeRoot, "UE4SS.dll"))).toBe(false);
  });

  it("removes known UE4SS-generated logs and CMM-created runtime folders for vanilla launch", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createReleaseLayoutFakeGame(root);
    await importNestedRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    expect((await deploymentService.prepareModdedDeployment(discovery)).status).toBe(
      "ok"
    );
    const runtimeRoot = path.join(
      discovery.gameInstallPath!,
      "Clawed",
      "Binaries",
      "Win64"
    );
    const generatedLogPath = path.join(runtimeRoot, "ue4ss", "UE4SS.log");
    await writeFile(generatedLogPath, "runtime generated log");

    const vanilla = await deploymentService.prepareVanillaDeployment(discovery);

    expect(vanilla.status).toBe("ok");
    expect(vanilla.state).toBe("vanillaReady");
    expect(await exists(generatedLogPath)).toBe(false);
    expect(await exists(path.join(runtimeRoot, "ue4ss"))).toBe(false);
    expect(await exists(path.join(runtimeRoot, "dwmapi.dll"))).toBe(false);
  });

  it("preserves preexisting UE4SS-generated log paths during vanilla restore", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createReleaseLayoutFakeGame(root);
    const runtimeRoot = path.join(
      discovery.gameInstallPath!,
      "Clawed",
      "Binaries",
      "Win64"
    );
    const preexistingLogPath = path.join(runtimeRoot, "ue4ss", "UE4SS.log");
    await mkdir(path.dirname(preexistingLogPath), { recursive: true });
    await writeFile(preexistingLogPath, "user-owned log");
    await importNestedRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    expect((await deploymentService.prepareModdedDeployment(discovery)).status).toBe(
      "ok"
    );

    const vanilla = await deploymentService.prepareVanillaDeployment(discovery);

    expect(vanilla.status).toBe("ok");
    expect(await readFile(preexistingLogPath, "utf8")).toBe("user-owned log");
    expect(await exists(path.join(runtimeRoot, "ue4ss", "Mods"))).toBe(false);
    expect(await exists(path.join(runtimeRoot, "dwmapi.dll"))).toBe(false);
  });

  it("detects changed game fingerprint and invalidates active deployment", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createFakeGame(root);
    await importRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    expect((await deploymentService.prepareModdedDeployment(discovery)).status).toBe(
      "ok"
    );

    await writeFile(discovery.gameExecutable!, "changed executable bytes");
    const snapshot = await deploymentService.getSnapshot();

    expect(snapshot.state).toBe("runtimeIncompatible");
    expect(
      snapshot.problems.some((problem) => problem.code === "GAME_BUILD_CHANGED")
    ).toBe(true);

    const refreshed = await deploymentService.prepareModdedDeployment(discovery);

    expect(refreshed.status).toBe("ok");
    expect(refreshed.state).toBe("runtimeUnvalidated");
    expect(
      refreshed.problems.some((problem) => problem.code === "GAME_BUILD_CHANGED")
    ).toBe(true);
    expect(refreshed.manifest?.gameFingerprint.executableSha256).toBe(
      await hashFileSha256(discovery.gameExecutable!)
    );
  });

  it("does not invalidate deployment when Steam appmanifest bytes change but build id is unchanged", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createFakeSteamGame(root);
    await importRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    expect((await deploymentService.prepareModdedDeployment(discovery)).status).toBe(
      "ok"
    );

    await writeAppManifest(discovery.appManifestPath!, "24742251", "200");
    const snapshot = await deploymentService.getSnapshot();

    expect(snapshot.state).toBe("runtimeUnvalidated");
    expect(snapshot.state).not.toBe("runtimeIncompatible");
    expect(
      snapshot.problems.some((problem) => problem.code === "GAME_BUILD_CHANGED")
    ).toBe(false);
  });

  it("stages pak assets structurally without requiring UE4SS runtime", async () => {
    const { root, deploymentService, modLibraryService, profileService } =
      await makeServices();
    const discovery = await createFakeGame(root);
    await importAndEnable(
      root,
      modLibraryService,
      profileService,
      {
        id: "pak-mod",
        name: "Pak Mod",
        version: "1.0.0",
        loader: "pak"
      },
      {
        payloadEntries: [
          {
            name: "Content/Paks/PakMod_P.pak",
            content: "fake pak bytes"
          },
          {
            name: "Content/Paks/PakMod_P.utoc",
            content: "fake iostore bytes"
          }
        ]
      }
    );

    const result = await deploymentService.prepareModdedDeployment(discovery);
    const snapshot = await deploymentService.getSnapshot();

    expect(result.status).toBe("ok");
    expect(result.state).toBe("moddedReady");
    expect(result.manifest?.adapterId).toBe("pak");
    await expect(
      readFile(
        path.join(
          discovery.gameInstallPath!,
          "Content",
          "Paks",
          "zz-CMM-000001-pak-mod-01-PakMod_P_000001_P.pak"
        ),
        "utf8"
      )
    ).resolves.toBe("fake pak bytes");
    await expect(
      readFile(
        path.join(
          discovery.gameInstallPath!,
          "Content",
          "Paks",
          "zz-CMM-000001-pak-mod-01-PakMod_P_000001_P.utoc"
        ),
        "utf8"
      )
    ).resolves.toBe("fake iostore bytes");
    expect(
      snapshot.problems.some((problem) =>
        problem.message.includes("Effective Unreal asset load order")
      )
    ).toBe(false);
    expect(result.manifest?.runtimeConfiguration).toMatchObject({
      type: "pak",
      releaseValidation: "VALIDATED",
      effectiveOrderKnown: true,
      orderingStrategy: "ordered-project-patch-pak-filenames",
      logicalOrder: ["pak-mod"]
    });
  });

  it("stages pak assets into the release project Paks directory", async () => {
    const { root, deploymentService, modLibraryService, profileService } =
      await makeServices();
    const discovery = await createReleaseLayoutFakeGame(root);
    await importAndEnable(
      root,
      modLibraryService,
      profileService,
      {
        id: "pak-mod",
        name: "Pak Mod",
        version: "1.0.0",
        loader: "pak"
      },
      {
        payloadEntries: [
          {
            name: "Content/Paks/PakMod_P.pak",
            content: "fake pak bytes"
          },
          {
            name: "Content/Paks/PakMod_P.utoc",
            content: "fake iostore bytes"
          }
        ]
      }
    );

    const result = await deploymentService.prepareModdedDeployment(discovery);

    expect(result.status).toBe("ok");
    await expect(
      readFile(
        path.join(
          discovery.gameInstallPath!,
          "Clawed",
          "Content",
          "Paks",
          "Clawed-zz-CMM-000001-pak-mod-01-PakMod_P_000001_P.pak"
        ),
        "utf8"
      )
    ).resolves.toBe("fake pak bytes");
    await expect(
      readFile(
        path.join(
          discovery.gameInstallPath!,
          "Clawed",
          "Content",
          "Paks",
          "Clawed-zz-CMM-000001-pak-mod-01-PakMod_P_000001_P.utoc"
        ),
        "utf8"
      )
    ).resolves.toBe("fake iostore bytes");
    expect(
      await exists(
        path.join(discovery.gameInstallPath!, "Content", "Paks", "PakMod_P.pak")
      )
    ).toBe(false);
  });

  it("stages non-asset loose files without requiring UE4SS runtime", async () => {
    const { root, deploymentService, modLibraryService, profileService } =
      await makeServices();
    const discovery = await createReleaseLayoutFakeGame(root);
    await importAndEnable(
      root,
      modLibraryService,
      profileService,
      {
        id: "bp-logic-config",
        name: "BP Logic Config",
        version: "1.0.0",
        loader: "loose"
      },
      {
        payloadEntries: [
          {
            name: "Clawed/Content/Paks/LogicMods/BPLogic/config.lua",
            content: "return {}"
          }
        ]
      }
    );

    const result = await deploymentService.prepareModdedDeployment(discovery);

    expect(result.status).toBe("ok");
    expect(result.state).toBe("moddedReady");
    expect(result.manifest?.adapterId).toBe("loose");
    await expect(
      readFile(
        path.join(
          discovery.gameInstallPath!,
          "Clawed",
          "Content",
          "Paks",
          "LogicMods",
          "BPLogic",
          "config.lua"
        ),
        "utf8"
      )
    ).resolves.toBe("return {}");
  });

  it("blocks cooked Unreal assets from loose deployment", async () => {
    const { root, deploymentService, modLibraryService, profileService } =
      await makeServices();
    const discovery = await createReleaseLayoutFakeGame(root);
    await importAndEnable(
      root,
      modLibraryService,
      profileService,
      {
        id: "loose-texture",
        name: "Loose Texture",
        version: "1.0.0",
        loader: "loose"
      },
      {
        payloadEntries: [
          {
            name: "Clawed/Content/UtahRaptor/Textures/T_Utah_Claws_D.uasset",
            content: "fake cooked asset"
          },
          {
            name: "Clawed/Content/UtahRaptor/Textures/T_Utah_Claws_D.uexp",
            content: "fake cooked export"
          }
        ]
      }
    );

    const result = await deploymentService.prepareModdedDeployment(discovery);

    expect(result.status).toBe("blocked");
    expect(result.state).toBe("deploymentError");
    expect(result.problems[0]).toMatchObject({
      code: "DEPLOYMENT_VALIDATION_FAILED",
      message:
        'Loose Texture contains cooked Unreal asset files that Clawed does not load from loose staging; package them as loader "pak" under payload/Content/Paks/ instead.'
    });
    expect(
      await exists(
        path.join(
          discovery.gameInstallPath!,
          "Clawed",
          "Content",
          "UtahRaptor",
          "Textures",
          "T_Utah_Claws_D.uasset"
        )
      )
    ).toBe(false);
  });

  it("rolls back manager-owned files after a mid-deployment failure", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices({ failAfterFileOperations: 1 });
    const discovery = await createFakeGame(root);
    await importRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    const unknownFilePath = path.join(discovery.gameInstallPath!, "unknown.txt");
    await writeFile(unknownFilePath, "keep");

    const result = await deploymentService.prepareModdedDeployment(discovery);

    expect(result.status).toBe("rolledBack");
    expect(result.state).toBe("deploymentError");
    expect(await exists(path.join(discovery.gameInstallPath!, "xinput1_3.dll"))).toBe(
      false
    );
    expect(
      await exists(path.join(discovery.gameInstallPath!, "UE4SS-settings.ini"))
    ).toBe(false);
    expect(await readFile(unknownFilePath, "utf8")).toBe("keep");
    expect(
      await exists(
        path.join(root, "runtime", "deployments", "current-deployment.json")
      )
    ).toBe(false);
  });

  it("removes owned deployment files and restores backups for vanilla launch", async () => {
    const {
      root,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createFakeGame(root);
    await importRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const modsTxtPath = path.join(discovery.gameInstallPath!, "Mods", "mods.txt");
    const unknownFilePath = path.join(
      discovery.gameInstallPath!,
      "Mods",
      "unknown.txt"
    );
    await mkdir(path.dirname(modsTxtPath), { recursive: true });
    await writeFile(modsTxtPath, "original user file\n");
    await writeFile(unknownFilePath, "not owned by CMM");
    expect((await deploymentService.prepareModdedDeployment(discovery)).status).toBe(
      "ok"
    );

    const vanilla = await deploymentService.prepareVanillaDeployment(discovery);

    expect(vanilla.status).toBe("ok");
    expect(vanilla.state).toBe("vanillaReady");
    expect(await exists(path.join(discovery.gameInstallPath!, "xinput1_3.dll"))).toBe(
      false
    );
    expect(
      await exists(path.join(discovery.gameInstallPath!, "UE4SS-settings.ini"))
    ).toBe(false);
    expect(
      await exists(
        path.join(discovery.gameInstallPath!, "Mods", "cmm-profile.json")
      )
    ).toBe(false);
    expect(await readFile(modsTxtPath, "utf8")).toBe("original user file\n");
    expect(await readFile(unknownFilePath, "utf8")).toBe("not owned by CMM");
    expect(
      await exists(
        path.join(root, "runtime", "deployments", "current-deployment.json")
      )
    ).toBe(false);
  });

  it("restores tracked CMM changes through the backup service", async () => {
    const {
      root,
      backupService,
      deploymentService,
      modLibraryService,
      profileService,
      runtimeManager
    } = await makeServices();
    const discovery = await createFakeGame(root);
    await importRuntime(root, runtimeManager);
    await importAndEnable(root, modLibraryService, profileService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });

    const modsTxtPath = path.join(discovery.gameInstallPath!, "Mods", "mods.txt");
    const unknownFilePath = path.join(discovery.gameInstallPath!, "unknown.txt");
    await mkdir(path.dirname(modsTxtPath), { recursive: true });
    await writeFile(modsTxtPath, "before CMM\n");
    await writeFile(unknownFilePath, "unknown file");
    expect((await deploymentService.prepareModdedDeployment(discovery)).status).toBe(
      "ok"
    );
    await writeFile(
      path.join(discovery.gameInstallPath!, "UE4SS.log"),
      "runtime generated log"
    );

    const restored = await backupService.restoreCmmChanges();

    expect(restored.status).toBe("ok");
    expect(await readFile(modsTxtPath, "utf8")).toBe("before CMM\n");
    expect(await readFile(unknownFilePath, "utf8")).toBe("unknown file");
    expect(await exists(path.join(discovery.gameInstallPath!, "xinput1_3.dll"))).toBe(
      false
    );
    expect(await exists(path.join(discovery.gameInstallPath!, "UE4SS.log"))).toBe(
      false
    );
    expect(
      await exists(
        path.join(root, "runtime", "deployments", "current-deployment.json")
      )
    ).toBe(false);
  });

  it("rejects malformed and hostile UE4SS runtime archives", async () => {
    const { root, runtimeManager } = await makeServices();
    const malformedPath = path.join(root, "malformed.zip");
    await writeFile(malformedPath, "not a zip");

    const malformed = await runtimeManager.importUe4ssRuntime({
      sourcePath: malformedPath
    });
    expect(malformed.status).toBe("failed");
    expect(malformed.problems[0].code).toBe("UE4SS_RUNTIME_ARCHIVE_INVALID");

    const hostilePath = path.join(root, "hostile.zip");
    const hostileZip = new JSZip();
    hostileZip.file("../xinput1_3.dll", "bad");
    hostileZip.file("UE4SS-settings.ini", "config");
    await writeFile(hostilePath, await hostileZip.generateAsync({ type: "nodebuffer" }));

    const hostile = await runtimeManager.importUe4ssRuntime({
      sourcePath: hostilePath
    });
    expect(hostile.status).toBe("failed");
    expect(hostile.problems[0].code).toBe("UNSAFE_ARCHIVE_PATH");
  });
});
