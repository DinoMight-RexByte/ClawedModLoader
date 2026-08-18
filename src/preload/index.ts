import { contextBridge, ipcRenderer, webUtils } from "electron";

import {
  ipcContracts,
  type CmmApi,
  type IpcContract
} from "../shared/contracts/ipc";

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
  getLifecycleSnapshot: () => invoke(ipcContracts.getLifecycleSnapshot, {}),
  listInstalledMods: () => invoke(ipcContracts.listInstalledMods, {}),
  importModPackage: (request) => invoke(ipcContracts.importModPackage, request),
  importExternalModPackage: (request) =>
    invoke(ipcContracts.importExternalModPackage, request),
  chooseAndImportModPackage: () =>
    invoke(ipcContracts.chooseAndImportModPackage, {}),
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
  getCreatorAssetReport: (request) =>
    invoke(ipcContracts.getCreatorAssetReport, request),
  restoreCmmChanges: () => invoke(ipcContracts.restoreCmmChanges, {}),
  getStorageLayout: () => invoke(ipcContracts.getStorageLayout, {}),
  getDiagnosticsSummary: () => invoke(ipcContracts.getDiagnosticsSummary, {}),
  getDiagnosticReport: () => invoke(ipcContracts.getDiagnosticReport, {}),
  getLatestErrorsReport: () =>
    invoke(ipcContracts.getLatestErrorsReport, {}),
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
