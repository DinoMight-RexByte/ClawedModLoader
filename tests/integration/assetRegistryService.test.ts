import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalAssetRegistryService,
  type BaseGameMeshDecoder
} from "../../src/main/services/assetRegistryService";
import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import {
  LocalLoadOrderService,
  LocalProfileService
} from "../../src/main/services/profileService";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import {
  CreatorAssetMetadataV1Schema,
  type AppStorageLayout,
  type ClawedModManifestV1,
  type CreatorAssetIndexEntry,
  type CreatorAssetMetadataV1,
  type DeploymentOperationResult,
  type DeploymentSnapshot,
  type ServiceStatus
} from "../../src/shared/contracts/app";
import type {
  DeploymentServiceContract,
  StorageServiceContract
} from "../../src/shared/contracts/services";
import { createClawedModFixture } from "../helpers/clawedModFixture";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

class FakeDeploymentService implements DeploymentServiceContract {
  getStatus(): ServiceStatus {
    return {
      id: "deploymentService",
      label: "Deployment Service",
      status: "ready",
      detail: "fake"
    };
  }

  async getSnapshot(): Promise<DeploymentSnapshot> {
    return {
      state: "notDeployed",
      activeManifest: null,
      runtime: {
        ue4ss: null,
        status: "missing",
        problems: []
      },
      problems: []
    };
  }

  async prepareModdedDeployment(): Promise<DeploymentOperationResult> {
    throw new Error("not used");
  }

  async prepareRuntimeValidationDeployment(): Promise<DeploymentOperationResult> {
    throw new Error("not used");
  }

  async prepareUnrealMappingsDumpDeployment(): Promise<DeploymentOperationResult> {
    throw new Error("not used");
  }

  async prepareVanillaDeployment(): Promise<DeploymentOperationResult> {
    throw new Error("not used");
  }
}

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
  tempRoots = [];
});

interface AssetRegistryFixture {
  tempRoot: string;
  modLibraryService: LocalModLibraryService;
  profileService: LocalProfileService;
  loadOrderService: LocalLoadOrderService;
  service: LocalAssetRegistryService;
}

interface AssetRegistryFixtureOptions {
  includeMeshRows?: boolean;
  includeAmbiguousModelVisualRow?: boolean;
  includeBlendSpaceRow?: boolean;
  includeUnhintedStaticMeshRow?: boolean;
  createPreviewCache?: boolean;
  stalePreviewCache?: boolean;
  decoder?: BaseGameMeshDecoder;
  gameInstallPath?: string;
}

interface CreatorPackageFixtureOptions {
  id: string;
  name: string;
  pakFileName: string;
  payloadSha256: string;
  dependencies?: ClawedModManifestV1["dependencies"];
  conflicts?: string[];
  loadAfter?: string[];
  loadBefore?: string[];
  modelPreview?: {
    payloadPath: string;
    content: string;
    format?: "gltf" | "glb" | "obj" | "metadataOnly" | "unknown";
    source?: "userOwned" | "generated" | "derivedMetadata";
  };
}

