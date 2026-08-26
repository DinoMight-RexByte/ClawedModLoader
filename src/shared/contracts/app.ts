import { z } from "zod";

export const CLAWED_STEAM_APP_ID = "3394840";

export const EmptyRequestSchema = z.object({}).strict();
export type EmptyRequest = z.infer<typeof EmptyRequestSchema>;

export const ThemeModeSchema = z.enum(["dark", "light", "system"]);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;

export const LaunchCommandKindSchema = z.enum([
  "launchModded",
  "launchVanilla",
  "restartGame"
]);
export type LaunchCommandKind = z.infer<typeof LaunchCommandKindSchema>;

export const LaunchModeSchema = z.enum(["VANILLA", "MODDED"]);
export type LaunchMode = z.infer<typeof LaunchModeSchema>;

export const LaunchCommandRequestSchema = z.object({
  kind: LaunchCommandKindSchema,
  forceCloseConfirmed: z.boolean().optional(),
  runtimeValidationConfirmed: z.boolean().optional(),
  alwaysValidateRuntime: z.boolean().optional()
});
export type LaunchCommandRequest = z.infer<typeof LaunchCommandRequestSchema>;

export const CommandStatusSchema = z.enum([
  "accepted",
  "blocked",
  "completed",
  "needsConfirmation",
  "stubbed"
]);
export type CommandStatus = z.infer<typeof CommandStatusSchema>;

export const LifecycleStateSchema = z.enum([
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING"
]);
export type LifecycleState = z.infer<typeof LifecycleStateSchema>;

export const LaunchCommandResultSchema = z.object({
  kind: LaunchCommandKindSchema,
  launchMode: LaunchModeSchema.optional(),
  lifecycleState: LifecycleStateSchema.optional(),
  status: CommandStatusSchema,
  title: z.string(),
  message: z.string(),
  nextStep: z.string().optional(),
  requiresForceCloseConfirmation: z.boolean().optional(),
  requiresRuntimeValidationConfirmation: z.boolean().optional(),
  canOpenRuntimeValidationFlow: z.boolean().optional(),
  occurredAt: z.string()
});
export type LaunchCommandResult = z.infer<typeof LaunchCommandResultSchema>;

export const GameStateSchema = LifecycleStateSchema.or(z.literal("UNKNOWN"));
export type GameState = z.infer<typeof GameStateSchema>;

export const GameDiscoveryStatusSchema = z.enum([
  "READY",
  "STEAM_NOT_FOUND",
  "GAME_NOT_INSTALLED",
  "EXECUTABLE_NOT_FOUND",
  "MANUAL_OVERRIDE_INVALID",
  "UNSUPPORTED_PLATFORM"
]);
export type GameDiscoveryStatus = z.infer<typeof GameDiscoveryStatusSchema>;

export const DiagnosticErrorSchema = z.object({
  category: z.enum([
    "gameLocator",
    "processSupervisor",
    "launchService",
    "settings",
    "packageService",
    "externalImportService",
    "modLibraryService",
    "profileService",
    "loadOrderService",
    "deploymentService",
    "runtimeManager",
    "availableModService",
    "assetRegistryService",
    "unrealMappingsService",
    "security"
  ]),
  code: z.string(),
  message: z.string()
});
export type DiagnosticError = z.infer<typeof DiagnosticErrorSchema>;

export const LogCategorySchema = z.enum([
  "APP",
  "STEAM",
  "PROCESS",
  "PACKAGE",
  "PROFILE",
  "DEPLOYMENT",
  "RUNTIME",
  "SECURITY"
]);
export type LogCategory = z.infer<typeof LogCategorySchema>;

export const SteamLibrarySchema = z.object({
  path: z.string(),
  appManifestPath: z.string().nullable()
});
export type SteamLibrary = z.infer<typeof SteamLibrarySchema>;

export const GameDiscoverySchema = z.object({
  appId: z.literal(CLAWED_STEAM_APP_ID),
  steamPath: z.string().nullable(),
  steamLibrary: z.string().nullable(),
  steamLibraries: z.array(SteamLibrarySchema),
  appManifestPath: z.string().nullable(),
  gameInstallPath: z.string().nullable(),
  gameExecutable: z.string().nullable(),
  discoveryStatus: GameDiscoveryStatusSchema,
  source: z.enum(["steam", "manual", "none"]),
  manualOverride: z.string().nullable(),
  diagnosticErrors: z.array(DiagnosticErrorSchema),
  discoveredAt: z.string()
});
export type GameDiscovery = z.infer<typeof GameDiscoverySchema>;

export const AppSettingsSchema = z.object({
  manualGameDirectory: z.string().nullable(),
  autoUpdatePackagedRuntime: z.boolean().default(true),
  autoValidatePackagedRuntime: z.boolean().default(false)
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const ManualGameDirectoryRequestSchema = z.object({
  gameDirectory: z.string().min(1).nullable()
});
export type ManualGameDirectoryRequest = z.infer<
  typeof ManualGameDirectoryRequestSchema
>;

export const SetAutoUpdatePackagedRuntimeRequestSchema = z
  .object({
    enabled: z.boolean()
  })
  .strict();
export type SetAutoUpdatePackagedRuntimeRequest = z.infer<
  typeof SetAutoUpdatePackagedRuntimeRequestSchema
>;

export const SetAutoValidatePackagedRuntimeRequestSchema = z
  .object({
    enabled: z.boolean()
  })
  .strict();
export type SetAutoValidatePackagedRuntimeRequest = z.infer<
  typeof SetAutoValidatePackagedRuntimeRequestSchema
>;

export const AppUpdateStatusSchema = z.enum([
  "unsupported",
  "idle",
  "checking",
  "available",
  "notAvailable",
  "downloading",
  "downloaded",
  "error"
]);
export type AppUpdateStatus = z.infer<typeof AppUpdateStatusSchema>;

export const AppUpdateProgressSchema = z.object({
  percent: z.number().min(0).max(100),
  transferred: z.number().nonnegative(),
  total: z.number().nonnegative(),
  bytesPerSecond: z.number().nonnegative()
});
export type AppUpdateProgress = z.infer<typeof AppUpdateProgressSchema>;

export const AppUpdateSnapshotSchema = z.object({
  status: AppUpdateStatusSchema,
  currentVersion: z.string(),
  availableVersion: z.string().nullable(),
  releaseName: z.string().nullable(),
  releaseDate: z.string().nullable(),
  message: z.string(),
  lastCheckedAt: z.string().nullable(),
  downloadedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  progress: AppUpdateProgressSchema.nullable()
});
export type AppUpdateSnapshot = z.infer<typeof AppUpdateSnapshotSchema>;

export const GameProcessSnapshotSchema = z.object({
  lifecycleState: LifecycleStateSchema,
  processId: z.number().int().positive().nullable(),
  processName: z.string().nullable(),
  startedAt: z.string().nullable(),
  updatedAt: z.string()
});
export type GameProcessSnapshot = z.infer<typeof GameProcessSnapshotSchema>;

export const ModLoaderSchema = z.enum(["ue4ss", "pak", "loose", "unknown"]);
export type ModLoader = z.infer<typeof ModLoaderSchema>;

export const ModDependencySchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1).optional(),
    optional: z.boolean().optional()
  })
  .strict();
export type ModDependency = z.infer<typeof ModDependencySchema>;

const CreatorPayloadPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.replaceAll("\\", "/").startsWith("payload/"),
    "Package asset paths must be archive-relative payload/ paths."
  );
const CreatorPathSchema = z.string().min(1);
const CreatorSha256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
const CookedUnrealPayloadPathRegex = /\.(uasset|uexp|ubulk|umap)$/i;

export const CreatorAffectedAssetSourceSchema = z.enum([
  "baseGame",
  "samePackage",
  "modDependency",
  "generated",
  "external",
  "unknown"
]);
export type CreatorAffectedAssetSource = z.infer<
  typeof CreatorAffectedAssetSourceSchema
>;

export const CreatorAffectedAssetRoleSchema = z.enum([
  "target",
  "replacement",
  "dependency",
  "preview",
  "support"
]);
export type CreatorAffectedAssetRole = z.infer<
  typeof CreatorAffectedAssetRoleSchema
>;

export const CreatorAffectedAssetSchema = z
  .object({
    id: z.string().min(1),
    assetClass: z.string().min(1),
    packagePath: z.string().min(1).optional(),
    objectPath: z.string().min(1).optional(),
    virtualPath: CreatorPathSchema.optional(),
    payloadPath: CreatorPayloadPathSchema.optional(),
    source: CreatorAffectedAssetSourceSchema,
    role: CreatorAffectedAssetRoleSchema,
    tags: z.array(z.string().min(1))
  })
  .strict();
export type CreatorAffectedAsset = z.infer<
  typeof CreatorAffectedAssetSchema
>;

export const CreatorDeploymentRouteSchema = z.enum([
  "pak-iostore-existing-path",
  "pak-iostore-new-texture2d-asset-registry",
  "ue4ss-runtime",
  "loose-non-cooked",
  "inspect-only"
]);
export type CreatorDeploymentRoute = z.infer<
  typeof CreatorDeploymentRouteSchema
>;

export const CreatorValidationStateSchema = z.enum([
  "validated",
  "untested",
  "blocked",
  "authorClaim"
]);
export type CreatorValidationState = z.infer<
  typeof CreatorValidationStateSchema
>;

export const CreatorAssetReplacementSchema = z
  .object({
    targetAssetId: z.string().min(1).optional(),
    replacementAssetId: z.string().min(1).optional(),
    targetPackagePath: z.string().min(1).optional(),
    targetObjectPath: z.string().min(1).optional(),
    targetVirtualPath: CreatorPathSchema.optional(),
    replacementPackagePath: z.string().min(1).optional(),
    replacementObjectPath: z.string().min(1).optional(),
    replacementVirtualPath: CreatorPathSchema.optional(),
    payloadPaths: z.array(CreatorPayloadPathSchema).min(1),
    deploymentRoute: CreatorDeploymentRouteSchema,
    validationState: CreatorValidationStateSchema
  })
  .strict();
export type CreatorAssetReplacement = z.infer<
  typeof CreatorAssetReplacementSchema
>;

export const CreatorCookTargetSchema = z
  .object({
    unrealVersion: z.string().min(1),
    platform: z.literal("Windows"),
    containerFormat: z.enum([
      "pak",
      "iostore",
      "pak+iostore",
      "none",
      "unknown"
    ]),
    requiresAssetRegistry: z.boolean(),
    mountPoint: z.string().min(1).optional(),
    toolName: z.string().min(1).optional(),
    toolVersion: z.string().min(1).optional()
  })
  .strict();
export type CreatorCookTarget = z.infer<typeof CreatorCookTargetSchema>;

export const CreatorSupportedSteamBuildSchema = z
  .object({
    buildId: z.string().min(1),
    status: CreatorValidationStateSchema,
    evidence: z.string().min(1).optional(),
    notes: z.string().min(1).optional()
  })
  .strict();
export type CreatorSupportedSteamBuild = z.infer<
  typeof CreatorSupportedSteamBuildSchema
