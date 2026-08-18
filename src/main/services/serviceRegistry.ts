import { app } from "electron";
import path from "node:path";

import type {
  DeploymentAdapterContract,
  DeploymentAdapterDescriptor
} from "../../shared/contracts/deployment";
import type { CoreServices } from "../../shared/contracts/services";
import { ClawedGameAdapter } from "../adapters/clawed/clawedGameAdapter";
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

const BUNDLED_UE4SS_VERSION = "ue4ss-experimental-latest-1c1a1497";

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
      status: "validated",
      validatedSteamBuildIds: ["24719259", "24742251"],
      message:
        "Packaged UE4SS experimental-latest commit 1c1a1497 loads Lua mods and honors generated mods.txt Lua startup order on Clawed builds 24719259 and 24742251.",
      technicalDetail:
        "Live validation on 2026-08-13 loaded UE4SS.dll from the official nested layout through the local dwmapi proxy, detected UE 5.5, started CMMReleaseValidation, ran ExecuteInGameThread, and completed FindFirstOf(GameEngine). Follow-up CMM service and Electron-path validations deployed two generated .clawedmod Lua packages and observed UE4SS start them in CMM profile order from generated mods.txt. Runtime feature probes on 2026-08-15 revalidated UE4SS hook callbacks on Clawed build 24742251."
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
  const assetRegistryService = new LocalAssetRegistryService(
    modLibraryService,
    profileService,
    loadOrderService,
    deploymentService,
    {
      mapRoot: getBundledClawedFileMapPath()
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
      deploymentService
    ),
    deploymentService,
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