describe("asset registry service", () => {
  it("indexes map artifacts, package metadata, payloads, checksums, and active conflict winners", async () => {
    const {
      tempRoot: fixtureRoot,
      modLibraryService,
      profileService,
      service
    } =
      await createAssetRegistryFixture();

    await installCreatorPackage(
      fixtureRoot,
      modLibraryService,
      {
        id: "alpha-texture",
        name: "Alpha Texture",
        pakFileName: "Alpha_P.pak",
        payloadSha256: "a".repeat(64)
      }
    );
    await installCreatorPackage(
      fixtureRoot,
      modLibraryService,
      {
        id: "beta-texture",
        name: "Beta Texture",
        pakFileName: "Beta_P.pak",
        payloadSha256: "b".repeat(64)
      }
    );
    await profileService.setModEnabled({
      id: "alpha-texture",
      version: "1.0.0",
      enabled: true
    });
    await profileService.setModEnabled({
      id: "beta-texture",
      version: "1.0.0",
      enabled: true
    });

    const snapshot = await service.getSnapshot();
    const graph = await service.getConflictGraph({ includeInactive: false });
    const search = await service.searchAssets({
      query: "T_Target",
      source: "all",
      tags: [],
      conflictState: "any",
      activeOnly: false,
      limit: 80
    });
    const filteredSearch = await service.searchAssets({
      query: "T_Target",
      source: "installedPackage",
      objectPath: "/Game/UtahRaptor",
      tags: ["texture_material_visuals"],
      assetClass: "texture",
      modUse: "replacement",
      packageId: "beta-texture",
      conflictState: "winner",
      validationState: "validated",
      exportState: "exportable",
      activeOnly: true,
      sortBy: "objectPath",
      sortDirection: "asc",
      limit: 80
    });
    const physicalPathSearch = await service.searchAssets({
      query: "",
      source: "packagePayload",
      physicalPath: "Content/Paks/Beta_P.pak",
      tags: [],
      conflictState: "any",
      exportState: "exportable",
      activeOnly: true,
      sortBy: "physicalPath",
      sortDirection: "desc",
      limit: 80
    });
    const detail = await service.getAssetDetail({
      assetId: "asset:beta-texture@1.0.0:replacement"
    });
    const baseEntry = search.entries.find(
      (entry) => entry.source === "baseGameMap"
    );
    const packageExport = await service.getExportPlan({
      assetIds: [baseEntry?.id ?? ""],
      output: "clawedmod"
    });
    const indexExport = await service.getExportPlan({
      assetIds: [baseEntry?.id ?? ""],
      output: "assetIndex"
    });
    const metadataReport = await service.getReport({
      assetIds: [detail.asset?.id ?? ""],
      output: "assetIndex"
    });
    const dependencyReport = await service.getReport({
      assetIds: [detail.asset?.id ?? ""],
      output: "dependencyGraph"
    });
    const conflictReport = await service.getReport({
      assetIds: [baseEntry?.id ?? "", detail.asset?.id ?? ""],
      output: "conflictReport"
    });

    expect(snapshot.map.status).toBe("ready");
    expect(snapshot.totals.baseGameEntries).toBe(1);
    expect(snapshot.totals.installedPackages).toBe(2);
    expect(snapshot.totals.packagePayloadEntries).toBe(2);
    expect(snapshot.totals.affectedAssets).toBe(4);
    expect(snapshot.totals.replacements).toBe(2);
    expect(snapshot.totals.activeWinners).toBe(1);
    expect(graph.conflicts[0].winnerPackageId).toBe("beta-texture");
    expect(search.entries.some((entry) => entry.conflictState === "winner")).toBe(
      true
    );
    expect(filteredSearch.entries.map((entry) => entry.id)).toEqual([
      "asset:beta-texture@1.0.0:replacement"
    ]);
    expect(physicalPathSearch.entries[0]?.containerName).toBe("Beta_P.pak");
    expect(detail.status).toBe("ok");
    expect(detail.activeWinner?.packageId).toBe("beta-texture");
    expect(detail.asset?.containerName).toBe("Beta_P.pak");
    expect(detail.checksums[0]?.sha256).toBe("b".repeat(64));
    expect(detail.asset?.virtualPath).toBe(
      "/Packages/creator-fixture/Content/Paks/Beta_P.pak"
    );
    expect(detail.dependencies[0]?.toVirtualPath).toBe(
      "/Clawed/Base/UtahRaptor/Textures/T_Target"
    );
    expect(packageExport.status).toBe("blocked");
    expect(packageExport.items[0]?.eligibility.containsBaseGameContent).toBe(
      true
    );
    expect(indexExport.status).toBe("ready");
    expect(metadataReport.status).toBe("ready");
    expect(JSON.parse(metadataReport.text).assets[0].asset.containerName).toBe(
      "Beta_P.pak"
    );
    expect(dependencyReport.status).toBe("ready");
    expect(JSON.parse(dependencyReport.text).edges[0].relation).toBe("replaces");
    expect(conflictReport.text).toContain("Beta Texture");
  });

  it("resolves a base-game target with no override", async () => {
    const { service } = await createAssetRegistryFixture();
    const baseEntry = await getBaseTargetEntry(service);
    const detail = await service.getAssetDetail({ assetId: baseEntry.id });
    const graph = await service.getConflictGraph({
      assetId: baseEntry.id,
      includeInactive: true
    });

    expect(detail.conflicts[0]).toMatchObject({
      baseGamePresent: true,
      winnerPackageId: null,
      entries: []
    });
    expect(graph.conflicts[0]).toMatchObject({
      baseGamePresent: true,
      winnerPackageId: null,
      entries: []
    });
  });

  it("returns lazy asset tree roots, folders, and search nodes", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "alpha-texture",
      name: "Alpha Texture",
      pakFileName: "Alpha_P.pak",
      payloadSha256: "a".repeat(64)
    });
    await enablePackage(fixture.profileService, "alpha-texture");

    const roots = await fixture.service.getAssetTree({ parentId: null });
    const baseRoot = roots.nodes.find((node) => node.source === "baseGameMap");
    const packageRoot = roots.nodes.find(
      (node) => node.source === "installedPackage"
    );
    const baseGame = await fixture.service.getAssetTree({
      parentId: baseRoot?.id ?? null
    });
    const packageChildren = await fixture.service.getAssetTree({
      parentId: packageRoot?.id ?? null
    });
    const search = await fixture.service.getAssetTree({
      parentId: null,
      query: "T_Target"
    });

    expect(roots.nodes.map((node) => node.label)).toContain("Clawed Base Game");
    expect(packageRoot?.childCount).toBe(3);
    expect(baseGame.nodes[0]).toMatchObject({
      kind: "folder",
      label: "Game",
      source: "baseGameMap"
    });
    expect(packageChildren.nodes[0]).toMatchObject({
      kind: "folder",
      label: "Alpha Texture 1.0.0",
      source: "installedPackage",
      childCount: 3
    });
    expect(search.nodes.some((node) => node.kind === "asset")).toBe(true);
    expect(search.nodes.map((node) => node.assetId)).toContain(
      "asset:alpha-texture@1.0.0:target"
    );
  });

  it("resolves a single enabled override as the winner", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "alpha-texture",
      name: "Alpha Texture",
      pakFileName: "Alpha_P.pak",
      payloadSha256: "a".repeat(64)
    });
    await enablePackage(fixture.profileService, "alpha-texture");

    const graph = await getGraphForBaseTarget(fixture.service);
    const entry = graph.conflicts[0].entries[0];

    expect(graph.conflicts[0].baseGamePresent).toBe(true);
    expect(graph.conflicts[0].winnerPackageId).toBe("alpha-texture");
    expect(entry.packageId).toBe("alpha-texture");
    expect(entry.enabled).toBe(true);
    expect(entry.profileOrder).toBe(1);
    expect(entry.deploymentRoute).toBe("pak-iostore-existing-path");
    expect(entry.validationState).toBe("validated");
  });

  it("resolves multiple overrides from logical order and updates after order changes", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "alpha-texture",
      name: "Alpha Texture",
      pakFileName: "Alpha_P.pak",
      payloadSha256: "a".repeat(64)
    });
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "beta-texture",
      name: "Beta Texture",
      pakFileName: "Beta_P.pak",
      payloadSha256: "b".repeat(64)
    });
    await enablePackage(fixture.profileService, "alpha-texture");
    await enablePackage(fixture.profileService, "beta-texture");

    const firstGraph = await getGraphForBaseTarget(fixture.service);
    await fixture.profileService.placeModInActiveOrder({
      modId: "alpha-texture",
      targetModId: "beta-texture",
      placement: "after"
    });
    const secondGraph = await getGraphForBaseTarget(fixture.service);

    expect(firstGraph.conflicts[0].winnerPackageId).toBe("beta-texture");
    expect(secondGraph.conflicts[0].winnerPackageId).toBe("alpha-texture");
    expect(
      secondGraph.conflicts[0].entries.find(
        (entry) => entry.packageId === "alpha-texture"
      )?.profileOrder
    ).toBe(2);
  });

  it("shows disabled installed packages without allowing them to win", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "alpha-texture",
      name: "Alpha Texture",
      pakFileName: "Alpha_P.pak",
      payloadSha256: "a".repeat(64)
    });
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "beta-texture",
      name: "Beta Texture",
      pakFileName: "Beta_P.pak",
      payloadSha256: "b".repeat(64)
    });
    await enablePackage(fixture.profileService, "alpha-texture");

    const graph = await getGraphForBaseTarget(fixture.service);
    const activeGraph = await fixture.service.getConflictGraph({
      assetId: (await getBaseTargetEntry(fixture.service)).id
    });

    expect(graph.conflicts[0].winnerPackageId).toBe("alpha-texture");
    expect(
      graph.conflicts[0].entries.find(
        (entry) => entry.packageId === "beta-texture"
      )?.enabled
    ).toBe(false);
    expect(activeGraph.conflicts[0].entries).toHaveLength(1);
  });

  it("attaches missing dependency effects to packages touching the path", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "beta-texture",
      name: "Beta Texture",
      pakFileName: "Beta_P.pak",
      payloadSha256: "b".repeat(64),
      dependencies: [{ id: "missing-framework" }]
    });
    await enablePackage(fixture.profileService, "beta-texture");

    const graph = await getGraphForBaseTarget(fixture.service);

    expect(graph.problems.map((problem) => problem.code)).toContain(
      "CREATOR_LOAD_ORDER_MISSING_DEPENDENCY"
    );
    expect(graph.conflicts[0].entries[0].dependencies[0]?.id).toBe(
      "missing-framework"
    );
    expect(graph.conflicts[0].entries[0].loadOrderEffects[0]?.code).toBe(
      "MISSING_DEPENDENCY"
    );
  });

  it("attaches explicit package conflict effects to each contender", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "alpha-texture",
      name: "Alpha Texture",
      pakFileName: "Alpha_P.pak",
      payloadSha256: "a".repeat(64),
      conflicts: ["beta-texture"]
    });
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "beta-texture",
      name: "Beta Texture",
      pakFileName: "Beta_P.pak",
      payloadSha256: "b".repeat(64)
    });
    await enablePackage(fixture.profileService, "alpha-texture");
    await enablePackage(fixture.profileService, "beta-texture");

    const graph = await getGraphForBaseTarget(fixture.service);

    expect(graph.problems.map((problem) => problem.code)).toContain(
      "CREATOR_LOAD_ORDER_DECLARED_CONFLICT"
    );
    expect(
      graph.conflicts[0].entries.flatMap((entry) =>
        entry.loadOrderEffects.map((effect) => effect.code)
      )
    ).toContain("DECLARED_CONFLICT");
    expect(graph.conflicts[0].entries[0].explicitConflicts).toContain(
      "beta-texture"
    );
  });

  it("attaches loadBefore and loadAfter violations without rewriting order", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "alpha-texture",
      name: "Alpha Texture",
      pakFileName: "Alpha_P.pak",
      payloadSha256: "a".repeat(64),
      loadBefore: ["beta-texture"]
    });
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "beta-texture",
      name: "Beta Texture",
      pakFileName: "Beta_P.pak",
      payloadSha256: "b".repeat(64),
      loadAfter: ["alpha-texture"]
    });
    await enablePackage(fixture.profileService, "beta-texture");
    await enablePackage(fixture.profileService, "alpha-texture");

    const graph = await getGraphForBaseTarget(fixture.service);
    const effectCodes = graph.conflicts[0].entries.flatMap((entry) =>
      entry.loadOrderEffects.map((effect) => effect.code)
    );

    expect(graph.conflicts[0].winnerPackageId).toBe("alpha-texture");
    expect(effectCodes).toContain("LOAD_BEFORE_VIOLATION");
    expect(effectCodes).toContain("LOAD_AFTER_VIOLATION");
    expect(
      graph.conflicts[0].entries.find(
        (entry) => entry.packageId === "alpha-texture"
      )?.loadBefore
    ).toEqual(["beta-texture"]);
    expect(
      graph.conflicts[0].entries.find(
        (entry) => entry.packageId === "beta-texture"
      )?.loadAfter
    ).toEqual(["alpha-texture"]);
  });

  it("loads model previews only from declared package preview payloads", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "mesh-preview",
      name: "Mesh Preview",
      pakFileName: "Mesh_P.pak",
      payloadSha256: "c".repeat(64),
      modelPreview: {
        payloadPath: "payload/previews/utah-preview.obj",
        content: testObjModel(),
        source: "userOwned"
      }
    });
    await enablePackage(fixture.profileService, "mesh-preview");

    const preview = await fixture.service.getModelPreview({
      assetId: "asset:mesh-preview@1.0.0:replacement"
    });
    const baseEntry = await getBaseTargetEntry(fixture.service);
    const basePreview = await fixture.service.getModelPreview({
      assetId: baseEntry.id
    });

    expect(preview.status).toBe("available");
    expect(preview.model?.format).toBe("obj");
    expect(preview.model?.source).toBe("userOwned");
    expect(preview.model?.dataUrl).toContain("data:text/plain;base64,");
    expect(preview.metadata.skeleton).toBe(
      "/Game/UtahRaptor/Meshes/SKEL_Utah.SKEL_Utah"
    );
    expect(preview.metadata.materialSlots[0]?.name).toBe("Body");
    expect(preview.metadata.lods[0]?.triangleCount).toBe(1200);
    expect(preview.metadata.conflictWinner).toBe("Mesh Preview 1.0.0");
    expect(basePreview.status).toBe("available");
    expect(basePreview.model?.source).toBe("cachedBaseGame");
    expect(basePreview.metadata.materialSlots[0]?.name).toBe("Body");
    expect(basePreview.metadata.exportState).toBe("exportable");
  });

  it("loads package model payload files directly from the asset tree", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "mesh-payload",
      name: "Mesh Payload",
      pakFileName: "MeshPayload_P.pak",
      payloadSha256: "c".repeat(64),
      modelPreview: {
        payloadPath: "payload/previews/utah-preview.obj",
        content: testObjModel(),
        source: "userOwned"
      }
    });

    const search = await fixture.service.searchAssets({
      query: "utah-preview.obj",
      source: "packagePayload"
    });
    const payload = search.entries.find(
      (entry) => entry.assetClass === "ModelPreview"
    );
    expect(payload).toBeDefined();

    const preview = await fixture.service.getModelPreview({
      assetId: payload?.id ?? ""
    });

    expect(preview.status).toBe("available");
    expect(preview.model?.source).toBe("packagePayload");
    expect(preview.model?.format).toBe("obj");
    expect(preview.metadata.previewSource).toBe("Package model payload");
  });

  it("reports empty, unsupported, and error model preview states", async () => {
    const fixture = await createAssetRegistryFixture();
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "empty-preview",
      name: "Empty Preview",
      pakFileName: "Empty_P.pak",
      payloadSha256: "d".repeat(64)
    });
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "metadata-preview",
      name: "Metadata Preview",
      pakFileName: "Metadata_P.pak",
      payloadSha256: "e".repeat(64),
      modelPreview: {
        payloadPath: "payload/previews/metadata-only.obj",
        content: testObjModel(),
        format: "metadataOnly"
      }
    });
    await installCreatorPackage(fixture.tempRoot, fixture.modLibraryService, {
      id: "missing-preview",
      name: "Missing Preview",
      pakFileName: "Missing_P.pak",
      payloadSha256: "f".repeat(64),
      modelPreview: {
        payloadPath: "payload/previews/missing.obj",
        content: testObjModel()
      }
    });
    const missingRecord = (
      await fixture.modLibraryService.listInstalledModManifests()
    ).find((record) => record.manifest.id === "missing-preview");
    if (!missingRecord) {
      throw new Error("Missing preview fixture failed to install.");
    }
    await rm(
      path.join(
        missingRecord.mod.installPath,
        "payload",
        "previews",
        "missing.obj"
      ),
      { force: true }
    );

    const empty = await fixture.service.getModelPreview({
      assetId: "asset:empty-preview@1.0.0:replacement"
    });
    const unsupported = await fixture.service.getModelPreview({
      assetId: "asset:metadata-preview@1.0.0:replacement"
    });
    const error = await fixture.service.getModelPreview({
      assetId: "asset:missing-preview@1.0.0:replacement"
    });

    expect(empty.status).toBe("empty");
    expect(unsupported.status).toBe("unsupported");
    expect(error.status).toBe("error");
    expect(error.problems[0]?.code).toBe("CREATOR_MODEL_PREVIEW_FILE_MISSING");
  });

  it("decodes base-game StaticMesh previews without a preview-cache entry", async () => {
    const fixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder()
    });
    const mesh = await getBaseMeshEntry(fixture.service, "SM_Target");
    const preview = await fixture.service.getModelPreview({ assetId: mesh.id });

    expect(preview.status).toBe("available");
    expect(preview.model?.source).toBe("decodedBaseGame");
    expect(preview.model?.format).toBe("glb");
    expect(preview.metadata.meshType).toBe("staticMesh");
    expect(preview.metadata.materialSlots[0]?.name).toBe("Fallback Material");
    expect(
      preview.problems.some((problem) => problem.code.startsWith("AUTHORIZED_"))
    ).toBe(false);
  });

  it("does not mark ambiguous model_visuals cooked assets as viewport meshes", async () => {
    const fixture = await createAssetRegistryFixture({
      includeAmbiguousModelVisualRow: true
    });
    const search = await fixture.service.searchAssets({
      query: "Preview_Tag_Only",
      source: "baseGameMap"
    });
    const entry = search.entries[0];

    expect(entry?.assetClass).toBe("CookedUnrealAsset");
    expect(entry?.viewportState).toBe("none");
  });

  it("does not mark animation blend spaces under mesh folders as viewport meshes", async () => {
    const fixture = await createAssetRegistryFixture({
      includeBlendSpaceRow: true
    });
    const search = await fixture.service.searchAssets({
      query: "Ankylo_Walk_BS",
      source: "baseGameMap"
    });
    const entry = search.entries[0];

    expect(entry?.assetClass).toBe("BlendSpace");
    expect(entry?.viewportState).toBe("none");
  });

  it("marks model_visuals cooked rows as viewport candidates without tree probing", async () => {
    const fixture = await createAssetRegistryFixture({
      includeAmbiguousModelVisualRow: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder()
    });
    const tree = await fixture.service.getAssetTree({
      query: "Preview_Tag_Only",
      source: "baseGameMap"
    });
    const node = tree.nodes.find((candidate) => candidate.kind === "asset");
    const search = await fixture.service.searchAssets({
      query: "Preview_Tag_Only",
      source: "baseGameMap"
    });
    const entry = search.entries[0];
    expect(entry).toBeDefined();

    const preview = await fixture.service.getModelPreview({
      assetId: entry?.id ?? ""
    });

    expect(entry?.assetClass).toBe("CookedUnrealAsset");
    expect(node?.assetClass).toBe("CookedUnrealAsset");
    expect(node?.viewportState).toBe("viewable");
    expect(preview.status).toBe("available");
    expect(preview.asset?.assetClass).toBe("StaticMesh");
    expect(preview.metadata.meshType).toBe("staticMesh");
  });

  it("marks SM-prefixed static meshes as viewport-renderable without tree probing", async () => {
    const fixture = await createAssetRegistryFixture({
      includeUnhintedStaticMeshRow: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder()
    });
    const tree = await fixture.service.getAssetTree({
      query: "SM_Rock01",
      source: "baseGameMap"
    });
    const node = tree.nodes.find((candidate) => candidate.kind === "asset");
    const search = await fixture.service.searchAssets({
      query: "SM_Rock01",
      source: "baseGameMap"
    });
    const entry = search.entries[0];
    expect(entry).toBeDefined();

    const preview = await fixture.service.getModelPreview({
      assetId: entry?.id ?? ""
    });

    expect(entry?.assetClass).toBe("StaticMesh");
    expect(node?.assetClass).toBe("StaticMesh");
    expect(node?.viewportState).toBe("viewable");
    expect(preview.status).toBe("available");
    expect(preview.metadata.meshType).toBe("staticMesh");
  });

  it("decodes base-game SkeletalMesh previews and relationship metadata without a preview-cache entry", async () => {
    const fixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder()
    });
    const mesh = await getBaseMeshEntry(fixture.service, "SK_Target");
    const detail = await fixture.service.getAssetDetail({ assetId: mesh.id });
    const preview = await fixture.service.getModelPreview({ assetId: mesh.id });

    expect(preview.status).toBe("available");
    expect(preview.model?.source).toBe("decodedBaseGame");
    expect(preview.metadata.meshType).toBe("skeletalMesh");
    expect(preview.metadata.skeleton).toBe(
      "/Game/UtahRaptor/Meshes/SKEL_Target_Skeleton.SKEL_Target_Skeleton"
    );
    expect(preview.metadata.physicsAsset).toBe(
      "/Game/UtahRaptor/Meshes/PHYS_Target.PHYS_Target"
    );
    expect(detail.dependencies.map((dependency) => dependency.relation)).toEqual([
      "skeleton",
      "physicsAsset"
    ]);
  });

  it("decodes base-game Skeleton previews without a preview-cache entry", async () => {
    const fixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder()
    });
    const search = await fixture.service.searchAssets({
      query: "SKEL_Target_Skeleton",
      source: "baseGameMap"
    });
    const skeleton = search.entries.find(
      (candidate) => candidate.assetClass === "Skeleton"
    );
    expect(skeleton).toBeDefined();

    const preview = await fixture.service.getModelPreview({
      assetId: skeleton?.id ?? ""
    });

    expect(preview.status).toBe("available");
    expect(preview.model?.source).toBe("decodedBaseGame");
    expect(preview.model?.format).toBe("gltf");
    expect(preview.metadata.meshType).toBe("skeleton");
  });

  it("uses cached normalized base-game previews when valid and falls back when stale", async () => {
    const cachedFixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      decoder: fakeMeshDecoder()
    });
    const cachedMesh = await getBaseMeshEntry(
      cachedFixture.service,
      "SM_Target"
    );
    const cached = await cachedFixture.service.getModelPreview({
      assetId: cachedMesh.id
    });

    expect(cached.status).toBe("available");
    expect(cached.model?.source).toBe("cachedBaseGame");

    const staleFixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      stalePreviewCache: true,
      decoder: fakeMeshDecoder()
    });
    const staleMesh = await getBaseMeshEntry(staleFixture.service, "SM_Target");
    const stale = await staleFixture.service.getModelPreview({
      assetId: staleMesh.id
    });

    expect(stale.status).toBe("available");
    expect(stale.model?.source).toBe("decodedBaseGame");
    expect(stale.problems.map((problem) => problem.code)).toContain(
      "BASE_GAME_MODEL_PREVIEW_CACHE_FILE_MISSING"
    );
  });

  it("exports supported base-game model formats without a preview-cache entry", async () => {
    const fixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder()
    });
    const mesh = await getBaseMeshEntry(fixture.service, "SM_Target");
    const search = await fixture.service.searchAssets({
      query: "SKEL_Target_Skeleton",
      source: "baseGameMap"
    });
    const skeleton = search.entries.find(
      (candidate) => candidate.assetClass === "Skeleton"
    );
    expect(skeleton).toBeDefined();

    for (const [assetId, format] of [
      [mesh.id, "glb"],
      [mesh.id, "obj"],
      [skeleton?.id ?? "", "gltf"]
    ] as const) {
      const destinationPath = path.join(fixture.tempRoot, "exports", `mesh.${format}`);
      const result = await fixture.service.exportMesh({
        assetId,
        format,
        destinationPath
      });

      expect(result.status).toBe("exported");
      expect(result.bytesWritten).toBeGreaterThan(0);
      expect(await readFile(destinationPath)).toHaveLength(
        result.bytesWritten ?? 0
      );
    }

    const unsupported = await fixture.service.exportMesh({
      assetId: mesh.id,
      format: "gltf",
      destinationPath: path.join(fixture.tempRoot, "exports", "mesh.gltf")
    });
    expect(unsupported.status).toBe("unsupported");
    expect(unsupported.problems[0]?.code).toBe("BASE_GAME_MESH_FORMAT_UNSUPPORTED");
  });

  it("keeps base-game mesh probe cache separate by preview and export purpose", async () => {
    const fixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: purposeSensitiveProbeDecoder()
    });
    const mesh = await getBaseMeshEntry(fixture.service, "SM_Target");
    const preview = await fixture.service.getModelPreview({ assetId: mesh.id });
    const plan = await fixture.service.getExportPlan({
      assetIds: [mesh.id],
      output: "glb"
    });

    expect(preview.status).toBe("available");
    expect(plan.status).toBe("blocked");
    expect(plan.items[0]?.reason).toBe("Unsupported asset class.");
  });

  it("exports visible viewport models into one .clawedmod package", async () => {
    const fixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder()
    });
    const mesh = await getBaseMeshEntry(fixture.service, "SM_Target");
    const search = await fixture.service.searchAssets({
      query: "SKEL_Target_Skeleton",
      source: "baseGameMap"
    });
    const skeleton = search.entries.find(
      (candidate) => candidate.assetClass === "Skeleton"
    );
    expect(skeleton).toBeDefined();

    const destinationPath = path.join(
      fixture.tempRoot,
      "exports",
      "visible-models.clawedmod"
    );
    const result = await fixture.service.exportMeshPackage({
      assetIds: [mesh.id, skeleton?.id ?? ""],
      destinationPath
    });
    const parsed = await new ClawedModPackageService().parsePackage(
      destinationPath
    );

    expect(result.status).toBe("exported");
    expect(result.itemCount).toBe(2);
    expect(result.exportedCount).toBe(2);
    expect(parsed.manifest.creatorAssets?.previewAssets).toHaveLength(2);
    expect(parsed.zip.file(result.items[0]?.payloadPath ?? "")).not.toBeNull();
  });

  it("returns structured decoder errors for unsupported and corrupt base-game meshes", async () => {
    const unavailableFixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false
    });
    const unavailableMesh = await getBaseMeshEntry(
      unavailableFixture.service,
      "SM_Target"
    );
    const unavailable = await unavailableFixture.service.getModelPreview({
      assetId: unavailableMesh.id
    });

    expect(unavailable.status).toBe("unsupported");
    expect(unavailable.problems[0]?.code).toBe("BASE_GAME_MESH_DECODER_UNAVAILABLE");
    expect(unavailable.problems[0]?.message).not.toContain("authorized");

    const corruptFixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder("decode-error")
    });
    const corruptMesh = await getBaseMeshEntry(corruptFixture.service, "SM_Target");
    const corrupt = await corruptFixture.service.getModelPreview({
      assetId: corruptMesh.id
    });

    expect(corrupt.status).toBe("decode-error");
    expect(corrupt.problems[0]?.code).toBe("BASE_GAME_MESH_DECODE_FAILED");
  });

  it("blocks mesh export into the game installation", async () => {
    const gameInstallPath = path.join(os.tmpdir(), "cmm-clawed-install");
    const fixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder(),
      gameInstallPath
    });
    const mesh = await getBaseMeshEntry(fixture.service, "SM_Target");
    const result = await fixture.service.exportMesh({
      assetId: mesh.id,
      format: "obj",
      destinationPath: path.join(gameInstallPath, "Content", "mesh.obj")
    });

    expect(result.status).toBe("blocked");
    expect(result.problems[0]?.code).toBe("CREATOR_MESH_EXPORT_GAME_PATH_BLOCKED");
  });

  it("renders the Stegosaurus T-pose regression mesh without a preview-cache entry", async () => {
    const fixture = await createAssetRegistryFixture({
      includeMeshRows: true,
      createPreviewCache: false,
      decoder: fakeMeshDecoder()
    });
    const mesh = await getBaseMeshEntry(
      fixture.service,
      "SM_Stegosaurus_T_Pose"
    );
    const preview = await fixture.service.getModelPreview({ assetId: mesh.id });

    expect(preview.status).toBe("available");
    expect(preview.model?.source).toBe("decodedBaseGame");
    expect(preview.metadata.skeleton).toBe(
      "/Game/Stegosaurus_RD/Meshes/SKEL_Stegosaurus_T_Pose_Skeleton.SKEL_Stegosaurus_T_Pose_Skeleton"
    );
    expect(
      preview.problems.some((problem) => problem.code.startsWith("AUTHORIZED_"))
    ).toBe(false);
  });

  it("reports stale active-profile package references", async () => {
    const { profileService, service } = await createAssetRegistryFixture();
    await profileService.createProfileFromState({
      name: "Stale Profile",
      selectedMods: {
        "missing-texture": {
          modId: "missing-texture",
          version: "9.9.9",
          enabled: true,
          config: {}
        }
      },
      orderedModIds: ["missing-texture"],
      preferredLaunchMode: "MODDED"
    });

    const snapshot = await service.getSnapshot();
    const graph = await service.getConflictGraph({ includeInactive: true });

    expect(snapshot.totals.staleProfileReferences).toBe(1);
    expect(graph.problems.map((problem) => problem.code)).toContain(
      "CREATOR_LOAD_ORDER_INVALID_SELECTED_VERSION"
    );
  });
});

