import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

import {
  CreatorAssetConflictGraphRequestSchema,
  CreatorAssetConflictGraphSchema,
  CreatorAssetDetailRequestSchema,
  CreatorAssetDetailSchema,
  CreatorAssetIndexEntrySchema,
  CreatorModelPreviewRequestSchema,
  CreatorModelPreviewResultSchema,
  CreatorAssetReportRequestSchema,
  CreatorAssetReportResultSchema,
  CreatorAssetRegistrySnapshotSchema,
  CreatorAssetSearchRequestSchema,
  CreatorAssetSearchResultSchema,
  CreatorAssetTreeNodeSchema,
  CreatorAssetTreeRequestSchema,
  CreatorAssetTreeResultSchema,
  ClawedModManifestV1Schema,
  CreatorExportPlanRequestSchema,
  CreatorExportPlanResultSchema,
  CreatorMeshExportRequestSchema,
  CreatorMeshExportResultSchema,
  CreatorMeshPackageExportItemSchema,
  CreatorMeshPackageExportRequestSchema,
  CreatorMeshPackageExportResultSchema,
  CreatorPreviewLookupRequestSchema,
  CreatorPreviewLookupResultSchema,
  type CreatorAssetChecksum,
  type CreatorAssetConflict,
  type CreatorAssetConflictGraphRequest,
  type CreatorAssetDependency,
  type CreatorAssetDetail,
  type CreatorAssetIndexEntry,
  type CreatorAssetLoadOrderEffect,
  type CreatorAssetReportOutput,
  type CreatorAssetRegistryArtifact,
  type CreatorAssetRegistryMapSummary,
  type CreatorAssetRegistrySnapshot,
  type CreatorAssetSearchRequest,
  type CreatorAssetTreeNode,
  type CreatorAssetTreeRequest,
  type CreatorExportEligibility,
  type CreatorExportOutput,
  type CreatorExportPlanItem,
  type CreatorMeshExportFormat,
  type CreatorMeshPackageExportItem,
  type CreatorMeshPackageExportRequest,
  type CreatorMeshExportRequest,
  type CreatorMeshExportResult,
  type CreatorModelPreviewFormat,
  type CreatorModelPreviewMetadata,
  type CreatorModelPreviewRequest,
  type CreatorModelPreviewResult,
  type CreatorPreviewAsset,
  type DeploymentManifest,
  type InstalledModManifestRecord,
  type LoadOrderProblem,
  type LoadOrderValidation,
  type ModProblem,
  type Profile,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  AssetRegistryServiceContract,
  DeploymentServiceContract,
  LoadOrderServiceContract,
  ModLibraryServiceContract,
  ProfileServiceContract
} from "../../shared/contracts/services";
import type { LifecycleLogger } from "./lifecycleLogger";
import { modProblem } from "./packageProblems";
import { isPathInside } from "./packagePaths";

const MAP_FILES = [
  "clawed-all-files-and-container-entries.csv",
  "clawed-physical-files.csv",
  "clawed-shipping-manifest-entries.csv",
  "clawed-container-entries-annotated.csv",
  "clawed-map-summary.json"
] as const;
const MAX_MODEL_PREVIEW_BYTES = 15 * 1024 * 1024;
const MODEL_PREVIEW_FORMATS = new Set(["gltf", "glb", "obj"]);
const MESH_EXPORT_FORMATS = new Set(["obj", "gltf", "glb"]);
const BASE_GAME_PREVIEW_INDEX = "index.json";
const BASE_GAME_MESH_ASSET_CLASSES = new Set([
  "StaticMesh",
  "SkeletalMesh",
  "Skeleton"
]);

interface AssetRegistryOptions {
  mapRoot?: string;
  maxBaseEntries?: number;
  baseGamePreviewRoot?: string;
  baseGameMeshDecoder?: BaseGameMeshDecoder;
  gameInstallPath?: string;
  protectedGameRoots?: string[];
  logger?: LifecycleLogger;
}

interface BaseMapIndex {
  entries: CreatorAssetIndexEntry[];
  entriesById: Map<string, CreatorAssetIndexEntry>;
  targetKeys: Set<string>;
  summary: CreatorAssetRegistryMapSummary;
  topTags: Array<{ tag: string; count: number }>;
  problems: ModProblem[];
}

interface BaseMapSummaryIndex {
  summary: CreatorAssetRegistryMapSummary;
  topTags: Array<{ tag: string; count: number }>;
  problems: ModProblem[];
}

interface RuntimeAssetIndex {
  generatedAt: string;
  entries: CreatorAssetIndexEntry[];
  entriesById: Map<string, CreatorAssetIndexEntry>;
  conflicts: CreatorAssetConflict[];
  entriesByTargetKey: Map<string, CreatorAssetIndexEntry[]>;
  checksums: CreatorAssetChecksum[];
  checksumsByPackage: Map<string, CreatorAssetChecksum[]>;
  dependenciesByAssetId: Map<string, CreatorAssetDependency[]>;
  previewsByAssetId: Map<string, CreatorPreviewAsset[]>;
  eligibilityByAssetId: Map<string, CreatorExportEligibility>;
  recordsByPackage: Map<string, InstalledModManifestRecord>;
  loadOrderValidation: LoadOrderValidation;
  snapshot: CreatorAssetRegistrySnapshot;
}

interface CsvMapRow {
  [key: string]: string;
  source: string;
  path: string;
  objectPath: string;
  containerName: string;
  extension: string;
  sizeBytes: string;
  hashOrSha256: string;
  tags: string;
  modUses: string;
}

interface MapSummaryJson {
  generatedAtUtc?: string;
  installRoot?: string;
  gameInstallPath?: string;
  steamBuildId?: string;
  physicalFileCount?: number;
  shippingManifestEntryCount?: number;
  containerEntryCount?: number;
  namedContainerEntryCount?: number;
  tagCounts?: Record<string, number>;
}

export interface BaseGameMeshDecodeRequest {
  asset: CreatorAssetIndexEntry;
  detail: CreatorAssetDetail;
  cookedPayload: BaseGameCookedPayload;
  format: CreatorMeshExportFormat;
  purpose: "preview" | "export";
}

export interface BaseGameCookedPayload {
  objectPath: string | null;
  packagePath: string | null;
  relativePath: string | null;
  containerName: string | null;
  extension: string | null;
  sizeBytes: number | null;
  sha256: string | null;
}

export interface BaseGameMeshDecodeResult {
  status: "ready" | "unsupported" | "dependency-missing" | "decode-error";
  format?: CreatorMeshExportFormat;
  data?: Buffer;
  fileName?: string;
  metadata?: Partial<CreatorModelPreviewMetadata>;
  problems?: ModProblem[];
}

export interface BaseGameMeshProbeRequest {
  asset: CreatorAssetIndexEntry;
  cookedPayload: BaseGameCookedPayload;
  purpose: "preview" | "export";
}

export interface BaseGameMeshProbeResult {
  status: "ready" | "unsupported" | "dependency-missing" | "decode-error";
  assetClass?: string | null;
  metadata?: Partial<CreatorModelPreviewMetadata>;
  problems?: ModProblem[];
}

export interface BaseGameMeshDecoder {
  isAvailable?(): boolean | Promise<boolean>;
  supportsFormat?(
    format: CreatorMeshExportFormat,
    asset: CreatorAssetIndexEntry
  ): boolean;
  probe?(request: BaseGameMeshProbeRequest): Promise<BaseGameMeshProbeResult>;
  decode(request: BaseGameMeshDecodeRequest): Promise<BaseGameMeshDecodeResult>;
}

interface CachedBaseGamePreviewEntry {
  assetId?: string;
  objectPath?: string;
  packagePath?: string;
  virtualPath?: string;
  label?: string;
  modelPath: string;
  format?: CreatorModelPreviewFormat;
  skeleton?: string | null;
  physicsAsset?: string | null;
  materialSlots?: CreatorPreviewAsset["materialSlots"];
  lods?: CreatorPreviewAsset["lods"];
  dependencyPaths?: string[];
  exportable?: boolean;
}

interface BaseGameModelPreviewOptions {
  baseGamePreviewRoot: string | null;
  baseGameMeshDecoder: BaseGameMeshDecoder | null;
  resolveBaseGameMeshProbe?: BaseGameMeshProbeResolver;
}

type BaseGameMeshProbeResolver = (
  asset: CreatorAssetIndexEntry,
  purpose: BaseGameMeshProbeRequest["purpose"]
) => Promise<BaseGameMeshProbeResult | null>;

export class LocalAssetRegistryService implements AssetRegistryServiceContract {
  private baseMapIndex: Promise<BaseMapIndex> | null = null;
  private baseMapSummaryIndex: Promise<BaseMapSummaryIndex> | null = null;
  private readonly baseGameMeshProbeCache = new Map<
    string,
    Promise<BaseGameMeshProbeResult>
  >();

