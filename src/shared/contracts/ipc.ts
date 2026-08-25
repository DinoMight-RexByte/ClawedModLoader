import type { z } from "zod";

import {
  AcceptMissingModpackHistoryResultSchema,
  AcceptMissingProfileModsResultSchema,
  AppSettingsSchema,
  AppStorageLayoutSchema,
  BackupRestoreResultSchema,
  CreateProfileRequestSchema,
  CreatorAssetConflictGraphRequestSchema,
  CreatorAssetConflictGraphSchema,
  CreatorAssetDetailRequestSchema,
  CreatorAssetDetailSchema,
  CreatorAssetReportRequestSchema,
  CreatorAssetReportResultSchema,
  CreatorAssetRegistrySnapshotSchema,
  CreatorAssetSearchRequestSchema,
  CreatorAssetSearchResultSchema,
  CreatorAssetTreeRequestSchema,
  CreatorAssetTreeResultSchema,
  CreatorExportPlanRequestSchema,
  CreatorExportPlanResultSchema,
  CreatorMeshExportDialogRequestSchema,
  CreatorMeshExportResultSchema,
  CreatorMeshPackageExportDialogRequestSchema,
  CreatorMeshPackageExportResultSchema,
  CreatorMappingsDumpResultSchema,
  CreatorModelPreviewRequestSchema,
  CreatorModelPreviewResultSchema,
  CreatorPreviewLookupRequestSchema,
  CreatorPreviewLookupResultSchema,
  CreatorViewportTextureCandidatesRequestSchema,
  CreatorViewportTextureCandidatesResultSchema,
  CreatorViewportSessionSchema,
  DiagnosticReportSchema,
  DeploymentOperationResultSchema,
  DeploymentSnapshotSchema,
  DiagnosticsSummarySchema,
  DuplicateProfileRequestSchema,
  EmptyRequestSchema,
  GameDiscoverySchema,
  GameProcessSnapshotSchema,
  ImportModPackageRequestSchema,
  ImportModPackageResultSchema,
  ImportUe4ssRuntimeRequestSchema,
  ImportUe4ssRuntimeResultSchema,
  InspectManifestResultSchema,
  LaunchCommandRequestSchema,
  LaunchCommandResultSchema,
  LoadOrderActionResultSchema,
  LoadOrderSnapshotSchema,
  LoadOrderValidationSchema,
  LogOpenResultSchema,
  ManualGameDirectoryRequestSchema,
  ModIdentityRequestSchema,
  ModLibrarySnapshotSchema,
  ModOperationResultSchema,
  ModpackCompareRequestSchema,
  ModpackCompareResultSchema,
  ModpackExportRequestSchema,
  ModpackExportResultSchema,
  ModpackHistorySnapshotSchema,
  ModpackImportRequestSchema,
  ModpackImportResultSchema,
  ModpackInspectRequestSchema,
  ModpackInspectResultSchema,
  MoveModInOrderRequestSchema,
  PlaceModInOrderRequestSchema,
  PlaySnapshotSchema,
  ProfileActionResultSchema,
  ProfileIdRequestSchema,
  ProfileListSnapshotSchema,
  ProfileMissingModsSnapshotSchema,
  ProfileSchema,
  ReadmeResultSchema,
  RenameProfileRequestSchema,
  RendererErrorReportRequestSchema,
  RendererErrorReportResultSchema,
  RuntimeSnapshotSchema,
  SetAutoValidatePackagedRuntimeRequestSchema,
  SetAutoUpdatePackagedRuntimeRequestSchema,
  SetModOrderPositionRequestSchema,
  SetModEnabledRequestSchema,
  ValidatePackagedRuntimeResultSchema
} from "./app";
import type {
  AppSettings,
  AppStorageLayout,
  AcceptMissingModpackHistoryResult,
  AcceptMissingProfileModsResult,
  BackupRestoreResult,
  CreateProfileRequest,
  CreatorAssetConflictGraph,
  CreatorAssetConflictGraphRequest,
  CreatorAssetDetail,
  CreatorAssetDetailRequest,
  CreatorAssetReportRequest,
  CreatorAssetReportResult,
  CreatorAssetRegistrySnapshot,
  CreatorAssetSearchRequest,
  CreatorAssetSearchResult,
  CreatorAssetTreeRequest,
  CreatorAssetTreeResult,
  CreatorExportPlanRequest,
  CreatorExportPlanResult,
  CreatorMeshExportDialogRequest,
  CreatorMeshExportResult,
  CreatorMeshPackageExportDialogRequest,
  CreatorMeshPackageExportResult,
  CreatorMappingsDumpProgress,
  CreatorMappingsDumpResult,
  CreatorModelPreviewRequest,
  CreatorModelPreviewResult,
  CreatorPreviewLookupRequest,
  CreatorPreviewLookupResult,
  CreatorViewportTextureCandidatesRequest,
  CreatorViewportTextureCandidatesResult,
  CreatorViewportSession,
  CreatorViewportWindowEvent,
  DiagnosticReport,
  DeploymentOperationResult,
  DeploymentSnapshot,
  DiagnosticsSummary,
  DuplicateProfileRequest,
  EmptyRequest,
  GameDiscovery,
  GameProcessSnapshot,
  ImportModPackageRequest,
  ImportModPackageResult,
  ImportUe4ssRuntimeRequest,
  ImportUe4ssRuntimeResult,
  InspectManifestResult,
  LaunchCommandRequest,
  LaunchCommandResult,
  LoadOrderActionResult,
  LoadOrderSnapshot,
  LoadOrderValidation,
  LogOpenResult,
  ManualGameDirectoryRequest,
  MoveModInOrderRequest,
  ModIdentityRequest,
  ModLibrarySnapshot,
  ModOperationResult,
  ModpackCompareRequest,
  ModpackCompareResult,
  ModpackExportRequest,
  ModpackExportResult,
  ModpackHistorySnapshot,
  ModpackImportRequest,
  ModpackImportResult,
  ModpackInspectRequest,
  ModpackInspectResult,
  PlaceModInOrderRequest,
  PlaySnapshot,
  Profile,
  ProfileActionResult,
  ProfileIdRequest,
  ProfileListSnapshot,
  ProfileMissingModsSnapshot,
  ReadmeResult,
  RenameProfileRequest,
  RendererErrorReportRequest,
  RendererErrorReportResult,
  RuntimeSnapshot,
  SetAutoValidatePackagedRuntimeRequest,
  SetAutoUpdatePackagedRuntimeRequest,
  SetModOrderPositionRequest,
  SetModEnabledRequest,
  ValidatePackagedRuntimeResult
} from "./app";

