import { app } from "electron";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type {
  DeploymentAdapterContract,
  DeploymentAdapterDescriptor
} from "../../shared/contracts/deployment";
import type { CoreServices } from "../../shared/contracts/services";
import { ClawedGameAdapter } from "../adapters/clawed/clawedGameAdapter";
import { Cue4ParseMeshDecoder } from "../adapters/unreal/cue4parseMeshDecoder";
import { LooseFileDeploymentAdapter } from "../adapters/unreal/looseFileDeploymentAdapter";
import { PakDeploymentAdapter } from "../adapters/unreal/pakDeploymentAdapter";
import { UE4SSDeploymentAdapter } from "../adapters/ue4ss/ue4ssDeploymentAdapter";
import { LocalAssetRegistryService } from "./assetRegistryService";
import { LocalBackupService } from "./backupService";
import { ClawedModPackageService } from "./clawedModPackageService";
import { LocalDeploymentService } from "./deploymentService";
import { LocalDiagnosticsService } from "./diagnosticsService";
import { LocalExternalModImportService } from "./externalModImportService";
import { SteamGameLocator } from "./gameLocator";
import { JsonlLifecycleLogger } from "./lifecycleLogger";
import { SteamLaunchService } from "./launchService";
import { LocalModLibraryService } from "./modLibraryService";
import { LocalModpackService } from "./modpackService";
import { PackagedRuntimeValidationService } from "./packagedRuntimeValidationService";
import { WindowsProcessPlatform } from "./processPlatform";
import { WindowsProcessSupervisor } from "./processSupervisor";
import {
  LocalLoadOrderService,
  LocalProfileService
} from "./profileService";
import { LocalRuntimeManager } from "./runtimeManager";
import { JsonSettingsService } from "./settingsService";
import { ElectronStorageService } from "./storageService";
import { WindowsSteamPathProvider } from "./steamPathProvider";
import { LocalUnrealMappingsService } from "./unrealMappingsService";

const BUNDLED_UE4SS_VERSION = "ue4ss-v3.0.1-lts";

export type MainServiceDependencies = Omit<
  CoreServices,
  "diagnosticsService" | "storageService" | "settingsService"
>;

export function createMainServices(options?: {
  adapters?: DeploymentAdapterDescriptor[];
}): CoreServices {
  const storageService = new ElectronStorageService();
  const settingsService = new JsonSettingsService(storageService);
  const logger = new JsonlLifecycleLogger(storageService);
  const gameLocator = new SteamGameLocator(
    settingsService,
    new WindowsSteamPathProvider(),
    logger
  );
  const processPlatform = new WindowsProcessPlatform();
  const processSupervisor = new WindowsProcessSupervisor(
    processPlatform,
    logger
  );
  const packageService = new ClawedModPackageService();
  const modLibraryService = new LocalModLibraryService(
    storageService,
    packageService
  );
  const externalImportService = new LocalExternalModImportService(
    storageService,
    packageService,
    modLibraryService
  );
  const profileService = new LocalProfileService(
    storageService,
    modLibraryService
  );
  const loadOrderService = new LocalLoadOrderService(profileService);
  const runtimeManager = new LocalRuntimeManager(storageService, logger, {
    bundledUe4ssRuntimePath: getBundledUe4ssRuntimePath(),
    bundledUe4ssVersion: BUNDLED_UE4SS_VERSION,
    bundledUe4ssCompatibility: {
      status: "unvalidated",
      message:
        "Packaged UE4SS v3.0.1 LTS is installed for mod creator workflows, but this bundled default has not been live validated against the current Clawed build."
    }
  });
  const clawedGameAdapter = new ClawedGameAdapter();
  const ue4ssAdapter = new UE4SSDeploymentAdapter();
  const pakAdapter = new PakDeploymentAdapter();
  const looseAdapter = new LooseFileDeploymentAdapter();
  const deploymentAdapters: DeploymentAdapterContract[] = [
    ue4ssAdapter,
    pakAdapter,
    looseAdapter
  ];
  const adapters = options?.adapters ?? [
    clawedGameAdapter.descriptor,
    ue4ssAdapter.descriptor,
    pakAdapter.descriptor,
    looseAdapter.descriptor
  ];
  const deploymentService = new LocalDeploymentService(
    storageService,
    modLibraryService,
    profileService,
    loadOrderService,
    runtimeManager,
    deploymentAdapters,
    logger,
    { settingsService },
    clawedGameAdapter
  );
  const packagedRuntimeValidationService = new PackagedRuntimeValidationService(
    storageService,
    deploymentService,
    runtimeManager,
    processSupervisor,
    processPlatform,
    logger
  );
  const unrealMappingsService = new LocalUnrealMappingsService(
    storageService,
    gameLocator,
    deploymentService,
    processSupervisor,
    processPlatform,
    logger
  );
  const assetRegistryService = new LocalAssetRegistryService(
    modLibraryService,
    profileService,
    loadOrderService,
    deploymentService,
    {
      mapRoot: getBundledClawedFileMapPath(),
      baseGameMeshDecoder: new Cue4ParseMeshDecoder({
        sidecarPath: getBundledCue4ParseDecoderPath(),
        unrealVersion: "GAME_UE5_5",
        aesKey: process.env.CMM_CUE4PARSE_AES_KEY ?? null,
        resolveMappingsPath: async () => {
          const bundled = getBundledCue4ParseMappingsPath();
          if (bundled) {
            return bundled;
          }
          const discovery = await gameLocator.discover();
          return getClawedRuntimeMappingsPath(
            clawedGameAdapter.getLayout(discovery).binaryDirectory
          );
        },
        resolveArchiveRoot: async () => {
          const discovery = await gameLocator.discover();
          return clawedGameAdapter.getLayout(discovery).pakDirectory;
        }
      }),
      logger
    }
  );
  const dependencies: MainServiceDependencies = {
    gameLocator,
    processSupervisor,
    launchService: new SteamLaunchService(
      gameLocator,
      processSupervisor,
      processPlatform,
      logger,
      undefined,
      deploymentService,
      settingsService,
      packagedRuntimeValidationService
    ),
    deploymentService,
    packagedRuntimeValidationService,
    unrealMappingsService,
    runtimeManager,
    modLibraryService,
    externalImportService,
    assetRegistryService,
    profileService,
    loadOrderService,
    packageService,
    exportImportService: new LocalModpackService(
      storageService,
      modLibraryService,
      profileService,
      loadOrderService,
      packageService
    ),
    backupService: new LocalBackupService(storageService, logger)
  };

  return {
    ...dependencies,
    storageService,
    settingsService,
    diagnosticsService: new LocalDiagnosticsService(
      dependencies,
      storageService,
      adapters,
      clawedGameAdapter,
      logger
    )
  };
}

