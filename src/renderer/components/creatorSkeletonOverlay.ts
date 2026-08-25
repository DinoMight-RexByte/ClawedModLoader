import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Vector3,
  type Bone,
  type Material,
  type Object3D,
  type SkinnedMesh,
  type Skeleton
} from "three";

export const skinnedSkeletonOverlayName = "CMM_SkinnedSkeletonOverlay";
export const skeletonOnlyOverlayName = "CMM_SkeletonOnlyOverlay";

interface Vec4Attribute {
  count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  getW(index: number): number;
}

interface JointAccumulator {
  bone: Bone;
  samples: number;
  sum: Vector3;
  weight: number;
}

interface SkeletonMeshGroup {
  meshes: SkinnedMesh[];
  skeleton: Skeleton;
}

export interface CreatorSkeletonOverlayResult {
  overlayCount: number;
  overlays: LineSegments[];
  skeletonOnlyBoneCount: number;
  skinnedMeshCount: number;
  weightCentroidCount: number;
}

export interface CreatorSkeletonOverlayMetrics {
  centerDeltaRatio: number | null;
  coverageRatio: number;
  meanNearestJointDistanceRatio: number | null;
  overlayCount: number;
  p90NearestJointDistanceRatio: number | null;
  skinnedMeshCount: number;
  weightCentroidCount: number;
}

export function createCreatorSkeletonOverlays(
  root: Object3D
): CreatorSkeletonOverlayResult {
  root.updateMatrixWorld(true);
  const groups = collectSkeletonMeshGroups(root);
  const skinned = groups
    .map((group) => createSkinnedSkeletonOverlay(group))
    .filter((overlay): overlay is LineSegments => Boolean(overlay));
  const skeletonOnly =
    groups.length === 0 ? createSkeletonOnlyOverlay(root) : null;
  const overlays = skeletonOnly ? [...skinned, skeletonOnly.overlay] : skinned;
  return {
    overlayCount: overlays.length,
    overlays,
    skeletonOnlyBoneCount: skeletonOnly?.boneCount ?? 0,
    skinnedMeshCount: groups.reduce(
      (total, group) => total + group.meshes.length,
      0
    ),
    weightCentroidCount: skinned.reduce(
      (total, overlay) => total + Number(overlay.userData.weightCentroidCount ?? 0),
      0
    )
  };
}

export function setCreatorSkeletonOverlaysVisible(
  overlays: Object3D[],
  visible: boolean
): void {
  overlays.forEach((overlay) => {
    overlay.visible = visible;
  });
}

export function disposeCreatorSkeletonOverlays(overlays: Object3D[]): void {
  overlays.forEach((overlay) => {
    overlay.parent?.remove(overlay);
    overlay.traverse((object) => {
      const disposable = object as Object3D & {
        geometry?: { dispose(): void };
        material?: Material | Material[];
      };
      disposable.geometry?.dispose();
      const materials = disposable.material
        ? Array.isArray(disposable.material)
          ? disposable.material
          : [disposable.material]
        : [];
      materials.forEach((material) => material.dispose());
    });
  });
}

export function collectSkinnedWorldVertices(root: Object3D): Vector3[] {
  const vertices: Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!isSkinnedMesh(object)) {
      return;
    }
    object.updateMatrixWorld(true);
    object.skeleton.update();
    const position = object.geometry.getAttribute("position");
    if (!position) {
      return;
    }
    const vertex = new Vector3();
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index);
      object.applyBoneTransform(index, vertex);
      object.localToWorld(vertex);
      vertices.push(vertex.clone());
    }
  });
  return vertices;
}