>;

export const CreatorModelPreviewFormatSchema = z.enum([
  "gltf",
  "glb",
  "obj",
  "metadataOnly",
  "unknown"
]);
export type CreatorModelPreviewFormat = z.infer<
  typeof CreatorModelPreviewFormatSchema
>;

export const CreatorMeshExportFormatSchema = z.enum(["obj", "gltf", "glb"]);
export type CreatorMeshExportFormat = z.infer<
  typeof CreatorMeshExportFormatSchema
>;

export const CreatorModelPreviewRoleSchema = z.enum([
  "staticMesh",
  "skeletalMesh",
  "skeleton",
  "unknown"
]);
export type CreatorModelPreviewRole = z.infer<
  typeof CreatorModelPreviewRoleSchema
>;

export const CreatorModelMaterialSlotSchema = z
  .object({
    name: z.string().min(1),
    materialPath: z.string().min(1).nullable().default(null)
  })
  .strict();
export type CreatorModelMaterialSlot = z.infer<
  typeof CreatorModelMaterialSlotSchema
>;

export const CreatorModelLodSchema = z
  .object({
    index: z.number().int().nonnegative(),
    screenSize: z.number().nonnegative().nullable().default(null),
    triangleCount: z.number().int().nonnegative().nullable().default(null),
    vertexCount: z.number().int().nonnegative().nullable().default(null)
  })
  .strict();
export type CreatorModelLod = z.infer<typeof CreatorModelLodSchema>;

export const CreatorPreviewAssetSchema = z
  .object({
    id: z.string().min(1),
    payloadPath: CreatorPayloadPathSchema,
    kind: z.enum([
      "thumbnail",
      "image",
      "model",
      "audio",
      "video",
      "metadata",
      "validationEvidence"
    ]),
    assetClass: z.string().min(1).optional(),
    objectPath: z.string().min(1).optional(),
    source: z.enum([
      "userOwned",
      "generated",
      "derivedMetadata",
      "validationEvidence"
    ]),
    format: CreatorModelPreviewFormatSchema.default("unknown"),
    modelRole: CreatorModelPreviewRoleSchema.default("unknown"),
    skeleton: z.string().min(1).nullable().default(null),
    physicsAsset: z.string().min(1).nullable().default(null),
    materialSlots: z.array(CreatorModelMaterialSlotSchema).default([]),
    lods: z.array(CreatorModelLodSchema).default([]),
    dependencyPaths: z.array(z.string().min(1)).default([])
  })
  .strict();
export type CreatorPreviewAsset = z.infer<typeof CreatorPreviewAssetSchema>;

export const CreatorSourceHashSchema = z
  .object({
    algorithm: z.literal("sha256"),
    scope: z.enum(["source", "payload", "preview", "metadata"]),
    path: z.string().min(1).optional(),
    sha256: CreatorSha256Schema
  })
  .strict();
export type CreatorSourceHash = z.infer<typeof CreatorSourceHashSchema>;

export const CreatorImportProvenanceSchema = z
  .object({
    sourceKind: z.enum([
      "clawedmod",
      "rawPak",
      "rawIoStore",
      "zip",
      "creatorSource",
      "generated",
      "manual"
    ]),
    sourceName: z.string().min(1).optional(),
    sourceSha256: CreatorSha256Schema.optional(),
    sourceHashes: z.array(CreatorSourceHashSchema).default([]),
    importedAt: z.string().min(1).optional(),
    toolName: z.string().min(1).optional(),
    toolVersion: z.string().min(1).optional(),
    rights: z.enum([
      "userOwned",
      "generated",
      "redistributable",
      "indexOnly",
      "unknown"
    ])
  })
  .strict();
export type CreatorImportProvenance = z.infer<
  typeof CreatorImportProvenanceSchema
>;

export const CreatorAssetDependencySchema = z
  .object({
    fromAssetId: z.string().min(1).optional(),
    toAssetId: z.string().min(1).optional(),
    packagePath: z.string().min(1).optional(),
    objectPath: z.string().min(1).optional(),
    fromPackagePath: z.string().min(1).optional(),
    fromObjectPath: z.string().min(1).optional(),
    fromVirtualPath: CreatorPathSchema.optional(),
    toPackagePath: z.string().min(1).optional(),
    toObjectPath: z.string().min(1).optional(),
    toVirtualPath: CreatorPathSchema.optional(),
    assetClass: z.string().min(1).optional(),
    relation: z.string().min(1),
    required: z.boolean(),
    source: z.enum([
      "baseGame",
      "samePackage",
      "modDependency",
      "generated",
      "external",
      "unknown"
    ])
  })
  .strict();
export type CreatorAssetDependency = z.infer<
  typeof CreatorAssetDependencySchema
>;

export const CreatorViewportTextureLayerSchema = z.enum([
  "baseColor",
  "normal",
  "lightMap",
  "maskOrm",
  "emissive",
  "unknown"
]);
export type CreatorViewportTextureLayer = z.infer<
  typeof CreatorViewportTextureLayerSchema
>;

export const CreatorTextureBindingSchema = z
  .object({
    id: z.string().min(1).optional(),
    meshAssetId: z.string().min(1).optional(),
    meshPackagePath: z.string().min(1).optional(),
    meshObjectPath: z.string().min(1).optional(),
    meshVirtualPath: z.string().min(1).optional(),
    materialSlotName: z.string().min(1).nullable().default(null),
    layer: CreatorViewportTextureLayerSchema,
    textureAssetId: z.string().min(1).optional(),
    texturePackagePath: z.string().min(1).optional(),
    textureObjectPath: z.string().min(1).optional(),
    textureVirtualPath: z.string().min(1).optional(),
    texturePreviewId: z.string().min(1).optional(),
    evidence: z
      .enum(["creatorMetadata", "decodedMaterialDependency", "activeConflict"])
      .default("creatorMetadata")
  })
  .strict()
  .refine(
    (binding) =>
      Boolean(
        binding.meshAssetId ??
          binding.meshPackagePath ??
          binding.meshObjectPath ??
          binding.meshVirtualPath
      ),
    "Texture bindings must identify a mesh asset or mesh path."
  )
  .refine(
    (binding) =>
      Boolean(
        binding.textureAssetId ??
          binding.texturePackagePath ??
          binding.textureObjectPath ??
          binding.textureVirtualPath
      ),
    "Texture bindings must identify a Texture2D asset or texture path."
  );
export type CreatorTextureBinding = z.infer<
  typeof CreatorTextureBindingSchema
>;

export const CreatorExportOutputSchema = z.enum([
  "clawedmod",
  "clawedpack",
  "obj",
  "gltf",
  "glb",
  "assetIndex",
  "targetTemplate",
  "dependencyGraph",
  "conflictReport",
  "validationReport"
]);
export type CreatorExportOutput = z.infer<typeof CreatorExportOutputSchema>;

export const CreatorExportEligibilityStateSchema = z.enum([
  "exportable",
  "indexOnly",
  "blocked",
  "unknown"
]);
export type CreatorExportEligibilityState = z.infer<
  typeof CreatorExportEligibilityStateSchema
>;

export const CreatorExportEligibilitySchema = z
  .object({
    state: CreatorExportEligibilityStateSchema,
    allowedOutputs: z.array(CreatorExportOutputSchema),
    containsBaseGameContent: z.boolean(),
    requiresUserOwnedSource: z.boolean(),
    reason: z.string().min(1).optional()
  })
  .strict();
export type CreatorExportEligibility = z.infer<
  typeof CreatorExportEligibilitySchema
>;

export const CreatorAssetMetadataV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    affectedAssets: z.array(CreatorAffectedAssetSchema),
    replacements: z.array(CreatorAssetReplacementSchema),
    cookTarget: CreatorCookTargetSchema.optional(),
    supportedSteamBuilds: z.array(CreatorSupportedSteamBuildSchema),
    previewAssets: z.array(CreatorPreviewAssetSchema),
    importProvenance: z.array(CreatorImportProvenanceSchema),
    assetDependencies: z.array(CreatorAssetDependencySchema),
    textureBindings: z.array(CreatorTextureBindingSchema).default([]),
    exportEligibility: CreatorExportEligibilitySchema
  })
  .strict();
export type CreatorAssetMetadataV1 = z.infer<
  typeof CreatorAssetMetadataV1Schema
>;

export const ClawedModPackageIdentitySourceSchema = z.enum([
  "author",
  "cmmGenerated",
  "externalImport",
  "creatorExport",
  "manual"
]);
export type ClawedModPackageIdentitySource = z.infer<
  typeof ClawedModPackageIdentitySourceSchema
>;

export const ClawedModPackageIdentityV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z
      .string()
      .min(3)
      .max(160)
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
        "Package identity IDs must use letters, numbers, dot, underscore, colon, or hyphen."
      ),
    source: ClawedModPackageIdentitySourceSchema
  })
  .strict();
export type ClawedModPackageIdentityV1 = z.infer<
  typeof ClawedModPackageIdentityV1Schema
>;

export const ClawedModManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    author: z.string().min(1),
    description: z.string(),
    game: z.literal("clawed"),
    loader: ModLoaderSchema,
    dependencies: z.array(ModDependencySchema),
    conflicts: z.array(z.string().min(1)),
    loadAfter: z.array(z.string().min(1)),
    loadBefore: z.array(z.string().min(1)),
    packageIdentity: ClawedModPackageIdentityV1Schema.optional(),
    creatorAssets: CreatorAssetMetadataV1Schema.optional()
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const creator = manifest.creatorAssets;
    if (!creator) {
      return;
    }

    creator.replacements.forEach((replacement, index) => {
      const path = ["creatorAssets", "replacements", index, "deploymentRoute"];
      if (
        replacement.deploymentRoute.startsWith("pak-iostore") &&
        manifest.loader !== "pak"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: "Pak/IoStore creator replacements require loader \"pak\"."
        });
      }
      if (
        replacement.deploymentRoute === "ue4ss-runtime" &&
        manifest.loader !== "ue4ss"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: "UE4SS creator replacements require loader \"ue4ss\"."
        });
      }
      if (
        replacement.deploymentRoute === "loose-non-cooked" &&
        manifest.loader !== "loose"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: "Loose creator replacements require loader \"loose\"."
        });
      }
      if (
        replacement.deploymentRoute === "loose-non-cooked" &&
        replacement.payloadPaths.some((payloadPath) =>
          CookedUnrealPayloadPathRegex.test(payloadPath)
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["creatorAssets", "replacements", index, "payloadPaths"],
          message:
            "Loose creator replacements must not deploy cooked Unreal assets."
        });
      }
      if (
        replacement.deploymentRoute ===
          "pak-iostore-new-texture2d-asset-registry" &&
        creator.cookTarget?.requiresAssetRegistry !== true
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["creatorAssets", "cookTarget", "requiresAssetRegistry"],
          message:
            "Brand-new Texture2D Pak/IoStore creator replacements require AssetRegistry metadata."
        });
      }
    });
  });
export type ClawedModManifestV1 = z.infer<
  typeof ClawedModManifestV1Schema
>;