async function createAssetRegistryFixture(
  options: AssetRegistryFixtureOptions = {}
): Promise<AssetRegistryFixture> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-assets-"));
  tempRoots.push(tempRoot);
  const mapRoot = path.join(tempRoot, "map");
  const baseGamePreviewRoot = path.join(tempRoot, "base-game-previews");
  await createMapArtifacts(mapRoot, options);
  if (options.createPreviewCache !== false || options.stalePreviewCache) {
    await createBaseGamePreviewArtifacts(baseGamePreviewRoot, options);
  }

  const storageService = new FakeStorageService(createStorageLayout(tempRoot));
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
  const deploymentService = new FakeDeploymentService();
  const service = new LocalAssetRegistryService(
    modLibraryService,
    profileService,
    loadOrderService,
    deploymentService,
    {
      mapRoot,
      baseGamePreviewRoot,
      baseGameMeshDecoder: options.decoder,
      gameInstallPath: options.gameInstallPath
    }
  );

  return {
    tempRoot,
    modLibraryService,
    profileService,
    loadOrderService,
    service
  };
}

async function getBaseTargetEntry(
  service: LocalAssetRegistryService
): Promise<CreatorAssetIndexEntry> {
  const search = await service.searchAssets({
    query: "T_Target",
    source: "baseGameMap"
  });
  const entry = search.entries[0];
  expect(entry).toBeDefined();
  return entry;
}