export const IPC_CHANNELS = {
  getPlaySnapshot: "cmm:play:getSnapshot",
  runLaunchCommand: "cmm:launch:runCommand",
  getGameDiscovery: "cmm:game:getDiscovery",
  rescanGameDiscovery: "cmm:game:rescanDiscovery",
  chooseManualGameDirectory: "cmm:settings:chooseManualGameDirectory",
  clearManualGameDirectory: "cmm:settings:clearManualGameDirectory",
  setManualGameDirectory: "cmm:settings:setManualGameDirectory",
  getAppSettings: "cmm:settings:getAppSettings",
  setAutoUpdatePackagedRuntime: "cmm:settings:setAutoUpdatePackagedRuntime",
  setAutoValidatePackagedRuntime:
    "cmm:settings:setAutoValidatePackagedRuntime",
  getLifecycleSnapshot: "cmm:process:getLifecycleSnapshot",
  listInstalledMods: "cmm:mods:listInstalled",
  importModPackage: "cmm:mods:importPackage",
  importExternalModPackage: "cmm:mods:importExternalPackage",
  chooseAndImportModPackage: "cmm:mods:chooseAndImportPackage",
  uninstallMod: "cmm:mods:uninstall",
  setModEnabled: "cmm:mods:setEnabled",
  inspectModManifest: "cmm:mods:inspectManifest",
  readModReadme: "cmm:mods:readReadme",
  openModFolder: "cmm:mods:openFolder",
  getActiveProfile: "cmm:profiles:getActive",
  listProfiles: "cmm:profiles:list",
  createProfile: "cmm:profiles:create",
  duplicateProfile: "cmm:profiles:duplicate",
  renameProfile: "cmm:profiles:rename",
  deleteProfile: "cmm:profiles:delete",
  switchProfile: "cmm:profiles:switch",
  getMissingProfileMods: "cmm:profiles:getMissingMods",
  acceptMissingProfileMods: "cmm:profiles:acceptMissingMods",
  getLoadOrderSnapshot: "cmm:loadOrder:getSnapshot",
  validateActiveLoadOrder: "cmm:loadOrder:validateActive",
  moveModInActiveOrder: "cmm:loadOrder:move",
  setModActiveOrderPosition: "cmm:loadOrder:setPosition",
  placeModInActiveOrder: "cmm:loadOrder:place",
  exportCurrentProfileModpack: "cmm:modpacks:exportCurrentProfile",
  chooseAndExportCurrentProfileModpack:
    "cmm:modpacks:chooseAndExportCurrentProfile",
  inspectModpack: "cmm:modpacks:inspect",
  chooseAndInspectModpack: "cmm:modpacks:chooseAndInspect",
  importModpack: "cmm:modpacks:import",
  compareCurrentProfileToModpack: "cmm:modpacks:compareCurrentProfile",
  listRecentModpacks: "cmm:modpacks:listRecent",
  acceptMissingModpackMods: "cmm:modpacks:acceptMissingMods",
  getDeploymentSnapshot: "cmm:deployment:getSnapshot",
  prepareVanillaDeployment: "cmm:deployment:prepareVanilla",
  getRuntimeSnapshot: "cmm:runtime:getSnapshot",
  installBundledUe4ssRuntime: "cmm:runtime:installBundledUe4ss",
  validatePackagedRuntime: "cmm:runtime:validatePackaged",
  cancelPackagedRuntimeValidation: "cmm:runtime:cancelPackagedValidation",
  importUe4ssRuntime: "cmm:runtime:importUe4ss",
  chooseAndImportUe4ssRuntime: "cmm:runtime:chooseAndImportUe4ss",
  getCreatorAssetRegistrySnapshot: "cmm:creatorAssets:getRegistrySnapshot",
  searchCreatorAssets: "cmm:creatorAssets:search",
  getCreatorAssetTree: "cmm:creatorAssets:getTree",
  getCreatorAssetDetail: "cmm:creatorAssets:getDetail",
  getCreatorConflictGraph: "cmm:creatorAssets:getConflictGraph",
  getCreatorPreview: "cmm:creatorAssets:getPreview",
  getCreatorModelPreview: "cmm:creatorAssets:getModelPreview",
  getCreatorExportPlan: "cmm:creatorAssets:getExportPlan",
  chooseAndExportCreatorMesh: "cmm:creatorAssets:chooseAndExportMesh",
  chooseAndExportCreatorMeshPackage:
    "cmm:creatorAssets:chooseAndExportMeshPackage",
  generateCreatorMappings: "cmm:creatorAssets:generateMappings",
  creatorMappingsProgress: "cmm:creatorAssets:mappingsProgress",
  getCreatorAssetReport: "cmm:creatorAssets:getReport",
  getCreatorViewportTextureCandidates:
    "cmm:creatorAssets:getViewportTextureCandidates",
  openCreatorViewportWindow: "cmm:creatorViewport:openWindow",
  getCreatorViewportSession: "cmm:creatorViewport:getSession",
  updateCreatorViewportSession: "cmm:creatorViewport:updateSession",
  returnCreatorViewportWindow: "cmm:creatorViewport:returnWindow",
  creatorViewportWindowEvent: "cmm:creatorViewport:event",
  restoreCmmChanges: "cmm:backup:restoreCmmChanges",
  getStorageLayout: "cmm:storage:getLayout",
  getDiagnosticsSummary: "cmm:diagnostics:getSummary",
  getDiagnosticReport: "cmm:diagnostics:getReport",
  getLatestErrorsReport: "cmm:diagnostics:getLatestErrors",
  recordRendererError: "cmm:diagnostics:recordRendererError",
  openLogs: "cmm:diagnostics:openLogs"
} as const;