export const ModProblemSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  code: z.string(),
  message: z.string(),
  technicalDetail: z.string().optional()
});
export type ModProblem = z.infer<typeof ModProblemSchema>;

export const CreatorRegistrySourceSchema = z.enum([
  "baseGameMap",
  "installedPackage",
  "packagePayload",
  "deployment"
]);
export type CreatorRegistrySource = z.infer<
  typeof CreatorRegistrySourceSchema
>;

export const CreatorAssetConflictStateSchema = z.enum([
  "none",
  "winner",
  "overridden",
  "conflicted"
]);
export type CreatorAssetConflictState = z.infer<
  typeof CreatorAssetConflictStateSchema
>;

export const CreatorViewportStateSchema = z.enum(["none", "viewable"]);
export type CreatorViewportState = z.infer<typeof CreatorViewportStateSchema>;

export const CreatorAssetIndexEntrySchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    source: CreatorRegistrySourceSchema,
    ownerLabel: z.string().min(1),
    packageId: z.string().min(1).nullable(),
    packageVersion: z.string().min(1).nullable(),
    packageName: z.string().min(1).nullable(),
    containerName: z.string().min(1).nullable().default(null),
    loader: ModLoaderSchema.nullable(),
    activeProfileEnabled: z.boolean(),
    activeProfileOrder: z.number().int().positive().nullable(),
    assetClass: z.string().min(1).nullable(),
    viewportCapable: z.boolean().default(false),
    packagePath: z.string().min(1).nullable(),
    objectPath: z.string().min(1).nullable(),
    virtualPath: z.string().min(1).nullable().default(null),
    payloadPath: z.string().min(1).nullable(),
    relativePath: z.string().min(1).nullable(),
    extension: z.string().nullable(),
    tags: z.array(z.string().min(1)),
    modUses: z.string().nullable(),
    sizeBytes: z.number().int().nonnegative().nullable(),
    sha256: z.string().nullable(),
    validationState: CreatorValidationStateSchema.nullable(),
    deploymentRoute: CreatorDeploymentRouteSchema.nullable(),
    exportState: CreatorExportEligibilityStateSchema.nullable(),
    viewportState: CreatorViewportStateSchema.default("none"),
    conflictState: CreatorAssetConflictStateSchema
  })
  .strict();
export type CreatorAssetIndexEntry = z.infer<
  typeof CreatorAssetIndexEntrySchema
>;

export const CreatorViewportWindowModeSchema = z.enum([
  "embedded",
  "poppedOut"
]);
export type CreatorViewportWindowMode = z.infer<
  typeof CreatorViewportWindowModeSchema
>;

export const CreatorViewportLightSettingsSchema = z
  .object({
    bottomLeft: z.boolean(),
    bottomRight: z.boolean(),
    even: z.boolean(),
    topLeft: z.boolean(),
    topRight: z.boolean()
  })
  .strict();
export type CreatorViewportLightSettings = z.infer<
  typeof CreatorViewportLightSettingsSchema
>;

export const CreatorViewportCameraVectorSchema = z.tuple([
  z.number(),
  z.number(),
  z.number()
]);
export type CreatorViewportCameraVector = z.infer<
  typeof CreatorViewportCameraVectorSchema
>;

export const CreatorViewportCameraStateSchema = z
  .object({
    distance: z.number().nonnegative(),
    position: CreatorViewportCameraVectorSchema,
    target: CreatorViewportCameraVectorSchema
  })
  .strict();
export type CreatorViewportCameraState = z.infer<
  typeof CreatorViewportCameraStateSchema
>;

export const CreatorViewportTextureEvidenceSchema = z
  .object({
    detail: z.string().min(1).nullable().default(null),
    relation: z.string().min(1).nullable().default(null),
    source: z.enum([
      "creatorMetadata",
      "decodedMaterialDependency",
      "activeConflict"
    ])
  })
  .strict();
export type CreatorViewportTextureEvidence = z.infer<
  typeof CreatorViewportTextureEvidenceSchema
>;

export const CreatorViewportTextureCandidateSchema = z
  .object({
    dataUrl: z.string().min(1).nullable(),
    evidence: z.array(CreatorViewportTextureEvidenceSchema).min(1),
    id: z.string().min(1),
    layer: CreatorViewportTextureLayerSchema,
    materialSlotName: z.string().min(1).nullable(),
    meshAssetId: z.string().min(1),
    meshLabel: z.string().min(1),
    mimeType: z.string().min(1).nullable(),
    textureAssetId: z.string().min(1),
    textureLabel: z.string().min(1),
    textureObjectPath: z.string().min(1).nullable(),
    texturePackagePath: z.string().min(1).nullable(),
    texturePreviewId: z.string().min(1).nullable()
  })
  .strict();
export type CreatorViewportTextureCandidate = z.infer<
  typeof CreatorViewportTextureCandidateSchema
>;

export const CreatorViewportTextureHintSchema = z
  .object({
    dependencyPaths: z.array(z.string().min(1)).max(80).default([]),
    materialPath: z.string().min(1).nullable().default(null),
    materialSlotName: z.string().min(1).nullable().default(null),
    meshAssetId: z.string().min(1)
  })
  .strict();
export type CreatorViewportTextureHint = z.infer<
  typeof CreatorViewportTextureHintSchema
>;

export const CreatorViewportTextureCandidatesRequestSchema = z
  .object({
    textureHints: z.array(CreatorViewportTextureHintSchema).max(1000).default([]),
    visibleAssetIds: z.array(z.string().min(1)).max(200)
  })
  .strict();
export type CreatorViewportTextureCandidatesRequest = z.infer<
  typeof CreatorViewportTextureCandidatesRequestSchema
>;

export const CreatorViewportTextureCandidatesResultSchema = z
  .object({
    candidates: z.array(CreatorViewportTextureCandidateSchema),
    generatedAt: z.string(),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorViewportTextureCandidatesResult = z.infer<
  typeof CreatorViewportTextureCandidatesResultSchema
>;

export const CreatorViewportTextureSelectionSchema = z
  .object({
    candidateId: z.string().min(1)
  })
  .strict();
export type CreatorViewportTextureSelection = z.infer<
  typeof CreatorViewportTextureSelectionSchema
>;

export const CreatorViewportSessionItemSchema = z
  .object({
    assetClass: z.string().min(1).nullable(),
    assetId: z.string().min(1),
    label: z.string().min(1),
    previewId: z.string().min(1).nullable(),
    selected: z.boolean(),
    source: CreatorRegistrySourceSchema,
    visible: z.boolean()
  })
  .strict();
export type CreatorViewportSessionItem = z.infer<
  typeof CreatorViewportSessionItemSchema
>;

export const CreatorViewportSessionSchema = z
  .object({
    cameraState: CreatorViewportCameraStateSchema.nullable(),
    items: z.array(CreatorViewportSessionItemSchema).max(200),
    lightSettings: CreatorViewportLightSettingsSchema,
    selectedAssetId: z.string().min(1).nullable(),
    showSkeletons: z.boolean(),
    stopRotation: z.boolean(),
    textureSelections: z
      .array(CreatorViewportTextureSelectionSchema)
      .default([]),
    windowMode: CreatorViewportWindowModeSchema
  })
  .strict();
export type CreatorViewportSession = z.infer<
  typeof CreatorViewportSessionSchema
>;

export const CreatorViewportWindowEventSchema = z
  .object({
    session: CreatorViewportSessionSchema,
    type: z.enum(["poppedOut", "returned"])
  })
  .strict();
export type CreatorViewportWindowEvent = z.infer<
  typeof CreatorViewportWindowEventSchema
>;

export const CreatorAssetChecksumSchema = z
  .object({
    packageId: z.string().min(1),
    packageVersion: z.string().min(1),
    scope: z.enum(["package", "source", "payload"]),
    path: z.string().min(1).nullable(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/)
  })
  .strict();
export type CreatorAssetChecksum = z.infer<
  typeof CreatorAssetChecksumSchema
>;

export const CreatorAssetRegistryArtifactSchema = z
  .object({
    name: z.string().min(1),
    exists: z.boolean(),
    sizeBytes: z.number().int().nonnegative().nullable()
  })
  .strict();
export type CreatorAssetRegistryArtifact = z.infer<
  typeof CreatorAssetRegistryArtifactSchema
>;

export const CreatorAssetRegistryMapSummarySchema = z
  .object({
    status: z.enum(["ready", "missing", "partial"]),
    artifactRoot: z.string().min(1).nullable(),
    generatedAtUtc: z.string().nullable(),
    steamBuildId: z.string().nullable(),
    physicalFileCount: z.number().int().nonnegative(),
    shippingManifestEntryCount: z.number().int().nonnegative(),
    containerEntryCount: z.number().int().nonnegative(),
    namedContainerEntryCount: z.number().int().nonnegative(),
    artifacts: z.array(CreatorAssetRegistryArtifactSchema)
  })
  .strict();
export type CreatorAssetRegistryMapSummary = z.infer<
  typeof CreatorAssetRegistryMapSummarySchema
>;

export const CreatorAssetActiveProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    orderedModIds: z.array(z.string().min(1)),
    enabledModIds: z.array(z.string().min(1))
  })
  .strict();
export type CreatorAssetActiveProfile = z.infer<
  typeof CreatorAssetActiveProfileSchema
>;

export const CreatorAssetRegistryTotalsSchema = z
  .object({
    baseGameEntries: z.number().int().nonnegative(),
    installedPackages: z.number().int().nonnegative(),
    packagePayloadEntries: z.number().int().nonnegative(),
    creatorMetadataPackages: z.number().int().nonnegative(),
    affectedAssets: z.number().int().nonnegative(),
    replacements: z.number().int().nonnegative(),
    checksumRecords: z.number().int().nonnegative(),
    activeConflictTargets: z.number().int().nonnegative(),
    activeWinners: z.number().int().nonnegative(),
    loadOrderEffectProblems: z.number().int().nonnegative().default(0),
    staleProfileReferences: z.number().int().nonnegative().default(0),
    deploymentFiles: z.number().int().nonnegative()
  })
  .strict();
export type CreatorAssetRegistryTotals = z.infer<
  typeof CreatorAssetRegistryTotalsSchema
>;

export const CreatorAssetTagCountSchema = z
  .object({
    tag: z.string().min(1),
    count: z.number().int().nonnegative()
  })
  .strict();
export type CreatorAssetTagCount = z.infer<
  typeof CreatorAssetTagCountSchema
>;