async function getBaseMeshEntry(
  service: LocalAssetRegistryService,
  query: string
): Promise<CreatorAssetIndexEntry> {
  const search = await service.searchAssets({
    query,
    source: "baseGameMap"
  });
  const entry = search.entries.find(
    (candidate) =>
      candidate.assetClass === "StaticMesh" ||
      candidate.assetClass === "SkeletalMesh"
  );
  expect(entry).toBeDefined();
  return entry as CreatorAssetIndexEntry;
}

async function getGraphForBaseTarget(service: LocalAssetRegistryService) {
  const baseEntry = await getBaseTargetEntry(service);
  return service.getConflictGraph({
    assetId: baseEntry.id,
    includeInactive: true
  });
}

async function enablePackage(
  profileService: LocalProfileService,
  id: string
): Promise<void> {
  const result = await profileService.setModEnabled({
    id,
    version: "1.0.0",
    enabled: true
  });

  expect(result.status).toBe("ok");
}

function testObjModel(): string {
  return [
    "o PreviewTriangle",
    "v 0 0.8 0",
    "v -0.8 -0.8 0",
    "v 0.8 -0.8 0",
    "f 1 2 3"
  ].join("\n");
}

function fakeMeshDecoder(
  status: "ready" | "unsupported" | "dependency-missing" | "decode-error" = "ready"
): BaseGameMeshDecoder {
  return {
    isAvailable: () => true,
    supportsFormat: (format, asset) =>
      asset.assetClass === "Skeleton"
        ? format === "gltf"
        : format === "glb" || format === "obj",
    probe: async ({ asset }) => {
      const assetClass = probeAssetClass(asset);
      return assetClass
        ? {
            status: "ready",
            assetClass,
            metadata: { meshType: meshTypeForAssetClass(assetClass) },
            problems: []
          }
        : {
            status: "unsupported",
            problems: []
          };
    },
    decode: async ({ asset, detail, format }) => {
      if (status !== "ready") {
        return { status, problems: [] };
      }
      const skeleton =
        detail.dependencies.find((dependency) => dependency.relation === "skeleton")
          ?.toObjectPath ?? null;
      const physicsAsset =
        detail.dependencies.find(
          (dependency) => dependency.relation === "physicsAsset"
        )?.toObjectPath ?? null;
      return {
        status: "ready",
        format,
        data: meshDataForFormat(format),
        fileName: `${asset.label.replace(/[^\w.-]+/g, "-")}.${format}`,
        metadata: {
          meshType:
            asset.assetClass === "Skeleton"
              ? "skeleton"
              : asset.assetClass === "SkeletalMesh"
                ? "skeletalMesh"
                : "staticMesh",
          skeleton,
          physicsAsset,
          materialSlots: [{ name: "Fallback Material", materialPath: null }],
          lods: [
            {
              index: 0,
              screenSize: 1,
              triangleCount: 1,
              vertexCount: 3
            }
          ],
          dependencyPaths: detail.dependencies.flatMap((dependency) =>
            [
              dependency.toObjectPath,
              dependency.toPackagePath,
              dependency.toVirtualPath
            ].filter((value): value is string => Boolean(value))
          ),
          lodCount: 1,
          vertexCount: 3,
          triangleCount: 1,
          materialSlotCount: 1
        },
        problems: []
      };
    }
  };
}

