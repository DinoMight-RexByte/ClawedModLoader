import type {
  AppSettings,
  AppStorageLayout,
  AcceptMissingModpackHistoryResult,
  AcceptMissingProfileModsResult,
  BackupRestoreResult,
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
  CreatorMeshExportRequest,
  CreatorMeshExportResult,
  CreatorMeshPackageExportRequest,
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
  DiagnosticReport,
  DiagnosticsSummary,
  CreateProfileRequest,
  CreateProfileFromStateRequest,
  DeploymentOperationResult,
  DeploymentSnapshot,
  DuplicateProfileRequest,
  ExternalModInspectionRequest,
  ExternalModInspectionResult,
  GameDiscovery,
  GameProcessSnapshot,
  ImportModPackageRequest,
  ImportModPackageResult,
  ImportUe4ssRuntimeRequest,
  ImportUe4ssRuntimeResult,
  InspectManifestResult,
  InstalledModManifestRecord,
  LaunchCommandRequest,
  LaunchCommandResult,
  LoadOrderActionResult,
  LoadOrderSnapshot,
  LoadOrderValidation,
  LaunchMode,
  MoveModInOrderRequest,
  ModpackCompareRequest,
  ModpackCompareResult,
  ModpackExportRequest,
  ModpackExportResult,
  ModpackHistorySnapshot,
  ModpackImportRequest,
  ModpackImportResult,
  ModpackInspectRequest,
  ModpackInspectResult,
  ModIdentityRequest,
  ModLibrarySnapshot,
  ModOperationResult,
  LogOpenResult,
  PlaceModInOrderRequest,
  Profile,
  ProfileActionResult,
  ProfileIdRequest,
  ProfileListSnapshot,
  ProfileMissingModsSnapshot,
  RecordUe4ssRuntimeValidationRequest,
  RecordUe4ssRuntimeValidationResult,
  RenameProfileRequest,
  RendererErrorReportRequest,
  RendererErrorReportResult,
  PlaySnapshot,
  ReadmeResult,
  RuntimeSnapshot,
  SetModOrderPositionRequest,
  SetModEnabledRequest,
  ServiceStatus,
  ValidatePackagedRuntimeResult
} from "./app";

export type CoreServiceId =
  | "gameLocator"
  | "processSupervisor"
  | "launchService"
  | "deploymentService"
  | "packagedRuntimeValidationService"
  | "runtimeManager"
  | "modLibraryService"
  | "externalImportService"
  | "assetRegistryService"
  | "unrealMappingsService"
  | "profileService"
  | "loadOrderService"
  | "packageService"
  | "exportImportService"
  | "backupService"
  | "diagnosticsService";

export interface ServiceHealthReporter {
  getStatus(): ServiceStatus;
}

export interface GameLocatorContract extends ServiceHealthReporter {
  discover(): Promise<GameDiscovery>;
  rescan(): Promise<GameDiscovery>;
  getExecutablePath(): Promise<string | null>;
}

export interface ProcessSupervisorContract extends ServiceHealthReporter {
  getSnapshot(gameExecutable: string | null): Promise<GameProcessSnapshot>;
  isGameRunning(): Promise<boolean>;
}

export interface LaunchServiceContract extends ServiceHealthReporter {
  getCurrentLaunchMode(): LaunchMode;
  getLastCommand(): LaunchCommandResult | null;
  runLaunchCommand(
    request: LaunchCommandRequest
  ): Promise<LaunchCommandResult>;
}

export interface RuntimeManagerContract extends ServiceHealthReporter {
  getRuntimeSnapshot(
    currentSteamBuildId?: string | null,
    currentFingerprintSha256?: string | null
  ): Promise<RuntimeSnapshot>;
  ensureBundledUe4ssRuntime(): Promise<ImportUe4ssRuntimeResult | null>;
  installBundledUe4ssRuntime(): Promise<ImportUe4ssRuntimeResult>;
  importUe4ssRuntime(
    request: ImportUe4ssRuntimeRequest
  ): Promise<ImportUe4ssRuntimeResult>;
  recordUe4ssRuntimeValidation(
    request: RecordUe4ssRuntimeValidationRequest
  ): Promise<RecordUe4ssRuntimeValidationResult>;
  recordBundledUe4ssRuntimeValidation(
    request: RecordUe4ssRuntimeValidationRequest
  ): Promise<RecordUe4ssRuntimeValidationResult>;
}