export const CreatorAssetRegistrySnapshotSchema = z
  .object({
    generatedAt: z.string(),
    map: CreatorAssetRegistryMapSummarySchema,
    activeProfile: CreatorAssetActiveProfileSchema,
    totals: CreatorAssetRegistryTotalsSchema,
    topTags: z.array(CreatorAssetTagCountSchema),
    recentEntries: z.array(CreatorAssetIndexEntrySchema),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorAssetRegistrySnapshot = z.infer<
  typeof CreatorAssetRegistrySnapshotSchema
>;

export const CreatorAssetSearchRequestSchema = z
  .object({
    query: z.string().default(""),
    source: CreatorRegistrySourceSchema.or(z.literal("all")).default("all"),
    physicalPath: z.string().default(""),
    objectPath: z.string().default(""),
    tags: z.array(z.string().min(1)).default([]),
    assetClass: z.string().min(1).optional(),
    modUse: z.string().default(""),
    packageId: z.string().min(1).optional(),
    conflictState: CreatorAssetConflictStateSchema.or(z.literal("any")).default(
      "any"
    ),
    validationState: CreatorValidationStateSchema.optional(),
    exportState: CreatorExportEligibilityStateSchema.or(z.literal("any")).default(
      "any"
    ),
    sortBy: z
      .enum([
        "relevance",
        "label",
        "source",
        "physicalPath",
        "objectPath",
        "assetClass",
        "modUse",
        "package",
        "validationState",
        "conflictState",
        "exportState",
        "activeProfileOrder"
      ])
      .default("relevance"),
    sortDirection: z.enum(["asc", "desc"]).default("asc"),
    activeOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(80)
  })
  .strict();
export type CreatorAssetSearchRequest = z.infer<
  typeof CreatorAssetSearchRequestSchema
>;

export const CreatorAssetSearchResultSchema = z
  .object({
    generatedAt: z.string(),
    totalMatches: z.number().int().nonnegative(),
    truncated: z.boolean(),
    entries: z.array(CreatorAssetIndexEntrySchema),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorAssetSearchResult = z.infer<
  typeof CreatorAssetSearchResultSchema
>;

export const CreatorAssetTreeNodeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum(["root", "folder", "asset"]),
    source: CreatorRegistrySourceSchema.nullable(),
    path: z.string(),
    assetId: z.string().min(1).nullable(),
    hasChildren: z.boolean(),
    childCount: z.number().int().nonnegative(),
    assetClass: z.string().min(1).nullable().default(null),
    viewportCapable: z.boolean().default(false),
    packageName: z.string().min(1).nullable().default(null),
    validationState: CreatorValidationStateSchema.nullable().default(null),
    conflictState: CreatorAssetConflictStateSchema.nullable().default(null),
    exportState: CreatorExportEligibilityStateSchema.nullable().default(null),
    viewportState: CreatorViewportStateSchema.default("none")
  })
  .strict();
export type CreatorAssetTreeNode = z.infer<
  typeof CreatorAssetTreeNodeSchema
>;

export const CreatorAssetTreeRequestSchema = z
  .object({
    parentId: z.string().min(1).nullable().default(null),
    source: CreatorRegistrySourceSchema.or(z.literal("all")).default("all"),
    query: z.string().default(""),
    activeOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(500).default(200)
  })
  .strict();
export type CreatorAssetTreeRequest = z.infer<
  typeof CreatorAssetTreeRequestSchema
>;

export const CreatorAssetTreeResultSchema = z
  .object({
    generatedAt: z.string(),
    parentId: z.string().min(1).nullable(),
    nodes: z.array(CreatorAssetTreeNodeSchema),
    totalChildren: z.number().int().nonnegative(),
    truncated: z.boolean(),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorAssetTreeResult = z.infer<
  typeof CreatorAssetTreeResultSchema
>;

export const CreatorAssetDetailRequestSchema = z
  .object({
    assetId: z.string().min(1)
  })
  .strict();
export type CreatorAssetDetailRequest = z.infer<
  typeof CreatorAssetDetailRequestSchema
>;

export const CreatorAssetLoadOrderEffectSchema = z
  .object({
    severity: z.enum(["ERROR", "WARNING"]),
    code: z.string(),
    message: z.string(),
    modId: z.string().min(1).optional(),
    relatedModId: z.string().min(1).optional(),
    technicalDetail: z.string().optional()
  })
  .strict();
export type CreatorAssetLoadOrderEffect = z.infer<
  typeof CreatorAssetLoadOrderEffectSchema
>;

export const CreatorAssetConflictEntrySchema = z
  .object({
    packageId: z.string().min(1),
    packageVersion: z.string().min(1),
    packageName: z.string().min(1),
    loader: ModLoaderSchema,
    enabled: z.boolean(),
    profileOrder: z.number().int().positive().nullable(),
    validationState: CreatorValidationStateSchema,
    deploymentRoute: CreatorDeploymentRouteSchema,
    payloadPaths: z.array(z.string().min(1)),
    targetAssetIds: z.array(z.string().min(1)),
    contributesReplacement: z.boolean().default(true),
    dependencies: z.array(ModDependencySchema).default([]),
    explicitConflicts: z.array(z.string().min(1)).default([]),
    loadBefore: z.array(z.string().min(1)).default([]),
    loadAfter: z.array(z.string().min(1)).default([]),
    loadOrderEffects: z
      .array(CreatorAssetLoadOrderEffectSchema)
      .default([]),
    isWinner: z.boolean()
  })
  .strict();
export type CreatorAssetConflictEntry = z.infer<
  typeof CreatorAssetConflictEntrySchema
>;

export const CreatorAssetConflictSchema = z
  .object({
    targetKey: z.string().min(1),
    targetPackagePath: z.string().min(1).nullable(),
    targetObjectPath: z.string().min(1).nullable(),
    targetVirtualPath: z.string().min(1).nullable().default(null),
    baseGamePresent: z.boolean(),
    winnerPackageId: z.string().min(1).nullable(),
    winnerPackageVersion: z.string().min(1).nullable(),
    entries: z.array(CreatorAssetConflictEntrySchema),
    loadOrderEffects: z
      .array(CreatorAssetLoadOrderEffectSchema)
      .default([])
  })
  .strict();
export type CreatorAssetConflict = z.infer<
  typeof CreatorAssetConflictSchema
>;

export const CreatorAssetConflictGraphRequestSchema = z
  .object({
    assetId: z.string().min(1).optional(),
    targetKey: z.string().min(1).optional(),
    objectPath: z.string().min(1).optional(),
    packagePath: z.string().min(1).optional(),
    virtualPath: z.string().min(1).optional(),
    includeInactive: z.boolean().default(false)
  })
  .strict();
export type CreatorAssetConflictGraphRequest = z.infer<
  typeof CreatorAssetConflictGraphRequestSchema
>;

export const CreatorAssetConflictGraphSchema = z
  .object({
    generatedAt: z.string(),
    activeProfile: CreatorAssetActiveProfileSchema,
    conflicts: z.array(CreatorAssetConflictSchema),
    totals: z.object({
      targets: z.number().int().nonnegative(),
      activeTargets: z.number().int().nonnegative(),
      winners: z.number().int().nonnegative()
    }),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorAssetConflictGraph = z.infer<
  typeof CreatorAssetConflictGraphSchema
>;

export const CreatorAssetDetailSchema = z
  .object({
    status: z.enum(["ok", "notFound"]),
    asset: CreatorAssetIndexEntrySchema.nullable(),
    relatedAssets: z.array(CreatorAssetIndexEntrySchema),
    conflicts: z.array(CreatorAssetConflictSchema),
    activeWinner: CreatorAssetConflictEntrySchema.nullable(),
    previews: z.array(CreatorPreviewAssetSchema),
    checksums: z.array(CreatorAssetChecksumSchema),
    dependencies: z.array(CreatorAssetDependencySchema),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorAssetDetail = z.infer<typeof CreatorAssetDetailSchema>;

export const CreatorPreviewLookupRequestSchema = z
  .object({
    assetId: z.string().min(1)
  })
  .strict();
export type CreatorPreviewLookupRequest = z.infer<
  typeof CreatorPreviewLookupRequestSchema
>;

export const CreatorPreviewLookupResultSchema = z
  .object({
    status: z.enum(["available", "notFound", "blocked"]),
    previews: z.array(CreatorPreviewAssetSchema),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorPreviewLookupResult = z.infer<
  typeof CreatorPreviewLookupResultSchema
>;

export const CreatorModelPreviewRequestSchema = z
  .object({
    assetId: z.string().min(1),
    previewId: z.string().min(1).optional()
  })
  .strict();
export type CreatorModelPreviewRequest = z.infer<
  typeof CreatorModelPreviewRequestSchema
>;

export const CreatorModelPreviewPayloadSchema = z
  .object({
    dataUrl: z.string().min(1),
    format: z.enum(["gltf", "glb", "obj"]),
    source: z.enum([
      "userOwned",
      "generated",
      "packagePayload",
      "cachedBaseGame",
      "decodedBaseGame"
    ]),
    fileName: z.string().min(1),
    sizeBytes: z.number().int().nonnegative()
  })
  .strict();
export type CreatorModelPreviewPayload = z.infer<
  typeof CreatorModelPreviewPayloadSchema
>;

export const CreatorModelPreviewMetadataSchema = z
  .object({
    meshType: CreatorModelPreviewRoleSchema.default("unknown"),
    skeleton: z.string().min(1).nullable(),
    physicsAsset: z.string().min(1).nullable(),
    materialSlots: z.array(CreatorModelMaterialSlotSchema),
    lods: z.array(CreatorModelLodSchema),
    dependencyPaths: z.array(z.string().min(1)),
    targetObjectPath: z.string().min(1).nullable(),
    packagePath: z.string().min(1).nullable().default(null),
    packageSource: z.string().min(1).nullable(),
    sourceContainer: z.string().min(1).nullable().default(null),
    previewSource: z.string().min(1).nullable().default(null),
    lodCount: z.number().int().nonnegative().nullable().default(null),
    vertexCount: z.number().int().nonnegative().nullable().default(null),
    triangleCount: z.number().int().nonnegative().nullable().default(null),
    materialSlotCount: z.number().int().nonnegative().nullable().default(null),
    validationState: CreatorValidationStateSchema.nullable(),
    conflictWinner: z.string().min(1).nullable(),
    exportState: CreatorExportEligibilityStateSchema.nullable()
  })
  .strict();
export type CreatorModelPreviewMetadata = z.infer<
  typeof CreatorModelPreviewMetadataSchema
>;

export const CreatorModelPreviewResultSchema = z
  .object({
    status: z.enum([
      "available",
      "empty",
      "unsupported",
      "blocked",
      "error",
      "resolving",
      "decoding",
      "converting",
      "ready",
      "dependency-missing",
      "decode-error",
      "export-ready",
      "export-error"
    ]),
    asset: CreatorAssetIndexEntrySchema.nullable(),
    preview: CreatorPreviewAssetSchema.nullable(),
    activeWinner: CreatorAssetConflictEntrySchema.nullable(),
    model: CreatorModelPreviewPayloadSchema.nullable(),
    metadata: CreatorModelPreviewMetadataSchema,
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorModelPreviewResult = z.infer<
  typeof CreatorModelPreviewResultSchema
>;

export const CreatorExportPlanRequestSchema = z
  .object({
    assetIds: z.array(z.string().min(1)).min(1).max(200),
    output: CreatorExportOutputSchema
  })
  .strict();
export type CreatorExportPlanRequest = z.infer<
  typeof CreatorExportPlanRequestSchema
>;

export const CreatorExportPlanItemSchema = z
  .object({
    asset: CreatorAssetIndexEntrySchema,
    eligibility: CreatorExportEligibilitySchema,
    status: z.enum(["allowed", "blocked", "unknown"]),
    reason: z.string().min(1).nullable()
  })
  .strict();
export type CreatorExportPlanItem = z.infer<
  typeof CreatorExportPlanItemSchema
>;

export const CreatorExportPlanResultSchema = z
  .object({
    status: z.enum(["ready", "blocked", "empty"]),
    output: CreatorExportOutputSchema,
    items: z.array(CreatorExportPlanItemSchema),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorExportPlanResult = z.infer<
  typeof CreatorExportPlanResultSchema
>;

export const CreatorMeshExportRequestSchema = z
  .object({
    assetId: z.string().min(1),
    format: CreatorMeshExportFormatSchema,
    destinationPath: z.string().min(1)
  })
  .strict();
export type CreatorMeshExportRequest = z.infer<
  typeof CreatorMeshExportRequestSchema
>;

export const CreatorMeshExportDialogRequestSchema = z
  .object({
    assetId: z.string().min(1),
    format: CreatorMeshExportFormatSchema
  })
  .strict();
export type CreatorMeshExportDialogRequest = z.infer<
  typeof CreatorMeshExportDialogRequestSchema
>;

export const CreatorMeshExportResultSchema = z
  .object({
    status: z.enum([
      "exported",
      "blocked",
      "unsupported",
      "dependency-missing",
      "decode-error",
      "export-error",
      "cancelled"
    ]),
    asset: CreatorAssetIndexEntrySchema.nullable(),
    format: CreatorMeshExportFormatSchema,
    destinationPath: z.string().min(1).nullable(),
    bytesWritten: z.number().int().nonnegative().nullable().default(null),
    metadata: CreatorModelPreviewMetadataSchema,
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorMeshExportResult = z.infer<
  typeof CreatorMeshExportResultSchema
>;

export const CreatorMeshPackageExportDialogRequestSchema = z
  .object({
    assetIds: z.array(z.string().min(1)).min(1).max(50)
  })
  .strict();
export type CreatorMeshPackageExportDialogRequest = z.infer<
  typeof CreatorMeshPackageExportDialogRequestSchema
>;

export const CreatorMeshPackageExportRequestSchema =
  CreatorMeshPackageExportDialogRequestSchema.extend({
    destinationPath: z.string().min(1)
  }).strict();
export type CreatorMeshPackageExportRequest = z.infer<
  typeof CreatorMeshPackageExportRequestSchema
>;

export const CreatorMeshPackageExportItemSchema = z
  .object({
    asset: CreatorAssetIndexEntrySchema.nullable(),
    status: z.enum([
      "exported",
      "blocked",
      "unsupported",
      "dependency-missing",
      "decode-error",
      "export-error"
    ]),
    format: CreatorMeshExportFormatSchema.nullable(),
    payloadPath: CreatorPayloadPathSchema.nullable(),
    bytesWritten: z.number().int().nonnegative().nullable().default(null),
    metadata: CreatorModelPreviewMetadataSchema,
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorMeshPackageExportItem = z.infer<
  typeof CreatorMeshPackageExportItemSchema
>;

export const CreatorMeshPackageExportResultSchema = z
  .object({
    status: z.enum([
      "exported",
      "partial",
      "blocked",
      "empty",
      "cancelled",
      "export-error"
    ]),
    destinationPath: z.string().min(1).nullable(),
    bytesWritten: z.number().int().nonnegative().nullable().default(null),
    itemCount: z.number().int().nonnegative(),
    exportedCount: z.number().int().nonnegative(),
    items: z.array(CreatorMeshPackageExportItemSchema),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorMeshPackageExportResult = z.infer<
  typeof CreatorMeshPackageExportResultSchema
>;

export const CreatorMappingsDumpResultSchema = z
  .object({
    status: z.enum(["ready", "generated", "blocked", "failed"]),
    mappingsPath: z.string().min(1).nullable(),
    evidencePath: z.string().min(1).nullable(),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorMappingsDumpResult = z.infer<
  typeof CreatorMappingsDumpResultSchema
>;

export const CreatorMappingsDumpProgressStageSchema = z.enum([
  "checking",
  "staging",
  "launching",
  "waitingForGame",
  "waitingForMappings",
  "closingGame",
  "restoringVanilla",
  "complete",
  "blocked",
  "failed"
]);
export type CreatorMappingsDumpProgressStage = z.infer<
  typeof CreatorMappingsDumpProgressStageSchema
>;

export const CreatorMappingsDumpProgressStatusSchema = z.enum([
  "running",
  "done",
  "blocked",
  "failed"
]);
export type CreatorMappingsDumpProgressStatus = z.infer<
  typeof CreatorMappingsDumpProgressStatusSchema
>;

export const CreatorMappingsDumpProgressSchema = z
  .object({
    stage: CreatorMappingsDumpProgressStageSchema,
    status: CreatorMappingsDumpProgressStatusSchema,
    message: z.string().min(1),
    detail: z.string().min(1).nullable().default(null),
    mappingsPath: z.string().min(1).nullable().default(null),
    evidencePath: z.string().min(1).nullable().default(null)
  })
  .strict();
export type CreatorMappingsDumpProgress = z.infer<
  typeof CreatorMappingsDumpProgressSchema
>;

export const CreatorAssetReportOutputSchema = z.enum([
  "assetIndex",
  "dependencyGraph",
  "conflictReport",
  "validationReport"
]);
export type CreatorAssetReportOutput = z.infer<
  typeof CreatorAssetReportOutputSchema
>;

export const CreatorAssetReportRequestSchema = z
  .object({
    assetIds: z.array(z.string().min(1)).min(1).max(200),
    output: CreatorAssetReportOutputSchema
  })
  .strict();
export type CreatorAssetReportRequest = z.infer<
  typeof CreatorAssetReportRequestSchema
>;

export const CreatorAssetReportResultSchema = z
  .object({
    status: z.enum(["ready", "blocked", "empty"]),
    output: CreatorAssetReportOutputSchema,
    generatedAt: z.string(),
    fileName: z.string().min(1),
    mimeType: z.enum(["application/json", "text/plain"]),
    text: z.string(),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type CreatorAssetReportResult = z.infer<
  typeof CreatorAssetReportResultSchema
>;

export const InstalledModVersionSchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  author: z.string(),
  description: z.string(),
  loader: ModLoaderSchema,
  sha256: z.string(),
  packageIdentityId: z.string().min(1).nullable().optional(),
  enabled: z.boolean(),
  installPath: z.string(),
  packagePath: z.string(),
  iconDataUrl: z.string().nullable(),
  hasReadme: z.boolean(),
  status: z.enum(["ready", "warning", "error"]),
  problems: z.array(ModProblemSchema),
  installedAt: z.string()
});
export type InstalledModVersion = z.infer<typeof InstalledModVersionSchema>;

export const InstalledModManifestRecordSchema = z.object({
  mod: InstalledModVersionSchema,
  manifest: ClawedModManifestV1Schema
});
export type InstalledModManifestRecord = z.infer<
  typeof InstalledModManifestRecordSchema
>;

export const ModLibrarySnapshotSchema = z.object({
  mods: z.array(InstalledModVersionSchema),
  totals: z.object({
    installed: z.number().int().nonnegative(),
    enabled: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
    problems: z.number().int().nonnegative()
  })
});
export type ModLibrarySnapshot = z.infer<typeof ModLibrarySnapshotSchema>;

export const AvailableModCategorySchema = z.enum(["prototype", "release"]);
export type AvailableModCategory = z.infer<
  typeof AvailableModCategorySchema
>;

export const AvailableModInstallScopeSchema = z.enum([
  "hostOnly",
  "everyone"
]);
export type AvailableModInstallScope = z.infer<
  typeof AvailableModInstallScopeSchema
>;

export const AvailableModInstallStateSchema = z.enum([
  "notInstalled",
  "installed",
  "sameIdentityInstalled",
  "duplicateDifferentHash"
]);
export type AvailableModInstallState = z.infer<
  typeof AvailableModInstallStateSchema
>;

export const AvailableModSchema = z
  .object({
    key: z.string().min(1),
    category: AvailableModCategorySchema,
    fileName: z.string().min(1),
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    author: z.string().min(1),
    description: z.string(),
    loader: ModLoaderSchema,
    packageIdentityId: z.string().min(1).nullable(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    installScope: AvailableModInstallScopeSchema,
    installState: AvailableModInstallStateSchema,
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type AvailableMod = z.infer<typeof AvailableModSchema>;

export const AvailableModGroupSchema = z
  .object({
    category: AvailableModCategorySchema,
    title: z.string().min(1),
    mods: z.array(AvailableModSchema)
  })
  .strict();
export type AvailableModGroup = z.infer<typeof AvailableModGroupSchema>;

export const AvailableModCatalogSchema = z
  .object({
    generatedAt: z.string(),
    groups: z.array(AvailableModGroupSchema),
    totals: z.object({
      available: z.number().int().nonnegative(),
      prototype: z.number().int().nonnegative(),
      release: z.number().int().nonnegative(),
      installed: z.number().int().nonnegative(),
      problems: z.number().int().nonnegative()
    }),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type AvailableModCatalog = z.infer<typeof AvailableModCatalogSchema>;

export const PackageIdentityReplacementRequestSchema = z
  .object({
    action: z.literal("replaceMatchingIdentity"),
    packageIdentityId: z.string().min(1)
  })
  .strict();
export type PackageIdentityReplacementRequest = z.infer<
  typeof PackageIdentityReplacementRequestSchema
>;

export const ImportModPackageRequestSchema = z
  .object({
    packagePath: z.string().min(1),
    replacement: PackageIdentityReplacementRequestSchema.optional()
  })
  .strict();
export type ImportModPackageRequest = z.infer<
  typeof ImportModPackageRequestSchema
>;

export const ImportModPackageResultSchema = z.object({
  status: z.enum([
    "installed",
    "alreadyInstalled",
    "duplicateDifferentHash",
    "needsReplacementConfirmation",
    "failed"
  ]),
  mod: InstalledModVersionSchema.nullable(),
  packageIdentityId: z.string().min(1).nullable().optional(),
  replacementCandidates: z.array(InstalledModVersionSchema).optional(),
  problems: z.array(ModProblemSchema)
});
export type ImportModPackageResult = z.infer<
  typeof ImportModPackageResultSchema
>;

export const InstallAvailableModRequestSchema = z
  .object({
    key: z.string().min(1),
    replacement: PackageIdentityReplacementRequestSchema.optional()
  })
  .strict();
export type InstallAvailableModRequest = z.infer<
  typeof InstallAvailableModRequestSchema
>;

export const InstallAvailableModResultSchema = z
  .object({
    result: ImportModPackageResultSchema,
    catalog: AvailableModCatalogSchema
  })
  .strict();
export type InstallAvailableModResult = z.infer<
  typeof InstallAvailableModResultSchema
>;

export const ExternalModFormatSchema = z.enum([
  "clawedmod",
  "rawPak",
  "rawIoStore",
  "thunderstore",
  "ue4ssArchive",
  "fomod",
  "genericZip",
  "unsupportedArchive",
  "blockedExecutable"
]);
export type ExternalModFormat = z.infer<typeof ExternalModFormatSchema>;

export const ExternalImportSupportSchema = z.enum([
  "installable",
  "inspectOnly",
  "unsupported",
  "blocked"
]);
export type ExternalImportSupport = z.infer<
  typeof ExternalImportSupportSchema
>;

export const ExternalModInspectionRequestSchema = z
  .object({
    packagePath: z.string().min(1)
  })
  .strict();
export type ExternalModInspectionRequest = z.infer<
  typeof ExternalModInspectionRequestSchema
>;

export const ExternalModInspectionResultSchema = z
  .object({
    status: z.enum(["recognized", "unsupported", "invalid"]),
    format: ExternalModFormatSchema,
    support: ExternalImportSupportSchema,
    loader: ModLoaderSchema.nullable(),
    sourcePath: z.string(),
    fileName: z.string(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable(),
    detectedName: z.string().nullable(),
    detectedVersion: z.string().nullable(),
    entryCount: z.number().int().nonnegative(),
    problems: z.array(ModProblemSchema)
  })
  .strict();
export type ExternalModInspectionResult = z.infer<
  typeof ExternalModInspectionResultSchema
>;

export const ModIdentityRequestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1)
});
export type ModIdentityRequest = z.infer<typeof ModIdentityRequestSchema>;

export const ModReferenceSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1)
});
export type ModReference = z.infer<typeof ModReferenceSchema>;

export const SetModEnabledRequestSchema = ModIdentityRequestSchema.extend({
  enabled: z.boolean()
});
export type SetModEnabledRequest = z.infer<typeof SetModEnabledRequestSchema>;

export const ModOperationResultSchema = z.object({
  status: z.enum(["ok", "notFound", "blocked", "failed"]),
  mod: InstalledModVersionSchema.nullable(),
  problems: z.array(ModProblemSchema)
});
export type ModOperationResult = z.infer<typeof ModOperationResultSchema>;

export const CreatorMetadataStateSchema = z.enum(["present", "missing"]);
export type CreatorMetadataState = z.infer<typeof CreatorMetadataStateSchema>;

export const InspectManifestResultSchema = z.object({
  manifest: ClawedModManifestV1Schema.nullable(),
  creatorMetadataState: CreatorMetadataStateSchema.default("missing"),
  creatorMetadataProblems: z.array(ModProblemSchema).default([]),
  problems: z.array(ModProblemSchema)
});
export type InspectManifestResult = z.infer<
  typeof InspectManifestResultSchema
>;

export const ReadmeResultSchema = z.object({
  content: z.string().nullable(),
  problems: z.array(ModProblemSchema)
});
export type ReadmeResult = z.infer<typeof ReadmeResultSchema>;

export const ProfileValiditySchema = z.enum(["valid", "invalid", "unknown"]);
export type ProfileValidity = z.infer<typeof ProfileValiditySchema>;

export const ProfileModSelectionSchema = z
  .object({
    modId: z.string().min(1),
    version: z.string().min(1),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown())
  })
  .strict();
export type ProfileModSelection = z.infer<
  typeof ProfileModSelectionSchema
>;

export const ProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
    selectedMods: z.record(z.string(), ProfileModSelectionSchema),
    orderedModIds: z.array(z.string().min(1)),
    preferredLaunchMode: LaunchModeSchema
  })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  modCount: z.number().int().nonnegative(),
  enabledCount: z.number().int().nonnegative(),
  preferredLaunchMode: LaunchModeSchema,
  isActive: z.boolean(),
  updatedAt: z.string()
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export const ProfileListSnapshotSchema = z.object({
  activeProfileId: z.string(),
  profiles: z.array(ProfileSummarySchema)
});
export type ProfileListSnapshot = z.infer<typeof ProfileListSnapshotSchema>;

export const ProfileActionResultSchema = z.object({
  status: z.enum(["ok", "notFound", "blocked", "failed"]),
  activeProfile: ProfileSchema,
  profiles: z.array(ProfileSummarySchema),
  problems: z.array(ModProblemSchema)
});
export type ProfileActionResult = z.infer<typeof ProfileActionResultSchema>;

export const MissingProfileModSchema = ModReferenceSchema.extend({
  enabled: z.boolean()
});
export type MissingProfileMod = z.infer<typeof MissingProfileModSchema>;

export const ProfileMissingModsSchema = z.object({
  profileId: z.string(),
  profileName: z.string(),
  missingMods: z.array(MissingProfileModSchema)
});
export type ProfileMissingMods = z.infer<typeof ProfileMissingModsSchema>;

export const ProfileMissingModsSnapshotSchema = z.object({
  profiles: z.array(ProfileMissingModsSchema),
  totalMissing: z.number().int().nonnegative(),
  generatedAt: z.string()
});
export type ProfileMissingModsSnapshot = z.infer<
  typeof ProfileMissingModsSnapshotSchema
>;

export const AcceptMissingProfileModsResultSchema = z.object({
  status: z.enum(["ok", "failed"]),
  profilesUpdated: z.number().int().nonnegative(),
  removedModCount: z.number().int().nonnegative(),
  snapshot: ProfileMissingModsSnapshotSchema,
  problems: z.array(ModProblemSchema)
});
export type AcceptMissingProfileModsResult = z.infer<
  typeof AcceptMissingProfileModsResultSchema
>;

export const CreateProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80)
  })
  .strict();
export type CreateProfileRequest = z.infer<
  typeof CreateProfileRequestSchema
>;

export const DuplicateProfileRequestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(80).optional()
  })
  .strict();
export type DuplicateProfileRequest = z.infer<
  typeof DuplicateProfileRequestSchema
>;

export const RenameProfileRequestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(80)
  })
  .strict();
export type RenameProfileRequest = z.infer<
  typeof RenameProfileRequestSchema
>;

export const ProfileIdRequestSchema = z
  .object({
    id: z.string().min(1)
  })
  .strict();
export type ProfileIdRequest = z.infer<typeof ProfileIdRequestSchema>;

export const OrderMoveKindSchema = z.enum([
  "up",
  "down",
  "top",
  "bottom"
]);
export type OrderMoveKind = z.infer<typeof OrderMoveKindSchema>;

export const MoveModInOrderRequestSchema = z
  .object({
    modId: z.string().min(1),
    direction: OrderMoveKindSchema
  })
  .strict();
export type MoveModInOrderRequest = z.infer<
  typeof MoveModInOrderRequestSchema
>;

export const SetModOrderPositionRequestSchema = z
  .object({
    modId: z.string().min(1),
    position: z.number().int().positive()
  })
  .strict();
export type SetModOrderPositionRequest = z.infer<
  typeof SetModOrderPositionRequestSchema
>;

export const PlaceModInOrderRequestSchema = z
  .object({
    modId: z.string().min(1),
    targetModId: z.string().min(1),
    placement: z.enum(["before", "after"])
  })
  .strict();
export type PlaceModInOrderRequest = z.infer<
  typeof PlaceModInOrderRequestSchema
>;

export const LoadOrderProblemSchema = z
  .object({
    severity: z.enum(["ERROR", "WARNING"]),
    code: z.string(),
    message: z.string(),
    modId: z.string().min(1).optional(),
    relatedModId: z.string().min(1).optional(),
    technicalDetail: z.string().optional()
  })
  .strict();
export type LoadOrderProblem = z.infer<typeof LoadOrderProblemSchema>;

export const LoadOrderEntrySchema = z.object({
  position: z.number().int().positive(),
  mod: InstalledModVersionSchema,
  selectedVersion: z.string(),
  enabled: z.boolean(),
  problems: z.array(LoadOrderProblemSchema)
});
export type LoadOrderEntry = z.infer<typeof LoadOrderEntrySchema>;

export const LoadOrderValidationSchema = z.object({
  profileId: z.string(),
  profileName: z.string(),
  orderedModIds: z.array(z.string()),
  problems: z.array(LoadOrderProblemSchema),
  validity: ProfileValiditySchema
});
export type LoadOrderValidation = z.infer<
  typeof LoadOrderValidationSchema
>;

export const LoadOrderSnapshotSchema = z.object({
  activeProfile: ProfileSchema,
  entries: z.array(LoadOrderEntrySchema),
  validation: LoadOrderValidationSchema
});
export type LoadOrderSnapshot = z.infer<typeof LoadOrderSnapshotSchema>;

export const LoadOrderActionResultSchema = z.object({
  status: z.enum(["ok", "notFound", "blocked", "failed"]),
  snapshot: LoadOrderSnapshotSchema,
  problems: z.array(ModProblemSchema)
});
export type LoadOrderActionResult = z.infer<
  typeof LoadOrderActionResultSchema
>;

export const ModpackExportTypeSchema = z.enum(["PORTABLE"]);
export type ModpackExportType = z.infer<typeof ModpackExportTypeSchema>;

export const ModpackPackageRecordSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    file: z.string().min(1)
  })
  .strict();
export type ModpackPackageRecord = z.infer<
  typeof ModpackPackageRecordSchema
>;

export const ModpackPackManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal("clawedpack"),
    exportType: ModpackExportTypeSchema,
    name: z.string().min(1),
    exportedAt: z.string(),
    packages: z.array(ModpackPackageRecordSchema)
  })
  .strict();
export type ModpackPackManifest = z.infer<
  typeof ModpackPackManifestSchema
>;

export const ModpackLoadOrderSchema = z
  .object({
    schemaVersion: z.literal(1),
    profileName: z.string().min(1),
    selectedMods: z.record(z.string(), ProfileModSelectionSchema),
    enabledModIds: z.array(z.string().min(1)),
    disabledModIds: z.array(z.string().min(1)),
    orderedModIds: z.array(z.string().min(1)),
    preferredLaunchMode: LaunchModeSchema
  })
  .strict()
  .superRefine((loadOrder, context) => {
    const selectedIds = new Set(Object.keys(loadOrder.selectedMods));
    const enabledIds = new Set(loadOrder.enabledModIds);
    const disabledIds = new Set(loadOrder.disabledModIds);
    const orderedIds = new Set(loadOrder.orderedModIds);

    for (const [label, values] of [
      ["enabledModIds", loadOrder.enabledModIds],
      ["disabledModIds", loadOrder.disabledModIds],
      ["orderedModIds", loadOrder.orderedModIds]
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${label} must not contain duplicate mod IDs.`
        });
      }
    }

    for (const modId of [...enabledIds, ...disabledIds]) {
      if (!selectedIds.has(modId)) {
        context.addIssue({
          code: "custom",
          message: `${modId} is listed as enabled or disabled but is not selected.`
        });
      }
    }

    for (const [modId, selection] of Object.entries(loadOrder.selectedMods)) {
      if (selection.modId !== modId) {
        context.addIssue({
          code: "custom",
          message: `${modId} selectedMods key must match its modId value.`
        });
      }
    }

    for (const modId of selectedIds) {
      const isEnabled = enabledIds.has(modId);
      const isDisabled = disabledIds.has(modId);

      if (isEnabled === isDisabled) {
        context.addIssue({
          code: "custom",
          message: `${modId} must appear in exactly one enabled or disabled list.`
        });
      }
    }

    for (const modId of orderedIds) {
      if (!selectedIds.has(modId)) {
        context.addIssue({
          code: "custom",
          message: `${modId} is ordered but is not selected.`
        });
      }
    }

    for (const modId of selectedIds) {
      if (!orderedIds.has(modId)) {
        context.addIssue({
          code: "custom",
          message: `${modId} is selected but missing from orderedModIds.`
        });
      }
    }
  });
export type ModpackLoadOrder = z.infer<typeof ModpackLoadOrderSchema>;

export const ModpackPackageInspectionSchema = z.object({
  id: z.string(),
  version: z.string(),
  sha256: z.string(),
  file: z.string(),
  name: z.string().nullable(),
  loader: ModLoaderSchema.nullable(),
  status: z.enum(["missing", "installed", "hashMismatch", "invalid"]),
  problems: z.array(ModProblemSchema)
});
export type ModpackPackageInspection = z.infer<
  typeof ModpackPackageInspectionSchema
>;

export const ModpackSummarySchema = z.object({
  profileName: z.string(),
  packageCount: z.number().int().nonnegative(),
  enabledCount: z.number().int().nonnegative(),
  disabledCount: z.number().int().nonnegative(),
  orderedModIds: z.array(z.string())
});
export type ModpackSummary = z.infer<typeof ModpackSummarySchema>;

export const ModpackInspectRequestSchema = z
  .object({
    modpackPath: z.string().min(1)
  })
  .strict();
export type ModpackInspectRequest = z.infer<
  typeof ModpackInspectRequestSchema
>;

export const ModpackExportRequestSchema = z
  .object({
    destinationPath: z.string().min(1)
  })
  .strict();
export type ModpackExportRequest = z.infer<
  typeof ModpackExportRequestSchema
>;

export const ModpackImportRequestSchema = z
  .object({
    modpackPath: z.string().min(1)
  })
  .strict();
export type ModpackImportRequest = z.infer<
  typeof ModpackImportRequestSchema
>;

export const ModpackCompareRequestSchema = z
  .object({
    modpackPath: z.string().min(1)
  })
  .strict();
export type ModpackCompareRequest = z.infer<
  typeof ModpackCompareRequestSchema
>;

export const ModpackInspectResultSchema = z.object({
  status: z.enum(["ok", "invalid"]),
  modpackPath: z.string(),
  pack: ModpackPackManifestSchema.nullable(),
  loadOrder: ModpackLoadOrderSchema.nullable(),
  summary: ModpackSummarySchema.nullable(),
  packages: z.array(ModpackPackageInspectionSchema),
  problems: z.array(ModProblemSchema)
});
export type ModpackInspectResult = z.infer<
  typeof ModpackInspectResultSchema
>;

export const ModpackExportResultSchema = z.object({
  status: z.enum(["exported", "blocked", "failed"]),
  modpackPath: z.string().nullable(),
  packageCount: z.number().int().nonnegative(),
  validation: LoadOrderValidationSchema.nullable(),
  problems: z.array(ModProblemSchema)
});
export type ModpackExportResult = z.infer<
  typeof ModpackExportResultSchema
>;

export const ModpackImportResultSchema = z.object({
  status: z.enum(["imported", "blocked", "failed"]),
  inspect: ModpackInspectResultSchema,
  profile: ProfileSchema.nullable(),
  validation: LoadOrderValidationSchema.nullable(),
  installedPackageCount: z.number().int().nonnegative(),
  reusedPackageCount: z.number().int().nonnegative(),
  problems: z.array(ModProblemSchema)
});
export type ModpackImportResult = z.infer<
  typeof ModpackImportResultSchema
>;

export const ModpackCompareStatusSchema = z.enum([
  "MATCH",
  "MISSING",
  "EXTRA",
  "VERSION MISMATCH",
  "HASH MISMATCH",
  "ORDER MISMATCH"
]);
export type ModpackCompareStatus = z.infer<
  typeof ModpackCompareStatusSchema
>;

export const ModpackComparisonItemSchema = z.object({
  id: z.string(),
  status: ModpackCompareStatusSchema,
  expectedVersion: z.string().nullable(),
  actualVersion: z.string().nullable(),
  expectedSha256: z.string().nullable(),
  actualSha256: z.string().nullable(),
  expectedEnabled: z.boolean().nullable(),
  actualEnabled: z.boolean().nullable(),
  enabledMatches: z.boolean().nullable()
});
export type ModpackComparisonItem = z.infer<
  typeof ModpackComparisonItemSchema
>;

export const ModpackCompareResultSchema = z.object({
  status: z.enum(["MATCH", "DIFFERENT", "FAILED"]),
  modpackPath: z.string(),
  profileName: z.string(),
  orderStatus: ModpackCompareStatusSchema,
  items: z.array(ModpackComparisonItemSchema),
  copyableReport: z.string(),
  problems: z.array(ModProblemSchema)
});
export type ModpackCompareResult = z.infer<
  typeof ModpackCompareResultSchema
>;

export const ModpackHistoryEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["import", "export"]),
  status: z.string(),
  fileName: z.string(),
  profileId: z.string().nullable().optional(),
  profileName: z.string(),
  packageCount: z.number().int().nonnegative(),
  trackedPackages: z.array(ModReferenceSchema).default([]),
  missingPackages: z.array(ModReferenceSchema).default([]),
  acceptedMissingAt: z.string().nullable().optional(),
  occurredAt: z.string()
});
export type ModpackHistoryEntry = z.infer<
  typeof ModpackHistoryEntrySchema
>;

export const ModpackHistorySnapshotSchema = z.object({
  entries: z.array(ModpackHistoryEntrySchema)
});
export type ModpackHistorySnapshot = z.infer<
  typeof ModpackHistorySnapshotSchema
>;

export const AcceptMissingModpackHistoryResultSchema = z.object({
  status: z.enum(["ok", "failed"]),
  entriesUpdated: z.number().int().nonnegative(),
  removedPackageCount: z.number().int().nonnegative(),
  history: ModpackHistorySnapshotSchema,
  problems: z.array(ModProblemSchema)
});
export type AcceptMissingModpackHistoryResult = z.infer<
  typeof AcceptMissingModpackHistoryResultSchema
>;

export const CreateProfileFromStateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    selectedMods: z.record(z.string(), ProfileModSelectionSchema),
    orderedModIds: z.array(z.string().min(1)),
    preferredLaunchMode: LaunchModeSchema
  })
  .strict();
export type CreateProfileFromStateRequest = z.infer<
  typeof CreateProfileFromStateRequestSchema
>;

export const DeploymentStateSchema = z.enum([
  "vanillaReady",
  "moddedReady",
  "deploymentRequired",
  "deploymentError",
  "runtimeUnvalidated",
  "runtimeIncompatible",
  "notDeployed",
  "current",
  "stale",
  "failed",
  "unknown"
]);
export type DeploymentState = z.infer<typeof DeploymentStateSchema>;

export const RuntimeStatusSchema = z.enum([
  "missing",
  "configured",
  "validated",
  "invalid",
  "unvalidated",
  "incompatible"
]);
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const RuntimeSourceSchema = z.enum(["bundled", "user"]);
export type RuntimeSource = z.infer<typeof RuntimeSourceSchema>;

export const RuntimeReleaseValidationSchema = z.enum([
  "UNVALIDATED",
  "VALIDATED",
  "INCOMPATIBLE"
]);
export type RuntimeReleaseValidation = z.infer<
  typeof RuntimeReleaseValidationSchema
>;

export const Ue4ssRuntimeValidationRecordSchema = z
  .object({
    status: z.enum(["VALIDATED", "INCOMPATIBLE"]),
    validatedAt: z.string(),
    steamBuildId: z.string().min(1).nullable(),
    fingerprintSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable(),
    evidencePath: z.string().min(1),
    markerModId: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    details: z.string().min(1).optional()
  })
  .strict()
  .superRefine((record, context) => {
    if (!record.steamBuildId && !record.fingerprintSha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steamBuildId"],
        message:
          "UE4SS runtime validation evidence must include a Steam build ID or game fingerprint."
      });
    }
  });
export type Ue4ssRuntimeValidationRecord = z.infer<
  typeof Ue4ssRuntimeValidationRecordSchema
>;

export const Ue4ssRuntimeInstallSchema = z.object({
  version: z.string(),
  installPath: z.string(),
  importedAt: z.string(),
  sourceSha256: z.string(),
  source: RuntimeSourceSchema.optional(),
  releaseValidation: RuntimeReleaseValidationSchema,
  validation: Ue4ssRuntimeValidationRecordSchema.optional()
});
export type Ue4ssRuntimeInstall = z.infer<
  typeof Ue4ssRuntimeInstallSchema
>;

export const RuntimeSnapshotSchema = z.object({
  ue4ss: Ue4ssRuntimeInstallSchema.nullable(),
  status: RuntimeStatusSchema,
  problems: z.array(ModProblemSchema)
});
export type RuntimeSnapshot = z.infer<typeof RuntimeSnapshotSchema>;

export const GameFingerprintStatusSchema = z.enum([
  "CURRENT_VALIDATED_BUILD",
  "NEW_CHANGED_BUILD",
  "UNKNOWN_BUILD"
]);
export type GameFingerprintStatus = z.infer<
  typeof GameFingerprintStatusSchema
>;

export const GameFingerprintModeSchema = z.enum(["full", "quick"]);
export type GameFingerprintMode = z.infer<typeof GameFingerprintModeSchema>;

export const GameFingerprintFileSchema = z.object({
  relativePath: z.string(),
  sha256: z.string(),
  size: z.number().int().nonnegative()
});
export type GameFingerprintFile = z.infer<typeof GameFingerprintFileSchema>;

export const GameFingerprintSchema = z.object({
  fingerprintMode: GameFingerprintModeSchema.default("full"),
  status: GameFingerprintStatusSchema,
  generatedAt: z.string(),
  gameInstallPath: z.string().nullable(),
  executablePath: z.string().nullable(),
  executableSha256: z.string().nullable(),
  steamBuildId: z.string().nullable(),
  appManifestPath: z.string().nullable(),
  appManifestSha256: z.string().nullable(),
  contentFiles: z.array(GameFingerprintFileSchema),
  fingerprintSha256: z.string().nullable(),
  releaseValidation: z.enum(["UNVALIDATED", "VALIDATED"]),
  problems: z.array(ModProblemSchema)
});
export type GameFingerprint = z.infer<typeof GameFingerprintSchema>;

export const ImportUe4ssRuntimeRequestSchema = z
  .object({
    sourcePath: z.string().min(1)
  })
  .strict();
export type ImportUe4ssRuntimeRequest = z.infer<
  typeof ImportUe4ssRuntimeRequestSchema
>;

export const ImportUe4ssRuntimeResultSchema = z.object({
  status: z.enum(["imported", "alreadyInstalled", "failed"]),
  runtime: Ue4ssRuntimeInstallSchema.nullable(),
  problems: z.array(ModProblemSchema)
});
export type ImportUe4ssRuntimeResult = z.infer<
  typeof ImportUe4ssRuntimeResultSchema
>;

export const RecordUe4ssRuntimeValidationRequestSchema = z
  .object({
    status: z.enum(["VALIDATED", "INCOMPATIBLE"]),
    steamBuildId: z.string().min(1).nullable(),
    fingerprintSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable(),
    evidencePath: z.string().min(1),
    markerModId: z.string().min(1),
    details: z.string().min(1).optional()
  })
  .strict()
  .superRefine((request, context) => {
    if (!request.steamBuildId && !request.fingerprintSha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steamBuildId"],
        message:
          "UE4SS runtime validation evidence must include a Steam build ID or game fingerprint."
      });
    }
  });
export type RecordUe4ssRuntimeValidationRequest = z.infer<
  typeof RecordUe4ssRuntimeValidationRequestSchema
>;

export const RecordUe4ssRuntimeValidationResultSchema = z.object({
  status: z.enum(["recorded", "blocked", "failed"]),
  runtime: Ue4ssRuntimeInstallSchema.nullable(),
  problems: z.array(ModProblemSchema)
});
export type RecordUe4ssRuntimeValidationResult = z.infer<
  typeof RecordUe4ssRuntimeValidationResultSchema
>;

export const ValidatePackagedRuntimeResultSchema = z.object({
  status: z.enum([
    "validated",
    "incompatible",
    "blocked",
    "failed",
    "cancelled"
  ]),
  evidencePath: z.string().min(1).nullable(),
  recording: RecordUe4ssRuntimeValidationResultSchema.nullable(),
  problems: z.array(ModProblemSchema)
});
export type ValidatePackagedRuntimeResult = z.infer<
  typeof ValidatePackagedRuntimeResultSchema
>;

export const DeploymentFileRecordSchema = z.object({
  relativePath: z.string(),
  absolutePath: z.string(),
  sha256: z.string().nullable(),
  action: z.enum(["created", "modified"])
});
export type DeploymentFileRecord = z.infer<
  typeof DeploymentFileRecordSchema
>;

export const DeploymentBackupRecordSchema = z.object({
  relativePath: z.string(),
  originalPath: z.string(),
  backupPath: z.string(),
  originalSha256: z.string(),
  sha256: z.string()
});
export type DeploymentBackupRecord = z.infer<
  typeof DeploymentBackupRecordSchema
>;

export const DeploymentDirectoryRecordSchema = z.object({
  relativePath: z.string(),
  absolutePath: z.string()
});
export type DeploymentDirectoryRecord = z.infer<
  typeof DeploymentDirectoryRecordSchema
>;

export const RuntimeGeneratedFileRecordSchema = z.object({
  relativePath: z.string(),
  absolutePath: z.string(),
  preexisting: z.boolean()
});
export type RuntimeGeneratedFileRecord = z.infer<
  typeof RuntimeGeneratedFileRecordSchema
>;

export const DeploymentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  profileId: z.string(),
  adapterId: z.string(),
  adapterVersion: z.string(),
  gameInstallPath: z.string(),
  gameFingerprint: z.object({
    executablePath: z.string().nullable(),
    executableSha256: z.string().nullable(),
    releaseValidation: z.enum(["UNVALIDATED", "VALIDATED"])
  }).and(GameFingerprintSchema.partial()),
  runtimeConfiguration: z.record(z.string(), z.unknown()),
  filesCreated: z.array(DeploymentFileRecordSchema),
  filesModified: z.array(DeploymentFileRecordSchema),
  backups: z.array(DeploymentBackupRecordSchema),
  directoriesCreated: z.array(DeploymentDirectoryRecordSchema).default([]),
  runtimeGeneratedFiles: z.array(RuntimeGeneratedFileRecordSchema).default([]),
  sourcePackages: z.array(ModpackPackageRecordSchema),
  deployedAt: z.string(),
  lastVerifiedState: z.enum(["applied", "rolledBack", "unknown"])
});
export type DeploymentManifest = z.infer<typeof DeploymentManifestSchema>;

export const DeploymentSnapshotSchema = z.object({
  state: DeploymentStateSchema,
  activeManifest: DeploymentManifestSchema.nullable(),
  runtime: RuntimeSnapshotSchema,
  problems: z.array(ModProblemSchema)
});
export type DeploymentSnapshot = z.infer<typeof DeploymentSnapshotSchema>;

export const DeploymentOperationResultSchema = z.object({
  status: z.enum(["ok", "blocked", "failed", "rolledBack"]),
  state: DeploymentStateSchema,
  manifest: DeploymentManifestSchema.nullable(),
  problems: z.array(ModProblemSchema)
});
export type DeploymentOperationResult = z.infer<
  typeof DeploymentOperationResultSchema
>;

export const BackupRestoreResultSchema = z.object({
  status: z.enum(["ok", "blocked", "failed"]),
  restoredFiles: z.array(z.string()),
  removedFiles: z.array(z.string()),
  problems: z.array(ModProblemSchema)
});
export type BackupRestoreResult = z.infer<typeof BackupRestoreResultSchema>;

export const ActiveProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string()
});
export type ActiveProfileSummary = z.infer<typeof ActiveProfileSummarySchema>;

export const ConflictSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  severity: z.enum(["none", "warning", "error"])
});
export type ConflictSummary = z.infer<typeof ConflictSummarySchema>;

export const PlaySnapshotSchema = z.object({
  activeProfile: ActiveProfileSummarySchema,
  gameState: GameStateSchema,
  launchMode: LaunchModeSchema,
  enabledMods: z.number().int().nonnegative(),
  profileValidity: ProfileValiditySchema,
  deploymentState: DeploymentStateSchema,
  runtime: RuntimeSnapshotSchema,
  conflicts: ConflictSummarySchema,
  discovery: GameDiscoverySchema,
  process: GameProcessSnapshotSchema,
  lastCommand: LaunchCommandResultSchema.nullable()
});
export type PlaySnapshot = z.infer<typeof PlaySnapshotSchema>;

export const AppStorageDirectoriesSchema = z.object({
  libraryMods: z.string(),
  profiles: z.string(),
  staging: z.string(),
  runtime: z.string(),
  backups: z.string(),
  logs: z.string()
});
export type AppStorageDirectories = z.infer<typeof AppStorageDirectoriesSchema>;

export const AppStorageLayoutSchema = z.object({
  root: z.string(),
  directories: AppStorageDirectoriesSchema
});
export type AppStorageLayout = z.infer<typeof AppStorageLayoutSchema>;

export const ServiceStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ready", "stubbed", "planned", "validated", "blocked"]),
  detail: z.string()
});
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const ManagerOwnedFileSchema = z.object({
  relativePath: z.string(),
  action: z.enum(["created", "modified"]),
  sha256: z.string().nullable(),
  exists: z.boolean()
});
export type ManagerOwnedFile = z.infer<typeof ManagerOwnedFileSchema>;

export const DiagnosticReportSchema = z.object({
  generatedAt: z.string(),
  text: z.string()
});
export type DiagnosticReport = z.infer<typeof DiagnosticReportSchema>;

export const RendererErrorSourceSchema = z.enum([
  "reactErrorBoundary",
  "windowError",
  "unhandledRejection"
]);
export type RendererErrorSource = z.infer<typeof RendererErrorSourceSchema>;

export const RendererErrorReportRequestSchema = z
  .object({
    source: RendererErrorSourceSchema,
    message: z.string().min(1).max(500),
    errorName: z.string().min(1).max(120).optional(),
    stack: z.string().max(4000).optional(),
    componentStack: z.string().max(4000).optional()
  })
  .strict();
export type RendererErrorReportRequest = z.infer<
  typeof RendererErrorReportRequestSchema
>;

export const RendererErrorReportResultSchema = z.object({
  status: z.literal("logged")
});
export type RendererErrorReportResult = z.infer<
  typeof RendererErrorReportResultSchema
>;

export const LogOpenResultSchema = z.object({
  status: z.enum(["ok", "failed"]),
  path: z.string().nullable(),
  problems: z.array(ModProblemSchema)
});
export type LogOpenResult = z.infer<typeof LogOpenResultSchema>;

export const DiagnosticLogsSummarySchema = z.object({
  logDirectory: z.string(),
  crashDumpsDirectory: z.string(),
  crashDumpCount: z.number().int().nonnegative(),
  latestErrors: z.array(z.string())
});
export type DiagnosticLogsSummary = z.infer<
  typeof DiagnosticLogsSummarySchema
>;

export const CreatorDiagnosticsSummarySchema = z.object({
  packagesWithMetadata: z.number().int().nonnegative(),
  packagesMissingMetadata: z.number().int().nonnegative(),
  affectedAssets: z.number().int().nonnegative(),
  replacements: z.number().int().nonnegative(),
  packagePayloadEntries: z.number().int().nonnegative(),
  checksumRecords: z.number().int().nonnegative(),
  activeConflictTargets: z.number().int().nonnegative(),
  activeWinners: z.number().int().nonnegative(),
  loadOrderEffectProblems: z.number().int().nonnegative().default(0),
  staleProfileReferences: z.number().int().nonnegative().default(0)
});
export type CreatorDiagnosticsSummary = z.infer<
  typeof CreatorDiagnosticsSummarySchema
>;

export const DiagnosticsSummarySchema = z.object({
  generatedAt: z.string(),
  storage: AppStorageLayoutSchema,
  discovery: GameDiscoverySchema,
  process: GameProcessSnapshotSchema,
  gameFingerprint: GameFingerprintSchema,
  runtime: RuntimeSnapshotSchema,
  activeProfile: ActiveProfileSummarySchema,
  profileValidity: ProfileValiditySchema,
  enabledModCount: z.number().int().nonnegative(),
  dependencyProblems: z.array(LoadOrderProblemSchema),
  conflictProblems: z.array(LoadOrderProblemSchema),
  deployment: DeploymentSnapshotSchema,
  managerOwnedFiles: z.array(ManagerOwnedFileSchema),
  lastLaunchMode: LaunchModeSchema,
  lastGameExit: z.string().nullable(),
  lastDeploymentProblem: ModProblemSchema.nullable(),
  logs: DiagnosticLogsSummarySchema,
  modLibrary: ModLibrarySnapshotSchema,
  creatorAssets: CreatorDiagnosticsSummarySchema.default({
    packagesWithMetadata: 0,
    packagesMissingMetadata: 0,
    affectedAssets: 0,
    replacements: 0,
    packagePayloadEntries: 0,
    checksumRecords: 0,
    activeConflictTargets: 0,
    activeWinners: 0,
    loadOrderEffectProblems: 0,
    staleProfileReferences: 0
  }),
  services: z.array(ServiceStatusSchema),
  releaseValidation: z.object({
    state: z.enum(["KNOWN", "ASSUMED", "UNVALIDATED", "VALIDATED"]),
    detail: z.string()
  })
});
export type DiagnosticsSummary = z.infer<typeof DiagnosticsSummarySchema>;