function purposeSensitiveProbeDecoder(): BaseGameMeshDecoder {
  const decoder = fakeMeshDecoder();
  return {
    ...decoder,
    probe: async ({ asset, purpose }) => {
      if (purpose === "export") {
        return {
          status: "unsupported",
          problems: []
        };
      }
      const assetClass = probeAssetClass(asset);
      return assetClass
        ? {
            status: "ready",
            assetClass,
            metadata: { meshType: meshTypeForAssetClass(assetClass) },
            problems: []
          }
        : {
            status: "unsupported",
            problems: []
          };
    }
  };
}

function probeAssetClass(asset: CreatorAssetIndexEntry): string | null {
  const value = [
    asset.assetClass,
    asset.objectPath,
    asset.packagePath,
    asset.relativePath,
    asset.label
  ]
    .filter(Boolean)
    .join("/")
    .toLowerCase();
  if (value.includes("preview_tag_only")) {
    return "StaticMesh";
  }
  if (value.includes("rock01")) {
    return "StaticMesh";
  }
  if (asset.assetClass === "StaticMesh" || asset.assetClass === "SkeletalMesh") {
    return asset.assetClass;
  }
  if (asset.assetClass === "Skeleton") {
    return "Skeleton";
  }
  return null;
}

function meshTypeForAssetClass(
  assetClass: string
): "staticMesh" | "skeletalMesh" | "skeleton" {
  if (assetClass === "Skeleton") {
    return "skeleton";
  }
  return assetClass === "SkeletalMesh" ? "skeletalMesh" : "staticMesh";
}