export function measureCreatorSkeletonOverlay(
  root: Object3D,
  overlays: Object3D[]
): CreatorSkeletonOverlayMetrics {
  const meshVertices = collectSkinnedWorldVertices(root);
  const overlayVertices = collectOverlayVertices(overlays);
  const skeletonGroups = collectSkeletonMeshGroups(root);
  const overlayCount = overlays.length;
  const weightCentroidCount = overlays.reduce(
    (total, overlay) => total + Number(overlay.userData.weightCentroidCount ?? 0),
    0
  );

  if (!meshVertices.length || !overlayVertices.length) {
    return {
      centerDeltaRatio: null,
      coverageRatio: 0,
      meanNearestJointDistanceRatio: null,
      overlayCount,
      p90NearestJointDistanceRatio: null,
      skinnedMeshCount: skeletonGroups.reduce(
        (total, group) => total + group.meshes.length,
        0
      ),
      weightCentroidCount
    };
  }

  const meshBox = new Box3().setFromPoints(meshVertices);
  const overlayBox = new Box3().setFromPoints(overlayVertices);
  const diagonal = Math.max(meshBox.getSize(new Vector3()).length(), 1);
  const meshCenter = meshBox.getCenter(new Vector3());
  const overlayCenter = overlayBox.getCenter(new Vector3());
  const expandedMeshBox = meshBox.clone().expandByScalar(diagonal * 0.05);
  const nearestDistances = meshVertices.map(
    (vertex) => nearestDistance(vertex, overlayVertices) / diagonal
  );
  nearestDistances.sort((left, right) => left - right);

  return {
    centerDeltaRatio: meshCenter.distanceTo(overlayCenter) / diagonal,
    coverageRatio:
      overlayVertices.filter((vertex) => expandedMeshBox.containsPoint(vertex))
        .length / overlayVertices.length,
    meanNearestJointDistanceRatio:
      nearestDistances.reduce((total, distance) => total + distance, 0) /
      nearestDistances.length,
    overlayCount,
    p90NearestJointDistanceRatio:
      nearestDistances[Math.floor((nearestDistances.length - 1) * 0.9)] ?? null,
    skinnedMeshCount: skeletonGroups.reduce(
      (total, group) => total + group.meshes.length,
      0
    ),
    weightCentroidCount
  };
}

function collectSkeletonMeshGroups(root: Object3D): SkeletonMeshGroup[] {
  const groups = new Map<string, SkeletonMeshGroup>();
  root.traverse((object) => {
    if (!isSkinnedMesh(object)) {
      return;
    }
    const key = object.skeleton.uuid;
    const group = groups.get(key);
    if (group) {
      group.meshes.push(object);
    } else {
      groups.set(key, { meshes: [object], skeleton: object.skeleton });
    }
  });
  return [...groups.values()];
}

function createSkinnedSkeletonOverlay({
  meshes,
  skeleton
}: SkeletonMeshGroup): LineSegments | null {
  const joints = collectWeightedJoints(meshes, skeleton);
  const boneIndexes = new Map<Bone, number>();
  skeleton.bones.forEach((bone, index) => boneIndexes.set(bone, index));
  const positions: number[] = [];

  [...joints.entries()]
    .sort(([left], [right]) => left - right)
    .forEach(([, joint]) => {
      const parentIndex = nearestWeightedParentIndex(
        joint.bone,
        boneIndexes,
        joints
      );
      if (parentIndex === null) {
        return;
      }
      const parent = joints.get(parentIndex);
      if (!parent) {
        return;
      }
      const from = joint.sum.clone().divideScalar(joint.weight);
      const to = parent.sum.clone().divideScalar(parent.weight);
      if (from.distanceToSquared(to) <= 1e-10) {
        return;
      }
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    });

  if (!positions.length) {
    return null;
  }

  const overlay = createLineOverlay(
    positions,
    skinnedSkeletonOverlayName,
    "#facc15"
  );
  overlay.userData.kind = "skinned";
  overlay.userData.skinnedMeshCount = meshes.length;
  overlay.userData.weightCentroidCount = joints.size;
  overlay.userData.skeletonUuid = skeleton.uuid;
  return overlay;
}