  constructor(
    private readonly modLibraryService: ModLibraryServiceContract,
    private readonly profileService: ProfileServiceContract,
    private readonly loadOrderService: LoadOrderServiceContract,
    private readonly deploymentService: DeploymentServiceContract,
    private readonly options: AssetRegistryOptions = {}
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "assetRegistryService",
      label: "Asset Registry Service",
      status: "ready",
      detail:
        "Indexes Clawed map artifacts, package creator metadata, payloads, checksums, and active conflict winners."
    };
  }

  async getSnapshot() {
    return this.buildSnapshot();
  }

  async searchAssets(request: unknown) {
    const parsed = CreatorAssetSearchRequestSchema.parse(request);
    const index = await this.buildIndex();
    const matches = sortCreatorAssetIndexEntries(
      filterCreatorAssetIndexEntries(index.entries, parsed),
      parsed
    );
    const entries = matches.slice(0, parsed.limit);

    return CreatorAssetSearchResultSchema.parse({
      generatedAt: index.generatedAt,
      totalMatches: matches.length,
      truncated: matches.length > entries.length,
      entries,
      problems: index.snapshot.problems
    });
  }

  async getAssetTree(request: unknown) {
    const parsed = CreatorAssetTreeRequestSchema.parse(request);
    if (!parsed.parentId && !parsed.query.trim() && !parsed.activeOnly) {
      const snapshot = await this.buildSnapshot();
      return CreatorAssetTreeResultSchema.parse({
        generatedAt: snapshot.generatedAt,
        parentId: null,
        nodes: rootTreeNodes(snapshot, parsed),
        totalChildren: rootTreeNodes(snapshot, parsed).length,
        truncated: false,
        problems: snapshot.problems
      });
    }

    const index = await this.buildIndex();
    return buildAssetTreeResult(parsed, index);
  }

  async getAssetDetail(request: unknown) {
    const { assetId } = CreatorAssetDetailRequestSchema.parse(request);
    const index = await this.buildIndex();
    return detailForAsset(assetId, index);
  }

  async getConflictGraph(request: unknown) {
    const parsed = CreatorAssetConflictGraphRequestSchema.parse(request);
    const index = await this.buildIndex();
    const selectedTargetKey = targetKeyForGraphRequest(parsed, index);
    const sourceConflicts = selectedTargetKey
      ? [
          index.conflicts.find(
            (conflict) => conflict.targetKey === selectedTargetKey
          ) ??
            emptyConflictForTarget(
              selectedTargetKey,
              index.entriesByTargetKey.get(selectedTargetKey) ?? [],
              parsed
            )
        ]
      : index.conflicts;
    const conflicts = sourceConflicts
      .map((conflict) => ({
        ...conflict,
        entries: parsed.includeInactive
          ? conflict.entries
          : conflict.entries.filter((entry) => entry.enabled)
      }))
      .filter((conflict) => selectedTargetKey || conflict.entries.length > 0);

    return CreatorAssetConflictGraphSchema.parse({
      generatedAt: index.generatedAt,
      activeProfile: index.snapshot.activeProfile,
      conflicts,
      totals: {
        targets: index.conflicts.length,
        activeTargets: index.conflicts.filter((conflict) =>
          conflict.entries.some((entry) => entry.enabled)
        ).length,
        winners: index.conflicts.filter((conflict) => conflict.winnerPackageId)
          .length
      },
      problems: index.snapshot.problems
    });
  }

  async getPreview(request: unknown) {
    const { assetId } = CreatorPreviewLookupRequestSchema.parse(request);
    const index = await this.buildIndex();
    const asset = index.entriesById.get(assetId);

    if (!asset) {
      return CreatorPreviewLookupResultSchema.parse({
        status: "notFound",
        previews: [],
        problems: [
          modProblem(
            "warning",
            "CREATOR_ASSET_NOT_FOUND",
            "That creator asset index entry could not be found."
          )
        ]
      });
    }

    const previews = index.previewsByAssetId.get(assetId) ?? [];
    if (previews.length > 0) {
      return CreatorPreviewLookupResultSchema.parse({
        status: "available",
        previews,
        problems: []
      });
    }

    return CreatorPreviewLookupResultSchema.parse({
      status: "notFound",
      previews: [],
      problems:
        asset.source === "baseGameMap"
          ? [
              modProblem(
                "info",
                "BASE_GAME_PREVIEW_NOT_CACHED",
                "No cached base-game preview is indexed for this asset. CMM can still attempt direct decode for supported model assets."
              )
            ]
        : []
    });
  }

  async getModelPreview(request: unknown) {
    const parsed = CreatorModelPreviewRequestSchema.parse(request);
    const index = await this.buildIndex();
    const result = await readModelPreview(parsed, index, {
      baseGamePreviewRoot: this.getBaseGamePreviewRoot(),
      baseGameMeshDecoder: this.options.baseGameMeshDecoder ?? null,
      resolveBaseGameMeshProbe: this.probeBaseGameMeshAsset.bind(this)
    });
    await this.logCreatorResult("creator_model_preview", result.status, {
      assetId: parsed.assetId,
      assetClass: result.asset?.assetClass ?? null,
      source: result.model?.source ?? null
    }, result.problems);
    return result;
  }

  async getExportPlan(request: unknown) {
    const parsed = CreatorExportPlanRequestSchema.parse(request);
    const index = await this.buildIndex();
    const decoder = this.options.baseGameMeshDecoder ?? null;
    const decoderAvailable = await isDecoderAvailable(decoder);
    const items = (
      await Promise.all(
        parsed.assetIds.map(async (assetId) => {
          const asset = index.entriesById.get(assetId);
          if (!asset) {
            return null;
          }

          const eligibility =
            index.eligibilityByAssetId.get(assetId) ?? defaultEligibility(asset);
          const meshBlockReason = isMeshExportOutput(parsed.output)
            ? await meshExportPlanBlockReason(
                asset,
                parsed.output,
                decoderAvailable,
                this.getBaseGamePreviewRoot(),
                decoder,
                this.probeBaseGameMeshAsset.bind(this)
              )
            : null;
          const allowed =
            !meshBlockReason &&
            (isMeshExportOutput(parsed.output) ||
              isOutputAllowed(parsed.output, eligibility));
          return {
            asset,
            eligibility,
            status: allowed
              ? ("allowed" as const)
              : eligibility.state === "unknown"
                ? ("unknown" as const)
                : ("blocked" as const),
            reason: allowed
              ? null
              : meshBlockReason ??
                eligibility.reason ??
                "The selected output is not allowed for this asset."
          };
        })
      )
    ).filter((item): item is CreatorExportPlanItem => Boolean(item));
    const blocked = items.filter((item) => item.status !== "allowed");

    return CreatorExportPlanResultSchema.parse({
      status:
        items.length === 0 ? "empty" : blocked.length > 0 ? "blocked" : "ready",
      output: parsed.output,
      items,
      problems: [
        ...parsed.assetIds
          .filter((assetId) => !index.entriesById.has(assetId))
          .map((assetId) =>
            modProblem(
              "warning",
              "CREATOR_ASSET_NOT_FOUND",
              "A selected creator asset index entry could not be found.",
              assetId
            )
          ),
        ...blocked.map((item) =>
          modProblem(
            "warning",
            "CREATOR_EXPORT_BLOCKED",
            "CMM blocked this creator export plan for at least one selected asset.",
            `${item.asset.id}: ${item.reason ?? "not allowed"}`
          )
        )
      ]
    });
  }

  async exportMesh(request: unknown): Promise<CreatorMeshExportResult> {
    const parsed = CreatorMeshExportRequestSchema.parse(request);
    const index = await this.buildIndex();
    const result = await exportCreatorMesh(parsed, index, {
      baseGamePreviewRoot: this.getBaseGamePreviewRoot(),
      baseGameMeshDecoder: this.options.baseGameMeshDecoder ?? null,
      resolveBaseGameMeshProbe: this.probeBaseGameMeshAsset.bind(this),
      protectedGameRoots: await this.getProtectedGameRoots()
    });
    await this.logCreatorResult("creator_mesh_export", result.status, {
      assetId: parsed.assetId,
      format: parsed.format,
      destinationPath: result.destinationPath
    }, result.problems);
    return result;
  }

  async exportMeshPackage(request: unknown) {
    const parsed = CreatorMeshPackageExportRequestSchema.parse(request);
    const index = await this.buildIndex();
    const result = await exportCreatorMeshPackage(parsed, index, {
      baseGamePreviewRoot: this.getBaseGamePreviewRoot(),
      baseGameMeshDecoder: this.options.baseGameMeshDecoder ?? null,
      resolveBaseGameMeshProbe: this.probeBaseGameMeshAsset.bind(this),
      protectedGameRoots: await this.getProtectedGameRoots()
    });
    await this.logCreatorResult("creator_mesh_package_export", result.status, {
      itemCount: result.itemCount,
      exportedCount: result.exportedCount,
      destinationPath: result.destinationPath
    }, result.problems);
    return result;
  }

  private async probeBaseGameMeshAsset(
    asset: CreatorAssetIndexEntry,
    purpose: BaseGameMeshProbeRequest["purpose"]
  ): Promise<BaseGameMeshProbeResult | null> {
    const decoder = this.options.baseGameMeshDecoder;
    if (
      !decoder?.probe ||
      !shouldProbeBaseGameMeshAsset(asset) ||
      !(await isDecoderAvailable(decoder))
    ) {
      return null;
    }

    const key = baseGameMeshProbeKey(asset, purpose);
    let probe = this.baseGameMeshProbeCache.get(key);
    if (!probe) {
      probe = decoder
        .probe({
          asset,
          cookedPayload: baseGameCookedPayloadForAsset(asset),
          purpose
        })
        .catch((error): BaseGameMeshProbeResult => ({
          status: "decode-error",
          problems: [
            modProblem(
              "warning",
              "BASE_GAME_MESH_PROBE_FAILED",
              "The base-game mesh decoder could not classify this cooked Unreal asset.",
              error instanceof Error ? error.message : String(error)
            )
          ]
        }));
      this.baseGameMeshProbeCache.set(key, probe);
    }

    return probe;
  }

  private async logCreatorResult(
    action: string,
    status: string,
    details: Record<string, string | number | boolean | null>,
    problems: ModProblem[]
  ): Promise<void> {
    if (!this.options.logger || (isCreatorOkStatus(status) && !problems.length)) {
      return;
    }
    const firstProblem = problems[0] ?? null;
    await this.options.logger
      .log({
        category: "assetRegistryService",
        action,
        result: creatorLogResult(status),
        errorCode: firstProblem?.code,
        message: firstProblem?.message ?? status,
        details: {
          ...details,
          status,
          problemCount: problems.length,
          technicalDetail: firstProblem?.technicalDetail ?? null
        }
      })
      .catch(() => undefined);
  }

  async getReport(request: unknown) {
    const parsed = CreatorAssetReportRequestSchema.parse(request);
    const index = await this.buildIndex();
    const details = parsed.assetIds.map((assetId) => detailForAsset(assetId, index));
    const foundDetails = details.filter((detail) => detail.asset);
    const problems = details.flatMap((detail) => detail.problems);

    if (!foundDetails.length) {
      return CreatorAssetReportResultSchema.parse({
        status: "empty",
        output: parsed.output,
        generatedAt: index.generatedAt,
        fileName: creatorReportFileName(parsed.output, index.generatedAt),
        mimeType: reportMimeType(parsed.output),
        text: "",
        problems
      });
    }

    const blockedProblems = foundDetails.flatMap((detail) => {
      const asset = detail.asset;
      if (!asset) {
        return [];
      }
      const eligibility =
        index.eligibilityByAssetId.get(asset.id) ?? defaultEligibility(asset);
      return isOutputAllowed(parsed.output, eligibility)
        ? []
        : [
            modProblem(
              "warning",
              "CREATOR_REPORT_EXPORT_BLOCKED",
              "CMM blocked this creator report output for at least one selected asset.",
              `${asset.id}: ${
                eligibility.reason ?? "report output is not allowed"
              }`
            )
          ];
    });
    const allProblems = [...problems, ...blockedProblems];
    const status = blockedProblems.length ? "blocked" : "ready";

    return CreatorAssetReportResultSchema.parse({
      status,
      output: parsed.output,
      generatedAt: index.generatedAt,
      fileName: creatorReportFileName(parsed.output, index.generatedAt),
      mimeType: reportMimeType(parsed.output),
      text: formatCreatorReport(parsed.output, foundDetails, index),
      problems: allProblems
    });
  }

  private async buildSnapshot(): Promise<CreatorAssetRegistrySnapshot> {
    const [baseMap, records, profile, deployment, loadOrderValidation] =
      await Promise.all([
      this.readBaseMapSummaryIndex(),
      this.modLibraryService.listInstalledModManifests(),
      this.profileService.getActiveProfile(),
      this.deploymentService.getSnapshot(),
      this.loadOrderService.validateActiveOrder()
    ]);
    const generatedAt = new Date().toISOString();
    const activeProfile = {
      id: profile.id,
      name: profile.name,
      orderedModIds: loadOrderValidation.orderedModIds,
      enabledModIds: Object.values(profile.selectedMods)
        .filter((selection) => selection.enabled)
        .map((selection) => selection.modId)
    };
    const packageIndex = await this.indexPackages(records, profile);
    const conflicts = buildConflictGraph(
      records,
      profile,
      new Set(),
      loadOrderValidation
    );
    const entries = [
      ...applyConflictStates(packageIndex.entries, conflicts),
      ...deploymentEntries(deployment.activeManifest, generatedAt)
    ].sort(compareEntries);
    const activeConflictTargets = conflicts.filter((conflict) =>
      conflict.entries.some((entry) => entry.enabled)
    ).length;
    const staleProfileReferences = loadOrderValidation.problems.filter(
      (problem) => problem.code === "INVALID_SELECTED_VERSION"
    ).length;

    return CreatorAssetRegistrySnapshotSchema.parse({
      generatedAt,
      map: baseMap.summary,
      activeProfile,
      totals: {
        baseGameEntries: baseEntryCount(baseMap.summary),
        installedPackages: records.length,
        packagePayloadEntries: packageIndex.payloadEntryCount,
        creatorMetadataPackages: records.filter(
          (record) => record.manifest.creatorAssets
        ).length,
        affectedAssets: packageIndex.affectedAssetCount,
        replacements: packageIndex.replacementCount,
        checksumRecords: packageIndex.checksums.length,
        activeConflictTargets,
        activeWinners: conflicts.filter((conflict) => conflict.winnerPackageId)
          .length,
        loadOrderEffectProblems: loadOrderValidation.problems.length,
        staleProfileReferences,
        deploymentFiles:
          (deployment.activeManifest?.filesCreated.length ?? 0) +
          (deployment.activeManifest?.filesModified.length ?? 0)
      },
      topTags: baseMap.topTags,
      recentEntries: entries.slice(0, 12),
      problems: [
        ...baseMap.problems,
        ...deployment.problems,
        ...loadOrderProblemsForReport(loadOrderValidation.problems)
      ]
    });
  }

  private async buildIndex(): Promise<RuntimeAssetIndex> {
    const [baseMap, records, profile, deployment, loadOrderValidation] =
      await Promise.all([
      this.readBaseMapIndex(),
      this.modLibraryService.listInstalledModManifests(),
      this.profileService.getActiveProfile(),
      this.deploymentService.getSnapshot(),
      this.loadOrderService.validateActiveOrder()
    ]);
    const generatedAt = new Date().toISOString();
    const activeProfile = {
      id: profile.id,
      name: profile.name,
      orderedModIds: loadOrderValidation.orderedModIds,
      enabledModIds: Object.values(profile.selectedMods)
        .filter((selection) => selection.enabled)
        .map((selection) => selection.modId)
    };
    const packageIndex = await this.indexPackages(records, profile);
    const conflicts = buildConflictGraph(
      records,
      profile,
      baseMap.targetKeys,
      loadOrderValidation
    );
    const entries = [
      ...applyConflictStates(baseMap.entries, conflicts),
      ...applyConflictStates(packageIndex.entries, conflicts),
      ...deploymentEntries(deployment.activeManifest, generatedAt)
    ].sort(compareEntries);
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const entriesByTargetKey = groupEntriesByTargetKey(entries);
    const activeConflictTargets = conflicts.filter((conflict) =>
      conflict.entries.some((entry) => entry.enabled)
    ).length;
    const staleProfileReferences = loadOrderValidation.problems.filter(
      (problem) => problem.code === "INVALID_SELECTED_VERSION"
    ).length;
    const snapshot = CreatorAssetRegistrySnapshotSchema.parse({
      generatedAt,
      map: baseMap.summary,
      activeProfile,
      totals: {
        baseGameEntries: baseMap.entries.length,
        installedPackages: records.length,
        packagePayloadEntries: packageIndex.payloadEntryCount,
        creatorMetadataPackages: records.filter(
          (record) => record.manifest.creatorAssets
        ).length,
        affectedAssets: packageIndex.affectedAssetCount,
        replacements: packageIndex.replacementCount,
        checksumRecords: packageIndex.checksums.length,
        activeConflictTargets,
        activeWinners: conflicts.filter((conflict) => conflict.winnerPackageId)
          .length,
        loadOrderEffectProblems: loadOrderValidation.problems.length,
        staleProfileReferences,
        deploymentFiles:
          (deployment.activeManifest?.filesCreated.length ?? 0) +
          (deployment.activeManifest?.filesModified.length ?? 0)
      },
      topTags: baseMap.topTags,
      recentEntries: entries.slice(0, 12),
      problems: [
        ...baseMap.problems,
        ...deployment.problems,
        ...loadOrderProblemsForReport(loadOrderValidation.problems)
      ]
    });

    return {
      generatedAt,
      entries,
      entriesById,
      conflicts,
      entriesByTargetKey,
      checksums: packageIndex.checksums,
      checksumsByPackage: groupChecksumsByPackage(packageIndex.checksums),
      dependenciesByAssetId: packageIndex.dependenciesByAssetId,
      previewsByAssetId: packageIndex.previewsByAssetId,
      eligibilityByAssetId: packageIndex.eligibilityByAssetId,
      recordsByPackage: new Map(
        records.map((record) => [
          packageKeyOf(record.manifest.id, record.manifest.version),
          record
        ])
      ),
      loadOrderValidation,
      snapshot
    };
  }

  private async readBaseMapIndex(): Promise<BaseMapIndex> {
    this.baseMapIndex ??= readBaseMapIndex(this.getMapRoot(), this.options);
    return this.baseMapIndex;
  }

  private async readBaseMapSummaryIndex(): Promise<BaseMapSummaryIndex> {
    this.baseMapSummaryIndex ??= readBaseMapSummaryIndex(this.getMapRoot());
    return this.baseMapSummaryIndex;
  }

  private getMapRoot(): string {
    return path.resolve(
      this.options.mapRoot ??
        process.env.CMM_CLAWED_FILE_MAP_DIR ??
        path.join(
          process.cwd(),
          ".codex",
          "clawed-game-file-map",
          "20260814-current"
        )
    );
  }

  private getBaseGamePreviewRoot(): string | null {
    const configured =
      this.options.baseGamePreviewRoot ?? process.env.CMM_BASE_GAME_PREVIEW_DIR;
    if (configured) {
      return path.resolve(configured);
    }

    return path.join(this.getMapRoot(), "base-game-previews");
  }

  private async getProtectedGameRoots(): Promise<string[]> {
    const roots = [
      this.options.gameInstallPath,
      ...(this.options.protectedGameRoots ?? []),
      await readMapInstallRoot(this.getMapRoot())
    ].filter((value): value is string => Boolean(value?.trim()));

    return uniqueStrings(roots.map((root) => path.resolve(root)));
  }

  private async indexPackages(records: InstalledModManifestRecord[], profile: Profile) {
    const entries: CreatorAssetIndexEntry[] = [];
    const checksums: CreatorAssetChecksum[] = [];
    const dependenciesByAssetId = new Map<string, CreatorAssetDependency[]>();
    const previewsByAssetId = new Map<string, CreatorPreviewAsset[]>();
    const eligibilityByAssetId = new Map<string, CreatorExportEligibility>();
    let payloadEntryCount = 0;
    let affectedAssetCount = 0;
    let replacementCount = 0;

    for (const record of records) {
      const identity = packageKeyOf(record.manifest.id, record.manifest.version);
      const selection = profile.selectedMods[record.manifest.id];
      const enabled =
        selection?.version === record.manifest.version && selection.enabled;
      const order = profile.orderedModIds.indexOf(record.manifest.id);
      const activeProfileOrder = order >= 0 ? order + 1 : null;
      const packageChecksums = await readPackageChecksums(record);
      const checksumByPath = new Map(
        packageChecksums
          .filter((checksum) => checksum.path)
          .map((checksum) => [
            normalizeArchivePath(checksum.path ?? ""),
            checksum.sha256
          ])
      );
      checksums.push(...packageChecksums);

      const creator = record.manifest.creatorAssets;
      const packageTags = uniqueStrings(
        creator?.affectedAssets.flatMap((asset) => asset.tags) ?? []
      );
      const packageEntry = CreatorAssetIndexEntrySchema.parse({
        id: `package:${identity}`,
        label: `${record.manifest.name} ${record.manifest.version}`,
        source: "installedPackage",
        ownerLabel: record.manifest.name,
        packageId: record.manifest.id,
        packageVersion: record.manifest.version,
        packageName: record.manifest.name,
        containerName: "package.clawedmod",
        loader: record.manifest.loader,
        activeProfileEnabled: enabled,
        activeProfileOrder,
        assetClass: null,
        packagePath: null,
        objectPath: null,
        virtualPath: packageVirtualPath(
          record.manifest.id,
          record.manifest.version
        ),
        payloadPath: null,
        relativePath: null,
        extension: null,
        tags: packageTags,
        modUses: record.manifest.description || null,
        sizeBytes: null,
        sha256: record.mod.sha256,
        validationState: null,
        deploymentRoute: null,
        exportState: creator?.exportEligibility.state ?? null,
        conflictState: "none"
      });
      entries.push(packageEntry);
      if (creator) {
        eligibilityByAssetId.set(packageEntry.id, creator.exportEligibility);
      }

      if (creator) {
        affectedAssetCount += creator.affectedAssets.length;
        replacementCount += creator.replacements.length;
        for (const affected of creator.affectedAssets) {
          const replacement = creator.replacements.find(
            (candidate) =>
              candidate.targetAssetId === affected.id ||
              candidate.replacementAssetId === affected.id ||
              candidate.targetObjectPath === affected.objectPath ||
              candidate.targetPackagePath === affected.packagePath
          );
          const indexedObjectPath =
            affected.objectPath ??
            (replacement?.replacementAssetId === affected.id
              ? replacement.targetObjectPath ?? null
              : null);
          const indexedPackagePath =
            affected.packagePath ??
            (indexedObjectPath ? packagePathFromObjectPath(indexedObjectPath) : null) ??
            (replacement?.replacementAssetId === affected.id
              ? replacement.targetPackagePath ?? null
              : null);
          const indexedVirtualPath =
            [
              affected.virtualPath,
              replacement?.replacementAssetId === affected.id
                ? replacement.replacementVirtualPath
                : null,
              replacement?.targetAssetId === affected.id
                ? replacement.targetVirtualPath
                : null,
              affected.payloadPath
                ? payloadVirtualPath(
                    record.manifest.id,
                    record.manifest.version,
                    affected.payloadPath
                  )
                : null,
              indexedObjectPath,
              indexedPackagePath
            ].find((value): value is string => Boolean(value)) ?? null;
          const assetId = `asset:${identity}:${affected.id}`;
          const entry = CreatorAssetIndexEntrySchema.parse({
            id: assetId,
            label:
              indexedObjectPath ??
              indexedPackagePath ??
              affected.payloadPath ??
              affected.id,
            source: "installedPackage",
            ownerLabel: record.manifest.name,
            packageId: record.manifest.id,
            packageVersion: record.manifest.version,
            packageName: record.manifest.name,
            containerName: containerNameFromPayload(affected.payloadPath),
            loader: record.manifest.loader,
            activeProfileEnabled: enabled,
            activeProfileOrder,
            assetClass: affected.assetClass,
            packagePath: indexedPackagePath,
            objectPath: indexedObjectPath,
            virtualPath: indexedVirtualPath,
            payloadPath: affected.payloadPath ?? null,
            relativePath: null,
            extension: affected.payloadPath
              ? path.posix.extname(affected.payloadPath)
              : null,
            tags: affected.tags,
            modUses: affected.role,
            sizeBytes: null,
            sha256: affected.payloadPath
              ? checksumByPath.get(normalizeArchivePath(affected.payloadPath)) ??
                null
              : null,
            validationState: replacement?.validationState ?? null,
            deploymentRoute: replacement?.deploymentRoute ?? null,
            exportState: creator.exportEligibility.state,
            conflictState: "none"
          });
          entries.push(entry);
          eligibilityByAssetId.set(assetId, creator.exportEligibility);
          dependenciesByAssetId.set(
            assetId,
            creator.assetDependencies.filter(
              (dependency) =>
                dependency.fromAssetId === affected.id ||
                dependency.toAssetId === affected.id ||
                dependency.objectPath === affected.objectPath ||
                dependency.packagePath === affected.packagePath ||
                dependency.fromObjectPath === affected.objectPath ||
                dependency.toObjectPath === affected.objectPath ||
                dependency.fromPackagePath === affected.packagePath ||
                dependency.toPackagePath === affected.packagePath ||
                dependency.fromVirtualPath === affected.virtualPath ||
                dependency.toVirtualPath === affected.virtualPath ||
                dependency.fromVirtualPath === indexedVirtualPath ||
                dependency.toVirtualPath === indexedVirtualPath
            )
          );
          previewsByAssetId.set(
            assetId,
            creator.previewAssets.filter(
              (preview) =>
                preview.objectPath === affected.objectPath ||
                preview.objectPath === indexedObjectPath ||
                affected.payloadPath === preview.payloadPath
            )
          );
        }
      }

      const payloadEntries = await readPayloadEntries(
        record,
        enabled,
        activeProfileOrder,
        checksumByPath
      );
      payloadEntryCount += payloadEntries.length;
      entries.push(...payloadEntries);
    }

    return {
      entries,
      checksums,
      dependenciesByAssetId,
      previewsByAssetId,
      eligibilityByAssetId,
      payloadEntryCount,
      affectedAssetCount,
      replacementCount
    };
  }
}

