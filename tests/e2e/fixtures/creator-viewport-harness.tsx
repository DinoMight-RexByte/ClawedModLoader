import React from "react";
import { createRoot } from "react-dom/client";
import {
  Box3,
  Vector3,
  type Object3D,
  type SkinnedMesh
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { CreatorModelPreviewResult } from "../../../src/shared/contracts/app";
import { CreatorModelViewport } from "../../../src/renderer/components/CreatorModelViewport";
import { createSkeletonOverlays } from "../../../src/renderer/components/creatorSkeletonOverlay";
import "../../../src/renderer/styles/global.css";

interface VisualHarnessWindow extends Window {
  __CMM_CREATOR_VISUAL_PREVIEW__?: CreatorModelPreviewResult;
  __CMM_CREATOR_VISUAL_READY__?: boolean;
  __CMM_CREATOR_VISUAL_ERROR__?: string;
  __CMM_CREATOR_VISUAL_METRICS__?: SkeletonOverlayMetrics;
}

interface SkeletonOverlayMetrics {
  skinnedMeshCount: number;
  overlayCount: number;
  weightCentroidCount: number;
  centerDeltaRatio: number;
  coverageRatio: number;
  meanNearestJointDistanceRatio: number;
  p90NearestJointDistanceRatio: number;
  meshBox: BoxSummary | null;
  overlayBox: BoxSummary | null;
}

interface BoxSummary {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
}

const harnessWindow = window as VisualHarnessWindow;
const preview = harnessWindow.__CMM_CREATOR_VISUAL_PREVIEW__;
const root = document.getElementById("root");

if (!root) {
  throw new Error("Visual harness root is missing.");
}

if (!preview?.model) {
  throw new Error("Visual harness preview model was not provided.");
}

createRoot(root).render(
  <div className="min-h-screen bg-app-bg p-4 text-app-text">
    <CreatorModelViewport busy={false} error={null} preview={preview} />
  </div>
);

void collectSkeletonOverlayMetrics(preview.model.dataUrl)
  .then((metrics) => {
    harnessWindow.__CMM_CREATOR_VISUAL_METRICS__ = metrics;
    harnessWindow.__CMM_CREATOR_VISUAL_READY__ = true;
  })
  .catch((error) => {
    harnessWindow.__CMM_CREATOR_VISUAL_ERROR__ =
      error instanceof Error ? error.message : String(error);
  });

async function collectSkeletonOverlayMetrics(
  dataUrl: string
): Promise<SkeletonOverlayMetrics> {
  const object = await new GLTFLoader().loadAsync(dataUrl).then((gltf) => gltf.scene);
  object.updateWorldMatrix(true, true);

  const meshes: SkinnedMesh[] = [];
  object.traverse((child) => {
    const mesh = child as SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.skeleton) {
      meshes.push(mesh);
    }
  });

  const meshBox = skinnedMeshesBox(meshes);
  const overlays = createSkeletonOverlays(object);
  const overlayPoints = overlayEndpoints(overlays);
  const overlayBox = pointsBox(overlayPoints);
  const centroids = skinWeightCentroids(meshes);
  const meshSize = meshBox?.getSize(new Vector3()) ?? new Vector3();
  const meshDiagonal = Math.max(meshSize.length(), 0.001);
  const nearestRatios = centroids.map(
    (centroid) => nearestDistance(centroid, overlayPoints) / meshDiagonal
  );
  const centerDeltaRatio =
    meshBox && overlayBox
      ? meshBox.getCenter(new Vector3()).distanceTo(overlayBox.getCenter(new Vector3())) /
        meshDiagonal
      : Infinity;

  return {
    skinnedMeshCount: meshes.length,
    overlayCount: overlays.length,
    weightCentroidCount: centroids.length,
    centerDeltaRatio,
    coverageRatio:
      nearestRatios.length === 0
        ? 0
        : nearestRatios.filter((ratio) => ratio <= 0.12).length /
          nearestRatios.length,
    meanNearestJointDistanceRatio: mean(nearestRatios),
    p90NearestJointDistanceRatio: percentile(nearestRatios, 0.9),
    meshBox: meshBox ? summarizeBox(meshBox) : null,
    overlayBox: overlayBox ? summarizeBox(overlayBox) : null
  };
}