function meshDataForFormat(format: "obj" | "gltf" | "glb"): Buffer {
  if (format === "gltf") {
    return Buffer.from(
      JSON.stringify({
        asset: { version: "2.0", generator: "CMM test decoder" },
        scenes: [{ nodes: [] }],
        scene: 0,
        nodes: []
      })
    );
  }
  if (format === "glb") {
    return Buffer.from("glb-test-payload");
  }
  return Buffer.from(testObjModel());
}

async function createMapArtifacts(
  mapRoot: string,
  options: AssetRegistryFixtureOptions
): Promise<void> {
  const rows = [
    "container,Clawed/Content/UtahRaptor/Textures/T_Target.uasset,/Game/UtahRaptor/Textures/T_Target.T_Target,Clawed-Windows,.uasset,120,0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef,texture_material_visuals,Texture replacement target",
    ...(options.includeAmbiguousModelVisualRow
      ? [
          "container,Clawed/Content/Shared/Preview_Tag_Only.uasset,/Game/Shared/Preview_Tag_Only.Preview_Tag_Only,Clawed-Windows,.uasset,120,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,cooked_asset;model_visuals,Ambiguous visual metadata"
        ]
      : []),
    ...(options.includeBlendSpaceRow
      ? [
          "container,Clawed/Content/Ankylosaurus/Meshes/Ankylo_Walk_BS.uasset,/Game/Ankylosaurus/Meshes/Ankylo_Walk_BS.Ankylo_Walk_BS,Clawed-Windows,.uasset,2425,bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,cooked_asset;model_visuals;chunk_exportbundledata,Ankylosaurus blend space"
        ]
      : []),
    ...(options.includeUnhintedStaticMeshRow
      ? [
          "container,Clawed/Content/Environment/Rocks/SM_Rock01.uasset,/Game/Environment/Rocks/SM_Rock01.SM_Rock01,Clawed-Windows,.uasset,2048,cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc,cooked_asset;chunk_exportbundledata,Unhinted static mesh"
        ]
      : []),
    ...(options.includeMeshRows
      ? [
          "container,Clawed/Content/UtahRaptor/Meshes/SM_Target.uasset,/Game/UtahRaptor/Meshes/SM_Target.SM_Target,Clawed-Windows,.uasset,2048,1111111111111111111111111111111111111111111111111111111111111111,cooked_asset;model_visuals,Static mesh target",
          "container,Clawed/Content/UtahRaptor/Meshes/SK_Target.uasset,/Game/UtahRaptor/Meshes/SK_Target.SK_Target,Clawed-Windows,.uasset,4096,2222222222222222222222222222222222222222222222222222222222222222,cooked_asset;model_visuals;character_model_animation,Skeletal mesh target",
          "container,Clawed/Content/UtahRaptor/Meshes/SKEL_Target_Skeleton.uasset,/Game/UtahRaptor/Meshes/SKEL_Target_Skeleton.SKEL_Target_Skeleton,Clawed-Windows,.uasset,512,3333333333333333333333333333333333333333333333333333333333333333,cooked_asset;rig_skeleton_physics,Skeleton target",
          "container,Clawed/Content/UtahRaptor/Meshes/PHYS_Target.uasset,/Game/UtahRaptor/Meshes/PHYS_Target.PHYS_Target,Clawed-Windows,.uasset,512,4444444444444444444444444444444444444444444444444444444444444444,cooked_asset;rig_skeleton_physics,Physics target",
          "container,Clawed/Content/Stegosaurus_RD/Meshes/SM_Stegosaurus_T_Pose.uasset,/Game/Stegosaurus_RD/Meshes/SM_Stegosaurus_T_Pose.SM_Stegosaurus_T_Pose,Clawed-Windows.utoc,.uasset,1275009,5555555555555555555555555555555555555555555555555555555555555555,cooked_asset;model_visuals;chunk_exportbundledata,Stegosaurus model",
          "container,Clawed/Content/Stegosaurus_RD/Meshes/SKEL_Stegosaurus_T_Pose_Skeleton.uasset,/Game/Stegosaurus_RD/Meshes/SKEL_Stegosaurus_T_Pose_Skeleton.SKEL_Stegosaurus_T_Pose_Skeleton,Clawed-Windows.utoc,.uasset,65432,6666666666666666666666666666666666666666666666666666666666666666,cooked_asset;model_visuals;rig_skeleton_physics;chunk_exportbundledata,Stegosaurus skeleton"
        ]
      : [])
  ];
  await mkdir(mapRoot, { recursive: true });
  await writeFile(
    path.join(mapRoot, "clawed-map-summary.json"),
    `${JSON.stringify(
      {
        generatedAtUtc: "2026-08-14T17:55:16.276Z",
        installRoot: options.gameInstallPath,
        steamBuildId: "24719259",
        physicalFileCount: rows.length,
        shippingManifestEntryCount: rows.length,
        containerEntryCount: rows.length,
        namedContainerEntryCount: rows.length
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(mapRoot, "clawed-all-files-and-container-entries.csv"),
    [
      "source,path,objectPath,containerName,extension,sizeBytes,hashOrSha256,tags,modUses",
      ...rows
    ].join("\n")
  );

  for (const fileName of [
    "clawed-physical-files.csv",
    "clawed-shipping-manifest-entries.csv",
    "clawed-container-entries-annotated.csv"
  ]) {
    await writeFile(path.join(mapRoot, fileName), "source,path\n");
  }
}

async function createBaseGamePreviewArtifacts(
  root: string,
  options: AssetRegistryFixtureOptions
): Promise<void> {
  await mkdir(path.join(root, "models"), { recursive: true });
  await writeFile(path.join(root, "models", "base-target.obj"), testObjModel());
  if (!options.stalePreviewCache) {
    await writeFile(
      path.join(root, "models", "sm-target.obj"),
      testObjModel()
    );
  }
  await writeFile(
    path.join(root, "index.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entries: [
          {
            objectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
            modelPath: "models/base-target.obj",
            format: "obj",
            materialSlots: [
              {
                name: "Body",
                materialPath:
                  "/Game/UtahRaptor/Materials/M_Target.M_Target"
              }
            ],
            lods: [
              {
                index: 0,
                triangleCount: 12,
                vertexCount: 8
              }
            ],
            dependencyPaths: [
              "/Game/UtahRaptor/Materials/M_Target.M_Target"
            ],
            exportable: true
          },
          ...(options.includeMeshRows
            ? [
                {
                  objectPath: "/Game/UtahRaptor/Meshes/SM_Target.SM_Target",
                  modelPath: "models/sm-target.obj",
                  format: "obj",
                  materialSlots: [
                    {
                      name: "Cached Body",
                      materialPath: null
                    }
                  ],
                  lods: [
                    {
                      index: 0,
                      triangleCount: 1,
                      vertexCount: 3
                    }
                  ],
                  exportable: true
                }
              ]
            : [])
        ]
      },
      null,
      2
    )}\n`
  );
}

