import { app, dialog, ipcMain } from "electron";
import path from "node:path";
import { ZodError } from "zod";

import {
  IPC_CHANNELS,
  ipcContracts,
  type IpcContract
} from "../../shared/contracts/ipc";
import {
  CreatorMappingsDumpProgressSchema,
  type ImportModPackageResult
} from "../../shared/contracts/app";
import type {
  AppUpdateServiceContract,
  CoreServices,
  CreatorViewportWindowServiceContract
} from "../../shared/contracts/services";

function toUserSafeError(error: unknown): Error {
  if (error instanceof ZodError) {
    return new Error("The app received an invalid internal request.");
  }

  if (error instanceof Error) {
    return new Error(error.message);
  }

  return new Error("The app could not complete the request.");
}

function registerHandler<TRequest, TResponse>(
  contract: IpcContract<TRequest, TResponse>,
  handler: (request: TRequest) => Promise<TResponse>
): void {
  ipcMain.handle(contract.channel, async (_event, rawRequest: unknown) => {
    try {
      const request = contract.requestSchema.parse(rawRequest);
      const response = await handler(request);
      return contract.responseSchema.parse(response);
    } catch (error) {
      throw toUserSafeError(error);
    }
  });
}

async function importExternalModPackageWithPrompt(
  services: CoreServices,
  packagePath: string
): Promise<ImportModPackageResult> {
  const result = await services.externalImportService.importExternalModPackage({
    packagePath
  });

  if (
    result.status !== "needsReplacementConfirmation" ||
    !result.packageIdentityId
  ) {
    return result;
  }

  const response = await dialog.showMessageBox({
    type: "warning",
    title: "Replace installed mod?",
    message: "CMM found an installed mod with the same package identity.",
    detail: formatReplacementPromptDetail(result),
    buttons: ["Cancel", "Replace Matching Mods"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });

  if (response.response !== 1) {
    return {
      ...result,
      status: "failed",
      mod: null,
      problems: [
        {
          severity: "info",
          code: "PACKAGE_IDENTITY_REPLACEMENT_CANCELLED",
          message: "Mod import was cancelled before replacing installed mods."
        }
      ]
    };
  }

  return services.externalImportService.importExternalModPackage({
    packagePath,
    replacement: {
      action: "replaceMatchingIdentity",
      packageIdentityId: result.packageIdentityId
    }
  });
}

function formatReplacementPromptDetail(result: ImportModPackageResult): string {
  const candidates = result.replacementCandidates ?? [];
  const installed = candidates.length
    ? candidates
        .map((candidate) => `${candidate.name} (${candidate.id}@${candidate.version})`)
        .join("\n")
    : "No installed package details were available.";

  return [
    "Display names are not used for this replacement decision.",
    "",
    "Matching installed mods:",
    installed,
    "",
    "Replace the matching installed mod entries with the selected package?"
  ].join("\n");
}

type IpcServices = CoreServices & {
  appUpdateService: AppUpdateServiceContract;
  creatorViewportWindowService: CreatorViewportWindowServiceContract;
};

export function registerIpcHandlers(services: IpcServices): void {
  registerHandler(ipcContracts.getPlaySnapshot, () =>
    services.diagnosticsService.getPlaySnapshot()
  );

  registerHandler(ipcContracts.runLaunchCommand, (request) =>
    services.launchService.runLaunchCommand(request)
  );

  registerHandler(ipcContracts.getGameDiscovery, () =>
    services.gameLocator.discover()
  );

  registerHandler(ipcContracts.rescanGameDiscovery, () =>
    services.gameLocator.rescan()
  );

  registerHandler(ipcContracts.chooseManualGameDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select Clawed installation folder",
      properties: ["openDirectory"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return services.gameLocator.discover();
    }

    await services.settingsService.setManualGameDirectory(result.filePaths[0]);
    return services.gameLocator.rescan();
  });

  registerHandler(ipcContracts.clearManualGameDirectory, async () => {
    await services.settingsService.setManualGameDirectory(null);
    return services.gameLocator.rescan();
  });

  registerHandler(ipcContracts.setManualGameDirectory, async (request) => {
    await services.settingsService.setManualGameDirectory(request.gameDirectory);
    return services.gameLocator.rescan();
  });

  registerHandler(ipcContracts.getAppSettings, () =>
    services.settingsService.getSettings()
  );

  registerHandler(ipcContracts.setAutoUpdatePackagedRuntime, (request) =>
    services.settingsService.setAutoUpdatePackagedRuntime(request.enabled)
  );

  registerHandler(ipcContracts.setAutoValidatePackagedRuntime, (request) =>
    services.settingsService.setAutoValidatePackagedRuntime(request.enabled)
  );

  registerHandler(ipcContracts.setSuppressAppUpdatePrompt, (request) =>
    services.settingsService.setSuppressAppUpdatePrompt(request.enabled)
  );

  registerHandler(ipcContracts.getAppUpdateSnapshot, async () =>
    services.appUpdateService.getSnapshot()
  );

  registerHandler(ipcContracts.checkForAppUpdates, () =>
    services.appUpdateService.checkForUpdates()
  );

  registerHandler(ipcContracts.downloadAppUpdate, () =>
    services.appUpdateService.downloadAvailableUpdate()
  );

  registerHandler(ipcContracts.installAppUpdate, async () =>
    services.appUpdateService.installDownloadedUpdate()
  );

  registerHandler(ipcContracts.getLifecycleSnapshot, async () => {
    const discovery = await services.gameLocator.discover();
    return services.processSupervisor.getSnapshot(discovery.gameExecutable);
  });

  registerHandler(ipcContracts.listInstalledMods, () =>
    services.profileService.listInstalledModsForActiveProfile()
  );

  registerHandler(ipcContracts.importModPackage, (request) =>
    services.modLibraryService.importModPackage(request)
  );

  registerHandler(ipcContracts.importExternalModPackage, (request) =>
    services.externalImportService.importExternalModPackage(request)
  );

  registerHandler(ipcContracts.chooseAndImportModPackage, async () => {
    const result = await dialog.showOpenDialog({
      title: "Import mod package",
      filters: [
        {
          name: "Supported Mod Files",
          extensions: ["clawedmod", "zip", "pak", "utoc", "ucas", "rar", "7z"]
        },
        { name: "Clawed Mod Packages", extensions: ["clawedmod"] },
        { name: "ZIP Archives", extensions: ["zip"] },
        { name: "Unreal Pak / IoStore", extensions: ["pak", "utoc", "ucas"] },
        { name: "Recognized Unsupported Archives", extensions: ["rar", "7z"] }
      ],
      properties: ["openFile"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return {
        status: "failed" as const,
        mod: null,
        problems: [
          {
            severity: "info" as const,
            code: "IMPORT_CANCELLED",
            message: "No mod package was selected."
          }
        ]
      };
    }

    return importExternalModPackageWithPrompt(services, result.filePaths[0]);
  });

  registerHandler(ipcContracts.listAvailableMods, () =>
    services.availableModService.listAvailableMods()
  );

  registerHandler(ipcContracts.installAvailableMod, (request) =>
    services.availableModService.installAvailableMod(request)
  );

  registerHandler(ipcContracts.uninstallMod, async (request) => {
    const result = await services.modLibraryService.uninstallMod(request);

    if (result.status !== "ok") {
      return result;
    }

    const [missingProfiles, modpackHistory] = await Promise.all([
      services.profileService.getMissingModReferences(),
      services.exportImportService.listRecentModpacks()
    ]);
    const missingModpackPackages = modpackHistory.entries.reduce(
      (total, entry) => total + entry.missingPackages.length,
      0
    );

    return {
      ...result,
      problems: [
        ...result.problems,
        ...(missingProfiles.totalMissing > 0
          ? [
              {
                severity: "warning" as const,
                code: "PROFILE_MODS_MISSING_AFTER_UNINSTALL",
                message:
                  "Some profiles now reference removed mods. Review Profiles to accept the new state.",
                technicalDetail: formatMissingProfiles(missingProfiles)
              }
            ]
          : []),
        ...(missingModpackPackages > 0
          ? [
              {
                severity: "warning" as const,
                code: "MODPACK_TRACKING_MISSING_AFTER_UNINSTALL",
                message:
                  "Recent modpack tracking now references removed mods. Review Modpacks to accept the new state.",
                technicalDetail: formatMissingModpackHistory(modpackHistory)
              }
            ]
          : [])
      ]
    };
  });

  registerHandler(ipcContracts.setModEnabled, (request) =>
    services.profileService.setModEnabled(request)
  );

  registerHandler(ipcContracts.inspectModManifest, (request) =>
    services.modLibraryService.inspectManifest(request)
  );

  registerHandler(ipcContracts.readModReadme, (request) =>
    services.modLibraryService.readReadme(request)
  );

  registerHandler(ipcContracts.openModFolder, (request) =>
    services.modLibraryService.openModFolder(request)
  );

  registerHandler(ipcContracts.getActiveProfile, () =>
    services.profileService.getActiveProfile()
  );

  registerHandler(ipcContracts.listProfiles, () =>
    services.profileService.listProfiles()
  );

  registerHandler(ipcContracts.createProfile, (request) =>
    services.profileService.createProfile(request)
  );

  registerHandler(ipcContracts.duplicateProfile, (request) =>
    services.profileService.duplicateProfile(request)
  );

  registerHandler(ipcContracts.renameProfile, (request) =>
    services.profileService.renameProfile(request)
  );

  registerHandler(ipcContracts.deleteProfile, (request) =>
    services.profileService.deleteProfile(request)
  );

  registerHandler(ipcContracts.switchProfile, (request) =>
    services.profileService.switchProfile(request)
  );

  registerHandler(ipcContracts.getMissingProfileMods, () =>
    services.profileService.getMissingModReferences()
  );

  registerHandler(ipcContracts.acceptMissingProfileMods, () =>
    services.profileService.acceptMissingModReferences()
  );

  registerHandler(ipcContracts.getLoadOrderSnapshot, () =>
    services.loadOrderService.getSnapshot()
  );

  registerHandler(ipcContracts.validateActiveLoadOrder, () =>
    services.loadOrderService.validateActiveOrder()
  );

  registerHandler(ipcContracts.moveModInActiveOrder, (request) =>
    services.profileService.moveModInActiveOrder(request)
  );

  registerHandler(ipcContracts.setModActiveOrderPosition, (request) =>
    services.profileService.setModActiveOrderPosition(request)
  );

  registerHandler(ipcContracts.placeModInActiveOrder, (request) =>
    services.profileService.placeModInActiveOrder(request)
  );

  registerHandler(ipcContracts.exportCurrentProfileModpack, (request) =>
    services.exportImportService.exportCurrentProfile(request)
  );

  registerHandler(
    ipcContracts.chooseAndExportCurrentProfileModpack,
    async () => {
      const activeProfile = await services.profileService.getActiveProfile();
      const result = await dialog.showSaveDialog({
        title: "Share current profile",
        defaultPath: `${sanitizeFileName(activeProfile.name)}.clawedpack`,
        filters: [{ name: "Clawed Modpacks", extensions: ["clawedpack"] }]
      });

      if (result.canceled || !result.filePath) {
        return {
          status: "failed" as const,
          modpackPath: null,
          packageCount: 0,
          validation: null,
          problems: [
            {
              severity: "info" as const,
              code: "EXPORT_CANCELLED",
              message: "No modpack export path was selected."
            }
          ]
        };
      }

      return services.exportImportService.exportCurrentProfile({
        destinationPath: result.filePath
      });
    }
  );

  registerHandler(ipcContracts.inspectModpack, (request) =>
    services.exportImportService.inspectModpack(request)
  );

  registerHandler(ipcContracts.chooseAndInspectModpack, async () => {
    const result = await dialog.showOpenDialog({
      title: "Import friend's modpack",
      filters: [{ name: "Clawed Modpacks", extensions: ["clawedpack"] }],
      properties: ["openFile"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return {
        status: "invalid" as const,
        modpackPath: "",
        pack: null,
        loadOrder: null,
        summary: null,
        packages: [],
        problems: [
          {
            severity: "info" as const,
            code: "IMPORT_CANCELLED",
            message: "No modpack was selected."
          }
        ]
      };
    }

    return services.exportImportService.inspectModpack({
      modpackPath: result.filePaths[0]
    });
  });

  registerHandler(ipcContracts.importModpack, (request) =>
    services.exportImportService.importModpack(request)
  );

  registerHandler(ipcContracts.compareCurrentProfileToModpack, (request) =>
    services.exportImportService.compareCurrentProfileToModpack(request)
  );

  registerHandler(ipcContracts.listRecentModpacks, () =>
    services.exportImportService.listRecentModpacks()
  );

  registerHandler(ipcContracts.acceptMissingModpackMods, () =>
    services.exportImportService.acceptMissingModpackReferences()
  );

  registerHandler(ipcContracts.getDeploymentSnapshot, async () =>
    services.deploymentService.getSnapshot(await services.gameLocator.discover())
  );

  registerHandler(ipcContracts.prepareVanillaDeployment, async () => {
    const discovery = await services.gameLocator.rescan();
    return services.deploymentService.prepareVanillaDeployment(discovery);
  });

  registerHandler(ipcContracts.getRuntimeSnapshot, async () =>
    (await services.diagnosticsService.getDiagnosticsSummary()).runtime
  );

  registerHandler(ipcContracts.installBundledUe4ssRuntime, () =>
    services.runtimeManager.installBundledUe4ssRuntime()
  );

  registerHandler(ipcContracts.validatePackagedRuntime, async () =>
    services.packagedRuntimeValidationService.validate(
      await services.gameLocator.rescan()
    )
  );

  registerHandler(ipcContracts.cancelPackagedRuntimeValidation, () =>
    services.packagedRuntimeValidationService.cancel()
  );

  registerHandler(ipcContracts.importUe4ssRuntime, (request) =>
    services.runtimeManager.importUe4ssRuntime(request)
  );

  registerHandler(ipcContracts.chooseAndImportUe4ssRuntime, async () => {
    const result = await dialog.showOpenDialog({
      title: "Import UE4SS runtime ZIP",
      filters: [{ name: "UE4SS ZIP Archives", extensions: ["zip"] }],
      properties: ["openFile"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return {
        status: "failed" as const,
        runtime: null,
        problems: [
          {
            severity: "info" as const,
            code: "RUNTIME_IMPORT_CANCELLED",
            message: "No UE4SS runtime package was selected."
          }
        ]
      };
    }

    return services.runtimeManager.importUe4ssRuntime({
      sourcePath: result.filePaths[0]
    });
  });

  registerHandler(ipcContracts.getCreatorAssetRegistrySnapshot, () =>
    services.assetRegistryService.getSnapshot()
  );

  registerHandler(ipcContracts.searchCreatorAssets, (request) =>
    services.assetRegistryService.searchAssets(request)
  );

  registerHandler(ipcContracts.getCreatorAssetTree, (request) =>
    services.assetRegistryService.getAssetTree(request)
  );

  registerHandler(ipcContracts.getCreatorAssetDetail, (request) =>
    services.assetRegistryService.getAssetDetail(request)
  );

  registerHandler(ipcContracts.getCreatorConflictGraph, (request) =>
    services.assetRegistryService.getConflictGraph(request)
  );

  registerHandler(ipcContracts.getCreatorPreview, (request) =>
    services.assetRegistryService.getPreview(request)
  );

  registerHandler(ipcContracts.getCreatorModelPreview, (request) =>
    services.assetRegistryService.getModelPreview(request)
  );

  registerHandler(ipcContracts.getCreatorExportPlan, (request) =>
    services.assetRegistryService.getExportPlan(request)
  );

  registerHandler(ipcContracts.chooseAndExportCreatorMesh, async (request) => {
    const result = await dialog.showSaveDialog({
      title: "Export creator mesh",
      defaultPath: `${sanitizeFileName(request.assetId)}.${request.format}`,
      filters: [meshExportDialogFilter(request.format)]
    });

    if (result.canceled || !result.filePath) {
      return {
        status: "cancelled" as const,
        asset: null,
        format: request.format,
        destinationPath: null,
        bytesWritten: null,
        metadata: emptyCreatorMeshExportMetadata(),
        problems: [
          {
            severity: "info" as const,
            code: "CREATOR_MESH_EXPORT_CANCELLED",
            message: "No mesh export path was selected."
          }
        ]
      };
    }

    return services.assetRegistryService.exportMesh({
      assetId: request.assetId,
      format: request.format,
      destinationPath: result.filePath
    });
  });

  registerHandler(ipcContracts.chooseAndExportCreatorMeshPackage, async (request) => {
    const result = await dialog.showSaveDialog({
      title: "Export visible creator models",
      defaultPath: "creator-visible-models.clawedmod",
      filters: [{ name: "Clawed Mod Package", extensions: ["clawedmod"] }]
    });

    if (result.canceled || !result.filePath) {
      return {
        status: "cancelled" as const,
        destinationPath: null,
        bytesWritten: null,
        itemCount: request.assetIds.length,
        exportedCount: 0,
        items: [],
        problems: [
          {
            severity: "info" as const,
            code: "CREATOR_MESH_PACKAGE_EXPORT_CANCELLED",
            message: "No creator model package path was selected."
          }
        ]
      };
    }

    return services.assetRegistryService.exportMeshPackage({
      assetIds: request.assetIds,
      destinationPath: result.filePath
    });
  });

  ipcMain.handle(
    ipcContracts.generateCreatorMappings.channel,
    async (event, rawRequest: unknown) => {
      try {
        ipcContracts.generateCreatorMappings.requestSchema.parse(rawRequest);
        const response = await services.unrealMappingsService.generateMappings(
          (progress) => {
            event.sender.send(
              IPC_CHANNELS.creatorMappingsProgress,
              CreatorMappingsDumpProgressSchema.parse(progress)
            );
          }
        );
        return ipcContracts.generateCreatorMappings.responseSchema.parse(response);
      } catch (error) {
        throw toUserSafeError(error);
      }
    }
  );

  registerHandler(ipcContracts.getCreatorAssetReport, (request) =>
    services.assetRegistryService.getReport(request)
  );

  registerHandler(ipcContracts.getCreatorViewportTextureCandidates, (request) =>
    services.assetRegistryService.getViewportTextureCandidates(request)
  );

  registerHandler(ipcContracts.openCreatorViewportWindow, (request) =>
    services.creatorViewportWindowService.open(request)
  );

  registerHandler(ipcContracts.getCreatorViewportSession, () =>
    services.creatorViewportWindowService.read()
  );

  registerHandler(ipcContracts.updateCreatorViewportSession, (request) =>
    services.creatorViewportWindowService.update(request)
  );

  registerHandler(ipcContracts.returnCreatorViewportWindow, (request) =>
    services.creatorViewportWindowService.returnToMain(request)
  );

  registerHandler(ipcContracts.restoreCmmChanges, async () => {
    const discovery = await services.gameLocator.discover();
    const process = await services.processSupervisor.getSnapshot(
      discovery.gameExecutable
    );
    if (process.lifecycleState !== "STOPPED") {
      return {
        status: "blocked" as const,
        restoredFiles: [],
        removedFiles: [],
        problems: [
          {
            severity: "warning" as const,
            code: "GAME_RUNNING",
            message: "Close Clawed and wait for it to stop before restoring CMM changes."
          }
        ]
      };
    }

    return services.backupService.restoreCmmChanges();
  });

  registerHandler(ipcContracts.getStorageLayout, () =>
    services.storageService.getLayout()
  );

  registerHandler(ipcContracts.getDiagnosticsSummary, () =>
    services.diagnosticsService.getDiagnosticsSummary()
  );

  registerHandler(ipcContracts.getDiagnosticReport, () =>
    services.diagnosticsService.getDiagnosticReport()
  );

  registerHandler(ipcContracts.getLatestErrorsReport, () =>
    services.diagnosticsService.getLatestErrorsReport()
  );

  registerHandler(ipcContracts.getLogBundlePlan, (request) =>
    services.diagnosticsService.getLogBundlePlan(request)
  );

  registerHandler(ipcContracts.chooseAndCreateLogBundle, async (request) => {
    const plan = await services.diagnosticsService.getLogBundlePlan(request);
    const result = await dialog.showSaveDialog({
      title: "Save Clawed log bundle",
      defaultPath: path.join(app.getPath("downloads"), plan.fileName),
      filters: [{ name: "ZIP Archives", extensions: ["zip"] }]
    });

    if (result.canceled || !result.filePath) {
      return {
        status: "cancelled" as const,
        bundlePath: null,
        fileName: plan.fileName,
        steamBuildId: plan.steamBuildId,
        fileCount: 0,
        bytesWritten: null,
        includedHardware: request.includeHardware,
        problems: [
          {
            severity: "info" as const,
            code: "LOG_BUNDLE_CANCELLED",
            message: "No log bundle path was selected."
          }
        ]
      };
    }

    return services.diagnosticsService.createLogBundle({
      ...request,
      destinationPath: ensureZipExtension(result.filePath)
    });
  });

  registerHandler(ipcContracts.recordRendererError, (request) =>
    services.diagnosticsService.recordRendererError(request)
  );

  registerHandler(ipcContracts.openLogs, () =>
    services.diagnosticsService.openLogs()
  );
}

function sanitizeFileName(fileName: string): string {
  const sanitized = Array.from(fileName)
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? "-"
        : character
    )
    .join("")
    .trim();

  return sanitized || "profile";
}

function ensureZipExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase() === ".zip"
    ? filePath
    : `${filePath}.zip`;
}

function meshExportDialogFilter(format: "obj" | "gltf" | "glb"): {
  name: string;
  extensions: string[];
} {
  if (format === "glb") {
    return { name: "Binary glTF", extensions: ["glb"] };
  }
  if (format === "gltf") {
    return { name: "glTF", extensions: ["gltf"] };
  }
  return { name: "Wavefront OBJ", extensions: ["obj"] };
}

function emptyCreatorMeshExportMetadata() {
  return {
    meshType: "unknown" as const,
    skeleton: null,
    physicsAsset: null,
    materialSlots: [],
    lods: [],
    dependencyPaths: [],
    targetObjectPath: null,
    packagePath: null,
    packageSource: null,
    sourceContainer: null,
    previewSource: null,
    lodCount: null,
    vertexCount: null,
    triangleCount: null,
    materialSlotCount: null,
    validationState: null,
    conflictWinner: null,
    exportState: null
  };
}

function formatMissingProfiles({
  profiles
}: Awaited<
  ReturnType<CoreServices["profileService"]["getMissingModReferences"]>
>): string {
  return profiles
    .map(
      (profile) =>
        `${profile.profileName}: ${profile.missingMods
          .map((mod) => `${mod.id}@${mod.version}`)
          .join(", ")}`
    )
    .join("\n");
}

function formatMissingModpackHistory({
  entries
}: Awaited<
  ReturnType<CoreServices["exportImportService"]["listRecentModpacks"]>
>): string {
  return entries
    .filter((entry) => entry.missingPackages.length > 0)
    .map(
      (entry) =>
        `${entry.profileName}: ${entry.missingPackages
          .map((mod) => `${mod.id}@${mod.version}`)
          .join(", ")}`
    )
    .join("\n");
}
