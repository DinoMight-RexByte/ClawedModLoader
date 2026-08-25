import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { Cue4ParseMeshDecoder } from "../../src/main/adapters/unreal/cue4parseMeshDecoder";
import type {
  CreatorAssetDetail,
  CreatorAssetIndexEntry,
  CreatorModelPreviewMetadata,
  CreatorModelPreviewResult
} from "../../src/shared/contracts/app";

const liveEnabled = process.env.CMM_CREATOR_VIEWPORT_ANKYLO_VISUAL === "1";
const artifactRoot = process.env.CMM_CREATOR_VIEWPORT_ANKYLO_ARTIFACT_DIR
  ? path.resolve(process.env.CMM_CREATOR_VIEWPORT_ANKYLO_ARTIFACT_DIR)
  : path.join(
      process.cwd(),
      ".codex",
      "live-validation",
      "creator-viewport-ankylosaurus"
    );
const defaultGameRoot = String.raw`C:\Program Files (x86)\Steam\steamapps\common\Clawed`;
const ankylosaurusAsset: CreatorAssetIndexEntry = {
  id: "base:ankylosaurus-sk-t-pose",
  label: "SK_Ankylosaurus_T_POSE",
  source: "baseGameMap",
  ownerLabel: "Clawed Base Game",
  packageId: null,
  packageVersion: null,
  packageName: null,
  containerName: "Clawed-Windows",
  loader: null,
  activeProfileEnabled: false,
  activeProfileOrder: null,
  assetClass: "SkeletalMesh",
  viewportCapable: true,
  viewportState: "viewable",
  packagePath: "/Game/Ankylosaurus/Meshes/SK_Ankylosaurus_T_POSE",
  objectPath:
    "/Game/Ankylosaurus/Meshes/SK_Ankylosaurus_T_POSE.SK_Ankylosaurus_T_POSE",
  virtualPath:
    "/Clawed/Base/Clawed/Content/Ankylosaurus/Meshes/SK_Ankylosaurus_T_POSE.uasset",
  payloadPath: null,
  relativePath:
    "Clawed/Content/Ankylosaurus/Meshes/SK_Ankylosaurus_T_POSE.uasset",
  extension: ".uasset",
  tags: ["cooked_asset", "model_visuals", "character_model_animation"],
  modUses: "Ankylosaurus skeletal mesh visual reference",
  sizeBytes: null,
  sha256: null,
  validationState: null,
  deploymentRoute: null,
  exportState: "exportable",
  conflictState: "none"
};

test.skip(
  !liveEnabled,
  "Set CMM_CREATOR_VIEWPORT_ANKYLO_VISUAL=1 to run the live Ankylosaurus viewport validation."
);

test("renders the Ankylosaurus cooked skeletal mesh with an aligned skeleton overlay", async ({
  page
}, testInfo) => {
  test.setTimeout(240_000);
  const artifactDir = path.join(artifactRoot, timestamp());
  await mkdir(artifactDir, { recursive: true });
  const preview = await decodeAnkylosaurusPreview();
  await writeFile(
    path.join(artifactDir, "preview-metadata.json"),
    JSON.stringify(
      {
        asset: ankylosaurusAsset,
        model: {
          format: preview.model?.format,
          fileName: preview.model?.fileName,
          source: preview.model?.source,
          sizeBytes: preview.model?.sizeBytes
        },
        metadata: preview.metadata,
        problems: preview.problems
      },
      null,
      2
    )
  );

  await page.addInitScript((modelPreview) => {
    (window as typeof window & { __CMM_CREATOR_VISUAL_PREVIEW__?: unknown })
      .__CMM_CREATOR_VISUAL_PREVIEW__ = modelPreview;
  }, preview);
  await page.goto("/tests/e2e/fixtures/creator-viewport-harness.html");
  const viewport = page.getByTestId("creator-model-viewport");
  await expect(viewport).toBeVisible();
  await expect(page.getByText("Model preview available")).toBeVisible();
  await expect(page.getByLabel("Model preview")).toBeVisible();
  await page.waitForFunction(() => {
    const state = window as typeof window & {
      __CMM_CREATOR_VISUAL_READY__?: boolean;
      __CMM_CREATOR_VISUAL_ERROR__?: string;
    };
    return state.__CMM_CREATOR_VISUAL_READY__ || state.__CMM_CREATOR_VISUAL_ERROR__;
  });

  const error = await page.evaluate(
    () =>
      (window as typeof window & { __CMM_CREATOR_VISUAL_ERROR__?: string })
        .__CMM_CREATOR_VISUAL_ERROR__ ?? null
  );
  expect(error).toBeNull();

  const metrics = await page.evaluate(
    () =>
      (window as typeof window & { __CMM_CREATOR_VISUAL_METRICS__?: unknown })
        .__CMM_CREATOR_VISUAL_METRICS__
  );
  await writeFile(
    path.join(artifactDir, "overlay-metrics.json"),
    JSON.stringify(metrics, null, 2)
  );
  await page.waitForTimeout(3_200);
  const screenshotPath = path.join(artifactDir, "ankylosaurus-viewport.png");
  await viewport.screenshot({ path: screenshotPath });
  await testInfo.attach("ankylosaurus-viewport", {
    path: screenshotPath,
    contentType: "image/png"
  });

  expect(metrics).toMatchObject({
    skinnedMeshCount: expect.any(Number),
    overlayCount: expect.any(Number),
    weightCentroidCount: expect.any(Number),
    centerDeltaRatio: expect.any(Number),
    coverageRatio: expect.any(Number),
    meanNearestJointDistanceRatio: expect.any(Number),
    p90NearestJointDistanceRatio: expect.any(Number)
  });
  const typedMetrics = metrics as {
    skinnedMeshCount: number;
    overlayCount: number;
    weightCentroidCount: number;
    centerDeltaRatio: number;
    coverageRatio: number;
    meanNearestJointDistanceRatio: number;
    p90NearestJointDistanceRatio: number;
  };
  expect(typedMetrics.skinnedMeshCount).toBeGreaterThan(0);
  expect(typedMetrics.overlayCount).toBeGreaterThan(0);
  expect(typedMetrics.weightCentroidCount).toBeGreaterThan(12);
  expect(typedMetrics.centerDeltaRatio).toBeLessThanOrEqual(0.15);
  expect(typedMetrics.coverageRatio).toBeGreaterThanOrEqual(0.65);
  expect(typedMetrics.meanNearestJointDistanceRatio).toBeLessThanOrEqual(0.18);
  expect(typedMetrics.p90NearestJointDistanceRatio).toBeLessThanOrEqual(0.32);
});

