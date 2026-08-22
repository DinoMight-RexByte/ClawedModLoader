import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  SkeletonHelper,
  Vector3,
  type Object3D,
  type SkinnedMesh
} from "three";

const minSegmentLengthSq = 1e-10;

export function createSkeletonOverlays(object: Object3D): Object3D[] {
  const skeletonMeshes = new Map<SkinnedMesh["skeleton"], SkinnedMesh[]>();
  object.traverse((child) => {
    const mesh = child as SkinnedMesh;
    const skeleton = mesh.skeleton;
    if (!mesh.isSkinnedMesh || !skeleton) {
      return;
    }
    skeletonMeshes.set(skeleton, [...(skeletonMeshes.get(skeleton) ?? []), mesh]);
  });

  const overlays: Object3D[] = [];
  skeletonMeshes.forEach((meshes) => {
    const overlay = createSkinnedSkeletonOverlay(meshes);
    if (overlay) {
      overlays.push(overlay);
    }
  });

  if (overlays.length > 0) {
    return overlays;
  }

  return hasSkeletonHierarchy(object) ? [new SkeletonHelper(object)] : [];
}

function createSkinnedSkeletonOverlay(meshes: SkinnedMesh[]): LineSegments | null {
  const mesh = meshes[0];
  if (!mesh) {
    return null;
  }

  const { bones } = mesh.skeleton;
  if (bones.length === 0) {
    return null;
  }

  const indexes = new Map<Object3D, number>();
  bones.forEach((bone, index) => indexes.set(bone, index));
  const visibleBoneIndexes = weightedBoneIndexes(meshes);
  const source = alignSkeletonSource(
    createHierarchyPoseSource(mesh, indexes, visibleBoneIndexes),
    meshes,
    mesh
  );

  if (!source) {
    return null;
  }

  const positions = sourceLinePositions(source);
  if (positions.length === 0) {
    return null;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color: "#22d3ee",
    depthTest: false,
    depthWrite: false,
    opacity: 0.95,
    toneMapped: false,
    transparent: true
  });
  const overlay = new LineSegments(geometry, material);
  overlay.frustumCulled = false;
  overlay.matrix = mesh.matrixWorld;
  overlay.matrixAutoUpdate = false;
  overlay.name = "CMM_SkinnedSkeletonOverlay";
  return overlay;
}

interface SkeletonSource {
  positions: Vector3[];
  segments: Array<[number, number]>;
}

interface WeightedJoint {
  index: number;
  position: Vector3;
  weight: number;
}

function createHierarchyPoseSource(
  mesh: SkinnedMesh,
  indexes: Map<Object3D, number>,
  visibleBoneIndexes: Set<number> | null
): SkeletonSource | null {
  mesh.updateWorldMatrix(true, true);
  updateSkeletonWorldMatrices(mesh.skeleton.bones, indexes);
  const worldToMesh = new Matrix4().copy(mesh.matrixWorld).invert();
  const boneMatrix = new Matrix4();
  return createSkeletonSource(mesh, indexes, visibleBoneIndexes, (index, target) => {
    boneMatrix.multiplyMatrices(worldToMesh, mesh.skeleton.bones[index].matrixWorld);
    return target.setFromMatrixPosition(boneMatrix);
  });
}

function createSkeletonSource(
  mesh: SkinnedMesh,
  indexes: Map<Object3D, number>,
  visibleBoneIndexes: Set<number> | null,
  positionAt: (index: number, target: Vector3) => Vector3
): SkeletonSource | null {
  const positions = mesh.skeleton.bones.map((_, index) =>
    positionAt(index, new Vector3())
  );
  const segments: Array<[number, number]> = [];
  let hasVisibleSegment = false;

  mesh.skeleton.bones.forEach((bone, index) => {
    const parentIndex = nearestVisibleParentIndex(
      bone,
      indexes,
      visibleBoneIndexes
    );
    if (parentIndex === undefined) {
      return;
    }
    if (visibleBoneIndexes && !visibleBoneIndexes.has(index)) {
      return;
    }

    const parent = positions[parentIndex];
    const child = positions[index];
    if (!isFiniteVector(parent) || !isFiniteVector(child)) {
      return;
    }

    hasVisibleSegment ||= parent.distanceToSquared(child) > minSegmentLengthSq;
    segments.push([parentIndex, index]);
  });

  if (segments.length === 0 || !hasVisibleSegment) {
    return null;
  }

  return { positions, segments };
}