async function readBaseMapIndex(
  mapRoot: string,
  options: AssetRegistryOptions
): Promise<BaseMapIndex> {
  const artifacts = await Promise.all(
    MAP_FILES.map((fileName) => artifactStatus(mapRoot, fileName))
  );
  const summary = await readMapSummary(mapRoot, artifacts);
  const entries: CreatorAssetIndexEntry[] = [];
  const entriesById = new Map<string, CreatorAssetIndexEntry>();
  const targetKeys = new Set<string>();
  const problems: ModProblem[] = [];
  const tagCounts = new Map<string, number>();
  const allEntriesPath = path.join(
    mapRoot,
    "clawed-all-files-and-container-entries.csv"
  );

  if (!(await pathExists(allEntriesPath))) {
    problems.push(
      modProblem(
        "warning",
        "CLAWED_MAP_ARTIFACT_MISSING",
        "The Clawed asset map index is not available."
      )
    );
    return {
      entries,
      entriesById,
      targetKeys,
      summary,
      topTags: [],
      problems
    };
  }

  try {
    const rows = await readCsvRows<CsvMapRow>(allEntriesPath);
    const maxBaseEntries = options.maxBaseEntries ?? Number.POSITIVE_INFINITY;
    for (const row of rows) {
      if (entries.length >= maxBaseEntries) {
        break;
      }

      const entry = mapRowToEntry(row);
      if (!entry) {
        continue;
      }

      const targetKey = targetKeyForEntry(entry);
      if (targetKey) {
        targetKeys.add(targetKey);
      }
      for (const tag of entry.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
      entries.push(entry);
      entriesById.set(entry.id, entry);
    }
  } catch (error) {
    problems.push(
      modProblem(
        "warning",
        "CLAWED_MAP_READ_FAILED",
        "CMM could not read the Clawed asset map index.",
        error instanceof Error ? error.message : String(error)
      )
    );
  }

  return {
    entries,
    entriesById,
    targetKeys,
    summary,
    topTags: [...tagCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 16)
      .map(([tag, count]) => ({ tag, count })),
    problems
  };
}

async function readBaseMapSummaryIndex(
  mapRoot: string
): Promise<BaseMapSummaryIndex> {
  const artifacts = await Promise.all(
    MAP_FILES.map((fileName) => artifactStatus(mapRoot, fileName))
  );
  const summary = await readMapSummary(mapRoot, artifacts);
  const allEntriesPath = path.join(
    mapRoot,
    "clawed-all-files-and-container-entries.csv"
  );
  const problems = (await pathExists(allEntriesPath))
    ? []
    : [
        modProblem(
          "warning",
          "CLAWED_MAP_ARTIFACT_MISSING",
          "The Clawed asset map index is not available."
        )
      ];

  return {
    summary,
    topTags: [],
    problems
  };
}

async function artifactStatus(
  mapRoot: string,
  fileName: string
): Promise<CreatorAssetRegistryArtifact> {
  const filePath = path.join(mapRoot, fileName);
  const fileStat = await stat(filePath).catch(() => null);

  return {
    name: fileName,
    exists: Boolean(fileStat),
    sizeBytes: fileStat?.size ?? null
  };
}

async function readMapSummary(
  mapRoot: string,
  artifacts: CreatorAssetRegistryArtifact[]
): Promise<CreatorAssetRegistryMapSummary> {
  const summaryPath = path.join(mapRoot, "clawed-map-summary.json");
  const rawSummary = await readFile(summaryPath, "utf8")
    .then((content) => JSON.parse(content) as MapSummaryJson)
    .catch((): MapSummaryJson => ({}));
  const presentArtifacts = artifacts.filter((artifact) => artifact.exists).length;

  return {
    status:
      presentArtifacts === MAP_FILES.length
        ? "ready"
        : presentArtifacts > 0
          ? "partial"
          : "missing",
    artifactRoot: workspaceRelativePath(mapRoot),
    generatedAtUtc: rawSummary.generatedAtUtc ?? null,
    steamBuildId: rawSummary.steamBuildId ?? null,
    physicalFileCount: rawSummary.physicalFileCount ?? 0,
    shippingManifestEntryCount: rawSummary.shippingManifestEntryCount ?? 0,
    containerEntryCount: rawSummary.containerEntryCount ?? 0,
    namedContainerEntryCount: rawSummary.namedContainerEntryCount ?? 0,
    artifacts
  };
}

function mapRowToEntry(row: CsvMapRow): CreatorAssetIndexEntry | null {
  const rowPath = row.path?.trim();
  if (!rowPath) {
    return null;
  }

  const objectPath = emptyToNull(row.objectPath);
  const packagePath = objectPath
    ? packagePathFromObjectPath(objectPath)
    : packagePathFromGamePath(rowPath, row.extension);
  const tags = splitTags(row.tags);
  const id = `base:${hashStable(
    [row.source, rowPath, objectPath ?? "", packagePath ?? ""].join("\0")
  )}`;

  return CreatorAssetIndexEntrySchema.parse({
    id,
    label: objectPath ?? packagePath ?? rowPath,
    source: "baseGameMap",
    ownerLabel: "Clawed base index",
    packageId: null,
    packageVersion: null,
    packageName: null,
    containerName: emptyToNull(row.containerName),
    loader: null,
    activeProfileEnabled: false,
    activeProfileOrder: null,
    assetClass: inferAssetClass(row.extension, rowPath, tags),
    packagePath,
    objectPath,
    virtualPath: baseVirtualPath(rowPath),
    payloadPath: null,
    relativePath: rowPath,
    extension: emptyToNull(row.extension),
    tags,
    modUses: emptyToNull(row.modUses),
    sizeBytes: parseNumber(row.sizeBytes),
    sha256: normalizeHash(row.hashOrSha256),
    validationState: null,
    deploymentRoute: null,
    exportState: "exportable",
    conflictState: "none"
  });
}

function isCreatorOkStatus(status: string): boolean {
  return ["available", "ready", "exported", "partial"].includes(status);
}

function creatorLogResult(status: string): "ok" | "blocked" | "failed" | "requested" {
  if (isCreatorOkStatus(status)) {
    return "ok";
  }
  if (["decode-error", "error", "export-error"].includes(status)) {
    return "failed";
  }
  return "blocked";
}

async function readPayloadEntries(
  record: InstalledModManifestRecord,
  activeProfileEnabled: boolean,
  activeProfileOrder: number | null,
  checksumByPath: Map<string, string>
): Promise<CreatorAssetIndexEntry[]> {
  const payloadRoot = path.join(record.mod.installPath, "payload");
  const files = await listFiles(payloadRoot);

  return Promise.all(
    files.map(async (filePath) => {
      const relativePayloadPath = normalizeArchivePath(
        path.relative(record.mod.installPath, filePath)
      );
      const fileStat = await stat(filePath);
      const affected = record.manifest.creatorAssets?.affectedAssets.find(
        (asset) =>
          asset.payloadPath &&
          normalizeArchivePath(asset.payloadPath) === relativePayloadPath
      );
      const identity = packageKeyOf(record.manifest.id, record.manifest.version);

      return CreatorAssetIndexEntrySchema.parse({
        id: `payload:${identity}:${hashStable(relativePayloadPath)}`,
        label: relativePayloadPath,
        source: "packagePayload",
        ownerLabel: record.manifest.name,
        packageId: record.manifest.id,
        packageVersion: record.manifest.version,
        packageName: record.manifest.name,
        containerName: containerNameFromPayload(relativePayloadPath),
        loader: record.manifest.loader,
        activeProfileEnabled,
        activeProfileOrder,
        assetClass:
          affected?.assetClass ??
          inferAssetClass(path.extname(filePath), relativePayloadPath, []),
        packagePath: affected?.packagePath ?? null,
        objectPath: affected?.objectPath ?? null,
        virtualPath:
          affected?.virtualPath ??
          payloadVirtualPath(
            record.manifest.id,
            record.manifest.version,
            relativePayloadPath
          ),
        payloadPath: relativePayloadPath,
        relativePath: relativePayloadPath,
        extension: path.extname(filePath) || null,
        tags: affected?.tags ?? [],
        modUses: affected?.role ?? null,
        sizeBytes: fileStat.size,
        sha256: checksumByPath.get(relativePayloadPath) ?? null,
        validationState: null,
        deploymentRoute: null,
        exportState:
          record.manifest.creatorAssets?.exportEligibility.state ?? "unknown",
        conflictState: "none"
      });
    })
  );
}

async function readPackageChecksums(
  record: InstalledModManifestRecord
): Promise<CreatorAssetChecksum[]> {
  const packageKey = {
    packageId: record.manifest.id,
    packageVersion: record.manifest.version
  };
  const checksums: CreatorAssetChecksum[] = [
    {
      ...packageKey,
      scope: "package",
      path: "package.clawedmod",
      sha256: record.mod.sha256
    }
  ];
  const checksumsPath = path.join(record.mod.installPath, "checksums.json");
  const raw = await readFile(checksumsPath, "utf8")
    .then((content) => JSON.parse(content) as unknown)
    .catch(() => null);

  if (!raw || typeof raw !== "object") {
    return checksums;
  }

  for (const checksum of extractChecksums(raw, packageKey)) {
    checksums.push(checksum);
  }

  return checksums;
}

function extractChecksums(
  raw: unknown,
  packageKey: Pick<CreatorAssetChecksum, "packageId" | "packageVersion">
): CreatorAssetChecksum[] {
  const checksums: CreatorAssetChecksum[] = [];
  if (!raw || typeof raw !== "object") {
    return checksums;
  }

  const record = raw as Record<string, unknown>;
  const source = record.source;
  if (source && typeof source === "object") {
    const sourceRecord = source as Record<string, unknown>;
    if (
      typeof sourceRecord.sha256 === "string" &&
      isSha256(sourceRecord.sha256)
    ) {
      checksums.push({
        ...packageKey,
        scope: "source",
        path:
          typeof sourceRecord.fileName === "string"
            ? sourceRecord.fileName
            : null,
        sha256: sourceRecord.sha256
      });
    }
  }

  const files = record.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      if (!file || typeof file !== "object") {
        continue;
      }
      const fileRecord = file as Record<string, unknown>;
      if (
        typeof fileRecord.path === "string" &&
        typeof fileRecord.sha256 === "string" &&
        isSha256(fileRecord.sha256)
      ) {
        checksums.push({
          ...packageKey,
          scope: "payload",
          path: fileRecord.path,
          sha256: fileRecord.sha256
        });
      }
    }
  }

  const payload = record.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const [payloadPath, sha256] of Object.entries(payload)) {
      if (typeof sha256 === "string" && isSha256(sha256)) {
        checksums.push({
          ...packageKey,
          scope: "payload",
          path: payloadPath,
          sha256
        });
      }
    }
  }

  return checksums;
}

function buildConflictGraph(
  records: InstalledModManifestRecord[],
  profile: Profile,
  baseTargets: Set<string>,
  validation: LoadOrderValidation
): CreatorAssetConflict[] {
  const byTarget = new Map<string, CreatorAssetConflict>();
  const orderIndex = new Map(
    validation.orderedModIds.map((modId, index) => [modId, index])
  );

  for (const record of records) {
    const creator = record.manifest.creatorAssets;
    if (!creator) {
      continue;
    }

    const selection = profile.selectedMods[record.manifest.id];
    const enabled =
      selection?.version === record.manifest.version && selection.enabled;
    const order = orderIndex.get(record.manifest.id) ?? -1;
    const profileOrder = order >= 0 ? order + 1 : null;
    const effects = loadOrderEffectsForMod(
      record.manifest.id,
      validation.problems
    );
    const representedTouches = new Set<string>();

    for (const replacement of creator.replacements) {
      const targetAsset = creator.affectedAssets.find(
        (asset) => asset.id === replacement.targetAssetId
      );
      const targetObjectPath =
        replacement.targetObjectPath ?? targetAsset?.objectPath ?? null;
      const targetPackagePath =
        replacement.targetPackagePath ??
        targetAsset?.packagePath ??
        (targetObjectPath ? packagePathFromObjectPath(targetObjectPath) : null);
      const targetVirtualPath =
        replacement.targetVirtualPath ?? targetAsset?.virtualPath ?? null;
      const targetKey = targetKeyFromPaths(
        targetObjectPath,
        targetPackagePath,
        targetVirtualPath
      );
      if (!targetKey) {
        continue;
      }

      const existing = ensureConflictTarget(byTarget, targetKey, {
        targetPackagePath,
        targetObjectPath,
        targetVirtualPath,
        baseTargets
      });
      existing.entries.push({
        packageId: record.manifest.id,
        packageVersion: record.manifest.version,
        packageName: record.manifest.name,
        loader: record.manifest.loader,
        enabled,
        profileOrder,
        validationState: replacement.validationState,
        deploymentRoute: replacement.deploymentRoute,
        payloadPaths: replacement.payloadPaths,
        targetAssetIds: [replacement.targetAssetId, replacement.replacementAssetId]
          .filter((value): value is string => Boolean(value)),
        contributesReplacement: true,
        dependencies: record.manifest.dependencies,
        explicitConflicts: record.manifest.conflicts,
        loadBefore: record.manifest.loadBefore,
        loadAfter: record.manifest.loadAfter,
        loadOrderEffects: effects,
        isWinner: false
      });
      representedTouches.add(
        conflictPackageKey(targetKey, record.manifest.id, record.manifest.version)
      );
    }

    for (const affected of creator.affectedAssets) {
      if (!["target", "dependency"].includes(affected.role)) {
        continue;
      }

      const targetKey = targetKeyFromPaths(
        affected.objectPath,
        affected.packagePath,
        affected.virtualPath
      );
      if (
        !targetKey ||
        representedTouches.has(
          conflictPackageKey(
            targetKey,
            record.manifest.id,
            record.manifest.version
          )
        )
      ) {
        continue;
      }

      const existing = ensureConflictTarget(byTarget, targetKey, {
        targetPackagePath: affected.packagePath ?? null,
        targetObjectPath: affected.objectPath ?? null,
        targetVirtualPath: affected.virtualPath ?? null,
        baseTargets
      });
      existing.entries.push({
        packageId: record.manifest.id,
        packageVersion: record.manifest.version,
        packageName: record.manifest.name,
        loader: record.manifest.loader,
        enabled,
        profileOrder,
        validationState: "untested",
        deploymentRoute: "inspect-only",
        payloadPaths: affected.payloadPath ? [affected.payloadPath] : [],
        targetAssetIds: [affected.id],
        contributesReplacement: false,
        dependencies: record.manifest.dependencies,
        explicitConflicts: record.manifest.conflicts,
        loadBefore: record.manifest.loadBefore,
        loadAfter: record.manifest.loadAfter,
        loadOrderEffects: effects,
        isWinner: false
      });
    }
  }

  return [...byTarget.values()]
    .map(assignConflictLoadOrderEffects)
    .map(assignWinner)
    .sort((left, right) => left.targetKey.localeCompare(right.targetKey));
}

function ensureConflictTarget(
  byTarget: Map<string, CreatorAssetConflict>,
  targetKey: string,
  options: {
    targetPackagePath: string | null;
    targetObjectPath: string | null;
    targetVirtualPath: string | null;
    baseTargets: Set<string>;
  }
): CreatorAssetConflict {
  const existing = byTarget.get(targetKey);
  if (existing) {
    existing.targetPackagePath ??= options.targetPackagePath;
    existing.targetObjectPath ??= options.targetObjectPath;
    existing.targetVirtualPath ??= options.targetVirtualPath;
    existing.baseGamePresent =
      existing.baseGamePresent || options.baseTargets.has(targetKey);
    return existing;
  }

  const conflict = {
    targetKey,
    targetPackagePath: options.targetPackagePath,
    targetObjectPath: options.targetObjectPath,
    targetVirtualPath: options.targetVirtualPath,
    baseGamePresent: options.baseTargets.has(targetKey),
    winnerPackageId: null,
    winnerPackageVersion: null,
    entries: [],
    loadOrderEffects: []
  };
  byTarget.set(targetKey, conflict);
  return conflict;
}

function assignConflictLoadOrderEffects(
  conflict: CreatorAssetConflict
): CreatorAssetConflict {
  return {
    ...conflict,
    loadOrderEffects: uniqueLoadOrderEffects(
      conflict.entries.flatMap((entry) => entry.loadOrderEffects)
    )
  };
}

function assignWinner(conflict: CreatorAssetConflict): CreatorAssetConflict {
  const winner = [...conflict.entries]
    .filter((entry) => entry.enabled && entry.contributesReplacement)
    .sort(
      (left, right) =>
        (right.profileOrder ?? -1) - (left.profileOrder ?? -1) ||
        right.packageId.localeCompare(left.packageId)
    )[0];

  return {
    ...conflict,
    winnerPackageId: winner?.packageId ?? null,
    winnerPackageVersion: winner?.packageVersion ?? null,
    entries: conflict.entries.map((entry) => ({
      ...entry,
      isWinner:
        Boolean(winner) &&
        entry.packageId === winner?.packageId &&
        entry.packageVersion === winner?.packageVersion
    }))
  };
}

function conflictPackageKey(
  targetKey: string,
  packageId: string,
  packageVersion: string
): string {
  return `${targetKey}\0${packageKeyOf(packageId, packageVersion)}`;
}

function loadOrderEffectsForMod(
  modId: string,
  problems: LoadOrderProblem[]
): CreatorAssetLoadOrderEffect[] {
  return problems
    .filter(
      (problem) => problem.modId === modId || problem.relatedModId === modId
    )
    .map(loadOrderProblemToEffect);
}

function loadOrderProblemToEffect(
  problem: LoadOrderProblem
): CreatorAssetLoadOrderEffect {
  return {
    severity: problem.severity,
    code: problem.code,
    message: problem.message,
    ...(problem.modId ? { modId: problem.modId } : {}),
    ...(problem.relatedModId ? { relatedModId: problem.relatedModId } : {}),
    ...(problem.technicalDetail
      ? { technicalDetail: problem.technicalDetail }
      : {})
  };
}

function uniqueLoadOrderEffects(
  effects: CreatorAssetLoadOrderEffect[]
): CreatorAssetLoadOrderEffect[] {
  const seen = new Set<string>();
  const unique: CreatorAssetLoadOrderEffect[] = [];

  for (const effect of effects) {
    const key = [
      effect.code,
      effect.modId ?? "",
      effect.relatedModId ?? "",
      effect.message
    ].join("\0");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(effect);
    }
  }

  return unique;
}

function loadOrderProblemsForReport(
  problems: LoadOrderProblem[]
): ModProblem[] {
  return problems.map((problem) =>
    modProblem(
      problem.severity === "ERROR" ? "error" : "warning",
      `CREATOR_LOAD_ORDER_${problem.code}`,
      problem.message,
      [
        problem.technicalDetail,
        problem.modId ? `modId=${problem.modId}` : null,
        problem.relatedModId ? `relatedModId=${problem.relatedModId}` : null
      ]
        .filter((value): value is string => Boolean(value))
        .join("; ") || undefined
    )
  );
}

function applyConflictStates(
  entries: CreatorAssetIndexEntry[],
  conflicts: CreatorAssetConflict[]
): CreatorAssetIndexEntry[] {
  const conflictsByTarget = new Map(
    conflicts.map((conflict) => [conflict.targetKey, conflict])
  );

  return entries.map((entry) => {
    const targetKey = targetKeyForEntry(entry);
    const conflict = targetKey ? conflictsByTarget.get(targetKey) : undefined;
    if (!conflict) {
      return entry;
    }

    if (entry.source === "baseGameMap") {
      return {
        ...entry,
        conflictState: conflict.winnerPackageId ? "overridden" : "none"
      };
    }

    const matchingEntries = conflict.entries
      .filter((candidate) => candidate.contributesReplacement)
      .filter(
      (candidate) =>
        candidate.packageId === entry.packageId &&
        candidate.packageVersion === entry.packageVersion
    );
    const matchingActive = matchingEntries.some((candidate) => candidate.enabled);
    const isWinner = matchingEntries.some((candidate) => candidate.isWinner);
    const activeCompetitors = conflict.entries.filter(
      (candidate) => candidate.enabled && candidate.contributesReplacement
    ).length;

    return {
      ...entry,
      conflictState: isWinner
        ? "winner"
        : matchingActive && activeCompetitors > 1
          ? "conflicted"
          : matchingActive
            ? "winner"
            : "none"
    };
  });
}

function deploymentEntries(
  manifest: DeploymentManifest | null,
  generatedAt: string
): CreatorAssetIndexEntry[] {
  if (!manifest) {
    return [];
  }

  return [...manifest.filesCreated, ...manifest.filesModified].map((file) =>
    CreatorAssetIndexEntrySchema.parse({
      id: `deployment:${manifest.id}:${hashStable(file.relativePath)}`,
      label: file.relativePath,
      source: "deployment",
      ownerLabel: "Active deployment",
      packageId: null,
      packageVersion: null,
      packageName: null,
      containerName: manifest.id,
      loader: null,
      activeProfileEnabled: true,
      activeProfileOrder: null,
      assetClass: inferAssetClass(path.extname(file.relativePath), file.relativePath, []),
      packagePath: packagePathFromGamePath(file.relativePath, path.extname(file.relativePath)),
      objectPath: null,
      virtualPath: deploymentVirtualPath(manifest.id, file.relativePath),
      payloadPath: null,
      relativePath: file.relativePath,
      extension: path.extname(file.relativePath) || null,
      tags: ["manager_owned_deployment"],
      modUses: `Recorded ${file.action} file at ${generatedAt}`,
      sizeBytes: null,
      sha256: file.sha256,
      validationState: null,
      deploymentRoute: null,
      exportState: "indexOnly",
      conflictState: "none"
    })
  );
}