async function decodeAnkylosaurusPreview(): Promise<CreatorModelPreviewResult> {
  const decoder = new Cue4ParseMeshDecoder({
    sidecarPath:
      process.env.CMM_CUE4PARSE_DECODER_PATH ??
      path.join(process.cwd(), "assets", "unreal-decoder", "CmmUnrealDecoder.exe"),
    resolveArchiveRoot: async () =>
      process.env.CMM_CREATOR_VIEWPORT_ARCHIVE_ROOT ??
      path.join(defaultGameRoot, "Clawed", "Content", "Paks"),
    resolveMappingsPath: async () => process.env.CMM_CUE4PARSE_MAPPINGS ?? null,
    unrealVersion: process.env.CMM_CUE4PARSE_UNREAL_VERSION ?? "GAME_UE5_5",
    aesKey: process.env.CMM_CUE4PARSE_AES_KEY ?? null,
    timeoutMs: 180_000,
    maxOutputBytes:
      Number(process.env.CMM_CREATOR_VIEWPORT_MAX_MODEL_BYTES) ||
      80 * 1024 * 1024
  });
  const result = await decoder.decode({
    asset: ankylosaurusAsset,
    detail: assetDetail(ankylosaurusAsset),
    cookedPayload: {
      objectPath: ankylosaurusAsset.objectPath,
      packagePath: ankylosaurusAsset.packagePath,
      relativePath: ankylosaurusAsset.relativePath,
      containerName: ankylosaurusAsset.containerName,
      extension: ankylosaurusAsset.extension,
      sizeBytes: ankylosaurusAsset.sizeBytes,
      sha256: ankylosaurusAsset.sha256
    },
    format: "glb",
    purpose: "preview"
  });
  if (result.status !== "ready" || !result.data) {
    throw new Error(
      [
        `Ankylosaurus decode failed with status ${result.status}.`,
        ...(result.problems ?? []).map(
          (problem) =>
            `${problem.code}: ${problem.message}${
              problem.technicalDetail ? ` (${problem.technicalDetail})` : ""
            }`
        )
      ].join(" ")
    );
  }

  return {
    status: "available",
    asset: ankylosaurusAsset,
    preview: null,
    activeWinner: null,
    model: {
      dataUrl: dataUrlForModel(result.data),
      format: "glb",
      source: "decodedBaseGame",
      fileName: result.fileName ?? "SK_Ankylosaurus_T_POSE.glb",
      sizeBytes: result.data.byteLength
    },
    metadata: metadata(result.metadata),
    problems: result.problems ?? []
  };
}

function assetDetail(asset: CreatorAssetIndexEntry): CreatorAssetDetail {
  return {
    status: "ok",
    asset,
    relatedAssets: [],
    conflicts: [],
    activeWinner: null,
    previews: [],
    checksums: [],
    dependencies: [],
    problems: []
  };
}

function metadata(
  decoded: Partial<CreatorModelPreviewMetadata> | undefined
): CreatorModelPreviewMetadata {
  return {
    meshType: decoded?.meshType ?? "skeletalMesh",
    skeleton: decoded?.skeleton ?? null,
    physicsAsset: decoded?.physicsAsset ?? null,
    materialSlots: decoded?.materialSlots ?? [],
    lods: decoded?.lods ?? [],
    dependencyPaths: decoded?.dependencyPaths ?? [],
    targetObjectPath: ankylosaurusAsset.objectPath,
    packagePath: ankylosaurusAsset.packagePath,
    packageSource: ankylosaurusAsset.ownerLabel,
    sourceContainer: ankylosaurusAsset.containerName,
    previewSource: "Direct decoded base-game asset",
    lodCount: decoded?.lodCount ?? null,
    vertexCount: decoded?.vertexCount ?? null,
    triangleCount: decoded?.triangleCount ?? null,
    materialSlotCount: decoded?.materialSlotCount ?? null,
    validationState: ankylosaurusAsset.validationState,
    conflictWinner: null,
    exportState: ankylosaurusAsset.exportState
  };
}

function dataUrlForModel(data: Buffer): string {
  return `data:model/gltf-binary;base64,${data.toString("base64")}`;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
