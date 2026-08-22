import {
  Bone,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  type LineSegments
} from "three";
import { describe, expect, it } from "vitest";

import { createSkeletonOverlays } from "../../src/renderer/components/creatorSkeletonOverlay";

describe("creator skeleton overlay", () => {
  it("builds skinned mesh overlays from the live bone hierarchy", () => {
    const root = new Bone();
    const child = new Bone();
    child.position.set(0, 2, 0);
    root.add(child);
    const skeleton = new Skeleton([root, child], [
      new Matrix4(),
      new Matrix4().makeTranslation(0, -2, 0)
    ]);
    const mesh = new SkinnedMesh(
      weightedGeometry([0, 0, 0, 0, 2, 0], [0, 1]),
      new MeshBasicMaterial()
    );
    mesh.bind(skeleton, new Matrix4());

    const overlay = createSkeletonOverlays(mesh)[0] as LineSegments;
    const positions = overlay.geometry.getAttribute("position");

    expect(overlay.name).toBe("CMM_SkinnedSkeletonOverlay");
    expect(overlay.matrix).toBe(mesh.matrixWorld);
    expect(positions.getY(0)).toBeCloseTo(0);
    expect(positions.getY(1)).toBeCloseTo(2);
  });

  it("uses live hierarchy joints when inverse bind matrices disagree", () => {
    const root = new Bone();
    const child = new Bone();
    child.position.set(0, -2, 0);
    root.add(child);
    const skeleton = new Skeleton([root, child], [
      new Matrix4(),
      new Matrix4().makeTranslation(0, -2, 0)
    ]);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, -0.2, 2, 0, 0.2, 2, 0], 3)
    );
    geometry.setAttribute(
      "skinIndex",
      new Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4)
    );
    geometry.setAttribute(
      "skinWeight",
      new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4)
    );
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.bind(skeleton, new Matrix4());

    const overlay = createSkeletonOverlays(mesh)[0] as LineSegments;
    const positions = overlay.geometry.getAttribute("position");

    expect(positions.getY(0)).toBeCloseTo(0);
    expect(positions.getY(1)).toBeCloseTo(-2);
  });

  it("corrects mirrored live hierarchy axes against skin-weighted geometry", () => {
    const root = new Bone();
    const child = new Bone();
    child.position.set(0, -2, -1);
    root.add(child);
    const skeleton = new Skeleton([root, child], [
      new Matrix4(),
      new Matrix4().makeTranslation(0, 2, 1)
    ]);
    const mesh = new SkinnedMesh(
      weightedGeometry([0, 0, 0, 0, 2, 1], [0, 1]),
      new MeshBasicMaterial()
    );
    mesh.bind(skeleton, new Matrix4());

    const overlay = createSkeletonOverlays(mesh)[0] as LineSegments;
    const positions = overlay.geometry.getAttribute("position");

    expect(positions.getY(1)).toBeCloseTo(2);
    expect(positions.getZ(1)).toBeCloseTo(1);
  });

  it("preserves asymmetric left-right joint positions during axis correction", () => {
    const root = new Bone();
    const child = new Bone();
    child.position.set(-1, -2, -1);
    root.add(child);
    const skeleton = new Skeleton([root, child], [
      new Matrix4(),
      new Matrix4().makeTranslation(1, 2, 1)
    ]);
    const mesh = new SkinnedMesh(
      weightedGeometry([0, 0, 0, -1, 2, 1], [0, 1]),
      new MeshBasicMaterial()
    );
    mesh.bind(skeleton, new Matrix4());

    const overlay = createSkeletonOverlays(mesh)[0] as LineSegments;
    const positions = overlay.geometry.getAttribute("position");

    expect(positions.getX(1)).toBeCloseTo(-1);
    expect(positions.getY(1)).toBeCloseTo(2);
    expect(positions.getZ(1)).toBeCloseTo(1);
  });

  it("aligns against skinned vertex positions instead of raw bind vertices", () => {
    const root = new Bone();
    const child = new Bone();
    child.position.set(0, 1, 0);
    root.add(child);
    const skeleton = new Skeleton([root, child], [
      new Matrix4(),
      new Matrix4().makeTranslation(0, -1, 0)
    ]);
    const mesh = new SkinnedMesh(
      weightedGeometry([0, 0, 0, 0, 1, 0], [0, 1]),
      new MeshBasicMaterial()
    );
    mesh.bind(skeleton, new Matrix4());
    child.position.set(0, 2, 0);

    const overlay = createSkeletonOverlays(mesh)[0] as LineSegments;
    const positions = overlay.geometry.getAttribute("position");

    expect(positions.getY(1)).toBeCloseTo(2);
  });

  it("uses all material splits when matching skin-weighted joints", () => {
    const root = new Bone();
    const child = new Bone();
    child.position.set(0, 2, 1);
    root.add(child);
    const skeleton = new Skeleton([root, child], [
      new Matrix4(),
      new Matrix4().makeTranslation(0, -2, -1)
    ]);
    const first = new SkinnedMesh(
      weightedGeometry([0, 0, 0, 0, -2, -1], [0, 1]),
      new MeshBasicMaterial()
    );
    const second = new SkinnedMesh(
      weightedGeometry(
        [0, 0, 0, -0.1, 2, 1, 0.1, 2, 1, 0, 2.1, 1, 0, 1.9, 1],
        [0, 1, 1, 1, 1]
      ),
      new MeshBasicMaterial()
    );
    first.bind(skeleton, new Matrix4());
    second.bind(skeleton, new Matrix4());
    const object = new Object3D();
    object.add(first, second);

    const overlay = createSkeletonOverlays(object)[0] as LineSegments;
    const positions = overlay.geometry.getAttribute("position");

    expect(positions.getY(1)).toBeCloseTo(2);
    expect(positions.getZ(1)).toBeCloseTo(1);
  });

  it("does not reapply CUE4Parse axis correction after glTF conversion", () => {
    const root = new Bone();
    const child = new Bone();
    child.position.set(0, 2, 1);
    root.add(child);
    const skeleton = new Skeleton([root, child], [
      new Matrix4(),
      new Matrix4().makeTranslation(0, -2, -1)
    ]);
    const mesh = new SkinnedMesh(
      weightedGeometry([0, 0, 0, 0, 2, 1], [0, 1]),
      new MeshBasicMaterial()
    );
    mesh.bind(skeleton, new Matrix4());

    const overlay = createSkeletonOverlays(mesh)[0] as LineSegments;
    const positions = overlay.geometry.getAttribute("position");

    expect(positions.getY(1)).toBeCloseTo(2);
    expect(positions.getZ(1)).toBeCloseTo(1);
  });

  it("omits unweighted socket-style bones from skinned overlays", () => {
    const root = new Bone();
    const child = new Bone();
    const socket = new Bone();
    child.position.set(0, 2, 0);
    socket.position.set(4, 0, 0);
    root.add(child);
    child.add(socket);
    const skeleton = new Skeleton([root, child, socket], [
      new Matrix4(),
      new Matrix4().makeTranslation(0, -2, 0),
      new Matrix4().makeTranslation(-4, -2, 0)
    ]);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, -0.2, 2, 0, 0.2, 2, 0], 3)
    );
    geometry.setAttribute(
      "skinIndex",
      new Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4)
    );
    geometry.setAttribute(
      "skinWeight",
      new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4)
    );
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.bind(skeleton, new Matrix4());

    const overlay = createSkeletonOverlays(mesh)[0] as LineSegments;
    const positions = overlay.geometry.getAttribute("position");

    expect(positions.count).toBe(2);
    expect(positions.getY(0)).toBeCloseTo(0);
    expect(positions.getY(1)).toBeCloseTo(2);
  });

  it("falls back to Three skeleton helpers for skeleton-only hierarchies", () => {
    const root = new Bone();
    const child = new Bone();
    const object = new Object3D();
    root.add(child);
    object.add(root);

    const overlay = createSkeletonOverlays(object)[0];

    expect(overlay?.type).toBe("SkeletonHelper");
  });

  it("skips skinned meshes without a bound skeleton", () => {
    const mesh = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());

    const overlay = createSkeletonOverlays(mesh)[0];

    expect(overlay).toBeUndefined();
  });
});

function weightedGeometry(positions: number[], indexes: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(
      indexes.flatMap((index) => [index, 0, 0, 0]),
      4
    )
  );
  geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute(
      indexes.flatMap(() => [1, 0, 0, 0]),
      4
    )
  );
  return geometry;
}