function rootTreeNodes(
  snapshot: CreatorAssetRegistrySnapshot,
  request: CreatorAssetTreeRequest
): CreatorAssetTreeNode[] {
  const roots: Array<{
    source: CreatorAssetIndexEntry["source"];
    label: string;
    childCount: number;
  }> = [
    {
      source: "baseGameMap",
      label: "Clawed Base Game",
      childCount: snapshot.totals.baseGameEntries
    },
    {
      source: "installedPackage",
      label: "Installed Package Assets",
      childCount: snapshot.totals.installedPackages + snapshot.totals.affectedAssets
    },
    {
      source: "packagePayload",
      label: "Package Payloads",
      childCount: snapshot.totals.packagePayloadEntries
    },
    {
      source: "deployment",
      label: "Active Deployment",
      childCount: snapshot.totals.deploymentFiles
    }
  ];

  return roots
    .filter((root) => request.source === "all" || root.source === request.source)
    .map((root) =>
      CreatorAssetTreeNodeSchema.parse({
        id: rootTreeNodeId(root.source),
        label: root.label,
        kind: "root",
        source: root.source,
        path: "",
        assetId: null,
        hasChildren: root.childCount > 0,
        childCount: root.childCount
      })
    );
}

function rootTreeNodesFromEntries(
  index: RuntimeAssetIndex,
  request: CreatorAssetTreeRequest
): CreatorAssetTreeNode[] {
  return [
    { source: "baseGameMap" as const, label: "Clawed Base Game" },
    { source: "installedPackage" as const, label: "Installed Package Assets" },
    { source: "packagePayload" as const, label: "Package Payloads" },
    { source: "deployment" as const, label: "Active Deployment" }
  ]
    .filter((root) => request.source === "all" || root.source === request.source)
    .map((root) => {
      const childCount = entriesForTree(
        { ...request, source: root.source },
        index
      ).length;
      return CreatorAssetTreeNodeSchema.parse({
        id: rootTreeNodeId(root.source),
        label: root.label,
        kind: "root",
        source: root.source,
        path: "",
        assetId: null,
        hasChildren: childCount > 0,
        childCount
      });
    });
}

function buildAssetTreeResult(
  request: CreatorAssetTreeRequest,
  index: RuntimeAssetIndex
) {
  const nodes = request.query.trim()
    ? searchTreeNodes(request, index)
    : childTreeNodes(request, index);
  const limitedNodes = nodes.slice(0, request.limit);

  return CreatorAssetTreeResultSchema.parse({
    generatedAt: index.generatedAt,
    parentId: request.parentId,
    nodes: limitedNodes,
    totalChildren: nodes.length,
    truncated: nodes.length > limitedNodes.length,
    problems: index.snapshot.problems
  });
}

function searchTreeNodes(
  request: CreatorAssetTreeRequest,
  index: RuntimeAssetIndex
): CreatorAssetTreeNode[] {
  const query = request.query.trim().toLowerCase();
  return entriesForTree(request, index)
    .filter((entry) => treeSearchText(entry).includes(query))
    .sort(compareEntries)
    .map((entry) => assetTreeNode(entry, treePathForEntry(entry)));
}

function childTreeNodes(
  request: CreatorAssetTreeRequest,
  index: RuntimeAssetIndex
): CreatorAssetTreeNode[] {
  const parent = parseTreeNodeId(request.parentId);
  if (!parent) {
    return rootTreeNodesFromEntries(index, request);
  }
  if (parent.kind === "asset") {
    return [];
  }

  const source = parent.source;
  if (!source || (request.source !== "all" && request.source !== source)) {
    return [];
  }

  const parentSegments = parent.path ? parent.path.split("/") : [];
  const folders = new Map<string, CreatorAssetTreeNode>();
  const assets = new Map<string, CreatorAssetTreeNode>();

  for (const entry of entriesForTree({ ...request, source }, index)) {
    const treePath = treePathForEntry(entry);
    const segments = splitTreePath(treePath);
    if (
      segments.length <= parentSegments.length ||
      !segmentsPrefixMatches(segments, parentSegments)
    ) {
      continue;
    }

    const childSegments = segments.slice(0, parentSegments.length + 1);
    const childPath = childSegments.join("/");
    if (segments.length > childSegments.length) {
      const existing = folders.get(childPath);
      folders.set(
        childPath,
        existing
          ? { ...existing, childCount: existing.childCount + 1 }
          : CreatorAssetTreeNodeSchema.parse({
              id: folderTreeNodeId(source, childPath),
              label: childSegments.at(-1) ?? childPath,
              kind: "folder",
              source,
              path: childPath,
              assetId: null,
              hasChildren: true,
              childCount: 1
            })
      );
      continue;
    }

    assets.set(entry.id, assetTreeNode(entry, treePath));
  }

  return [...folders.values(), ...assets.values()].sort(compareTreeNodes);
}

function entriesForTree(
  request: CreatorAssetTreeRequest,
  index: RuntimeAssetIndex
): CreatorAssetIndexEntry[] {
  return index.entries.filter((entry) => {
    if (request.source !== "all" && entry.source !== request.source) {
      return false;
    }
    if (request.activeOnly && !entry.activeProfileEnabled) {
      return false;
    }
    return true;
  });
}

function assetTreeNode(
  entry: CreatorAssetIndexEntry,
  treePath: string
): CreatorAssetTreeNode {
  const segments = splitTreePath(treePath);
  return CreatorAssetTreeNodeSchema.parse({
    id: assetTreeNodeId(entry.id),
    label: segments.at(-1) ?? entry.label,
    kind: "asset",
    source: entry.source,
    path: treePath,
    assetId: entry.id,
    hasChildren: false,
    childCount: 0,
    assetClass: entry.assetClass,
    packageName: entry.packageName,
    validationState: entry.validationState,
    conflictState: entry.conflictState,
    exportState: entry.exportState,
    viewportState: viewportStateForEntry(entry)
  });
}

function treePathForEntry(entry: CreatorAssetIndexEntry): string {
  if (entry.source === "installedPackage") {
    const packageLabel = packageTreeLabel(entry);
    if (entry.id.startsWith("package:")) {
      return `${packageLabel}/package.clawedmod`;
    }
    return `${packageLabel}/${normalizeTreePath(
      entry.objectPath ??
        entry.packagePath ??
        entry.virtualPath ??
        entry.payloadPath ??
        entry.label
    )}`;
  }
  if (entry.source === "packagePayload") {
    return `${packageTreeLabel(entry)}/${normalizeTreePath(
      entry.payloadPath ?? entry.relativePath ?? entry.label
    )}`;
  }
  if (entry.source === "deployment") {
    return normalizeTreePath(entry.relativePath ?? entry.virtualPath ?? entry.label);
  }

  return normalizeTreePath(
    entry.objectPath ?? entry.packagePath ?? entry.relativePath ?? entry.label
  );
}

function packageTreeLabel(entry: CreatorAssetIndexEntry): string {
  return `${entry.packageName ?? entry.packageId ?? entry.ownerLabel} ${
    entry.packageVersion ?? ""
  }`.trim();
}

function treeSearchText(entry: CreatorAssetIndexEntry): string {
  return [
    entry.label,
    treePathForEntry(entry),
    entry.source,
    entry.ownerLabel,
    entry.packageId,
    entry.packageName,
    entry.containerName,
    entry.assetClass,
    entry.objectPath,
    entry.packagePath,
    entry.virtualPath,
    entry.payloadPath,
    entry.relativePath,
    entry.tags.join(" "),
    entry.modUses,
    entry.exportState,
    entry.validationState,
    entry.conflictState
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeTreePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function splitTreePath(value: string): string[] {
  return normalizeTreePath(value).split("/").filter(Boolean);
}

function segmentsPrefixMatches(
  segments: string[],
  prefix: string[]
): boolean {
  return prefix.every((segment, index) => segments[index] === segment);
}

function compareTreeNodes(
  left: CreatorAssetTreeNode,
  right: CreatorAssetTreeNode
): number {
  if (left.kind !== right.kind) {
    if (left.kind === "folder" || left.kind === "root") {
      return -1;
    }
    if (right.kind === "folder" || right.kind === "root") {
      return 1;
    }
  }
  return left.label.localeCompare(right.label);
}

function rootTreeNodeId(source: CreatorAssetIndexEntry["source"]): string {
  return `root|${source}`;
}

function folderTreeNodeId(
  source: CreatorAssetIndexEntry["source"],
  treePath: string
): string {
  return `folder|${source}|${encodeURIComponent(treePath)}`;
}

function assetTreeNodeId(assetId: string): string {
  return `asset|${encodeURIComponent(assetId)}`;
}

function parseTreeNodeId(
  id: string | null
):
  | { kind: "root"; source: CreatorAssetIndexEntry["source"]; path: "" }
  | { kind: "folder"; source: CreatorAssetIndexEntry["source"]; path: string }
  | { kind: "asset"; source: null; path: string }
  | null {
  if (!id) {
    return null;
  }

  const [kind, source, encodedPath] = id.split("|");
  if (
    kind === "root" &&
    ["baseGameMap", "installedPackage", "packagePayload", "deployment"].includes(
      source
    )
  ) {
    return {
      kind,
      source: source as CreatorAssetIndexEntry["source"],
      path: ""
    };
  }
  if (
    kind === "folder" &&
    ["baseGameMap", "installedPackage", "packagePayload", "deployment"].includes(
      source
    )
  ) {
    return {
      kind,
      source: source as CreatorAssetIndexEntry["source"],
      path: decodeURIComponent(encodedPath ?? "")
    };
  }
  if (kind === "asset") {
    return {
      kind,
      source: null,
      path: decodeURIComponent(source ?? "")
    };
  }

  return null;
}

function baseEntryCount(summary: CreatorAssetRegistryMapSummary): number {
  return (
    summary.namedContainerEntryCount ||
    summary.containerEntryCount ||
    summary.shippingManifestEntryCount ||
    summary.physicalFileCount
  );
}

async function listFiles(root: string): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (!isPathInside(root, entryPath) || entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function readCsvRows<T extends Record<string, string>>(
  filePath: string
): Promise<T[]> {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(lines[0] ?? "");
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, fields[index] ?? ""])
    ) as T;
  });
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      fields.push(field);
      field = "";
      continue;
    }

    field += character;
  }

  fields.push(field);
  return fields;
}

export function filterCreatorAssetIndexEntries(
  entries: CreatorAssetIndexEntry[],
  request: CreatorAssetSearchRequest
): CreatorAssetIndexEntry[] {
  return entries.filter((entry) => entryMatchesSearch(entry, request));
}

export function sortCreatorAssetIndexEntries(
  entries: CreatorAssetIndexEntry[],
  request: CreatorAssetSearchRequest
): CreatorAssetIndexEntry[] {
  const sorted = [...entries].sort((left, right) =>
    compareSearchEntries(left, right, request)
  );
  return request.sortDirection === "desc" ? sorted.reverse() : sorted;
}

function groupEntriesByTargetKey(
  entries: CreatorAssetIndexEntry[]
): Map<string, CreatorAssetIndexEntry[]> {
  const map = new Map<string, CreatorAssetIndexEntry[]>();

  for (const entry of entries) {
    const targetKey = targetKeyForEntry(entry);
    if (!targetKey) {
      continue;
    }
    map.set(targetKey, [...(map.get(targetKey) ?? []), entry]);
  }

  return map;
}

function targetKeyForGraphRequest(
  request: CreatorAssetConflictGraphRequest,
  index: RuntimeAssetIndex
): string | null {
  if (request.assetId) {
    const asset = index.entriesById.get(request.assetId);
    return asset ? targetKeyForEntry(asset) : null;
  }

  return (
    request.targetKey ??
    targetKeyFromPaths(request.objectPath, request.packagePath, request.virtualPath)
  );
}

function emptyConflictForTarget(
  targetKey: string,
  entries: CreatorAssetIndexEntry[],
  request: Partial<CreatorAssetConflictGraphRequest>
): CreatorAssetConflict {
  const baseEntry = entries.find((entry) => entry.source === "baseGameMap");
  const fallbackEntry = baseEntry ?? entries[0] ?? null;

  return {
    targetKey,
    targetPackagePath:
      request.packagePath ?? fallbackEntry?.packagePath ?? null,
    targetObjectPath: request.objectPath ?? fallbackEntry?.objectPath ?? null,
    targetVirtualPath: request.virtualPath ?? fallbackEntry?.virtualPath ?? null,
    baseGamePresent: Boolean(baseEntry),
    winnerPackageId: null,
    winnerPackageVersion: null,
    entries: [],
    loadOrderEffects: []
  };
}

function detailForAsset(
  assetId: string,
  index: RuntimeAssetIndex
): CreatorAssetDetail {
  const asset = index.entriesById.get(assetId) ?? null;

  if (!asset) {
    return CreatorAssetDetailSchema.parse({
      status: "notFound",
      asset: null,
      relatedAssets: [],
      conflicts: [],
      activeWinner: null,
      previews: [],
      checksums: [],
      dependencies: [],
      problems: [
        modProblem(
          "warning",
          "CREATOR_ASSET_NOT_FOUND",
          "That creator asset index entry could not be found.",
          assetId
        )
      ]
    });
  }

  const targetKey = targetKeyForEntry(asset);
  const conflicts = targetKey
    ? conflictsForTargetKey(targetKey, index, asset)
    : [];
  const packageKey = asset.packageId
    ? packageKeyOf(asset.packageId, asset.packageVersion ?? "")
    : null;
  const checksums = packageKey
    ? filterChecksumsForAsset(
        index.checksumsByPackage.get(packageKey) ?? [],
        asset
      )
    : [];
  const dependencies =
    asset.source === "baseGameMap"
      ? baseGameMeshDependenciesForAsset(asset, index)
      : index.dependenciesByAssetId.get(assetId) ?? [];
  const previews = index.previewsByAssetId.get(assetId) ?? [];
  const activeWinner =
    conflicts.flatMap((conflict) => conflict.entries).find((entry) => entry.isWinner) ??
    null;

  return CreatorAssetDetailSchema.parse({
    status: "ok",
    asset,
    relatedAssets: relatedAssetsFor(asset, index),
    conflicts,
    activeWinner,
    previews,
    checksums,
    dependencies,
    problems: []
  });
}

async function readModelPreview(
  request: CreatorModelPreviewRequest,
  index: RuntimeAssetIndex,
  options: BaseGameModelPreviewOptions
): Promise<CreatorModelPreviewResult> {
  const detail = detailForAsset(request.assetId, index);
  const asset = detail.asset;

  if (!asset) {
    return CreatorModelPreviewResultSchema.parse({
      status: "empty",
      asset: null,
      preview: null,
      activeWinner: null,
      model: null,
      metadata: modelPreviewMetadata(null, null, detail),
      problems: detail.problems
    });
  }

  if (asset.source === "baseGameMap") {
    return readBaseGameModelPreview(asset, detail, options);
  }

  if (asset.source === "packagePayload" && isModelPayloadAsset(asset)) {
    return readPackagePayloadModelPreview(asset, detail, index);
  }

  const modelPreviews = detail.previews.filter(
    (preview) => preview.kind === "model"
  );
  const preview = request.previewId
    ? modelPreviews.find((candidate) => candidate.id === request.previewId) ??
      null
    : modelPreviews[0] ?? null;

  if (!preview) {
    return CreatorModelPreviewResultSchema.parse({
      status: "empty",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, null, detail),
      problems: request.previewId
        ? [
            modProblem(
              "warning",
              "CREATOR_MODEL_PREVIEW_NOT_FOUND",
              "The requested model preview is not declared for this asset.",
              request.previewId
            )
          ]
        : []
    });
  }

  if (!["userOwned", "generated"].includes(preview.source)) {
    return CreatorModelPreviewResultSchema.parse({
      status: "blocked",
      asset,
      preview,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, preview, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_MODEL_PREVIEW_NOT_USER_OWNED",
          "Only user-owned or generated package preview models can be loaded."
        )
      ]
    });
  }

  const format = supportedModelPreviewFormat(preview);
  if (!format) {
    return CreatorModelPreviewResultSchema.parse({
      status: "unsupported",
      asset,
      preview,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, preview, detail),
      problems: [
        modProblem(
          "info",
          "CREATOR_MODEL_PREVIEW_UNSUPPORTED_FORMAT",
          "The model preview is declared, but its format is not supported by the viewport.",
          preview.format
        )
      ]
    });
  }

  const record = packageRecordForAsset(asset, index);
  if (!record) {
    return CreatorModelPreviewResultSchema.parse({
      status: "error",
      asset,
      preview,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, preview, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_MODEL_PREVIEW_PACKAGE_MISSING",
          "The package that owns this model preview is not installed."
        )
      ]
    });
  }

  const previewPath = normalizeArchivePath(preview.payloadPath);
  const payloadRoot = path.resolve(record.mod.installPath, "payload");
  const filePath = path.resolve(record.mod.installPath, previewPath);
  if (!isPathInside(payloadRoot, filePath)) {
    return CreatorModelPreviewResultSchema.parse({
      status: "blocked",
      asset,
      preview,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, preview, detail),
      problems: [
        modProblem(
          "error",
          "CREATOR_MODEL_PREVIEW_PATH_BLOCKED",
          "The declared model preview path is outside the package payload directory.",
          preview.payloadPath
        )
      ]
    });
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return CreatorModelPreviewResultSchema.parse({
      status: "error",
      asset,
      preview,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, preview, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_MODEL_PREVIEW_FILE_MISSING",
          "The declared model preview payload entry could not be read.",
          preview.payloadPath
        )
      ]
    });
  }

  if (fileStat.size > MAX_MODEL_PREVIEW_BYTES) {
    return CreatorModelPreviewResultSchema.parse({
      status: "unsupported",
      asset,
      preview,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, preview, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_MODEL_PREVIEW_TOO_LARGE",
          "The model preview is larger than the Creator viewport transfer limit.",
          `${fileStat.size} bytes`
        )
      ]
    });
  }

  try {
    const content = await readFile(filePath);
    return CreatorModelPreviewResultSchema.parse({
      status: "available",
      asset,
      preview,
      activeWinner: detail.activeWinner,
      model: {
        dataUrl: `data:${modelPreviewMimeType(format)};base64,${content.toString(
          "base64"
        )}`,
        format,
        source: preview.source,
        fileName: path.basename(previewPath),
        sizeBytes: fileStat.size
      },
      metadata: modelPreviewMetadata(asset, preview, detail),
      problems: []
    });
  } catch (error) {
    return CreatorModelPreviewResultSchema.parse({
      status: "error",
      asset,
      preview,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, preview, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_MODEL_PREVIEW_READ_FAILED",
          "The model preview could not be read from the installed package.",
          error instanceof Error ? error.message : String(error)
        )
      ]
    });
  }
}