function alignSkeletonSource(
  source: SkeletonSource | null,
  meshes: SkinnedMesh[],
  targetMesh: SkinnedMesh
): SkeletonSource | null {
  if (!source) {
    return null;
  }

  const joints = skinWeightJoints(meshes, targetMesh);
  if (joints.length === 0) {
    return source;
  }

  const positions = source.positions.map((position) => position.clone());
  joints.forEach((joint) => {
    positions[joint.index] = joint.position.clone();
  });
  return { positions, segments: source.segments };
}

function updateSkeletonWorldMatrices(
  bones: Object3D[],
  indexes: Map<Object3D, number>
): void {
  bones.forEach((bone) => {
    if (!bone.parent || !indexes.has(bone.parent)) {
      bone.updateWorldMatrix(true, true);
    }
  });
}

function nearestVisibleParentIndex(
  bone: Object3D,
  indexes: Map<Object3D, number>,
  visibleBoneIndexes: Set<number> | null
): number | undefined {
  for (let current = bone.parent; current; current = current.parent) {
    const index = indexes.get(current);
    if (index === undefined) {
      return undefined;
    }
    if (!visibleBoneIndexes || visibleBoneIndexes.has(index)) {
      return index;
    }
  }
  return undefined;
}

function weightedBoneIndexes(meshes: SkinnedMesh[]): Set<number> | null {
  const used = new Set<number>();

  meshes.forEach((mesh) => {
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    if (!skinIndex || !skinWeight) {
      return;
    }

    for (let vertexIndex = 0; vertexIndex < skinIndex.count; vertexIndex++) {
      for (let influence = 0; influence < 4; influence++) {
        if (attributeComponent(skinWeight, vertexIndex, influence) <= 0) {
          continue;
        }
        used.add(Math.trunc(attributeComponent(skinIndex, vertexIndex, influence)));
      }
    }
  });

  return used.size > 0 ? used : null;
}

function sourceLinePositions(source: SkeletonSource): number[] {
  const positions: number[] = [];
  source.segments.forEach(([parentIndex, childIndex]) => {
    const parent = source.positions[parentIndex];
    const child = source.positions[childIndex];
    positions.push(parent.x, parent.y, parent.z, child.x, child.y, child.z);
  });
  return positions;
}

function skinWeightJoints(
  meshes: SkinnedMesh[],
  targetMesh: SkinnedMesh
): WeightedJoint[] {
  const joints = new Map<number, WeightedJoint>();
  const worldToTarget = new Matrix4().copy(targetMesh.matrixWorld).invert();
  const meshToTarget = new Matrix4();
  const vertex = new Vector3();

  meshes.forEach((mesh) => {
    const position = mesh.geometry.getAttribute("position");
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    if (!position || !skinIndex || !skinWeight) {
      return;
    }

    const meshJoints = targetMesh.skeleton.bones.map((_, index) => ({
      index,
      position: new Vector3(),
      weight: 0
    }));
    mesh.updateWorldMatrix(true, false);
    meshToTarget.multiplyMatrices(worldToTarget, mesh.matrixWorld);
    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
      vertex.fromBufferAttribute(position, vertexIndex);
      mesh.applyBoneTransform(vertexIndex, vertex);
      vertex.applyMatrix4(meshToTarget);
      for (let influence = 0; influence < 4; influence++) {
        const weight = attributeComponent(skinWeight, vertexIndex, influence);
        if (weight <= 0) {
          continue;
        }
        const boneIndex = Math.trunc(
          attributeComponent(skinIndex, vertexIndex, influence)
        );
        const joint = meshJoints[boneIndex];
        if (!joint) {
          continue;
        }
        joint.position.addScaledVector(vertex, weight);
        joint.weight += weight;
      }
    }
    meshJoints.forEach((joint) => {
      if (joint.weight <= 0) {
        return;
      }
      const current = joints.get(joint.index);
      if (!current || joint.weight > current.weight) {
        joints.set(joint.index, {
          index: joint.index,
          position: joint.position.multiplyScalar(1 / joint.weight),
          weight: joint.weight
        });
      }
    });
  });

  return [...joints.values()];
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

function hasSkeletonHierarchy(object: Object3D): boolean {
  let found = false;
  object.traverse((child) => {
    const candidate = child as Object3D & { isBone?: boolean };
    found ||= Boolean(candidate.isBone);
  });
  return found;
}

function isFiniteVector(value: Vector3): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}