function collectWeightedJoints(
  meshes: SkinnedMesh[],
  skeleton: Skeleton
): Map<number, JointAccumulator> {
  const joints = new Map<number, JointAccumulator>();
  const vertex = new Vector3();

  meshes.forEach((mesh) => {
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    const position = mesh.geometry.getAttribute("position");
    const skinIndex = mesh.geometry.getAttribute("skinIndex") as
      | Vec4Attribute
      | undefined;
    const skinWeight = mesh.geometry.getAttribute("skinWeight") as
      | Vec4Attribute
      | undefined;
    if (!position || !skinIndex || !skinWeight) {
      return;
    }

    const count = Math.min(position.count, skinIndex.count, skinWeight.count);
    for (let index = 0; index < count; index += 1) {
      vertex.fromBufferAttribute(position, index);
      mesh.applyBoneTransform(index, vertex);
      mesh.localToWorld(vertex);
      for (let channel = 0; channel < 4; channel += 1) {
        const weight = readVec4(skinWeight, index, channel);
        const boneIndex = Math.trunc(readVec4(skinIndex, index, channel));
        const bone = skeleton.bones[boneIndex];
        if (weight <= 1e-5 || !bone) {
          continue;
        }
        const joint = joints.get(boneIndex) ?? {
          bone,
          samples: 0,
          sum: new Vector3(),
          weight: 0
        };
        joint.sum.addScaledVector(vertex, weight);
        joint.weight += weight;
        joint.samples += 1;
        joints.set(boneIndex, joint);
      }
    }
  });

  return joints;
}

function nearestWeightedParentIndex(
  bone: Bone,
  boneIndexes: Map<Bone, number>,
  joints: Map<number, JointAccumulator>
): number | null {
  let parent = bone.parent;
  while (parent) {
    const index = boneIndexes.get(parent as Bone);
    if (index !== undefined && joints.has(index)) {
      return index;
    }
    parent = parent.parent;
  }
  return null;
}

function createSkeletonOnlyOverlay(
  root: Object3D
): { boneCount: number; overlay: LineSegments } | null {
  const bones: Bone[] = [];
  root.traverse((object) => {
    if (isBone(object)) {
      bones.push(object);
    }
  });

  const boneSet = new Set<Bone>(bones);
  const positions: number[] = [];
  const from = new Vector3();
  const to = new Vector3();
  bones.forEach((bone) => {
    if (!bone.parent || !boneSet.has(bone.parent as Bone)) {
      return;
    }
    bone.getWorldPosition(from);
    bone.parent.getWorldPosition(to);
    if (from.distanceToSquared(to) <= 1e-10) {
      return;
    }
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  });

  if (!positions.length) {
    return null;
  }

  const overlay = createLineOverlay(positions, skeletonOnlyOverlayName, "#67e8f9");
  overlay.userData.kind = "skeletonOnly";
  overlay.userData.skeletonOnlyBoneCount = bones.length;
  return { boneCount: bones.length, overlay };
}

function createLineOverlay(
  positions: number[],
  name: string,
  color: string
): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    opacity: 0.9,
    transparent: true
  });
  const overlay = new LineSegments(geometry, material);
  overlay.frustumCulled = false;
  overlay.name = name;
  overlay.renderOrder = 10;
  return overlay;
}

function collectOverlayVertices(overlays: Object3D[]): Vector3[] {
  const vertices: Vector3[] = [];
  overlays.forEach((overlay) => {
    overlay.updateMatrixWorld(true);
    overlay.traverse((object) => {
      if (!(object instanceof LineSegments)) {
        return;
      }
      const position = object.geometry.getAttribute("position");
      const vertex = new Vector3();
      for (let index = 0; index < position.count; index += 1) {
        vertex.fromBufferAttribute(position, index);
        object.localToWorld(vertex);
        vertices.push(vertex.clone());
      }
    });
  });
  return vertices;
}

function nearestDistance(point: Vector3, candidates: Vector3[]): number {
  return Math.sqrt(
    candidates.reduce(
      (minimum, candidate) =>
        Math.min(minimum, point.distanceToSquared(candidate)),
      Number.POSITIVE_INFINITY
    )
  );
}

function readVec4(attribute: Vec4Attribute, index: number, channel: number): number {
  if (channel === 0) {
    return attribute.getX(index);
  }
  if (channel === 1) {
    return attribute.getY(index);
  }
  if (channel === 2) {
    return attribute.getZ(index);
  }
  return attribute.getW(index);
}

function isSkinnedMesh(object: Object3D): object is SkinnedMesh {
  const candidate = object as SkinnedMesh;
  return Boolean(
    candidate.isSkinnedMesh &&
      candidate.skeleton?.bones?.length &&
      candidate.geometry
  );
}

function isBone(object: Object3D): object is Bone {
  return Boolean((object as Bone).isBone);
}