async function readBaseGameModelPreview(
  asset: CreatorAssetIndexEntry,
  detail: CreatorAssetDetail,
  options: BaseGameModelPreviewOptions
): Promise<CreatorModelPreviewResult> {
  const cached = options.baseGamePreviewRoot
    ? await readCachedBaseGameModelPreview(
        asset,
        detail,
        options.baseGamePreviewRoot
      )
    : null;

  if (cached?.status === "available") {
    return CreatorModelPreviewResultSchema.parse({
      status: "available",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: {
        dataUrl: dataUrlForModel(cached.data, cached.format),
        format: cached.format,
        source: "cachedBaseGame",
        fileName: cached.fileName,
        sizeBytes: cached.data.byteLength
      },
      metadata: cached.metadata,
      problems: []
    });
  }

  const decoder = options.baseGameMeshDecoder;
  if (!decoder || !(await isDecoderAvailable(decoder))) {
    return CreatorModelPreviewResultSchema.parse({
      status: "unsupported",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: baseGameModelPreviewMetadata(asset, detail, cached?.entry ?? null, {
        previewSource: "Direct base-game decode unavailable"
      }),
      problems: [
        ...(cached?.problems ?? []),
        modProblem(
          "info",
          "BASE_GAME_MESH_DECODER_UNAVAILABLE",
          "No base-game mesh decoder is configured for cooked Unreal mesh conversion.",
          decoderTechnicalDetail(asset, "configure-decoder", "decoder unavailable")
        )
      ]
    });
  }

  const resolved = await resolveBaseGameRenderableAsset(asset, options, "preview");
  if (!resolved.asset) {
    return CreatorModelPreviewResultSchema.parse({
      status: baseGameProbeFailureStatus(resolved.probe),
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: baseGameModelPreviewMetadata(asset, detail, cached?.entry ?? null, {
        ...(resolved.probe?.metadata ?? {}),
        previewSource: "Unsupported base-game asset class"
      }),
      problems: [
        ...(cached?.problems ?? []),
        ...baseGameProbeProblems(asset, resolved.probe)
      ]
    });
  }

  const renderAsset = resolved.asset;
  const renderDetail = detailWithAsset(detail, renderAsset);
  const requestedFormat = preferredBaseGamePreviewFormat(renderAsset);
  const decoded = await decoder.decode({
    asset: renderAsset,
    detail: renderDetail,
    cookedPayload: baseGameCookedPayloadForAsset(renderAsset),
    format: requestedFormat,
    purpose: "preview"
  });

  if (decoded.status === "ready" && decoded.data) {
    const format = decoded.format ?? requestedFormat;
    return CreatorModelPreviewResultSchema.parse({
      status: "available",
      asset: renderAsset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: {
        dataUrl: dataUrlForModel(decoded.data, format),
        format,
        source: "decodedBaseGame",
        fileName: decoded.fileName ?? baseGameMeshFileName(asset, format),
        sizeBytes: decoded.data.byteLength
      },
      metadata: baseGameModelPreviewMetadata(renderAsset, renderDetail, cached?.entry ?? null, {
        ...decoded.metadata,
        previewSource: "Direct decoded base-game asset"
      }),
      problems: [
        ...(cached?.problems ?? []),
        ...(resolved.probe?.problems ?? []),
        ...(decoded.problems ?? [])
      ]
    });
  }

  return CreatorModelPreviewResultSchema.parse({
    status: decoded.status === "dependency-missing" ? "dependency-missing" : decoded.status,
    asset: renderAsset,
    preview: null,
    activeWinner: detail.activeWinner,
    model: null,
    metadata: baseGameModelPreviewMetadata(renderAsset, renderDetail, cached?.entry ?? null, {
      ...(decoded.metadata ?? {}),
      previewSource: "Direct base-game decode failed"
    }),
    problems: [
      ...(cached?.problems ?? []),
      ...(resolved.probe?.problems ?? []),
      ...baseGameDecoderProblems(renderAsset, decoded)
    ]
  });
}

async function readPackagePayloadModelPreview(
  asset: CreatorAssetIndexEntry,
  detail: CreatorAssetDetail,
  index: RuntimeAssetIndex
): Promise<CreatorModelPreviewResult> {
  const format = packagePayloadModelFormat(asset);
  if (!format) {
    return CreatorModelPreviewResultSchema.parse({
      status: "unsupported",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, null, detail),
      problems: [
        modProblem(
          "info",
          "CREATOR_PACKAGE_MODEL_PAYLOAD_UNSUPPORTED_FORMAT",
          "The package payload model format is not supported by the Creator viewport.",
          asset.extension ?? asset.payloadPath ?? asset.label
        )
      ]
    });
  }

  const record = packageRecordForAsset(asset, index);
  if (!record || !asset.payloadPath) {
    return CreatorModelPreviewResultSchema.parse({
      status: "error",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, null, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_PACKAGE_MODEL_PAYLOAD_MISSING",
          "The package that owns this model payload is not installed."
        )
      ]
    });
  }

  const payloadPath = normalizeArchivePath(asset.payloadPath);
  const payloadRoot = path.resolve(record.mod.installPath, "payload");
  const filePath = path.resolve(record.mod.installPath, payloadPath);
  if (!isPathInside(payloadRoot, filePath)) {
    return CreatorModelPreviewResultSchema.parse({
      status: "blocked",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, null, detail),
      problems: [
        modProblem(
          "error",
          "CREATOR_PACKAGE_MODEL_PAYLOAD_PATH_BLOCKED",
          "The model payload path is outside the package payload directory.",
          asset.payloadPath
        )
      ]
    });
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return CreatorModelPreviewResultSchema.parse({
      status: "error",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, null, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_PACKAGE_MODEL_PAYLOAD_FILE_MISSING",
          "The model payload entry could not be read from the installed package.",
          asset.payloadPath
        )
      ]
    });
  }

  if (fileStat.size > MAX_MODEL_PREVIEW_BYTES) {
    return CreatorModelPreviewResultSchema.parse({
      status: "unsupported",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, null, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_PACKAGE_MODEL_PAYLOAD_TOO_LARGE",
          "The model payload is larger than the Creator viewport transfer limit.",
          `${fileStat.size} bytes`
        )
      ]
    });
  }

  try {
    const content = await readFile(filePath);
    return CreatorModelPreviewResultSchema.parse({
      status: "available",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: {
        dataUrl: dataUrlForModel(content, format),
        format,
        source: "packagePayload",
        fileName: path.basename(payloadPath),
        sizeBytes: fileStat.size
      },
      metadata: {
        ...modelPreviewMetadata(asset, null, detail),
        previewSource: "Package model payload"
      },
      problems: []
    });
  } catch (error) {
    return CreatorModelPreviewResultSchema.parse({
      status: "error",
      asset,
      preview: null,
      activeWinner: detail.activeWinner,
      model: null,
      metadata: modelPreviewMetadata(asset, null, detail),
      problems: [
        modProblem(
          "warning",
          "CREATOR_PACKAGE_MODEL_PAYLOAD_READ_FAILED",
          "The model payload could not be read from the installed package.",
          error instanceof Error ? error.message : String(error)
        )
      ]
    });
  }
}

async function readCachedBaseGameModelPreview(
  asset: CreatorAssetIndexEntry,
  detail: CreatorAssetDetail,
  baseGamePreviewRoot: string
): Promise<{
  status: "available" | "miss" | "invalid";
  entry: CachedBaseGamePreviewEntry | null;
  format: CreatorMeshExportFormat;
  data: Buffer;
  fileName: string;
  metadata: CreatorModelPreviewMetadata;
  problems: ModProblem[];
}> {
  const entry = await findCachedBaseGamePreview(asset, baseGamePreviewRoot);

  if (!entry) {
    return {
      status: "miss",
      entry: null,
      format: "obj",
      data: Buffer.alloc(0),
      fileName: "",
      metadata: baseGameModelPreviewMetadata(asset, detail, null, {
        previewSource: "Direct base-game decode"
      }),
      problems: []
    };
  }

  const format = supportedCachedBaseGamePreviewFormat(entry);
  if (!format) {
    return {
      status: "invalid",
      entry,
      format: "obj",
      data: Buffer.alloc(0),
      fileName: "",
      metadata: baseGameModelPreviewMetadata(asset, detail, entry, {
        previewSource: "Cached normalized preview invalid"
      }),
      problems: [
        modProblem(
          "warning",
          "BASE_GAME_MODEL_PREVIEW_CACHE_UNSUPPORTED_FORMAT",
          "The cached base-game model preview format is not supported by the viewport.",
          entry.format ?? path.extname(entry.modelPath)
        )
      ]
    };
  }

  const modelPath = normalizeArchivePath(entry.modelPath);
  const filePath = path.resolve(baseGamePreviewRoot, modelPath);
  if (!isPathInside(baseGamePreviewRoot, filePath)) {
    return {
      status: "invalid",
      entry,
      format,
      data: Buffer.alloc(0),
      fileName: "",
      metadata: baseGameModelPreviewMetadata(asset, detail, entry, {
        previewSource: "Cached normalized preview blocked"
      }),
      problems: [
        modProblem(
          "error",
          "BASE_GAME_MODEL_PREVIEW_CACHE_PATH_BLOCKED",
          "The cached base-game model preview path is outside the preview cache.",
          entry.modelPath
        )
      ]
    };
  }

  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return {
      status: "invalid",
      entry,
      format,
      data: Buffer.alloc(0),
      fileName: "",
      metadata: baseGameModelPreviewMetadata(asset, detail, entry, {
        previewSource: "Cached normalized preview missing"
      }),
      problems: [
        modProblem(
          "warning",
          "BASE_GAME_MODEL_PREVIEW_CACHE_FILE_MISSING",
          "The cached base-game model preview file could not be read.",
          entry.modelPath
        )
      ]
    };
  }

  if (fileStat.size > MAX_MODEL_PREVIEW_BYTES) {
    return {
      status: "invalid",
      entry,
      format,
      data: Buffer.alloc(0),
      fileName: "",
      metadata: baseGameModelPreviewMetadata(asset, detail, entry, {
        previewSource: "Cached normalized preview too large"
      }),
      problems: [
        modProblem(
          "warning",
          "BASE_GAME_MODEL_PREVIEW_CACHE_TOO_LARGE",
          "The cached base-game model preview is larger than the Creator viewport transfer limit.",
          `${fileStat.size} bytes`
        )
      ]
    };
  }

  try {
    const content = await readFile(filePath);
    return {
      status: "available",
      entry,
      format,
      data: content,
      fileName: path.basename(modelPath),
      metadata: baseGameModelPreviewMetadata(asset, detail, entry, {
        previewSource: "Cached normalized preview"
      }),
      problems: []
    };
  } catch (error) {
    return {
      status: "invalid",
      entry,
      format,
      data: Buffer.alloc(0),
      fileName: "",
      metadata: baseGameModelPreviewMetadata(asset, detail, entry, {
        previewSource: "Cached normalized preview read failed"
      }),
      problems: [
        modProblem(
          "warning",
          "BASE_GAME_MODEL_PREVIEW_CACHE_READ_FAILED",
          "The cached base-game model preview could not be read.",
          error instanceof Error ? error.message : String(error)
        )
      ]
    };
  }
}

async function findCachedBaseGamePreview(
  asset: CreatorAssetIndexEntry,
  root: string
): Promise<CachedBaseGamePreviewEntry | null> {
  const indexPath = path.join(root, BASE_GAME_PREVIEW_INDEX);
  const raw = await readFile(indexPath, "utf8")
    .then((content) => JSON.parse(content) as unknown)
    .catch(() => null);
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return null;
  }

  for (const candidate of entries) {
    const entry = parseCachedBaseGamePreviewEntry(candidate);
    if (entry && cachedBaseGamePreviewMatches(asset, entry)) {
      return entry;
    }
  }

  return null;
}

function parseCachedBaseGamePreviewEntry(
  value: unknown
): CachedBaseGamePreviewEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.modelPath !== "string" || !record.modelPath.trim()) {
    return null;
  }

  return {
    assetId: stringField(record.assetId),
    objectPath: stringField(record.objectPath),
    packagePath: stringField(record.packagePath),
    virtualPath: stringField(record.virtualPath),
    label: stringField(record.label),
    modelPath: record.modelPath,
    format: modelPreviewFormatField(record.format),
    skeleton: nullableStringField(record.skeleton),
    physicsAsset: nullableStringField(record.physicsAsset),
    materialSlots: materialSlotsField(record.materialSlots),
    lods: lodsField(record.lods),
    dependencyPaths: stringArrayField(record.dependencyPaths),
    exportable: typeof record.exportable === "boolean" ? record.exportable : true
  };
}

function cachedBaseGamePreviewMatches(
  asset: CreatorAssetIndexEntry,
  entry: CachedBaseGamePreviewEntry
): boolean {
  return [
    entry.assetId && entry.assetId === asset.id,
    entry.objectPath && entry.objectPath === asset.objectPath,
    entry.packagePath && entry.packagePath === asset.packagePath,
    entry.virtualPath && entry.virtualPath === asset.virtualPath,
    entry.label && entry.label === asset.label
  ].some(Boolean);
}

function supportedCachedBaseGamePreviewFormat(
  entry: CachedBaseGamePreviewEntry
): CreatorMeshExportFormat | null {
  const format =
    entry.format ??
    path.extname(normalizeArchivePath(entry.modelPath)).replace(".", "");
  return MODEL_PREVIEW_FORMATS.has(format)
    ? (format as CreatorMeshExportFormat)
    : null;
}

function baseGameModelPreviewMetadata(
  asset: CreatorAssetIndexEntry,
  detail: CreatorAssetDetail,
  entry: CachedBaseGamePreviewEntry | null,
  override: Partial<CreatorModelPreviewMetadata> = {}
): CreatorModelPreviewMetadata {
  const skeleton =
    override.skeleton ??
    entry?.skeleton ??
    dependencyPathByRelation(detail.dependencies, "skeleton");
  const physicsAsset =
    override.physicsAsset ??
    entry?.physicsAsset ??
    dependencyPathByRelation(detail.dependencies, "physicsAsset");
  const materialSlots = override.materialSlots ?? entry?.materialSlots ?? [];
  const lods = override.lods ?? entry?.lods ?? [];
  const dependencyPaths = uniqueStrings([
    ...(override.dependencyPaths ?? []),
    ...(entry?.dependencyPaths ?? []),
    ...detail.dependencies.flatMap((dependency) =>
      [
        dependency.toObjectPath,
        dependency.toPackagePath,
        dependency.toVirtualPath,
        dependency.objectPath,
        dependency.packagePath
      ].filter((value): value is string => Boolean(value))
    )
  ]);

  return {
    meshType: override.meshType ?? meshPreviewRoleForAsset(asset),
    skeleton: skeleton ?? null,
    physicsAsset: physicsAsset ?? null,
    materialSlots,
    lods,
    dependencyPaths,
    targetObjectPath: asset.objectPath,
    packagePath: asset.packagePath,
    packageSource: "Clawed base game",
    sourceContainer: asset.containerName,
    previewSource: override.previewSource ?? null,
    lodCount: override.lodCount ?? (lods.length ? lods.length : null),
    vertexCount: override.vertexCount ?? firstKnownLodValue(lods, "vertexCount"),
    triangleCount:
      override.triangleCount ?? firstKnownLodValue(lods, "triangleCount"),
    materialSlotCount:
      override.materialSlotCount ??
      (materialSlots.length ? materialSlots.length : null),
    validationState: null,
    conflictWinner: detail.activeWinner
      ? `${detail.activeWinner.packageName} ${detail.activeWinner.packageVersion}`
      : null,
    exportState:
      override.exportState ?? (entry?.exportable ? "exportable" : asset.exportState)
  };
}

async function exportCreatorMesh(
  request: CreatorMeshExportRequest,
  index: RuntimeAssetIndex,
  options: BaseGameModelPreviewOptions & { protectedGameRoots: string[] }
): Promise<CreatorMeshExportResult> {
  const detail = detailForAsset(request.assetId, index);
  const asset = detail.asset;

  if (!asset) {
    return CreatorMeshExportResultSchema.parse({
      status: "export-error",
      asset: null,
      format: request.format,
      destinationPath: request.destinationPath,
      bytesWritten: null,
      metadata: modelPreviewMetadata(null, null, detail),
      problems: detail.problems
    });
  }

  const metadata = baseGameModelPreviewMetadata(asset, detail, null, {
    previewSource: "Direct base-game export"
  });

  if (asset.source !== "baseGameMap") {
    return CreatorMeshExportResultSchema.parse({
      status: "unsupported",
      asset,
      format: request.format,
      destinationPath: request.destinationPath,
      bytesWritten: null,
      metadata,
      problems: [
        modProblem(
          "info",
          "CREATOR_MESH_EXPORT_UNSUPPORTED_SOURCE",
          "Only indexed base-game model assets can use direct mesh export."
        )
      ]
    });
  }

  const destinationPath = path.resolve(request.destinationPath);
  const blockedRoot = options.protectedGameRoots.find((root) =>
    isPathInside(root, destinationPath)
  );
  if (blockedRoot) {
    return CreatorMeshExportResultSchema.parse({
      status: "blocked",
      asset,
      format: request.format,
      destinationPath,
      bytesWritten: null,
      metadata,
      problems: [
        modProblem(
          "error",
          "CREATOR_MESH_EXPORT_GAME_PATH_BLOCKED",
          "Mesh export cannot write into the Clawed game installation.",
          `${destinationPath} inside ${blockedRoot}`
        )
      ]
    });
  }

  const decoder = options.baseGameMeshDecoder;
  const resolved = await resolveBaseGameRenderableAsset(asset, options, "export");
  if (!resolved.asset) {
    return CreatorMeshExportResultSchema.parse({
      status: baseGameProbeFailureStatus(resolved.probe),
      asset,
      format: request.format,
      destinationPath,
      bytesWritten: null,
      metadata: baseGameModelPreviewMetadata(asset, detail, null, {
        ...(resolved.probe?.metadata ?? {}),
        previewSource: "Direct base-game export unsupported"
      }),
      problems: [
        ...baseGameProbeProblems(asset, resolved.probe)
      ]
    });
  }

  const renderAsset = resolved.asset;
  const renderDetail = detailWithAsset(detail, renderAsset);
  const cached = options.baseGamePreviewRoot
    ? await readCachedBaseGameModelPreview(
        renderAsset,
        renderDetail,
        options.baseGamePreviewRoot
      )
    : null;

  if (cached?.status === "available" && cached.format === request.format) {
    return writeMeshExportResult({
      asset: renderAsset,
      format: request.format,
      destinationPath,
      data: cached.data,
      metadata: cached.metadata,
      problems: []
    });
  }

  if (!decoder || !(await isDecoderAvailable(decoder))) {
    return CreatorMeshExportResultSchema.parse({
      status: "unsupported",
      asset: renderAsset,
      format: request.format,
      destinationPath,
      bytesWritten: null,
      metadata: baseGameModelPreviewMetadata(renderAsset, renderDetail, cached?.entry ?? null, {
        previewSource: "Direct base-game export unavailable"
      }),
      problems: [
        ...(cached?.problems ?? []),
        modProblem(
          "info",
          "BASE_GAME_MESH_DECODER_UNAVAILABLE",
          "No base-game mesh decoder is configured for cooked Unreal mesh conversion.",
          decoderTechnicalDetail(renderAsset, "configure-decoder", "decoder unavailable")
        )
      ]
    });
  }

  if (!decoderSupportsFormat(decoder, request.format, renderAsset)) {
    return CreatorMeshExportResultSchema.parse({
      status: "unsupported",
      asset: renderAsset,
      format: request.format,
      destinationPath,
      bytesWritten: null,
      metadata: baseGameModelPreviewMetadata(renderAsset, renderDetail, cached?.entry ?? null, {
        previewSource: "Direct base-game export unsupported"
      }),
      problems: [
        ...(cached?.problems ?? []),
        modProblem(
          "info",
          "BASE_GAME_MESH_FORMAT_UNSUPPORTED",
          "The configured base-game mesh decoder does not support this output format for the selected asset.",
          `${renderAsset.assetClass ?? "unknown"} -> ${request.format}`
        )
      ]
    });
  }

  const decoded = await decoder.decode({
    asset: renderAsset,
    detail: renderDetail,
    cookedPayload: baseGameCookedPayloadForAsset(renderAsset),
    format: request.format,
    purpose: "export"
  });

  if (decoded.status !== "ready" || !decoded.data) {
    return CreatorMeshExportResultSchema.parse({
      status:
        decoded.status === "dependency-missing"
          ? "dependency-missing"
            : decoded.status === "decode-error"
              ? "decode-error"
              : "unsupported",
      asset: renderAsset,
      format: request.format,
      destinationPath,
      bytesWritten: null,
      metadata: baseGameModelPreviewMetadata(renderAsset, renderDetail, cached?.entry ?? null, {
        ...(decoded.metadata ?? {}),
        previewSource: "Direct base-game export failed"
      }),
      problems: [
        ...(cached?.problems ?? []),
        ...(resolved.probe?.problems ?? []),
        ...baseGameDecoderProblems(renderAsset, decoded)
      ]
    });
  }

  return writeMeshExportResult({
    asset: renderAsset,
    format: decoded.format ?? request.format,
    destinationPath,
    data: decoded.data,
    metadata: baseGameModelPreviewMetadata(renderAsset, renderDetail, cached?.entry ?? null, {
      ...decoded.metadata,
      previewSource: "Direct decoded base-game export"
    }),
    problems: [
      ...(cached?.problems ?? []),
      ...(resolved.probe?.problems ?? []),
      ...(decoded.problems ?? [])
    ]
  });
}