function getBundledUe4ssRuntimePath(): string {
  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };

  if (app.isPackaged && electronProcess.resourcesPath) {
    return path.join(electronProcess.resourcesPath, "runtime", "ue4ss", "default");
  }

  return path.join(process.cwd(), "assets", "runtime", "ue4ss", "default");
}

function getBundledClawedFileMapPath(): string {
  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };

  if (app.isPackaged && electronProcess.resourcesPath) {
    return path.join(
      electronProcess.resourcesPath,
      "clawed-game-file-map",
      "20260814-current"
    );
  }

  return path.join(
    process.cwd(),
    ".codex",
    "clawed-game-file-map",
    "20260814-current"
  );
}

function getBundledCue4ParseDecoderPath(): string {
  const configured = process.env.CMM_CUE4PARSE_DECODER_PATH;
  if (configured) {
    return path.resolve(configured);
  }

  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };

  if (app.isPackaged && electronProcess.resourcesPath) {
    return path.join(
      electronProcess.resourcesPath,
      "unreal-decoder",
      "CmmUnrealDecoder.exe"
    );
  }

  return path.join(process.cwd(), "assets", "unreal-decoder", "CmmUnrealDecoder.exe");
}

function getBundledCue4ParseMappingsPath(): string | null {
  const configured = process.env.CMM_CUE4PARSE_MAPPINGS;
  if (configured) {
    return path.resolve(configured);
  }

  const mappingRoot = path.join(path.dirname(getBundledCue4ParseDecoderPath()), "mappings");
  if (!existsSync(mappingRoot)) {
    return null;
  }

  const mappings = readdirSync(mappingRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".usmap"))
    .map((entry) => path.join(mappingRoot, entry.name));
  return (
    mappings.find((mapping) => path.basename(mapping).toLowerCase().includes("clawed")) ??
    mappings[0] ??
    null
  );
}

function getClawedRuntimeMappingsPath(binaryDirectory: string | null): string | null {
  if (!binaryDirectory) {
    return null;
  }

  const stable = firstExistingPath([
    path.join(binaryDirectory, "Mappings.usmap"),
    path.join(binaryDirectory, "ue4ss", "Mappings.usmap")
  ]);
  if (stable) {
    return stable;
  }

  return findFirstUsmap([
    binaryDirectory,
    path.join(binaryDirectory, "ue4ss")
  ]);
}

function firstExistingPath(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findFirstUsmap(directories: string[]): string | null {
  const mappings = directories.flatMap((directory) => {
    if (!existsSync(directory)) {
      return [];
    }
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".usmap"))
      .map((entry) => path.join(directory, entry.name));
  });
  return (
    mappings.find((mapping) => path.basename(mapping).toLowerCase().includes("clawed")) ??
    mappings[0] ??
    null
  );
}