export interface IpcContract<TRequest, TResponse> {
  channel: string;
  requestSchema: z.ZodType<TRequest>;
  responseSchema: z.ZodType<TResponse>;
}

export const ipcContracts = {
  getPlaySnapshot: {
    channel: IPC_CHANNELS.getPlaySnapshot,
    requestSchema: EmptyRequestSchema,
    responseSchema: PlaySnapshotSchema
  } satisfies IpcContract<EmptyRequest, PlaySnapshot>,
  runLaunchCommand: {
    channel: IPC_CHANNELS.runLaunchCommand,
    requestSchema: LaunchCommandRequestSchema,
    responseSchema: LaunchCommandResultSchema
  } satisfies IpcContract<LaunchCommandRequest, LaunchCommandResult>,
  getGameDiscovery: {
    channel: IPC_CHANNELS.getGameDiscovery,
    requestSchema: EmptyRequestSchema,
    responseSchema: GameDiscoverySchema
  } satisfies IpcContract<EmptyRequest, GameDiscovery>,
  rescanGameDiscovery: {
    channel: IPC_CHANNELS.rescanGameDiscovery,
    requestSchema: EmptyRequestSchema,
    responseSchema: GameDiscoverySchema
  } satisfies IpcContract<EmptyRequest, GameDiscovery>,
  chooseManualGameDirectory: {
    channel: IPC_CHANNELS.chooseManualGameDirectory,
    requestSchema: EmptyRequestSchema,
    responseSchema: GameDiscoverySchema
  } satisfies IpcContract<EmptyRequest, GameDiscovery>,
  clearManualGameDirectory: {
    channel: IPC_CHANNELS.clearManualGameDirectory,
    requestSchema: EmptyRequestSchema,
    responseSchema: GameDiscoverySchema
  } satisfies IpcContract<EmptyRequest, GameDiscovery>,
  setManualGameDirectory: {
    channel: IPC_CHANNELS.setManualGameDirectory,
    requestSchema: ManualGameDirectoryRequestSchema,
    responseSchema: GameDiscoverySchema
  } satisfies IpcContract<ManualGameDirectoryRequest, GameDiscovery>,
  getAppSettings: {
    channel: IPC_CHANNELS.getAppSettings,
    requestSchema: EmptyRequestSchema,
    responseSchema: AppSettingsSchema
  } satisfies IpcContract<EmptyRequest, AppSettings>,
  setAutoUpdatePackagedRuntime: {
    channel: IPC_CHANNELS.setAutoUpdatePackagedRuntime,
    requestSchema: SetAutoUpdatePackagedRuntimeRequestSchema,
    responseSchema: AppSettingsSchema
  } satisfies IpcContract<
    SetAutoUpdatePackagedRuntimeRequest,
    AppSettings
  >,
  setAutoValidatePackagedRuntime: {
    channel: IPC_CHANNELS.setAutoValidatePackagedRuntime,
    requestSchema: SetAutoValidatePackagedRuntimeRequestSchema,
    responseSchema: AppSettingsSchema
  } satisfies IpcContract<
    SetAutoValidatePackagedRuntimeRequest,
    AppSettings
  >,
  getLifecycleSnapshot: {
    channel: IPC_CHANNELS.getLifecycleSnapshot,
    requestSchema: EmptyRequestSchema,
    responseSchema: GameProcessSnapshotSchema
  } satisfies IpcContract<EmptyRequest, GameProcessSnapshot>,
  listInstalledMods: {
    channel: IPC_CHANNELS.listInstalledMods,
    requestSchema: EmptyRequestSchema,
    responseSchema: ModLibrarySnapshotSchema
  } satisfies IpcContract<EmptyRequest, ModLibrarySnapshot>,
  importModPackage: {
    channel: IPC_CHANNELS.importModPackage,
    requestSchema: ImportModPackageRequestSchema,
    responseSchema: ImportModPackageResultSchema
  } satisfies IpcContract<ImportModPackageRequest, ImportModPackageResult>,
  importExternalModPackage: {
    channel: IPC_CHANNELS.importExternalModPackage,
    requestSchema: ImportModPackageRequestSchema,
    responseSchema: ImportModPackageResultSchema
  } satisfies IpcContract<ImportModPackageRequest, ImportModPackageResult>,
  chooseAndImportModPackage: {
    channel: IPC_CHANNELS.chooseAndImportModPackage,
    requestSchema: EmptyRequestSchema,
    responseSchema: ImportModPackageResultSchema
  } satisfies IpcContract<EmptyRequest, ImportModPackageResult>,
  uninstallMod: {
    channel: IPC_CHANNELS.uninstallMod,
    requestSchema: ModIdentityRequestSchema,
    responseSchema: ModOperationResultSchema
  } satisfies IpcContract<ModIdentityRequest, ModOperationResult>,
  setModEnabled: {
    channel: IPC_CHANNELS.setModEnabled,
    requestSchema: SetModEnabledRequestSchema,
    responseSchema: ModOperationResultSchema
  } satisfies IpcContract<SetModEnabledRequest, ModOperationResult>,
  inspectModManifest: {
    channel: IPC_CHANNELS.inspectModManifest,
    requestSchema: ModIdentityRequestSchema,
    responseSchema: InspectManifestResultSchema
  } satisfies IpcContract<ModIdentityRequest, InspectManifestResult>,
  readModReadme: {
    channel: IPC_CHANNELS.readModReadme,
    requestSchema: ModIdentityRequestSchema,
    responseSchema: ReadmeResultSchema
  } satisfies IpcContract<ModIdentityRequest, ReadmeResult>,
  openModFolder: {
    channel: IPC_CHANNELS.openModFolder,
    requestSchema: ModIdentityRequestSchema,
    responseSchema: ModOperationResultSchema
  } satisfies IpcContract<ModIdentityRequest, ModOperationResult>,
  getActiveProfile: {
    channel: IPC_CHANNELS.getActiveProfile,
    requestSchema: EmptyRequestSchema,
    responseSchema: ProfileSchema
  } satisfies IpcContract<EmptyRequest, Profile>,
  listProfiles: {
    channel: IPC_CHANNELS.listProfiles,
    requestSchema: EmptyRequestSchema,
    responseSchema: ProfileListSnapshotSchema
  } satisfies IpcContract<EmptyRequest, ProfileListSnapshot>,
  createProfile: {
    channel: IPC_CHANNELS.createProfile,
    requestSchema: CreateProfileRequestSchema,
    responseSchema: ProfileActionResultSchema
  } satisfies IpcContract<CreateProfileRequest, ProfileActionResult>,
  duplicateProfile: {
    channel: IPC_CHANNELS.duplicateProfile,
    requestSchema: DuplicateProfileRequestSchema,
    responseSchema: ProfileActionResultSchema
  } satisfies IpcContract<DuplicateProfileRequest, ProfileActionResult>,
  renameProfile: {
    channel: IPC_CHANNELS.renameProfile,
    requestSchema: RenameProfileRequestSchema,
    responseSchema: ProfileActionResultSchema
  } satisfies IpcContract<RenameProfileRequest, ProfileActionResult>,
  deleteProfile: {
    channel: IPC_CHANNELS.deleteProfile,
    requestSchema: ProfileIdRequestSchema,
    responseSchema: ProfileActionResultSchema
  } satisfies IpcContract<ProfileIdRequest, ProfileActionResult>,
  switchProfile: {
    channel: IPC_CHANNELS.switchProfile,
    requestSchema: ProfileIdRequestSchema,
    responseSchema: ProfileActionResultSchema
  } satisfies IpcContract<ProfileIdRequest, ProfileActionResult>,
  getMissingProfileMods: {
    channel: IPC_CHANNELS.getMissingProfileMods,
    requestSchema: EmptyRequestSchema,
    responseSchema: ProfileMissingModsSnapshotSchema
  } satisfies IpcContract<EmptyRequest, ProfileMissingModsSnapshot>,
  acceptMissingProfileMods: {
    channel: IPC_CHANNELS.acceptMissingProfileMods,
    requestSchema: EmptyRequestSchema,
    responseSchema: AcceptMissingProfileModsResultSchema
  } satisfies IpcContract<EmptyRequest, AcceptMissingProfileModsResult>,
  getLoadOrderSnapshot: {
    channel: IPC_CHANNELS.getLoadOrderSnapshot,
    requestSchema: EmptyRequestSchema,
    responseSchema: LoadOrderSnapshotSchema
  } satisfies IpcContract<EmptyRequest, LoadOrderSnapshot>,
  validateActiveLoadOrder: {
    channel: IPC_CHANNELS.validateActiveLoadOrder,
    requestSchema: EmptyRequestSchema,
    responseSchema: LoadOrderValidationSchema
  } satisfies IpcContract<EmptyRequest, LoadOrderValidation>,
  moveModInActiveOrder: {
    channel: IPC_CHANNELS.moveModInActiveOrder,
    requestSchema: MoveModInOrderRequestSchema,
    responseSchema: LoadOrderActionResultSchema
  } satisfies IpcContract<MoveModInOrderRequest, LoadOrderActionResult>,
  setModActiveOrderPosition: {
    channel: IPC_CHANNELS.setModActiveOrderPosition,
    requestSchema: SetModOrderPositionRequestSchema,
    responseSchema: LoadOrderActionResultSchema
  } satisfies IpcContract<SetModOrderPositionRequest, LoadOrderActionResult>,
  placeModInActiveOrder: {
    channel: IPC_CHANNELS.placeModInActiveOrder,
    requestSchema: PlaceModInOrderRequestSchema,
    responseSchema: LoadOrderActionResultSchema
  } satisfies IpcContract<PlaceModInOrderRequest, LoadOrderActionResult>,
  exportCurrentProfileModpack: {
    channel: IPC_CHANNELS.exportCurrentProfileModpack,
    requestSchema: ModpackExportRequestSchema,
    responseSchema: ModpackExportResultSchema
  } satisfies IpcContract<ModpackExportRequest, ModpackExportResult>,
  chooseAndExportCurrentProfileModpack: {
    channel: IPC_CHANNELS.chooseAndExportCurrentProfileModpack,
    requestSchema: EmptyRequestSchema,
    responseSchema: ModpackExportResultSchema
  } satisfies IpcContract<EmptyRequest, ModpackExportResult>,
  inspectModpack: {
    channel: IPC_CHANNELS.inspectModpack,
    requestSchema: ModpackInspectRequestSchema,
    responseSchema: ModpackInspectResultSchema
  } satisfies IpcContract<ModpackInspectRequest, ModpackInspectResult>,
  chooseAndInspectModpack: {
    channel: IPC_CHANNELS.chooseAndInspectModpack,
    requestSchema: EmptyRequestSchema,
    responseSchema: ModpackInspectResultSchema
  } satisfies IpcContract<EmptyRequest, ModpackInspectResult>,
  importModpack: {
    channel: IPC_CHANNELS.importModpack,
    requestSchema: ModpackImportRequestSchema,
    responseSchema: ModpackImportResultSchema
  } satisfies IpcContract<ModpackImportRequest, ModpackImportResult>,
  compareCurrentProfileToModpack: {
    channel: IPC_CHANNELS.compareCurrentProfileToModpack,
    requestSchema: ModpackCompareRequestSchema,
    responseSchema: ModpackCompareResultSchema
  } satisfies IpcContract<ModpackCompareRequest, ModpackCompareResult>,
  listRecentModpacks: {
    channel: IPC_CHANNELS.listRecentModpacks,
    requestSchema: EmptyRequestSchema,
    responseSchema: ModpackHistorySnapshotSchema
  } satisfies IpcContract<EmptyRequest, ModpackHistorySnapshot>,
  acceptMissingModpackMods: {
    channel: IPC_CHANNELS.acceptMissingModpackMods,
    requestSchema: EmptyRequestSchema,
    responseSchema: AcceptMissingModpackHistoryResultSchema
  } satisfies IpcContract<EmptyRequest, AcceptMissingModpackHistoryResult>,
  getDeploymentSnapshot: {
    channel: IPC_CHANNELS.getDeploymentSnapshot,
    requestSchema: EmptyRequestSchema,
    responseSchema: DeploymentSnapshotSchema
  } satisfies IpcContract<EmptyRequest, DeploymentSnapshot>,
  prepareVanillaDeployment: {
    channel: IPC_CHANNELS.prepareVanillaDeployment,
    requestSchema: EmptyRequestSchema,
    responseSchema: DeploymentOperationResultSchema
  } satisfies IpcContract<EmptyRequest, DeploymentOperationResult>,
  getRuntimeSnapshot: {
    channel: IPC_CHANNELS.getRuntimeSnapshot,
    requestSchema: EmptyRequestSchema,
    responseSchema: RuntimeSnapshotSchema
  } satisfies IpcContract<EmptyRequest, RuntimeSnapshot>,
  installBundledUe4ssRuntime: {
    channel: IPC_CHANNELS.installBundledUe4ssRuntime,
    requestSchema: EmptyRequestSchema,
    responseSchema: ImportUe4ssRuntimeResultSchema
  } satisfies IpcContract<EmptyRequest, ImportUe4ssRuntimeResult>,
  validatePackagedRuntime: {
    channel: IPC_CHANNELS.validatePackagedRuntime,
    requestSchema: EmptyRequestSchema,
    responseSchema: ValidatePackagedRuntimeResultSchema
  } satisfies IpcContract<EmptyRequest, ValidatePackagedRuntimeResult>,
  cancelPackagedRuntimeValidation: {
    channel: IPC_CHANNELS.cancelPackagedRuntimeValidation,
    requestSchema: EmptyRequestSchema,
    responseSchema: ValidatePackagedRuntimeResultSchema
  } satisfies IpcContract<EmptyRequest, ValidatePackagedRuntimeResult>,
  importUe4ssRuntime: {
    channel: IPC_CHANNELS.importUe4ssRuntime,
    requestSchema: ImportUe4ssRuntimeRequestSchema,
    responseSchema: ImportUe4ssRuntimeResultSchema
  } satisfies IpcContract<ImportUe4ssRuntimeRequest, ImportUe4ssRuntimeResult>,
  chooseAndImportUe4ssRuntime: {
    channel: IPC_CHANNELS.chooseAndImportUe4ssRuntime,
    requestSchema: EmptyRequestSchema,
    responseSchema: ImportUe4ssRuntimeResultSchema
  } satisfies IpcContract<EmptyRequest, ImportUe4ssRuntimeResult>,
  getCreatorAssetRegistrySnapshot: {
    channel: IPC_CHANNELS.getCreatorAssetRegistrySnapshot,
    requestSchema: EmptyRequestSchema,
    responseSchema: CreatorAssetRegistrySnapshotSchema
  } satisfies IpcContract<EmptyRequest, CreatorAssetRegistrySnapshot>,
  searchCreatorAssets: {
    channel: IPC_CHANNELS.searchCreatorAssets,
    requestSchema: CreatorAssetSearchRequestSchema,
    responseSchema: CreatorAssetSearchResultSchema
  } satisfies IpcContract<CreatorAssetSearchRequest, CreatorAssetSearchResult>,
  getCreatorAssetTree: {
    channel: IPC_CHANNELS.getCreatorAssetTree,
    requestSchema: CreatorAssetTreeRequestSchema,
    responseSchema: CreatorAssetTreeResultSchema
  } satisfies IpcContract<CreatorAssetTreeRequest, CreatorAssetTreeResult>,
  getCreatorAssetDetail: {
    channel: IPC_CHANNELS.getCreatorAssetDetail,
    requestSchema: CreatorAssetDetailRequestSchema,
    responseSchema: CreatorAssetDetailSchema
  } satisfies IpcContract<CreatorAssetDetailRequest, CreatorAssetDetail>,
  getCreatorConflictGraph: {
    channel: IPC_CHANNELS.getCreatorConflictGraph,
    requestSchema: CreatorAssetConflictGraphRequestSchema,
    responseSchema: CreatorAssetConflictGraphSchema
  } satisfies IpcContract<
    CreatorAssetConflictGraphRequest,
    CreatorAssetConflictGraph
  >,
  getCreatorPreview: {
    channel: IPC_CHANNELS.getCreatorPreview,
    requestSchema: CreatorPreviewLookupRequestSchema,
    responseSchema: CreatorPreviewLookupResultSchema
  } satisfies IpcContract<CreatorPreviewLookupRequest, CreatorPreviewLookupResult>,
  getCreatorModelPreview: {
    channel: IPC_CHANNELS.getCreatorModelPreview,
    requestSchema: CreatorModelPreviewRequestSchema,
    responseSchema: CreatorModelPreviewResultSchema
  } satisfies IpcContract<
    CreatorModelPreviewRequest,
    CreatorModelPreviewResult
  >,
  getCreatorExportPlan: {
    channel: IPC_CHANNELS.getCreatorExportPlan,
    requestSchema: CreatorExportPlanRequestSchema,
    responseSchema: CreatorExportPlanResultSchema
  } satisfies IpcContract<CreatorExportPlanRequest, CreatorExportPlanResult>,
  chooseAndExportCreatorMesh: {
    channel: IPC_CHANNELS.chooseAndExportCreatorMesh,
    requestSchema: CreatorMeshExportDialogRequestSchema,
    responseSchema: CreatorMeshExportResultSchema
  } satisfies IpcContract<
    CreatorMeshExportDialogRequest,
    CreatorMeshExportResult
  >,
  chooseAndExportCreatorMeshPackage: {
    channel: IPC_CHANNELS.chooseAndExportCreatorMeshPackage,
    requestSchema: CreatorMeshPackageExportDialogRequestSchema,
    responseSchema: CreatorMeshPackageExportResultSchema
  } satisfies IpcContract<
    CreatorMeshPackageExportDialogRequest,
    CreatorMeshPackageExportResult
  >,
  generateCreatorMappings: {
    channel: IPC_CHANNELS.generateCreatorMappings,
    requestSchema: EmptyRequestSchema,
    responseSchema: CreatorMappingsDumpResultSchema
  } satisfies IpcContract<EmptyRequest, CreatorMappingsDumpResult>,
  getCreatorAssetReport: {
    channel: IPC_CHANNELS.getCreatorAssetReport,
    requestSchema: CreatorAssetReportRequestSchema,
    responseSchema: CreatorAssetReportResultSchema
  } satisfies IpcContract<CreatorAssetReportRequest, CreatorAssetReportResult>,
  getCreatorViewportTextureCandidates: {
    channel: IPC_CHANNELS.getCreatorViewportTextureCandidates,
    requestSchema: CreatorViewportTextureCandidatesRequestSchema,
    responseSchema: CreatorViewportTextureCandidatesResultSchema
  } satisfies IpcContract<
    CreatorViewportTextureCandidatesRequest,
    CreatorViewportTextureCandidatesResult
  >,
  openCreatorViewportWindow: {
    channel: IPC_CHANNELS.openCreatorViewportWindow,
    requestSchema: CreatorViewportSessionSchema,
    responseSchema: CreatorViewportSessionSchema
  } satisfies IpcContract<CreatorViewportSession, CreatorViewportSession>,
  getCreatorViewportSession: {
    channel: IPC_CHANNELS.getCreatorViewportSession,
    requestSchema: EmptyRequestSchema,
    responseSchema: CreatorViewportSessionSchema
  } satisfies IpcContract<EmptyRequest, CreatorViewportSession>,
  updateCreatorViewportSession: {
    channel: IPC_CHANNELS.updateCreatorViewportSession,
    requestSchema: CreatorViewportSessionSchema,
    responseSchema: CreatorViewportSessionSchema
  } satisfies IpcContract<CreatorViewportSession, CreatorViewportSession>,
  returnCreatorViewportWindow: {
    channel: IPC_CHANNELS.returnCreatorViewportWindow,
    requestSchema: CreatorViewportSessionSchema,
    responseSchema: CreatorViewportSessionSchema
  } satisfies IpcContract<CreatorViewportSession, CreatorViewportSession>,
  restoreCmmChanges: {
    channel: IPC_CHANNELS.restoreCmmChanges,
    requestSchema: EmptyRequestSchema,
    responseSchema: BackupRestoreResultSchema
  } satisfies IpcContract<EmptyRequest, BackupRestoreResult>,
  getStorageLayout: {
    channel: IPC_CHANNELS.getStorageLayout,
    requestSchema: EmptyRequestSchema,
    responseSchema: AppStorageLayoutSchema
  } satisfies IpcContract<EmptyRequest, AppStorageLayout>,
  getDiagnosticsSummary: {
    channel: IPC_CHANNELS.getDiagnosticsSummary,
    requestSchema: EmptyRequestSchema,
    responseSchema: DiagnosticsSummarySchema
  } satisfies IpcContract<EmptyRequest, DiagnosticsSummary>,
  getDiagnosticReport: {
    channel: IPC_CHANNELS.getDiagnosticReport,
    requestSchema: EmptyRequestSchema,
    responseSchema: DiagnosticReportSchema
  } satisfies IpcContract<EmptyRequest, DiagnosticReport>,
  getLatestErrorsReport: {
    channel: IPC_CHANNELS.getLatestErrorsReport,
    requestSchema: EmptyRequestSchema,
    responseSchema: DiagnosticReportSchema
  } satisfies IpcContract<EmptyRequest, DiagnosticReport>,
  recordRendererError: {
    channel: IPC_CHANNELS.recordRendererError,
    requestSchema: RendererErrorReportRequestSchema,
    responseSchema: RendererErrorReportResultSchema
  } satisfies IpcContract<
    RendererErrorReportRequest,
    RendererErrorReportResult
  >,
  openLogs: {
    channel: IPC_CHANNELS.openLogs,
    requestSchema: EmptyRequestSchema,
    responseSchema: LogOpenResultSchema
  } satisfies IpcContract<EmptyRequest, LogOpenResult>
};