export interface DeploymentServiceContract extends ServiceHealthReporter {
  getSnapshot(discovery?: GameDiscovery): Promise<DeploymentSnapshot>;
  prepareModdedDeployment(
    discovery: GameDiscovery
  ): Promise<DeploymentOperationResult>;
  prepareRuntimeValidationDeployment(
    discovery: GameDiscovery
  ): Promise<DeploymentOperationResult>;
  prepareUnrealMappingsDumpDeployment(
    discovery: GameDiscovery
  ): Promise<DeploymentOperationResult>;
  prepareVanillaDeployment(
    discovery: GameDiscovery
  ): Promise<DeploymentOperationResult>;
}

export interface PackagedRuntimeValidationServiceContract
  extends ServiceHealthReporter {
  validate(discovery: GameDiscovery): Promise<ValidatePackagedRuntimeResult>;
  cancel(): Promise<ValidatePackagedRuntimeResult>;
}

export interface UnrealMappingsServiceContract extends ServiceHealthReporter {
  generateMappings(
    onProgress?: (progress: CreatorMappingsDumpProgress) => void
  ): Promise<CreatorMappingsDumpResult>;
}

export interface ModLibraryServiceContract extends ServiceHealthReporter {
  listInstalledMods(): Promise<ModLibrarySnapshot>;
  listInstalledModManifests(): Promise<InstalledModManifestRecord[]>;
  importModPackage(
    request: ImportModPackageRequest
  ): Promise<ImportModPackageResult>;
  uninstallMod(request: ModIdentityRequest): Promise<ModOperationResult>;
  inspectManifest(request: ModIdentityRequest): Promise<InspectManifestResult>;
  readReadme(request: ModIdentityRequest): Promise<ReadmeResult>;
  openModFolder(request: ModIdentityRequest): Promise<ModOperationResult>;
  countInstalledPackages(): Promise<number>;
}

export interface ExternalImportServiceContract extends ServiceHealthReporter {
  inspectExternalModPackage(
    request: ExternalModInspectionRequest
  ): Promise<ExternalModInspectionResult>;
  importExternalModPackage(
    request: ImportModPackageRequest
  ): Promise<ImportModPackageResult>;
}

export interface AssetRegistryServiceContract extends ServiceHealthReporter {
  getSnapshot(): Promise<CreatorAssetRegistrySnapshot>;
  searchAssets(
    request: CreatorAssetSearchRequest
  ): Promise<CreatorAssetSearchResult>;
  getAssetTree(
    request: CreatorAssetTreeRequest
  ): Promise<CreatorAssetTreeResult>;
  getAssetDetail(
    request: CreatorAssetDetailRequest
  ): Promise<CreatorAssetDetail>;
  getConflictGraph(
    request: CreatorAssetConflictGraphRequest
  ): Promise<CreatorAssetConflictGraph>;
  getPreview(
    request: CreatorPreviewLookupRequest
  ): Promise<CreatorPreviewLookupResult>;
  getModelPreview(
    request: CreatorModelPreviewRequest
  ): Promise<CreatorModelPreviewResult>;
  getExportPlan(
    request: CreatorExportPlanRequest
  ): Promise<CreatorExportPlanResult>;
  exportMesh(request: CreatorMeshExportRequest): Promise<CreatorMeshExportResult>;
  exportMeshPackage(
    request: CreatorMeshPackageExportRequest
  ): Promise<CreatorMeshPackageExportResult>;
  getReport(
    request: CreatorAssetReportRequest
  ): Promise<CreatorAssetReportResult>;
  getViewportTextureCandidates(
    request: CreatorViewportTextureCandidatesRequest
  ): Promise<CreatorViewportTextureCandidatesResult>;
}