async function exportCreatorMeshPackage(
  request: CreatorMeshPackageExportRequest,
  index: RuntimeAssetIndex,
  options: BaseGameModelPreviewOptions & { protectedGameRoots: string[] }
) {
  const destinationPath = path.resolve(request.destinationPath);
  const blockedRoot = options.protectedGameRoots.find((root) =>
    isPathInside(root, destinationPath)
  );
  if (blockedRoot) {
    return CreatorMeshPackageExportResultSchema.parse({
      status: "blocked",
      destinationPath,
      bytesWritten: null,
      itemCount: request.assetIds.length,
      exportedCount: 0,
      items: [],
      problems: [
        modProblem(
          "error",
          "CREATOR_MESH_PACKAGE_EXPORT_GAME_PATH_BLOCKED",
          "Creator model package export cannot write into the Clawed game installation.",
          `${destinationPath} inside ${blockedRoot}`
        )
      ]
    });
  }

  const assetIds = [...new Set(request.assetIds)];
  if (!assetIds.length) {
    return CreatorMeshPackageExportResultSchema.parse({
      status: "empty",
      destinationPath,
      bytesWritten: null,
      itemCount: 0,
      exportedCount: 0,
      items: [],
      problems: []
    });
  }

  const items = await Promise.all(
    assetIds.map((assetId, indexInPackage) =>
      creatorMeshPackageItem(assetId, indexInPackage, index, options)
    )
  );
  const exportedItems = items.filter(isExportedMeshPackageItem);

  if (!exportedItems.length) {
    return CreatorMeshPackageExportResultSchema.parse({
      status: "blocked",
      destinationPath,
      bytesWritten: null,
      itemCount: items.length,
      exportedCount: 0,
      items: publicMeshPackageItems(items),
      problems: [
        ...items.flatMap((item) => item.problems),
        modProblem(
          "warning",
          "CREATOR_MESH_PACKAGE_EXPORT_EMPTY",
          "No visible Creator model could be exported into the package."
        )
      ]
    });
  }

  const zip = new JSZip();
  const generatedAt = new Date().toISOString();
  const payloadHashes = exportedItems.map((item) => ({
    path: item.payloadPath,
    sha256: hashBuffer(item.data)
  }));
  for (const item of exportedItems) {
    zip.file(item.payloadPath, item.data);
  }
  zip.file(
    "manifest.json",
    `${JSON.stringify(
      ClawedModManifestV1Schema.parse({
        schemaVersion: 1,
        id: `creator-visible-models-${hashStable(
          `${generatedAt}\0${exportedItems.map((item) => item.asset?.id).join("\0")}`
        )}`,
        name: "Creator Visible Model Export",
        version: "1.0.0",
        author: "Clawed Mod Manager",
        description:
          "Creator export package containing model viewport payloads and metadata.",
        game: "clawed",
        loader: "pak",
        dependencies: [],
        conflicts: [],
        loadAfter: [],
        loadBefore: [],
        creatorAssets: {
          schemaVersion: 1,
          affectedAssets: exportedItems.flatMap((item, itemIndex) =>
            packageAffectedAssetsForItem(item, itemIndex)
          ),
          replacements: [],
          cookTarget: {
            unrealVersion: "5.5",
            platform: "Windows",
            containerFormat: "none",
            requiresAssetRegistry: false,
            toolName: "Clawed Mod Manager"
          },
          supportedSteamBuilds: index.snapshot.map.steamBuildId
            ? [
                {
                  buildId: index.snapshot.map.steamBuildId,
                  status: "authorClaim",
                  evidence: "Creator viewport package export"
                }
              ]
            : [],
          previewAssets: exportedItems.map((item, itemIndex) => ({
            id: `visible-${itemIndex + 1}-preview`,
            payloadPath: item.payloadPath,
            kind: "model",
            assetClass: item.asset?.assetClass ?? "ModelPreview",
            objectPath: item.asset?.objectPath ?? undefined,
            source: "generated",
            format: item.format,
            modelRole: item.metadata.meshType,
            skeleton: item.metadata.skeleton,
            physicsAsset: item.metadata.physicsAsset,
            materialSlots: item.metadata.materialSlots,
            lods: item.metadata.lods,
            dependencyPaths: item.metadata.dependencyPaths
          })),
          importProvenance: [
            {
              sourceKind: "generated",
              sourceName: "CMM visible viewport package export",
              sourceHashes: payloadHashes.map((payload) => ({
                algorithm: "sha256",
                scope: "payload",
                path: payload.path,
                sha256: payload.sha256
              })),
              importedAt: generatedAt,
              toolName: "Clawed Mod Manager",
              rights: exportedItems.some((item) => item.asset?.source === "baseGameMap")
                ? "redistributable"
                : "generated"
            }
          ],
          assetDependencies: exportedItems.flatMap((item, itemIndex) =>
            packageDependenciesForItem(item, itemIndex)
          ),
          exportEligibility: {
            state: "exportable",
            allowedOutputs: [
              "clawedmod",
              "assetIndex",
              "dependencyGraph",
              "conflictReport",
              "validationReport"
            ],
            containsBaseGameContent: exportedItems.some(
              (item) => item.asset?.source === "baseGameMap"
            ),
            requiresUserOwnedSource: false,
            reason:
              "This package contains Creator viewport model payloads exported from visible files."
          }
        }
      }),
      null,
      2
    )}\n`
  );
  zip.file(
    "checksums.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        payload: Object.fromEntries(
          payloadHashes.map((payload) => [payload.path, payload.sha256])
        )
      },
      null,
      2
    )}\n`
  );
  zip.file(
    "README.md",
    [
      "# Creator Visible Model Export",
      "",
      "This package contains model viewport payloads exported from the current visible Creator selection.",
      "It is metadata and creator-source output, not a validated gameplay replacement package.",
      ""
    ].join("\n")
  );

  try {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, await zip.generateAsync({ type: "nodebuffer" }));
    const fileStat = await stat(destinationPath);
    return CreatorMeshPackageExportResultSchema.parse({
      status: exportedItems.length === items.length ? "exported" : "partial",
      destinationPath,
      bytesWritten: fileStat.size,
      itemCount: items.length,
      exportedCount: exportedItems.length,
      items: publicMeshPackageItems(items),
      problems: items.flatMap((item) => item.problems)
    });
  } catch (error) {
    return CreatorMeshPackageExportResultSchema.parse({
      status: "export-error",
      destinationPath,
      bytesWritten: null,
      itemCount: items.length,
      exportedCount: 0,
      items: publicMeshPackageItems(items),
      problems: [
        ...items.flatMap((item) => item.problems),
        modProblem(
          "warning",
          "CREATOR_MESH_PACKAGE_EXPORT_WRITE_FAILED",
          "The Creator model package could not be written to the selected path.",
          error instanceof Error ? error.message : String(error)
        )
      ]
    });
  }
}

type InternalCreatorMeshPackageExportItem = CreatorMeshPackageExportItem & {
  data?: Buffer;
};

type ExportedCreatorMeshPackageItem = InternalCreatorMeshPackageExportItem & {
  status: "exported";
  format: CreatorMeshExportFormat;
  payloadPath: string;
  data: Buffer;
};

function isExportedMeshPackageItem(
  item: InternalCreatorMeshPackageExportItem
): item is ExportedCreatorMeshPackageItem {
  return (
    item.status === "exported" &&
    Boolean(item.payloadPath) &&
    Boolean(item.format) &&
    Boolean(item.data)
  );
}

async function creatorMeshPackageItem(
  assetId: string,
  indexInPackage: number,
  index: RuntimeAssetIndex,
  options: BaseGameModelPreviewOptions
): Promise<InternalCreatorMeshPackageExportItem> {
  const preview = await readModelPreview({ assetId }, index, options);
  const asset = preview.asset;
  if (
    (preview.status !== "available" && preview.status !== "ready") ||
    !preview.model
  ) {
    return {
      asset,
      status: meshPackageItemStatus(preview.status),
      format: preview.model?.format ?? null,
      payloadPath: null,
      bytesWritten: null,
      metadata: preview.metadata,
      problems:
        preview.problems.length > 0
          ? preview.problems
          : [
              modProblem(
                "warning",
                "CREATOR_MESH_PACKAGE_ITEM_UNAVAILABLE",
                "This visible Creator model is not available for package export.",
                assetId
              )
            ]
    };
  }

  try {
    const data = bufferFromDataUrl(preview.model.dataUrl);
    const payloadPath = `payload/creator-exports/${String(
      indexInPackage + 1
    ).padStart(2, "0")}-${sanitizePathSegment(
      path.basename(preview.model.fileName, path.extname(preview.model.fileName))
    )}.${preview.model.format}`;
    return {
      asset,
      status: "exported",
      format: preview.model.format,
      payloadPath,
      bytesWritten: data.byteLength,
      metadata: preview.metadata,
      problems: preview.problems,
      data
    };
  } catch (error) {
    return {
      asset,
      status: "export-error",
      format: preview.model.format,
      payloadPath: null,
      bytesWritten: null,
      metadata: preview.metadata,
      problems: [
        ...preview.problems,
        modProblem(
          "warning",
          "CREATOR_MESH_PACKAGE_ITEM_DATA_INVALID",
          "The visible Creator model data could not be prepared for package export.",
          error instanceof Error ? error.message : String(error)
        )
      ]
    };
  }
}

function publicMeshPackageItems(
  items: InternalCreatorMeshPackageExportItem[]
): CreatorMeshPackageExportItem[] {
  return items.map((item) => {
    const publicItem: Partial<InternalCreatorMeshPackageExportItem> = {
      ...item
    };
    delete publicItem.data;
    return CreatorMeshPackageExportItemSchema.parse(publicItem);
  });
}

function meshPackageItemStatus(
  status: CreatorModelPreviewResult["status"]
): CreatorMeshPackageExportItem["status"] {
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "dependency-missing") {
    return "dependency-missing";
  }
  if (status === "decode-error") {
    return "decode-error";
  }
  if (status === "error" || status === "export-error") {
    return "export-error";
  }
  return "unsupported";
}

function bufferFromDataUrl(dataUrl: string): Buffer {
  const encoded = dataUrl.split(",", 2)[1];
  if (!encoded) {
    throw new Error("Model preview data URL has no payload.");
  }
  return Buffer.from(encoded, "base64");
}

function packageAffectedAssetsForItem(
  item: InternalCreatorMeshPackageExportItem,
  itemIndex: number
) {
  const asset = item.asset;
  const sourceId = `visible-${itemIndex + 1}-source`;
  const exportId = `visible-${itemIndex + 1}-export`;
  return [
    {
      id: sourceId,
      assetClass: asset?.assetClass ?? "ModelPreview",
      packagePath: asset?.packagePath ?? undefined,
      objectPath: asset?.objectPath ?? undefined,
      virtualPath: asset?.virtualPath ?? undefined,
      source:
        asset?.source === "baseGameMap"
          ? "baseGame"
          : asset?.source === "installedPackage" ||
              asset?.source === "packagePayload"
            ? "samePackage"
            : "unknown",
      role: "target",
      tags: asset?.tags ?? []
    },
    {
      id: exportId,
      assetClass: asset?.assetClass ?? "ModelPreview",
      payloadPath: item.payloadPath ?? undefined,
      source: "generated",
      role: "preview",
      tags: uniqueStrings([...(asset?.tags ?? []), "model_visuals"])
    }
  ];
}

function packageDependenciesForItem(
  item: InternalCreatorMeshPackageExportItem,
  itemIndex: number
) {
  const asset = item.asset;
  return item.metadata.dependencyPaths.map((dependencyPath, dependencyIndex) => ({
    fromAssetId: `visible-${itemIndex + 1}-export`,
    toAssetId: `visible-${itemIndex + 1}-dependency-${dependencyIndex + 1}`,
    fromVirtualPath: item.payloadPath
      ? `/Packages/creator-visible-models/${item.payloadPath.replace(
          /^payload\//,
          ""
        )}`
      : undefined,
    toObjectPath: dependencyPath.startsWith("/") ? dependencyPath : undefined,
    toVirtualPath: dependencyPath.startsWith("/") ? undefined : dependencyPath,
    assetClass: asset?.assetClass ?? "ModelPreview",
    relation: "viewport-dependency",
    required: true,
    source: asset?.source === "baseGameMap" ? "baseGame" : "unknown"
  }));
}

async function writeMeshExportResult({
  asset,
  data,
  destinationPath,
  format,
  metadata,
  problems
}: {
  asset: CreatorAssetIndexEntry;
  data: Buffer;
  destinationPath: string;
  format: CreatorMeshExportFormat;
  metadata: CreatorModelPreviewMetadata;
  problems: ModProblem[];
}): Promise<CreatorMeshExportResult> {
  try {
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, data);
    const fileStat = await stat(destinationPath);
    return CreatorMeshExportResultSchema.parse({
      status: "exported",
      asset,
      format,
      destinationPath,
      bytesWritten: fileStat.size,
      metadata,
      problems
    });
  } catch (error) {
    return CreatorMeshExportResultSchema.parse({
      status: "export-error",
      asset,
      format,
      destinationPath,
      bytesWritten: null,
      metadata,
      problems: [
        ...problems,
        modProblem(
          "warning",
          "CREATOR_MESH_EXPORT_WRITE_FAILED",
          "The converted mesh could not be written to the selected export path.",
          error instanceof Error ? error.message : String(error)
        )
      ]
    });
  }
}

function isSupportedBaseGameMeshAsset(asset: CreatorAssetIndexEntry): boolean {
  return isSupportedBaseGameMeshAssetClass(asset.assetClass);
}

function isSupportedBaseGameMeshAssetClass(
  assetClass: string | null | undefined
): boolean {
  return BASE_GAME_MESH_ASSET_CLASSES.has(assetClass ?? "");
}

function shouldProbeBaseGameMeshAsset(asset: CreatorAssetIndexEntry): boolean {
  if (
    asset.source !== "baseGameMap" ||
    (asset.extension ?? "").toLowerCase() !== ".uasset"
  ) {
    return false;
  }
  if (isSupportedBaseGameMeshAsset(asset)) {
    return true;
  }
  return asset.assetClass === "CookedUnrealAsset";
}

function baseGameMeshProbeKey(
  asset: CreatorAssetIndexEntry,
  purpose: BaseGameMeshProbeRequest["purpose"]
): string {
  return [
    purpose,
    asset.id,
    asset.sha256 ?? "",
    asset.objectPath ?? "",
    asset.packagePath ?? "",
    asset.relativePath ?? ""
  ].join("\0");
}

async function resolveBaseGameRenderableAsset(
  asset: CreatorAssetIndexEntry,
  options: BaseGameModelPreviewOptions,
  purpose: BaseGameMeshProbeRequest["purpose"]
): Promise<{
  asset: CreatorAssetIndexEntry | null;
  probe: BaseGameMeshProbeResult | null;
}> {
  const probe = options.resolveBaseGameMeshProbe
    ? await options.resolveBaseGameMeshProbe(asset, purpose)
    : null;
  if (probe?.status === "ready") {
    if (!isSupportedBaseGameMeshAssetClass(probe.assetClass)) {
      return { asset: null, probe: { ...probe, status: "unsupported" } };
    }
    return {
      asset: assetWithBaseGameMeshClass(asset, probe.assetClass as string),
      probe
    };
  }
  if (probe) {
    return { asset: null, probe };
  }
  if (isSupportedBaseGameMeshAsset(asset)) {
    return { asset, probe };
  }
  return { asset: null, probe };
}

function assetWithBaseGameMeshClass(
  asset: CreatorAssetIndexEntry,
  assetClass: string
): CreatorAssetIndexEntry {
  return CreatorAssetIndexEntrySchema.parse({
    ...asset,
    assetClass,
    viewportState: "viewable",
    exportState: "exportable"
  });
}

function detailWithAsset(
  detail: CreatorAssetDetail,
  asset: CreatorAssetIndexEntry
): CreatorAssetDetail {
  return { ...detail, asset };
}

function baseGameProbeFailureStatus(
  probe: BaseGameMeshProbeResult | null
): "unsupported" | "dependency-missing" | "decode-error" {
  if (probe?.status === "dependency-missing") {
    return "dependency-missing";
  }
  if (probe?.status === "decode-error") {
    return "decode-error";
  }
  return "unsupported";
}

function baseGameProbeProblems(
  asset: CreatorAssetIndexEntry,
  probe: BaseGameMeshProbeResult | null
): ModProblem[] {
  if (probe?.problems?.length) {
    return probe.problems;
  }
  return [
    modProblem(
      "info",
      "BASE_GAME_MODEL_PREVIEW_UNSUPPORTED_ASSET_CLASS",
      "Only base-game StaticMesh, SkeletalMesh, and Skeleton assets can be decoded for the Creator viewport.",
      decoderTechnicalDetail(asset, "resolve-asset", "unsupported asset class")
    )
  ];
}

function viewportStateForEntry(
  entry: CreatorAssetIndexEntry
): "none" | "viewable" {
  return isRenderableModelAsset(entry) ? "viewable" : "none";
}

function isRenderableModelAsset(entry: CreatorAssetIndexEntry): boolean {
  if (entry.source === "baseGameMap") {
    return isSupportedBaseGameMeshAsset(entry) || isLikelyBaseGameMeshAsset(entry);
  }

  return (
    ["StaticMesh", "SkeletalMesh", "Skeleton", "ModelPreview"].includes(
      entry.assetClass ?? ""
    ) || isModelPayloadAsset(entry)
  );
}

function isLikelyBaseGameMeshAsset(entry: CreatorAssetIndexEntry): boolean {
  if (
    entry.source !== "baseGameMap" ||
    entry.assetClass !== "CookedUnrealAsset" ||
    (entry.extension ?? "").toLowerCase() !== ".uasset"
  ) {
    return false;
  }

  const lowerPath = [
    entry.objectPath,
    entry.packagePath,
    entry.relativePath,
    entry.label
  ]
    .filter(Boolean)
    .join("/")
    .toLowerCase();
  const stem = baseGameAssetStem(entry)?.toLowerCase() ?? "";

  return (
    entry.tags.includes("model_visuals") ||
    isMeshDirectoryPath(lowerPath) ||
    stem.startsWith("sm_") ||
    stem.startsWith("sk_") ||
    stem.startsWith("skm_")
  );
}

function isModelPayloadAsset(entry: CreatorAssetIndexEntry): boolean {
  return packagePayloadModelFormat(entry) !== null;
}

function packagePayloadModelFormat(
  entry: CreatorAssetIndexEntry
): CreatorMeshExportFormat | null {
  const format = (entry.extension ?? path.posix.extname(entry.payloadPath ?? ""))
    .replace(".", "")
    .toLowerCase();
  return MODEL_PREVIEW_FORMATS.has(format)
    ? (format as CreatorMeshExportFormat)
    : null;
}

function baseGameCookedPayloadForAsset(
  asset: CreatorAssetIndexEntry
): BaseGameCookedPayload {
  return {
    objectPath: asset.objectPath,
    packagePath: asset.packagePath,
    relativePath: asset.relativePath,
    containerName: asset.containerName,
    extension: asset.extension,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256
  };
}

async function isDecoderAvailable(
  decoder: BaseGameMeshDecoder | null
): Promise<boolean> {
  if (!decoder) {
    return false;
  }

  return decoder.isAvailable ? Boolean(await decoder.isAvailable()) : true;
}

function decoderSupportsFormat(
  decoder: BaseGameMeshDecoder,
  format: CreatorMeshExportFormat,
  asset: CreatorAssetIndexEntry
): boolean {
  return decoder.supportsFormat ? decoder.supportsFormat(format, asset) : true;
}

function baseGameDecoderProblems(
  asset: CreatorAssetIndexEntry,
  decoded: BaseGameMeshDecodeResult
): ModProblem[] {
  if (decoded.problems?.length) {
    return decoded.problems;
  }

  if (decoded.status === "dependency-missing") {
    return [
      modProblem(
        "warning",
        "BASE_GAME_MESH_DEPENDENCY_MISSING",
        "A required mesh dependency could not be resolved.",
        decoderTechnicalDetail(asset, "resolve-dependency", "dependency missing")
      )
    ];
  }

  if (decoded.status === "decode-error") {
    return [
      modProblem(
        "warning",
        "BASE_GAME_MESH_DECODE_FAILED",
        "The base-game mesh decoder could not convert the cooked Unreal asset.",
        decoderTechnicalDetail(asset, "decode", "decoder failed")
      )
    ];
  }

  return [
    modProblem(
      "info",
      "BASE_GAME_MESH_FORMAT_UNSUPPORTED",
      "The base-game mesh decoder does not support this asset or output format.",
      decoderTechnicalDetail(asset, "convert", decoded.status)
    )
  ];
}

function decoderTechnicalDetail(
  asset: CreatorAssetIndexEntry,
  stage: string,
  reason: string
): string {
  return JSON.stringify({
    objectPath: asset.objectPath,
    packagePath: asset.packagePath,
    assetClass: asset.assetClass,
    containerName: asset.containerName,
    relativePath: asset.relativePath,
    stage,
    reason,
    fallbackAttempted: true,
    cacheAttempted: true,
    directDecodeAttempted: true
  });
}

function preferredBaseGamePreviewFormat(
  asset: CreatorAssetIndexEntry
): CreatorMeshExportFormat {
  return asset.assetClass === "Skeleton" ? "gltf" : "glb";
}

function dataUrlForModel(data: Buffer, format: CreatorMeshExportFormat): string {
  return `data:${modelPreviewMimeType(format)};base64,${data.toString("base64")}`;
}

function baseGameMeshFileName(
  asset: CreatorAssetIndexEntry,
  format: CreatorMeshExportFormat
): string {
  return `${sanitizePathSegment(
    path.posix.basename(asset.packagePath ?? asset.objectPath ?? asset.label)
  )}.${format}`;
}

function meshPreviewRoleForAsset(
  asset: CreatorAssetIndexEntry
): "staticMesh" | "skeletalMesh" | "skeleton" | "unknown" {
  if (asset.assetClass === "StaticMesh") {
    return "staticMesh";
  }
  if (asset.assetClass === "SkeletalMesh") {
    return "skeletalMesh";
  }
  if (asset.assetClass === "Skeleton") {
    return "skeleton";
  }
  return "unknown";
}

function meshPreviewRoleForAssetOrUnknown(
  asset: CreatorAssetIndexEntry | null
): "staticMesh" | "skeletalMesh" | "skeleton" | "unknown" {
  return asset ? meshPreviewRoleForAsset(asset) : "unknown";
}

function dependencyPathByRelation(
  dependencies: CreatorAssetDependency[],
  relation: "skeleton" | "physicsAsset"
): string | null {
  const dependency = dependencies.find(
    (candidate) => candidate.relation === relation
  );
  return (
    dependency?.toObjectPath ??
    dependency?.toPackagePath ??
    dependency?.toVirtualPath ??
    null
  );
}

function firstKnownLodValue(
  lods: CreatorPreviewAsset["lods"],
  key: "vertexCount" | "triangleCount"
): number | null {
  return lods.find((lod) => lod[key] !== null)?.[key] ?? null;
}

function sanitizePathSegment(value: string): string {
  return (
    Array.from(value)
      .map((character) =>
        character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
          ? "-"
          : character
      )
      .join("")
      .trim() || "creator-mesh"
  );
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nullableStringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function modelPreviewFormatField(
  value: unknown
): CreatorModelPreviewFormat | undefined {
  return typeof value === "string" && MODEL_PREVIEW_FORMATS.has(value)
    ? (value as CreatorModelPreviewFormat)
    : undefined;
}

function materialSlotsField(
  value: unknown
): CreatorPreviewAsset["materialSlots"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const name = stringField(record.name);
    if (!name) {
      return [];
    }
    return [
      {
        name,
        materialPath: nullableStringField(record.materialPath)
      }
    ];
  });
}

function lodsField(value: unknown): CreatorPreviewAsset["lods"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const index = integerField(record.index);
    if (index === null || index < 0) {
      return [];
    }
    return [
      {
        index,
        screenSize: numberField(record.screenSize),
        triangleCount: integerField(record.triangleCount),
        vertexCount: integerField(record.vertexCount)
      }
    ];
  });
}

function integerField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function modelPreviewMetadata(
  asset: CreatorAssetIndexEntry | null,
  preview: CreatorPreviewAsset | null,
  detail: CreatorAssetDetail | null
) {
  const dependencyPaths = uniqueStrings([
    ...(preview?.dependencyPaths ?? []),
    ...((detail?.dependencies ?? []).flatMap((dependency) => [
      dependency.toObjectPath,
      dependency.toPackagePath,
      dependency.toVirtualPath,
      dependency.objectPath,
      dependency.packagePath
    ]) as Array<string | undefined>)
  ].filter((value): value is string => Boolean(value)));

  return {
    meshType: preview?.modelRole ?? meshPreviewRoleForAssetOrUnknown(asset),
    skeleton: preview?.skeleton ?? null,
    physicsAsset: preview?.physicsAsset ?? null,
    materialSlots: preview?.materialSlots ?? [],
    lods: preview?.lods ?? [],
    dependencyPaths,
    targetObjectPath: preview?.objectPath ?? asset?.objectPath ?? null,
    packagePath: asset?.packagePath ?? null,
    packageSource: asset?.packageName ?? asset?.ownerLabel ?? null,
    sourceContainer: asset?.containerName ?? null,
    previewSource:
      preview?.source === "generated"
        ? "Generated package preview"
        : preview?.source === "userOwned"
          ? "User-owned package preview"
          : null,
    lodCount: preview?.lods.length ? preview.lods.length : null,
    vertexCount:
      preview?.lods.find((lod) => lod.vertexCount !== null)?.vertexCount ?? null,
    triangleCount:
      preview?.lods.find((lod) => lod.triangleCount !== null)?.triangleCount ??
      null,
    materialSlotCount: preview?.materialSlots.length
      ? preview.materialSlots.length
      : null,
    validationState: asset?.validationState ?? null,
    conflictWinner: detail?.activeWinner
      ? `${detail.activeWinner.packageName} ${detail.activeWinner.packageVersion}`
      : null,
    exportState: asset?.exportState ?? null
  };
}

function packageRecordForAsset(
  asset: CreatorAssetIndexEntry,
  index: RuntimeAssetIndex
): InstalledModManifestRecord | null {
  if (!asset.packageId || !asset.packageVersion) {
    return null;
  }

  return index.recordsByPackage.get(
    packageKeyOf(asset.packageId, asset.packageVersion)
  ) ?? null;
}

function supportedModelPreviewFormat(
  preview: CreatorPreviewAsset
): "gltf" | "glb" | "obj" | null {
  if (preview.format === "metadataOnly") {
    return null;
  }

  const declared = preview.format !== "unknown" ? preview.format : null;
  const inferred = path.posix
    .extname(normalizeArchivePath(preview.payloadPath))
    .slice(1)
    .toLowerCase();
  const candidate = declared ?? inferred;

  return MODEL_PREVIEW_FORMATS.has(candidate)
    ? (candidate as "gltf" | "glb" | "obj")
    : null;
}

function modelPreviewMimeType(
  format: Exclude<CreatorModelPreviewFormat, "metadataOnly" | "unknown">
): string {
  if (format === "glb") {
    return "model/gltf-binary";
  }
  if (format === "gltf") {
    return "model/gltf+json";
  }
  return "text/plain";
}

function conflictsForTargetKey(
  targetKey: string,
  index: RuntimeAssetIndex,
  asset: CreatorAssetIndexEntry
): CreatorAssetConflict[] {
  const conflicts = index.conflicts.filter(
    (conflict) => conflict.targetKey === targetKey
  );
  return conflicts.length
    ? conflicts
    : [
        emptyConflictForTarget(
          targetKey,
          index.entriesByTargetKey.get(targetKey) ?? [asset],
          {}
        )
      ];
}

function relatedAssetsFor(
  asset: CreatorAssetIndexEntry,
  index: RuntimeAssetIndex
): CreatorAssetIndexEntry[] {
  const targetKey = targetKeyForEntry(asset);
  const packageKey = asset.packageId
    ? packageKeyOf(asset.packageId, asset.packageVersion ?? "")
    : null;

  return index.entries
    .filter((entry) => entry.id !== asset.id)
    .filter((entry) => {
      if (targetKey && targetKeyForEntry(entry) === targetKey) {
        return true;
      }
      if (
        packageKey &&
        entry.packageId &&
        packageKeyOf(entry.packageId, entry.packageVersion ?? "") === packageKey
      ) {
        return true;
      }
      return false;
    })
    .slice(0, 24);
}

function baseGameMeshDependenciesForAsset(
  asset: CreatorAssetIndexEntry,
  index: RuntimeAssetIndex
): CreatorAssetDependency[] {
  if (!isSupportedBaseGameMeshAsset(asset)) {
    return [];
  }

  const directory = baseGameAssetDirectory(asset);
  const assetStem = baseGameAssetStem(asset);
  const siblings = index.entries.filter(
    (entry) =>
      entry.source === "baseGameMap" &&
      entry.id !== asset.id &&
      baseGameAssetDirectory(entry) === directory
  );
  const skeleton = siblings.find(
    (entry) =>
      entry.assetClass === "Skeleton" &&
      baseGameStemsMatch(assetStem, baseGameAssetStem(entry))
  );
  const physicsAsset = siblings.find(
    (entry) =>
      entry.assetClass === "PhysicsAsset" &&
      baseGameStemsMatch(assetStem, baseGameAssetStem(entry))
  );

  return [skeleton, physicsAsset]
    .filter((entry): entry is CreatorAssetIndexEntry => Boolean(entry))
    .map((entry) => ({
      fromAssetId: asset.id,
      toAssetId: entry.id,
      fromPackagePath: asset.packagePath ?? undefined,
      fromObjectPath: asset.objectPath ?? undefined,
      fromVirtualPath: asset.virtualPath ?? undefined,
      toPackagePath: entry.packagePath ?? undefined,
      toObjectPath: entry.objectPath ?? undefined,
      toVirtualPath: entry.virtualPath ?? undefined,
      assetClass: entry.assetClass ?? undefined,
      relation: entry.assetClass === "Skeleton" ? "skeleton" : "physicsAsset",
      required: entry.assetClass === "Skeleton",
      source: "baseGame" as const
    }));
}

function baseGameAssetDirectory(asset: CreatorAssetIndexEntry): string | null {
  const value = asset.packagePath ?? asset.objectPath ?? asset.relativePath;
  if (!value) {
    return null;
  }
  return path.posix.dirname(value.replaceAll("\\", "/")).toLowerCase();
}

function baseGameAssetStem(asset: CreatorAssetIndexEntry): string {
  const value = asset.packagePath ?? asset.objectPath ?? asset.relativePath ?? asset.label;
  const baseName = path.posix.basename(value.replaceAll("\\", "/")).split(".")[0];
  return baseName
    .toLowerCase()
    .replace(/^(sm|sk|skm|skel|phys|pa)_/, "")
    .replace(/_(skeleton|physicsasset|physics|phys)$/, "");
}

function baseGameStemsMatch(left: string, right: string): boolean {
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function filterChecksumsForAsset(
  checksums: CreatorAssetChecksum[],
  asset: CreatorAssetIndexEntry
): CreatorAssetChecksum[] {
  if (!asset.payloadPath && !asset.relativePath) {
    return checksums;
  }

  const payloadPath = asset.payloadPath
    ? normalizeArchivePath(asset.payloadPath)
    : null;
  const relativePath = asset.relativePath
    ? normalizeArchivePath(asset.relativePath)
    : null;

  return checksums.filter((checksum) => {
    if (!checksum.path) {
      return true;
    }
    const checksumPath = normalizeArchivePath(checksum.path);
    return checksumPath === payloadPath || checksumPath === relativePath;
  });
}

function entryMatchesSearch(
  entry: CreatorAssetIndexEntry,
  request: CreatorAssetSearchRequest
): boolean {
  if (request.source !== "all" && entry.source !== request.source) {
    return false;
  }
  if (request.packageId && entry.packageId !== request.packageId) {
    return false;
  }
  if (request.activeOnly && !entry.activeProfileEnabled) {
    return false;
  }
  if (
    request.conflictState !== "any" &&
    entry.conflictState !== request.conflictState
  ) {
    return false;
  }
  if (request.validationState && entry.validationState !== request.validationState) {
    return false;
  }
  if (request.exportState !== "any" && entry.exportState !== request.exportState) {
    return false;
  }
  if (
    request.assetClass &&
    !entry.assetClass?.toLowerCase().includes(request.assetClass.toLowerCase())
  ) {
    return false;
  }
  if (
    request.physicalPath.trim() &&
    !entryPhysicalPath(entry).includes(request.physicalPath.trim().toLowerCase())
  ) {
    return false;
  }
  if (
    request.objectPath.trim() &&
    !entryObjectPath(entry).includes(request.objectPath.trim().toLowerCase())
  ) {
    return false;
  }
  if (
    request.modUse.trim() &&
    !entry.modUses?.toLowerCase().includes(request.modUse.trim().toLowerCase())
  ) {
    return false;
  }
  if (
    request.tags.length > 0 &&
    !request.tags.every((tag) =>
      entry.tags.some(
        (entryTag) => entryTag.toLowerCase() === tag.toLowerCase()
      )
    )
  ) {
    return false;
  }

  const query = request.query.trim().toLowerCase();
  if (!query) {
    return true;
  }

  const haystack = [
    entry.label,
    entry.ownerLabel,
    entry.packageId,
    entry.packageName,
    entry.containerName,
    entry.assetClass,
    entry.packagePath,
    entry.objectPath,
    entry.virtualPath,
    entry.payloadPath,
    entry.relativePath,
    entry.tags.join(" "),
    entry.modUses,
    entry.exportState,
    entry.conflictState,
    entry.validationState
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return query.split(/\s+/).every((term) => haystack.includes(term));
}

function compareSearchEntries(
  left: CreatorAssetIndexEntry,
  right: CreatorAssetIndexEntry,
  request: CreatorAssetSearchRequest
): number {
  if (request.sortBy === "relevance") {
    return compareEntries(left, right);
  }

  return (
    compareSortValues(sortValue(left, request), sortValue(right, request)) ||
    compareEntries(left, right)
  );
}

function sortValue(
  entry: CreatorAssetIndexEntry,
  request: CreatorAssetSearchRequest
): string | number | null {
  if (request.sortBy === "label") {
    return entry.label;
  }
  if (request.sortBy === "source") {
    return entry.source;
  }
  if (request.sortBy === "physicalPath") {
    return entry.relativePath ?? entry.payloadPath ?? entry.virtualPath;
  }
  if (request.sortBy === "objectPath") {
    return entry.objectPath ?? entry.packagePath ?? entry.virtualPath;
  }
  if (request.sortBy === "assetClass") {
    return entry.assetClass;
  }
  if (request.sortBy === "modUse") {
    return entry.modUses;
  }
  if (request.sortBy === "package") {
    return entry.packageName ?? entry.packageId ?? entry.ownerLabel;
  }
  if (request.sortBy === "validationState") {
    return entry.validationState;
  }
  if (request.sortBy === "conflictState") {
    return entry.conflictState;
  }
  if (request.sortBy === "exportState") {
    return entry.exportState;
  }
  if (request.sortBy === "activeProfileOrder") {
    return entry.activeProfileOrder;
  }
  return entry.label;
}

function compareSortValues(
  left: string | number | null,
  right: string | number | null
): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

function entryPhysicalPath(entry: CreatorAssetIndexEntry): string {
  return [
    entry.relativePath,
    entry.payloadPath,
    entry.virtualPath,
    entry.containerName
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function entryObjectPath(entry: CreatorAssetIndexEntry): string {
  return [entry.objectPath, entry.packagePath, entry.virtualPath]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function compareEntries(
  left: CreatorAssetIndexEntry,
  right: CreatorAssetIndexEntry
): number {
  return (
    sourceRank(left) - sourceRank(right) ||
    left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id)
  );
}

function sourceRank(entry: CreatorAssetIndexEntry): number {
  if (entry.conflictState === "winner") {
    return 0;
  }
  if (entry.activeProfileEnabled && entry.source === "installedPackage") {
    return 1;
  }
  if (entry.source === "installedPackage") {
    return 2;
  }
  if (entry.source === "packagePayload") {
    return 3;
  }
  if (entry.source === "baseGameMap") {
    return 4;
  }
  return 5;
}

function defaultEligibility(entry: CreatorAssetIndexEntry): CreatorExportEligibility {
  if (entry.source === "baseGameMap") {
    if (isSupportedBaseGameMeshAsset(entry)) {
      return {
        state: "exportable",
        allowedOutputs: [
          "obj",
          "gltf",
          "glb",
          "assetIndex",
          "targetTemplate",
          "dependencyGraph",
          "conflictReport",
          "validationReport"
        ],
        containsBaseGameContent: true,
        requiresUserOwnedSource: false,
        reason:
          "Base-game model export is enabled when CMM can decode and convert the cooked model payload."
      };
    }

    return {
      state: "indexOnly",
      allowedOutputs: [
        "assetIndex",
        "targetTemplate",
        "dependencyGraph",
        "conflictReport",
        "validationReport"
      ],
      containsBaseGameContent: true,
      requiresUserOwnedSource: false,
      reason: "Only index-style export is allowed for this base-game asset class."
    };
  }

  if (entry.source === "deployment") {
    return {
      state: "indexOnly",
      allowedOutputs: [
        "assetIndex",
        "targetTemplate",
        "dependencyGraph",
        "conflictReport",
        "validationReport"
      ],
      containsBaseGameContent: false,
      requiresUserOwnedSource: false,
      reason: "Only index-style export is allowed for this asset entry."
    };
  }

  return {
    state: "unknown",
    allowedOutputs: ["assetIndex", "conflictReport", "validationReport"],
    containsBaseGameContent: false,
    requiresUserOwnedSource: true,
    reason:
      "This package does not declare creator export rights for reusable asset output."
  };
}

function isOutputAllowed(
  output: CreatorExportOutput,
  eligibility: CreatorExportEligibility
): boolean {
  if (!eligibility.allowedOutputs.includes(output)) {
    return false;
  }
  if (eligibility.state === "blocked" || eligibility.state === "unknown") {
    return false;
  }
  if (
    eligibility.state === "indexOnly" &&
    ["clawedmod", "clawedpack"].includes(output)
  ) {
    return false;
  }

  return true;
}

function isMeshExportOutput(output: CreatorExportOutput): output is CreatorMeshExportFormat {
  return MESH_EXPORT_FORMATS.has(output);
}

async function meshExportPlanBlockReason(
  asset: CreatorAssetIndexEntry,
  output: CreatorMeshExportFormat,
  decoderAvailable: boolean,
  baseGamePreviewRoot: string | null,
  decoder: BaseGameMeshDecoder | null,
  resolveBaseGameMeshProbe?: BaseGameMeshProbeResolver
): Promise<string | null> {
  if (asset.source !== "baseGameMap") {
    return "Only indexed base-game model assets can use direct mesh export.";
  }
  const resolved = await resolveBaseGameRenderableAsset(
    asset,
    {
      baseGamePreviewRoot,
      baseGameMeshDecoder: decoder,
      resolveBaseGameMeshProbe
    },
    "export"
  );
  if (!resolved.asset) {
    return resolved.probe?.problems?.[0]?.message ?? "Unsupported asset class.";
  }
  const renderAsset = resolved.asset;
  const cached = baseGamePreviewRoot
    ? await findCachedBaseGamePreview(renderAsset, baseGamePreviewRoot)
    : null;
  if (cached && supportedCachedBaseGamePreviewFormat(cached) === output) {
    return null;
  }
  if (decoderAvailable && decoder) {
    return decoderSupportsFormat(decoder, output, renderAsset)
      ? null
      : "The configured base-game mesh decoder does not support this output format for this asset.";
  }
  return "No base-game mesh decoder is configured for cooked Unreal mesh conversion.";
}

function creatorReportFileName(
  output: CreatorAssetReportOutput,
  generatedAt: string
): string {
  const stamp = generatedAt.replace(/[.:]/g, "-");
  const extension =
    output === "assetIndex" || output === "dependencyGraph" ? "json" : "txt";
  return `creator-${output}-${stamp}.${extension}`;
}

function reportMimeType(
  output: CreatorAssetReportOutput
): "application/json" | "text/plain" {
  return output === "assetIndex" || output === "dependencyGraph"
    ? "application/json"
    : "text/plain";
}

function formatCreatorReport(
  output: CreatorAssetReportOutput,
  details: CreatorAssetDetail[],
  index: RuntimeAssetIndex
): string {
  if (output === "assetIndex") {
    return JSON.stringify(
      {
        generatedAt: index.generatedAt,
        activeProfile: index.snapshot.activeProfile,
        assets: details.map((detail) => ({
          asset: detail.asset,
          relatedAssets: detail.relatedAssets,
          conflicts: detail.conflicts,
          activeWinner: detail.activeWinner,
          previews: detail.previews,
          checksums: detail.checksums,
          dependencies: detail.dependencies
        }))
      },
      null,
      2
    );
  }

  if (output === "dependencyGraph") {
    const nodes = new Map<string, CreatorAssetIndexEntry>();
    const edges = details.flatMap((detail) => {
      if (detail.asset) {
        nodes.set(detail.asset.id, detail.asset);
      }
      for (const related of detail.relatedAssets) {
        nodes.set(related.id, related);
      }
      return detail.dependencies.map((dependency) => ({
        fromAssetId: dependency.fromAssetId ?? detail.asset?.id ?? null,
        toAssetId: dependency.toAssetId ?? null,
        fromPackagePath: dependency.fromPackagePath ?? null,
        fromObjectPath: dependency.fromObjectPath ?? null,
        fromVirtualPath: dependency.fromVirtualPath ?? detail.asset?.virtualPath ?? null,
        toPackagePath: dependency.toPackagePath ?? dependency.packagePath ?? null,
        toObjectPath: dependency.toObjectPath ?? dependency.objectPath ?? null,
        toVirtualPath: dependency.toVirtualPath ?? null,
        assetClass: dependency.assetClass ?? null,
        relation: dependency.relation,
        required: dependency.required,
        source: dependency.source
      }));
    });

    return JSON.stringify(
      {
        generatedAt: index.generatedAt,
        activeProfile: index.snapshot.activeProfile,
        nodes: [...nodes.values()],
        edges,
        conflicts: details.flatMap((detail) => detail.conflicts)
      },
      null,
      2
    );
  }

  if (output === "conflictReport") {
    return [
      `Creator Conflict Report`,
      `Generated: ${index.generatedAt}`,
      `Active profile: ${index.snapshot.activeProfile.name}`,
      "",
      ...details.flatMap((detail) => {
        const asset = detail.asset;
        if (!asset) {
          return [];
        }

        return [
          `Asset: ${asset.label}`,
          `Source: ${asset.source}`,
          `Path: ${asset.objectPath ?? asset.packagePath ?? asset.relativePath ?? asset.payloadPath ?? asset.virtualPath ?? "unknown"}`,
          `Conflict state: ${asset.conflictState}`,
          `Active winner: ${detail.activeWinner?.packageName ?? "none"}`,
          ...detail.conflicts.flatMap((conflict) => [
            `Target: ${conflict.targetObjectPath ?? conflict.targetPackagePath ?? conflict.targetKey}`,
            `Base game present: ${conflict.baseGamePresent ? "yes" : "no"}`,
            `Target virtual path: ${conflict.targetVirtualPath ?? "unknown"}`,
            `Load-order effects: ${conflict.loadOrderEffects.length}`,
            ...conflict.entries.map(
              (entry) =>
                `- ${entry.packageName} ${entry.packageVersion}: ${
                  entry.enabled ? "enabled" : "installed"
                }${entry.isWinner ? ", winner" : ""}, order ${
                  entry.profileOrder ?? "none"
                }, ${entry.validationState}, ${entry.deploymentRoute}, dependencies ${
                  entry.dependencies.length
                }, explicit conflicts ${entry.explicitConflicts.join(", ") || "none"}, loadAfter ${
                  entry.loadAfter.join(", ") || "none"
                }, loadBefore ${
                  entry.loadBefore.join(", ") || "none"
                }, effects ${
                  entry.loadOrderEffects.map((effect) => effect.code).join(", ") ||
                  "none"
                }`
            )
          ]),
          ""
        ];
      })
    ].join("\n");
  }

  return [
    `Creator Validation Report`,
    `Generated: ${index.generatedAt}`,
    `Active profile: ${index.snapshot.activeProfile.name}`,
    "",
    ...details.flatMap((detail) => {
      const asset = detail.asset;
      if (!asset) {
        return [];
      }

      return [
        `Asset: ${asset.label}`,
        `Source: ${asset.source}`,
        `Validation: ${asset.validationState ?? "not declared"}`,
        `Deployment route: ${asset.deploymentRoute ?? "not declared"}`,
        `Export state: ${asset.exportState ?? "unknown"}`,
        `Checksum records: ${detail.checksums.length}`,
        `Dependency records: ${detail.dependencies.length}`,
        `Conflict graph targets: ${detail.conflicts.length}`,
        `Load-order effects: ${detail.conflicts
          .flatMap((conflict) => conflict.loadOrderEffects)
          .map((effect) => effect.code)
          .join(", ") || "none"}`,
        ""
      ];
    })
  ].join("\n");
}

function targetKeyForEntry(entry: CreatorAssetIndexEntry): string | null {
  return targetKeyFromPaths(entry.objectPath, entry.packagePath, entry.virtualPath);
}

function targetKeyFromPaths(
  objectPath: string | null | undefined,
  packagePath: string | null | undefined,
  virtualPath?: string | null
): string | null {
  if (objectPath) {
    return `object:${normalizeUnrealPath(objectPath).toLowerCase()}`;
  }
  if (packagePath) {
    return `package:${normalizeUnrealPath(packagePath).toLowerCase()}`;
  }
  if (virtualPath) {
    return `virtual:${virtualPath.replaceAll("\\", "/").toLowerCase()}`;
  }

  return null;
}

function baseVirtualPath(rowPath: string): string {
  return `/Clawed/Base/${rowPath.replaceAll("\\", "/")}`;
}

function packageVirtualPath(packageId: string, version: string): string {
  return `/Packages/${packageId}/${version}`;
}

function payloadVirtualPath(
  packageId: string,
  version: string,
  payloadPath: string
): string {
  return `${packageVirtualPath(packageId, version)}/${payloadPath
    .replaceAll("\\", "/")
    .replace(/^payload\//, "")}`;
}

function containerNameFromPayload(
  payloadPath: string | null | undefined
): string | null {
  if (!payloadPath) {
    return null;
  }

  const normalized = normalizeArchivePath(payloadPath);
  const containerMatch = normalized.match(/([^/]+(?:\.pak|\.utoc|\.ucas))$/i);
  return containerMatch?.[1] ?? null;
}

function deploymentVirtualPath(manifestId: string, relativePath: string): string {
  return `/Deployment/${manifestId}/${relativePath.replaceAll("\\", "/")}`;
}

function packagePathFromObjectPath(objectPath: string): string {
  return objectPath.split(".")[0];
}

function packagePathFromGamePath(
  gamePath: string,
  extension: string | null | undefined
): string | null {
  const normalized = gamePath.replaceAll("\\", "/");
  const extensionValue = extension ?? path.posix.extname(normalized);
  if (![".uasset", ".umap"].includes(extensionValue.toLowerCase())) {
    return null;
  }

  const withoutExtension = normalized.slice(0, -extensionValue.length);
  if (withoutExtension.startsWith("Clawed/Content/")) {
    return `/Game/${withoutExtension.slice("Clawed/Content/".length)}`;
  }
  if (withoutExtension.startsWith("Engine/Content/")) {
    return `/Engine/${withoutExtension.slice("Engine/Content/".length)}`;
  }

  return withoutExtension.startsWith("/Game/") ? withoutExtension : null;
}

function inferAssetClass(
  extension: string | null | undefined,
  filePath: string,
  tags: string[]
): string | null {
  const lowerExtension = (extension ?? "").toLowerCase();
  const lowerPath = filePath.toLowerCase();

  if (lowerExtension === ".umap" || tags.includes("map_level")) {
    return "World";
  }
  if (lowerExtension === ".uasset") {
    const fileName = path.posix
      .basename(filePath.replaceAll("\\", "/"))
      .toLowerCase();
    const fileStem = fileName.replace(/\.[^.]+$/, "");
    if (lowerPath.includes("/textures/") || lowerPath.includes("/texture/")) {
      return "Texture2D";
    }
    if (lowerPath.includes("/materials/") || lowerPath.includes("/material/")) {
      return "Material";
    }
    if (
      fileStem.startsWith("skel_") ||
      fileStem.includes("_skeleton") ||
      lowerPath.includes("/skeletons/")
    ) {
      return "Skeleton";
    }
    if (
      fileStem.startsWith("phys_") ||
      fileStem.startsWith("pa_") ||
      lowerPath.includes("/physics/") ||
      tags.includes("rig_skeleton_physics")
    ) {
      return "PhysicsAsset";
    }
    if (isAnimationAssetFileName(fileStem) || tags.includes("animation")) {
      return animationAssetClass(fileStem);
    }
    if (fileStem.startsWith("sk_") || fileStem.startsWith("skm_")) {
      return "SkeletalMesh";
    }
    if (fileStem.startsWith("sm_")) {
      return "StaticMesh";
    }
    if (isMeshDirectoryPath(lowerPath)) {
      if (
        fileStem.startsWith("sk_") ||
        fileStem.startsWith("skm_") ||
        tags.includes("character_model_animation")
      ) {
        return "SkeletalMesh";
      }
      return "StaticMesh";
    }
    if (tags.includes("model_visuals")) {
      if (fileStem.startsWith("sk_") || fileStem.startsWith("skm_")) {
        return "SkeletalMesh";
      }
      if (fileStem.startsWith("sm_")) {
        return "StaticMesh";
      }
    }
    if (tags.includes("animation")) {
      return "AnimSequence";
    }
    if (tags.includes("audio")) {
      return "SoundWave";
    }
    return "CookedUnrealAsset";
  }
  if ([".pak", ".utoc", ".ucas"].includes(lowerExtension)) {
    return "PakIoStoreContainer";
  }
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(lowerExtension)) {
    return "Image";
  }
  if ([".wav", ".ogg", ".mp3"].includes(lowerExtension)) {
    return "Audio";
  }
  if ([".gltf", ".glb", ".obj"].includes(lowerExtension)) {
    return "ModelPreview";
  }
  if ([".lua", ".json", ".ini", ".txt", ".md"].includes(lowerExtension)) {
    return "SupportFile";
  }

  return null;
}

