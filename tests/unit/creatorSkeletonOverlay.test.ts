import { describe, expect, it, vi } from "vitest";
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute
} from "three";

import {
  collectSkinnedWorldVertices,
  createCreatorSkeletonOverlays,
  disposeCreatorSkeletonOverlays,
  measureCreatorSkeletonOverlay,
  setCreatorSkeletonOverlaysVisible,
  skeletonOnlyOverlayName,
  skinnedSkeletonOverlayName
} from "../../src/renderer/components/creatorSkeletonOverlay";

describe("creator skeleton overlays", () => {
  it("groups material-split skinned meshes sharing one skeleton into one overlay", () => {
    const { root } = createSkinnedFixture();

    const result = createCreatorSkeletonOverlays(root);
    const position = result.overlays[0]?.geometry.getAttribute("position");

    expect(result.overlayCount).toBe(1);
    expect(result.overlays[0]?.name).toBe(skinnedSkeletonOverlayName);
    expect(result.skinnedMeshCount).toBe(2);
    expect(result.weightCentroidCount).toBe(3);
    expect(position?.count).toBe(4);

    disposeCreatorSkeletonOverlays(result.overlays);
  });

  it("anchors skinned overlays to skinned world vertices instead of raw bone origins", () => {
    const { root } = createSkinnedFixture();

    const result = createCreatorSkeletonOverlays(root);
    const vertices = collectSkinnedWorldVertices(root);
    const metrics = measureCreatorSkeletonOverlay(root, result.overlays);
    const position = result.overlays[0]?.geometry.getAttribute("position");
    const xs = Array.from({ length: position?.count ?? 0 }, (_, index) =>
      position?.getX(index) ?? 0
    );

    expect(vertices.length).toBe(6);
    expect(Math.max(...xs.map((value) => Math.abs(value)))).toBeLessThan(0.01);
    expect(metrics.centerDeltaRatio).not.toBeNull();
    expect(metrics.centerDeltaRatio ?? 1).toBeLessThan(0.01);
    expect(metrics.coverageRatio).toBe(1);

    disposeCreatorSkeletonOverlays(result.overlays);
  });

  it("keeps skeleton-only previews separate from skinned mesh overlays", () => {
    const root = new Group();
    const hip = new Bone();
    const spine = new Bone();
    const head = new Bone();
    spine.position.set(0, 1, 0);
    head.position.set(0, 1, 0);
    hip.add(spine);
    spine.add(head);
    root.add(hip);
    root.updateMatrixWorld(true);

    const result = createCreatorSkeletonOverlays(root);

    expect(result.overlayCount).toBe(1);
    expect(result.overlays[0]?.name).toBe(skeletonOnlyOverlayName);
    expect(result.skinnedMeshCount).toBe(0);
    expect(result.skeletonOnlyBoneCount).toBe(3);

    disposeCreatorSkeletonOverlays(result.overlays);
  });

  it("toggles and disposes overlays without unloading the source scene", () => {
    const { root } = createSkinnedFixture();
    const result = createCreatorSkeletonOverlays(root);
    const dispose = vi.spyOn(result.overlays[0].geometry, "dispose");

    setCreatorSkeletonOverlaysVisible(result.overlays, false);
    expect(result.overlays[0].visible).toBe(false);

    setCreatorSkeletonOverlaysVisible(result.overlays, true);
    expect(result.overlays[0].visible).toBe(true);

    disposeCreatorSkeletonOverlays(result.overlays);
    expect(dispose).toHaveBeenCalledOnce();
    expect(root.children.length).toBe(3);
  });
});

function createSkinnedFixture(): { root: Group; skeleton: Skeleton } {
  const root = new Group();
  const hip = new Bone();
  const spine = new Bone();
  const head = new Bone();
  hip.position.set(8, 0, 0);
  spine.position.set(0, 1, 0);
  head.position.set(0, 1, 0);
  hip.add(spine);
  spine.add(head);
  root.add(hip);
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton([hip, spine, head]);
  root.add(createSkinnedMesh(skeleton, -0.2));
  root.add(createSkinnedMesh(skeleton, 0.2));
  root.updateMatrixWorld(true);
  return { root, skeleton };
}

function createSkinnedMesh(skeleton: Skeleton, x: number): SkinnedMesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([x, 0, 0, x, 1, 0, x, 2, 0], 3)
  );
  geometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0], 4)
  );
  geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4)
  );
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.bind(skeleton);
  return mesh;
}