export interface ProfileServiceContract extends ServiceHealthReporter {
  getActiveProfile(): Promise<Profile>;
  getActiveProfileName(): Promise<string>;
  countEnabledMods(): Promise<number>;
  listProfiles(): Promise<ProfileListSnapshot>;
  createProfile(request: CreateProfileRequest): Promise<ProfileActionResult>;
  createProfileFromState(
    request: CreateProfileFromStateRequest
  ): Promise<ProfileActionResult>;
  duplicateProfile(
    request: DuplicateProfileRequest
  ): Promise<ProfileActionResult>;
  renameProfile(request: RenameProfileRequest): Promise<ProfileActionResult>;
  deleteProfile(request: ProfileIdRequest): Promise<ProfileActionResult>;
  switchProfile(request: ProfileIdRequest): Promise<ProfileActionResult>;
  getMissingModReferences(): Promise<ProfileMissingModsSnapshot>;
  acceptMissingModReferences(): Promise<AcceptMissingProfileModsResult>;
  listInstalledModsForActiveProfile(): Promise<ModLibrarySnapshot>;
  setModEnabled(request: SetModEnabledRequest): Promise<ModOperationResult>;
  moveModInActiveOrder(
    request: MoveModInOrderRequest
  ): Promise<LoadOrderActionResult>;
  setModActiveOrderPosition(
    request: SetModOrderPositionRequest
  ): Promise<LoadOrderActionResult>;
  placeModInActiveOrder(
    request: PlaceModInOrderRequest
  ): Promise<LoadOrderActionResult>;
  getLoadOrderSnapshot(): Promise<LoadOrderSnapshot>;
}

export interface LoadOrderServiceContract extends ServiceHealthReporter {
  validateActiveOrder(): Promise<LoadOrderValidation>;
  getSnapshot(): Promise<LoadOrderSnapshot>;
}

export interface PackageServiceContract extends ServiceHealthReporter {
  isImportAvailable(): Promise<boolean>;
}

export interface ExportImportServiceContract extends ServiceHealthReporter {
  exportCurrentProfile(
    request: ModpackExportRequest
  ): Promise<ModpackExportResult>;
  inspectModpack(request: ModpackInspectRequest): Promise<ModpackInspectResult>;
  importModpack(request: ModpackImportRequest): Promise<ModpackImportResult>;
  compareCurrentProfileToModpack(
    request: ModpackCompareRequest
  ): Promise<ModpackCompareResult>;
  listRecentModpacks(): Promise<ModpackHistorySnapshot>;
  acceptMissingModpackReferences(): Promise<AcceptMissingModpackHistoryResult>;
}

export interface BackupServiceContract extends ServiceHealthReporter {
  countTrackedBackups(): Promise<number>;
  restoreCmmChanges(): Promise<BackupRestoreResult>;
}

export interface DiagnosticsServiceContract extends ServiceHealthReporter {
  getPlaySnapshot(): Promise<PlaySnapshot>;
  getDiagnosticsSummary(): Promise<DiagnosticsSummary>;
  getDiagnosticReport(): Promise<DiagnosticReport>;
  getLatestErrorsReport(): Promise<DiagnosticReport>;
  recordRendererError(
    request: RendererErrorReportRequest
  ): Promise<RendererErrorReportResult>;
  openLogs(): Promise<LogOpenResult>;
}

export interface CreatorViewportWindowServiceContract {
  open(session: CreatorViewportSession): Promise<CreatorViewportSession>;
  read(): Promise<CreatorViewportSession>;
  update(session: CreatorViewportSession): Promise<CreatorViewportSession>;
  returnToMain(
    session: CreatorViewportSession
  ): Promise<CreatorViewportSession>;
}

export interface StorageServiceContract {
  getLayout(): Promise<AppStorageLayout>;
}

export interface SettingsServiceContract {
  getSettings(): Promise<AppSettings>;
  setManualGameDirectory(gameDirectory: string | null): Promise<AppSettings>;
  setAutoUpdatePackagedRuntime(enabled: boolean): Promise<AppSettings>;
  setAutoValidatePackagedRuntime(enabled: boolean): Promise<AppSettings>;
}

export interface CoreServices {
  gameLocator: GameLocatorContract;
  processSupervisor: ProcessSupervisorContract;
  launchService: LaunchServiceContract;
  deploymentService: DeploymentServiceContract;
  packagedRuntimeValidationService: PackagedRuntimeValidationServiceContract;
  unrealMappingsService: UnrealMappingsServiceContract;
  runtimeManager: RuntimeManagerContract;
  modLibraryService: ModLibraryServiceContract;
  externalImportService: ExternalImportServiceContract;
  assetRegistryService: AssetRegistryServiceContract;
  profileService: ProfileServiceContract;
  loadOrderService: LoadOrderServiceContract;
  packageService: PackageServiceContract;
  exportImportService: ExportImportServiceContract;
  backupService: BackupServiceContract;
  diagnosticsService: DiagnosticsServiceContract;
  storageService: StorageServiceContract;
  settingsService: SettingsServiceContract;
}