function isAnimationAssetFileName(fileName: string): boolean {
  return (
    fileName.endsWith("_bs") ||
    fileName.includes("_bs_") ||
    fileName.endsWith("_blendspace") ||
    fileName.includes("_blendspace_") ||
    fileName.endsWith("_animblueprint") ||
    fileName.includes("_animblueprint_") ||
    fileName.endsWith("_montage") ||
    fileName.includes("_montage_") ||
    fileName.endsWith("_anim") ||
    fileName.includes("_anim_") ||
    fileName.endsWith("_ctrlrig") ||
    fileName.includes("_ctrlrig_") ||
    fileName.startsWith("abp_") ||
    fileName.startsWith("bs_")
  );
}

function animationAssetClass(fileName: string): string {
  if (fileName.endsWith("_ctrlrig") || fileName.includes("_ctrlrig_")) {
    return "ControlRig";
  }
  return fileName.endsWith("_bs") ||
    fileName.includes("_bs_") ||
    fileName.endsWith("_blendspace") ||
    fileName.includes("_blendspace_")
    ? "BlendSpace"
    : "AnimSequence";
}

function isMeshDirectoryPath(lowerPath: string): boolean {
  return /(^|\/)[^/]*meshes?[^/]*(\/|$)/.test(lowerPath);
}

