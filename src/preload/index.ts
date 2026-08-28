import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent
} from "electron";

import {
  AppUpdateSnapshotSchema,
  CreatorMappingsDumpProgressSchema
} from "../shared/contracts/app";
import {
  IPC_CHANNELS,
  ipcContracts,
  type CmmApi,
  type IpcContract
} from "../shared/contracts/ipc";
import { CreatorViewportWindowEventSchema } from "../shared/contracts/app";

async function invoke<TRequest, TResponse>(
  contract: IpcContract<TRequest, TResponse>,
  request: TRequest
): Promise<TResponse> {
  const safeRequest = contract.requestSchema.parse(request);
  const response = await ipcRenderer.invoke(contract.channel, safeRequest);
  return contract.responseSchema.parse(response);
}

const api: CmmApi = {
  getPlaySnapshot: () => invoke(ipcContracts.getPlaySnapshot, {}),
  runLaunchCommand: (request) =>
    invoke(ipcContracts.runLaunchCommand, request),
  getGameDiscovery: () => invoke(ipcContracts.getGameDiscovery, {}),
  rescanGameDiscovery: () => invoke(ipcContracts.rescanGameDiscovery, {}),
  chooseManualGameDirectory: () =>
    invoke(ipcContracts.chooseManualGameDirectory, {}),
  clearManualGameDirectory: () =>
    invoke(ipcContracts.clearManualGameDirectory, {}),
  setManualGameDirectory: (request) =>
    invoke(ipcContracts.setManualGameDirectory, request),
  getAppSettings: () => invoke(ipcContracts.getAppSettings, {}),
  setAutoUpdatePackagedRuntime: (request) =>
    invoke(ipcContracts.setAutoUpdatePackagedRuntime, request),
  setAutoValidatePackagedRuntime: (request) =>
    invoke(ipcContracts.setAutoValidatePackagedRuntime, request),
  setSuppressAppUpdatePrompt: (request) =>
    invoke(ipcContracts.setSuppressAppUpdatePrompt, request),
  getAppUpdateSnapshot: () =>
    invoke(ipcContracts.getAppUpdateSnapshot, {}),
  checkForAppUpdates: () =>
    invoke(ipcContracts.checkForAppUpdates, {}),
  downloadAppUpdate: () => invoke(ipcContracts.downloadAppUpdate, {}),
  installAppUpdate: () => invoke(ipcContracts.installAppUpdate, {}),
  onAppUpdateEvent: (callback) => {
    const listener = (_event: IpcRendererEvent, raw: unknown) => {
      callback(AppUpdateSnapshotSchema.parse(raw));
    };
    ipcRenderer.on(IPC_CHANNELS.appUpdateEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.appUpdateEvent, listener);
    };
  },
  getLifecycleSnapshot: () => invoke(ipcContracts.getLifecycleSnapshot, {}),
  listInstalledMods: () => invoke(ipcContracts.listInstalledMods, {}),
  importModPackage: (request) => invoke(ipcContracts.importModPackage, request),
  importExternalModPackage: (request) =>
    invoke(ipcContracts.importExternalModPackage, request),
  chooseAndImportModPackage: () =>
    invoke(ipcContracts.chooseAndImportModPackage, {}),
  listAvailableMods: () => invoke(ipcContracts.listAvailableMods, {}),
  installAvailableMod: (request) =>
    invoke(ipcContracts.installAvailableMod, request),
  uninstallMod: (request) => invoke(ipcContracts.uninstallMod, request),
  setModEnabled: (request) => invoke(ipcContracts.setModEnabled, request),
  inspectModManifest: (request) =>
    invoke(ipcContracts.inspectModManifest, request),
  readModReadme: (request) => invoke(ipcContracts.readModReadme, request),
  openModFolder: (request) => invoke(ipcContracts.openModFolder, request),
  getActiveProfile: () => invoke(ipcContracts.getActiveProfile, {}),
  listProfiles: () => invoke(ipcContracts.listProfiles, {}),
  createProfile: (request) => invoke(ipcContracts.createProfile, request),
  duplicateProfile: (request) =>
    invoke(ipcContracts.duplicateProfile, request),
  renameProfile: (request) => invoke(ipcContracts.renameProfile, request),
  deleteProfile: (request) => invoke(ipcContracts.deleteProfile, request),
  switchProfile: (request) => invoke(ipcContracts.switchProfile, request),
  getMissingProfileMods: () =>
    invoke(ipcContracts.getMissingProfileMods, {}),
  acceptMissingProfileMods: () =>
    invoke(ipcContracts.acceptMissingProfileMods, {}),
  getLoadOrderSnapshot: () => invoke(ipcContracts.getLoadOrderSnapshot, {}),
  validateActiveLoadOrder: () =>
    invoke(ipcContracts.validateActiveLoadOrder, {}),
  moveModInActiveOrder: (request) =>
    invoke(ipcContracts.moveModInActiveOrder, request),
  setModActiveOrderPosition: (request) =>
    invoke(ipcContracts.setModActiveOrderPosition, request),
  placeModInActiveOrder: (request) =>
    invoke(ipcContracts.placeModInActiveOrder, request),
  exportCurrentProfileModpack: (request) =>
    invoke(ipcContracts.exportCurrentProfileModpack, request),
  chooseAndExportCurrentProfileModpack: () =>
    invoke(ipcContracts.chooseAndExportCurrentProfileModpack, {}),
  inspectModpack: (request) => invoke(ipcContracts.inspectModpack, request),
  chooseAndInspectModpack: () =>
    invoke(ipcContracts.chooseAndInspectModpack, {}),
  importModpack: (request) => invoke(ipcContracts.importModpack, request),
  compareCurrentProfileToModpack: (request) =>
    invoke(ipcContracts.compareCurrentProfileToModpack, request),
  listRecentModpacks: () => invoke(ipcContracts.listRecentModpacks, {}),
  acceptMissingModpackMods: () =>
    invoke(ipcContracts.acceptMissingModpackMods, {}),
  getDeploymentSnapshot: () => invoke(ipcContracts.getDeploymentSnapshot, {}),
  prepareVanillaDeployment: () =>
    invoke(ipcContracts.prepareVanillaDeployment, {}),
  getRuntimeSnapshot: () => invoke(ipcContracts.getRuntimeSnapshot, {}),
  installBundledUe4ssRuntime: () =>
    invoke(ipcContracts.installBundledUe4ssRuntime, {}),
  validatePackagedRuntime: () =>
    invoke(ipcContracts.validatePackagedRuntime, {}),
  cancelPackagedRuntimeValidation: () =>
    invoke(ipcContracts.cancelPackagedRuntimeValidation, {}),
  importUe4ssRuntime: (request) =>
    invoke(ipcContracts.importUe4ssRuntime, request),
  chooseAndImportUe4ssRuntime: () =>
    invoke(ipcContracts.chooseAndImportUe4ssRuntime, {}),
  getCreatorAssetRegistrySnapshot: () =>
    invoke(ipcContracts.getCreatorAssetRegistrySnapshot, {}),
  searchCreatorAssets: (request) =>
    invoke(ipcContracts.searchCreatorAssets, request),
  getCreatorAssetTree: (request) =>
    invoke(ipcContracts.getCreatorAssetTree, request),
  getCreatorAssetDetail: (request) =>
    invoke(ipcContracts.getCreatorAssetDetail, request),
  getCreatorConflictGraph: (request) =>
    invoke(ipcContracts.getCreatorConflictGraph, request),
  getCreatorPreview: (request) =>
    invoke(ipcContracts.getCreatorPreview, request),
  getCreatorModelPreview: (request) =>
    invoke(ipcContracts.getCreatorModelPreview, request),
  getCreatorExportPlan: (request) =>
    invoke(ipcContracts.getCreatorExportPlan, request),
  chooseAndExportCreatorMesh: (request) =>
    invoke(ipcContracts.chooseAndExportCreatorMesh, request),
  chooseAndExportCreatorMeshPackage: (request) =>
    invoke(ipcContracts.chooseAndExportCreatorMeshPackage, request),
  generateCreatorMappings: () =>
    invoke(ipcContracts.generateCreatorMappings, {}),
  onCreatorMappingsProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown) => {
      listener(CreatorMappingsDumpProgressSchema.parse(raw));
    };
    ipcRenderer.on(IPC_CHANNELS.creatorMappingsProgress, handler);
    return () => {
      ipcRenderer.off(IPC_CHANNELS.creatorMappingsProgress, handler);
    };
  },
  getCreatorAssetReport: (request) =>
    invoke(ipcContracts.getCreatorAssetReport, request),
  getCreatorViewportTextureCandidates: (request) =>
    invoke(ipcContracts.getCreatorViewportTextureCandidates, request),
  openCreatorViewportWindow: (request) =>
    invoke(ipcContracts.openCreatorViewportWindow, request),
  getCreatorViewportSession: () =>
    invoke(ipcContracts.getCreatorViewportSession, {}),
  updateCreatorViewportSession: (request) =>
    invoke(ipcContracts.updateCreatorViewportSession, request),
  returnCreatorViewportWindow: (request) =>
    invoke(ipcContracts.returnCreatorViewportWindow, request),
  onCreatorViewportWindowEvent: (callback) => {
    const listener = (_event: IpcRendererEvent, rawEvent: unknown) => {
      callback(CreatorViewportWindowEventSchema.parse(rawEvent));
    };
    ipcRenderer.on(IPC_CHANNELS.creatorViewportWindowEvent, listener);
    return () => {
      ipcRenderer.removeListener(
        IPC_CHANNELS.creatorViewportWindowEvent,
        listener
      );
    };
  },
  restoreCmmChanges: () => invoke(ipcContracts.restoreCmmChanges, {}),
  getStorageLayout: () => invoke(ipcContracts.getStorageLayout, {}),
  getDiagnosticsSummary: () => invoke(ipcContracts.getDiagnosticsSummary, {}),
  getDiagnosticReport: () => invoke(ipcContracts.getDiagnosticReport, {}),
  getLatestErrorsReport: () =>
    invoke(ipcContracts.getLatestErrorsReport, {}),
  getLogBundlePlan: (request) =>
    invoke(ipcContracts.getLogBundlePlan, request),
  chooseAndCreateLogBundle: (request) =>
    invoke(ipcContracts.chooseAndCreateLogBundle, request),
  recordRendererError: (request) =>
    invoke(ipcContracts.recordRendererError, request),
  openLogs: () => invoke(ipcContracts.openLogs, {})
};

contextBridge.exposeInMainWorld("cmm", api);

contextBridge.exposeInMainWorld("cmmFileDrops", {
  getPathForFile: (file: File): string | null => {
    const filePath = webUtils.getPathForFile(file);
    return filePath || null;
  }
});