async function installCreatorPackage(
  tempRoot: string,
  modLibraryService: LocalModLibraryService,
  options: CreatorPackageFixtureOptions
): Promise<void> {
  const { id, name, pakFileName, payloadSha256 } = options;
  const payloadPath = `payload/Content/Paks/${pakFileName}`;
  const packagePath = path.join(tempRoot, `${id}.clawedmod`);
  const payloadEntries = [
    {
      name: `Content/Paks/${pakFileName}`,
      content: `${id} payload`
    },
    ...(options.modelPreview
      ? [
          {
            name: options.modelPreview.payloadPath.replace(/^payload\//, ""),
            content: options.modelPreview.content
          }
        ]
      : [])
  ];
  await createClawedModFixture(packagePath, {
    manifest: {
      id,
      name,
      loader: "pak",
      dependencies: options.dependencies ?? [],
      conflicts: options.conflicts ?? [],
      loadAfter: options.loadAfter ?? [],
      loadBefore: options.loadBefore ?? [],
      creatorAssets: creatorAssets(payloadPath, options.modelPreview)
    },
    payloadEntries,
    checksumsJsonOverride: {
      schemaVersion: 1,
      payload: {
        [payloadPath]: payloadSha256
      }
    }
  });

  const result = await modLibraryService.importModPackage({ packagePath });
  expect(result.status).toBe("installed");
}

function creatorAssets(
  payloadPath: string,
  modelPreview?: CreatorPackageFixtureOptions["modelPreview"]
): CreatorAssetMetadataV1 {
  return CreatorAssetMetadataV1Schema.parse({
    schemaVersion: 1,
    affectedAssets: [
      {
        id: "target",
        assetClass: "Texture2D",
        packagePath: "/Game/UtahRaptor/Textures/T_Target",
        objectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
        virtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Target",
        source: "baseGame",
        role: "target",
        tags: ["texture_material_visuals"]
      },
      {
        id: "replacement",
        assetClass: "Texture2D",
        virtualPath: `/Packages/creator-fixture/${payloadPath.replace(
          /^payload\//,
          ""
        )}`,
        payloadPath,
        source: "generated",
        role: "replacement",
        tags: ["texture_material_visuals"]
      }
    ],
    replacements: [
      {
        targetAssetId: "target",
        replacementAssetId: "replacement",
        targetObjectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
        targetVirtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Target",
        replacementVirtualPath: `/Packages/creator-fixture/${payloadPath.replace(
          /^payload\//,
          ""
        )}`,
        payloadPaths: [payloadPath],
        deploymentRoute: "pak-iostore-existing-path",
        validationState: "validated"
      }
    ],
    supportedSteamBuilds: [
      {
        buildId: "24719259",
        status: "validated",
        evidence: "integration fixture"
      }
    ],
    previewAssets: modelPreview
      ? [
          {
            id: "mesh-preview",
            payloadPath: modelPreview.payloadPath,
            kind: "model",
            assetClass: "SkeletalMesh",
            objectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
            source: modelPreview.source ?? "userOwned",
            format: modelPreview.format ?? "obj",
            modelRole: "skeletalMesh",
            skeleton: "/Game/UtahRaptor/Meshes/SKEL_Utah.SKEL_Utah",
            physicsAsset: "/Game/UtahRaptor/Meshes/PHYS_Utah.PHYS_Utah",
            materialSlots: [
              {
                name: "Body",
                materialPath:
                  "/Game/UtahRaptor/Materials/M_Utah_Body.M_Utah_Body"
              }
            ],
            lods: [
              {
                index: 0,
                triangleCount: 1200,
                vertexCount: 700
              }
            ],
            dependencyPaths: [
              "/Game/UtahRaptor/Materials/M_Utah_Body.M_Utah_Body"
            ]
          }
        ]
      : [],
    importProvenance: [
      {
        sourceKind: "generated",
        sourceName: "integration fixture",
        sourceSha256:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        sourceHashes: [
          {
            algorithm: "sha256",
            scope: "source",
            path: "integration fixture",
            sha256:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          }
        ],
        rights: "generated"
      }
    ],
    assetDependencies: [
      {
        fromAssetId: "replacement",
        toAssetId: "target",
        fromVirtualPath: `/Packages/creator-fixture/${payloadPath.replace(
          /^payload\//,
          ""
        )}`,
        toPackagePath: "/Game/UtahRaptor/Textures/T_Target",
        toObjectPath: "/Game/UtahRaptor/Textures/T_Target.T_Target",
        toVirtualPath: "/Clawed/Base/UtahRaptor/Textures/T_Target",
        relation: "replaces",
        required: true,
        source: "baseGame"
      }
    ],
    exportEligibility: {
      state: "exportable",
      allowedOutputs: [
        "clawedmod",
        "assetIndex",
        "dependencyGraph",
        "conflictReport",
        "validationReport"
      ],
      containsBaseGameContent: false,
      requiresUserOwnedSource: false
    }
  });
}