function splitTags(value: string): string[] {
  return uniqueStrings(
    value
      .split(/[|;]/)
      .flatMap((part) => part.split(/\s+/))
      .map((tag) => tag.trim())
      .filter(Boolean)
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function groupChecksumsByPackage(checksums: CreatorAssetChecksum[]) {
  const map = new Map<string, CreatorAssetChecksum[]>();

  for (const checksum of checksums) {
    const key = packageKeyOf(checksum.packageId, checksum.packageVersion);
    map.set(key, [...(map.get(key) ?? []), checksum]);
  }

  return map;
}

function packageKeyOf(packageId: string, packageVersion: string): string {
  return `${packageId}@${packageVersion}`;
}

function normalizeArchivePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "");
}

function normalizeUnrealPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function normalizeHash(value: string): string | null {
  const trimmed = value.trim().replace(/^0x/i, "");
  return isSha256(trimmed) ? trimmed.toLowerCase() : value.trim() || null;
}

function isSha256(value: string): boolean {
  return /^[a-fA-F0-9]{64}$/.test(value);
}

function parseNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function hashStable(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function hashBuffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function workspaceRelativePath(targetPath: string): string {
  const relative = path.relative(process.cwd(), targetPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : path.basename(targetPath);
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function readMapInstallRoot(mapRoot: string): Promise<string | null> {
  const summaryPath = path.join(mapRoot, "clawed-map-summary.json");
  return readFile(summaryPath, "utf8")
    .then((content) => {
      const summary = JSON.parse(content) as MapSummaryJson;
      return summary.installRoot ?? summary.gameInstallPath ?? null;
    })
    .catch(() => null);
}