function skinnedMeshesBox(meshes: SkinnedMesh[]): Box3 | null {
  const box = new Box3();
  let found = false;
  const vertex = new Vector3();
  meshes.forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    if (!position) {
      return;
    }
    mesh.updateWorldMatrix(true, false);
    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
      box.expandByPoint(skinnedWorldVertex(mesh, vertexIndex, vertex));
      found = true;
    }
  });
  return found ? box : null;
}

function overlayEndpoints(overlays: Object3D[]): Vector3[] {
  const points: Vector3[] = [];
  overlays.forEach((overlay) => {
    const geometry = (overlay as { geometry?: { getAttribute(name: string): unknown } })
      .geometry;
    const position = geometry?.getAttribute("position") as
      | { count: number; getX(index: number): number; getY(index: number): number; getZ(index: number): number }
      | undefined;
    if (!position) {
      return;
    }
    overlay.updateWorldMatrix(true, false);
    for (let index = 0; index < position.count; index++) {
      points.push(
        new Vector3(
          position.getX(index),
          position.getY(index),
          position.getZ(index)
        ).applyMatrix4(overlay.matrixWorld)
      );
    }
  });
  return points;
}

function pointsBox(points: Vector3[]): Box3 | null {
  if (points.length === 0) {
    return null;
  }
  const box = new Box3();
  points.forEach((point) => box.expandByPoint(point));
  return box;
}

function skinWeightCentroids(meshes: SkinnedMesh[]): Vector3[] {
  const sums = new Map<string, { position: Vector3; weight: number }>();
  const vertex = new Vector3();

  meshes.forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    if (!position || !skinIndex || !skinWeight) {
      return;
    }

    mesh.updateWorldMatrix(true, false);
    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
      skinnedWorldVertex(mesh, vertexIndex, vertex);
      for (let influence = 0; influence < 4; influence++) {
        const weight = attributeComponent(skinWeight, vertexIndex, influence);
        if (weight <= 0) {
          continue;
        }
        const key = `${mesh.uuid}:${Math.trunc(
          attributeComponent(skinIndex, vertexIndex, influence)
        )}`;
        const sum = sums.get(key) ?? { position: new Vector3(), weight: 0 };
        sum.position.addScaledVector(vertex, weight);
        sum.weight += weight;
        sums.set(key, sum);
      }
    }
  });

  return [...sums.values()]
    .filter((sum) => sum.weight > 0)
    .map((sum) => sum.position.multiplyScalar(1 / sum.weight));
}

function skinnedWorldVertex(
  mesh: SkinnedMesh,
  vertexIndex: number,
  target: Vector3
): Vector3 {
  const position = mesh.geometry.getAttribute("position");
  target.fromBufferAttribute(position, vertexIndex);
  mesh.applyBoneTransform(vertexIndex, target);
  return target.applyMatrix4(mesh.matrixWorld);
}

function attributeComponent(
  attribute: {
    getX(index: number): number;
    getY(index: number): number;
    getZ(index: number): number;
    getW(index: number): number;
  },
  index: number,
  component: number
): number {
  if (component === 0) {
    return attribute.getX(index);
  }
  if (component === 1) {
    return attribute.getY(index);
  }
  if (component === 2) {
    return attribute.getZ(index);
  }
  return attribute.getW(index);
}

function nearestDistance(point: Vector3, candidates: Vector3[]): number {
  if (candidates.length === 0) {
    return Infinity;
  }
  return Math.sqrt(
    Math.min(...candidates.map((candidate) => point.distanceToSquared(candidate)))
  );
}

function mean(values: number[]): number {
  return values.length === 0
    ? Infinity
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) {
    return Infinity;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

function summarizeBox(box: Box3): BoxSummary {
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z]
  };
}