export interface CmmApi {
  getPlaySnapshot(): Promise<PlaySnapshot>;
  runLaunchCommand(
    request: LaunchCommandRequest
  ): Promise<LaunchCommandResult>;
  getGameDiscovery(): Promise<GameDiscovery>;
  rescanGameDiscovery(): Promise<GameDiscovery>;
  chooseManualGameDirectory(): Promise<GameDiscovery>;
  clearManualGameDirectory(): Promise<GameDiscovery>;
  setManualGameDirectory(
    request: ManualGameDirectoryRequest
  ): Promise<GameDiscovery>;
  getAppSettings(): Promise<AppSettings>;
  setAutoUpdatePackagedRuntime(
    request: SetAutoUpdatePackagedRuntimeRequest
  ): Promise<AppSettings>;
  setAutoValidatePackagedRuntime(
    request: SetAutoValidatePackagedRuntimeRequest
  ): Promise<AppSettings>;
  getLifecycleSnapshot(): Promise<GameProcessSnapshot>;
  listInstalledMods(): Promise<ModLibrarySnapshot>;
  importModPackage(
    request: ImportModPackageRequest
  ): Promise<ImportModPackageResult>;
  importExternalModPackage(
    request: ImportModPackageRequest
  ): Promise<ImportModPackageResult>;
  chooseAndImportModPackage(): Promise<ImportModPackageResult>;
  uninstallMod(request: ModIdentityRequest): Promise<ModOperationResult>;
  setModEnabled(request: SetModEnabledRequest): Promise<ModOperationResult>;
  inspectModManifest(
    request: ModIdentityRequest
  ): Promise<InspectManifestResult>;
  readModReadme(request: ModIdentityRequest): Promise<ReadmeResult>;
  openModFolder(request: ModIdentityRequest): Promise<ModOperationResult>;
  getActiveProfile(): Promise<Profile>;
  listProfiles(): Promise<ProfileListSnapshot>;
  createProfile(request: CreateProfileRequest): Promise<ProfileActionResult>;
  duplicateProfile(
    request: DuplicateProfileRequest
  ): Promise<ProfileActionResult>;
  renameProfile(request: RenameProfileRequest): Promise<ProfileActionResult>;
  deleteProfile(request: ProfileIdRequest): Promise<ProfileActionResult>;
  switchProfile(request: ProfileIdRequest): Promise<ProfileActionResult>;
  getMissingProfileMods(): Promise<ProfileMissingModsSnapshot>;
  acceptMissingProfileMods(): Promise<AcceptMissingProfileModsResult>;
  getLoadOrderSnapshot(): Promise<LoadOrderSnapshot>;
  validateActiveLoadOrder(): Promise<LoadOrderValidation>;
  moveModInActiveOrder(
    request: MoveModInOrderRequest
  ): Promise<LoadOrderActionResult>;
  setModActiveOrderPosition(
    request: SetModOrderPositionRequest
  ): Promise<LoadOrderActionResult>;
  placeModInActiveOrder(
    request: PlaceModInOrderRequest
  ): Promise<LoadOrderActionResult>;
  exportCurrentProfileModpack(
    request: ModpackExportRequest
  ): Promise<ModpackExportResult>;
  chooseAndExportCurrentProfileModpack(): Promise<ModpackExportResult>;
  inspectModpack(request: ModpackInspectRequest): Promise<ModpackInspectResult>;
  chooseAndInspectModpack(): Promise<ModpackInspectResult>;
  importModpack(request: ModpackImportRequest): Promise<ModpackImportResult>;
  compareCurrentProfileToModpack(
    request: ModpackCompareRequest
  ): Promise<ModpackCompareResult>;
  listRecentModpacks(): Promise<ModpackHistorySnapshot>;
  acceptMissingModpackMods(): Promise<AcceptMissingModpackHistoryResult>;
  getDeploymentSnapshot(): Promise<DeploymentSnapshot>;
  prepareVanillaDeployment(): Promise<DeploymentOperationResult>;
  getRuntimeSnapshot(): Promise<RuntimeSnapshot>;
  installBundledUe4ssRuntime(): Promise<ImportUe4ssRuntimeResult>;
  validatePackagedRuntime(): Promise<ValidatePackagedRuntimeResult>;
  cancelPackagedRuntimeValidation(): Promise<ValidatePackagedRuntimeResult>;
  importUe4ssRuntime(
    request: ImportUe4ssRuntimeRequest
  ): Promise<ImportUe4ssRuntimeResult>;
  chooseAndImportUe4ssRuntime(): Promise<ImportUe4ssRuntimeResult>;
  getCreatorAssetRegistrySnapshot(): Promise<CreatorAssetRegistrySnapshot>;
  searchCreatorAssets(
    request: CreatorAssetSearchRequest
  ): Promise<CreatorAssetSearchResult>;
  getCreatorAssetTree(
    request: CreatorAssetTreeRequest
  ): Promise<CreatorAssetTreeResult>;
  getCreatorAssetDetail(
    request: CreatorAssetDetailRequest
  ): Promise<CreatorAssetDetail>;
  getCreatorConflictGraph(
    request: CreatorAssetConflictGraphRequest
  ): Promise<CreatorAssetConflictGraph>;
  getCreatorPreview(
    request: CreatorPreviewLookupRequest
  ): Promise<CreatorPreviewLookupResult>;
  getCreatorModelPreview(
    request: CreatorModelPreviewRequest
  ): Promise<CreatorModelPreviewResult>;
  getCreatorExportPlan(
    request: CreatorExportPlanRequest
  ): Promise<CreatorExportPlanResult>;
  chooseAndExportCreatorMesh(
    request: CreatorMeshExportDialogRequest
  ): Promise<CreatorMeshExportResult>;
  chooseAndExportCreatorMeshPackage(
    request: CreatorMeshPackageExportDialogRequest
  ): Promise<CreatorMeshPackageExportResult>;
  generateCreatorMappings(): Promise<CreatorMappingsDumpResult>;
  onCreatorMappingsProgress(
    listener: (progress: CreatorMappingsDumpProgress) => void
  ): () => void;
  getCreatorAssetReport(
    request: CreatorAssetReportRequest
  ): Promise<CreatorAssetReportResult>;
  getCreatorViewportTextureCandidates(
    request: CreatorViewportTextureCandidatesRequest
  ): Promise<CreatorViewportTextureCandidatesResult>;
  openCreatorViewportWindow(
    request: CreatorViewportSession
  ): Promise<CreatorViewportSession>;
  getCreatorViewportSession(): Promise<CreatorViewportSession>;
  updateCreatorViewportSession(
    request: CreatorViewportSession
  ): Promise<CreatorViewportSession>;
  returnCreatorViewportWindow(
    request: CreatorViewportSession
  ): Promise<CreatorViewportSession>;
  onCreatorViewportWindowEvent(
    callback: (event: CreatorViewportWindowEvent) => void
  ): () => void;
  restoreCmmChanges(): Promise<BackupRestoreResult>;
  getStorageLayout(): Promise<AppStorageLayout>;
  getDiagnosticsSummary(): Promise<DiagnosticsSummary>;
  getDiagnosticReport(): Promise<DiagnosticReport>;
  getLatestErrorsReport(): Promise<DiagnosticReport>;
  recordRendererError(
    request: RendererErrorReportRequest
  ): Promise<RendererErrorReportResult>;
  openLogs(): Promise<LogOpenResult>;
}
