import type { ReactElement } from "react";
import { useEffect, useMemo, useRef } from "react";
import {
  AmbientLight,
  Box3,
  BoxHelper,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  MOUSE,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  Vector2,
  WebGLRenderer,
  type Material,
  type Object3D
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

import type {
  CreatorModelPreviewPayload,
  CreatorViewportCameraState,
  CreatorViewportTextureCandidate
} from "../../shared/contracts/app";
import type {
  CreatorViewportBundleItem,
  CreatorViewportLightSettings
} from "../stores/creatorAssetStore";
import {
  createCreatorSkeletonOverlays,
  disposeCreatorSkeletonOverlays,
  setCreatorSkeletonOverlaysVisible
} from "./creatorSkeletonOverlay";
import {
  applyCreatorViewportDiagnosticMaterials,
  type CreatorViewportMaterialTexture,
  disposeMaterials
} from "./creatorViewportMaterials";

interface CreatorViewportSurfaceProps {
  cameraState: CreatorViewportCameraState | null;
  items: CreatorViewportBundleItem[];
  lightSettings: CreatorViewportLightSettings;
  onCameraStateChange?(cameraState: CreatorViewportCameraState | null): void;
  onRenderError?(message: string | null): void;
  onSelectItem(assetId: string): void;
  onStopRotationChange(stopRotation: boolean): void;
  selectedAssetId: string | null;
  selectedTextureCandidates: CreatorViewportTextureCandidate[];
  showSkeletons: boolean;
  stopRotation: boolean;
}

export function CreatorViewportSurface({
  cameraState,
  items,
  lightSettings,
  onCameraStateChange,
  onRenderError,
  onSelectItem,
  onStopRotationChange,
  selectedAssetId,
  selectedTextureCandidates,
  showSkeletons,
  stopRotation
}: CreatorViewportSurfaceProps): ReactElement {
  const cameraStateRef = useRef(cameraState);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const itemsRef = useRef(items);
  const lightRigRef = useRef<CreatorViewportLightRig | null>(null);
  const lightSettingsRef = useRef(lightSettings);
  const loadItemsRef = useRef<CreatorViewportBundleItem[]>([]);
  const onCameraStateChangeRef = useRef(onCameraStateChange);
  const onSelectItemRef = useRef(onSelectItem);
  const onStopRotationChangeRef = useRef(onStopRotationChange);
  const selectedAssetIdRef = useRef(selectedAssetId);
  const selectionStateRef = useRef<CreatorViewportSelectionState | null>(null);
  const selectedTextureCandidatesRef = useRef(selectedTextureCandidates);
  const skeletonOverlaysRef = useRef<Map<string, Object3D[]>>(new Map());
  const showSkeletonsRef = useRef(showSkeletons);
  const stopRotationRef = useRef(stopRotation);
  const loadItems = useMemo(
    () =>
      items.filter(
        (item) =>
          !item.busy &&
          item.preview?.model &&
          (item.preview.status === "available" ||
            item.preview.status === "ready")
      ),
    [items]
  );
  const loadItemsKey = useMemo(
    () =>
      loadItems
        .map(
          (item) =>
            `${item.assetId}:${item.previewId ?? ""}:${item.preview?.model?.fileName ?? ""}:${item.preview?.model?.sizeBytes ?? 0}`
        )
        .join("\0"),
    [loadItems]
  );
  const selectedTextureCandidatesKey = useMemo(
    () =>
      selectedTextureCandidates
        .map((candidate) => candidate.id)
        .sort()
        .join("\0"),
    [selectedTextureCandidates]
  );

  useEffect(() => {
    loadItemsRef.current = loadItems;
  }, [loadItems]);

  useEffect(() => {
    cameraStateRef.current = cameraState;
  }, [cameraState]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    selectedTextureCandidatesRef.current = selectedTextureCandidates;
  }, [selectedTextureCandidates]);

  useEffect(() => {
    onSelectItemRef.current = onSelectItem;
  }, [onSelectItem]);

  useEffect(() => {
    onCameraStateChangeRef.current = onCameraStateChange;
  }, [onCameraStateChange]);

  useEffect(() => {
    onStopRotationChangeRef.current = onStopRotationChange;
  }, [onStopRotationChange]);

  useEffect(() => {
    showSkeletonsRef.current = showSkeletons;
    applyViewportItemVisibility(
      selectionStateRef.current,
      items,
      showSkeletons,
      selectedAssetIdRef.current
    );
  }, [items, showSkeletons]);

  useEffect(() => {
    lightSettingsRef.current = lightSettings;
    if (lightRigRef.current) {
      applyCreatorViewportLightSettings(lightRigRef.current, lightSettings);
    }
  }, [lightSettings]);

  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId;
    updateSelectionHighlight(selectionStateRef.current, selectedAssetId);
  }, [selectedAssetId]);

  useEffect(() => {
    stopRotationRef.current = stopRotation;
    if (controlsRef.current) {
      controlsRef.current.autoRotate = !stopRotation;
    }
  }, [stopRotation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const currentLoadItems = loadItemsRef.current;
    const currentTextureCandidates = selectedTextureCandidatesRef.current;
    if (!canvas || !currentLoadItems.length) {
      onRenderError?.(null);
      return;
    }

    let frame = 0;
    let disposed = false;
    let controlPointer: PointerStart | null = null;
    let selectPointer: PointerStart | null = null;
    const renderer = new WebGLRenderer({
      antialias: true,
      canvas,
      preserveDrawingBuffer: true
    });
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas);
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const observer = new ResizeObserver(() => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    const stopAutoRotation = () => {
      controls.autoRotate = false;
      stopRotationRef.current = true;
      onStopRotationChangeRef.current(true);
    };
    const handleControlsEnd = () => {
      onCameraStateChangeRef.current?.(
        creatorViewportCameraState(camera, controls)
      );
    };
    const selectFromEvent = (event: MouseEvent | PointerEvent) => {
      const assetId = raycastViewportAsset(
        event,
        canvas,
        camera,
        selectionStateRef.current?.roots ?? new Map(),
        raycaster,
        pointer
      );
      if (assetId) {
        selectedAssetIdRef.current = assetId;
        onSelectItemRef.current(assetId);
        updateSelectionHighlight(selectionStateRef.current, assetId);
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (event.button === 0) {
        selectFromEvent(event);
      }
    };
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 0) {
        selectPointer = { x: event.clientX, y: event.clientY };
      }
      if (event.button === 1 || event.button === 2) {
        controlPointer = { x: event.clientX, y: event.clientY };
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!controlPointer) {
        return;
      }
      if (pointerDistance(controlPointer, event) > 3) {
        stopAutoRotation();
        controlPointer = null;
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (
        event.button === 0 &&
        selectPointer &&
        pointerDistance(selectPointer, event) <= 4
      ) {
        selectFromEvent(event);
      }
      selectPointer = null;
      controlPointer = null;
    };
    const handlePointerCancel = () => {
      selectPointer = null;
      controlPointer = null;
    };

    controls.autoRotate = !stopRotationRef.current;
    controls.autoRotateSpeed = 0.8;
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.mouseButtons = {
      LEFT: null,
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.ROTATE
    };
    controls.screenSpacePanning = true;
    controls.addEventListener("end", handleControlsEnd);
    controlsRef.current = controls;
    onRenderError?.(null);
    scene.background = new Color("#111827");
    lightRigRef.current = createCreatorViewportLightRig(scene);
    applyCreatorViewportLightSettings(
      lightRigRef.current,
      lightSettingsRef.current
    );
    const grid = new GridHelper(3, 6, "#334155", "#1f2937");
    grid.position.y = -0.75;
    scene.add(grid);
    observer.observe(canvas);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("contextmenu", handleContextMenu);
    canvas.addEventListener("pointercancel", handlePointerCancel);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);

    void Promise.all(
      currentLoadItems.map(async (item) => {
        const textures = await loadViewportTextures(
          currentTextureCandidates.filter(
            (candidate) => candidate.meshAssetId === item.assetId
          )
        );
        return {
          item,
          object: await loadPreviewObject(
            item.preview?.model as CreatorModelPreviewPayload
          ),
          textures
        };
      })
    )
      .then((loaded) => {
        if (disposed) {
          loaded.forEach(({ object, textures }) => {
            object.traverse(disposeObject);
            textures.forEach((texture) => texture.texture.dispose());
          });
          return;
        }

        const group = new Group();
        const roots = new Map<string, Object3D>();
        let offset = 0;
        loaded.forEach(({ item, object, textures }) => {
          applyCreatorViewportDiagnosticMaterials(object, textures);
          centerObject(object);
          object.name = item.assetId;
          object.userData.assetId = item.assetId;
          object.visible = item.visible;
          const width = Math.max(objectWidth(object), 0.5);
          object.position.x += offset + width / 2;
          offset += width + 0.45;
          roots.set(item.assetId, object);
          group.add(object);
        });
        centerObject(group);
        group.updateMatrixWorld(true);
        const target = frameCamera(camera, group);
        if (cameraStateRef.current) {
          applyCreatorViewportCameraState(
            camera,
            controls,
            cameraStateRef.current
          );
        } else {
          controls.target.copy(target);
        }
        controls.update();
        onCameraStateChangeRef.current?.(
          creatorViewportCameraState(camera, controls)
        );
        scene.add(group);
        const skeletonOverlays = new Map<string, Object3D[]>();
        roots.forEach((root, assetId) => {
          const overlays = createCreatorSkeletonOverlays(root).overlays;
          overlays.forEach((overlay) => scene.add(overlay));
          skeletonOverlays.set(assetId, overlays);
        });
        skeletonOverlaysRef.current = skeletonOverlays;
        selectionStateRef.current = {
          helper: null,
          overlays: skeletonOverlays,
          roots,
          scene
        };
        applyViewportItemVisibility(
          selectionStateRef.current,
          itemsRef.current,
          showSkeletonsRef.current,
          selectedAssetIdRef.current
        );
        const animate = () => {
          controls.update();
          selectionStateRef.current?.helper?.update();
          renderer.render(scene, camera);
          syncCanvasViewportState(
            canvas,
            camera,
            controls,
            selectedAssetIdRef.current,
            selectionStateRef.current
          );
          frame = window.requestAnimationFrame(animate);
        };
        animate();
      })
      .catch(() => {
        if (!disposed) {
          onRenderError?.("Model preview failed");
        }
      });

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      controls.removeEventListener("end", handleControlsEnd);
      controls.dispose();
      if (controlsRef.current === controls) {
        controlsRef.current = null;
      }
      disposeSelectionState(selectionStateRef.current);
      selectionStateRef.current = null;
      disposeCreatorSkeletonOverlays([
        ...skeletonOverlaysRef.current.values()
      ].flat());
      skeletonOverlaysRef.current.clear();
      lightRigRef.current = null;
      scene.traverse(disposeObject);
      renderer.dispose();
    };
  }, [loadItemsKey, onRenderError, selectedTextureCandidatesKey]);

  return (
    <canvas
      aria-label="Model preview"
      className="block h-96 w-full"
      data-texture-candidate-ids={selectedTextureCandidates
        .map((candidate) => candidate.id)
        .join(",")}
      data-selected-asset-id={selectedAssetId ?? ""}
      data-stop-rotation={stopRotation ? "true" : "false"}
      ref={canvasRef}
    />
  );
}

async function loadPreviewObject(
  model: CreatorModelPreviewPayload
): Promise<Object3D> {
  if (model.format === "obj") {
    return new OBJLoader().parse(decodeBase64DataUrl(model.dataUrl));
  }

  return new GLTFLoader().loadAsync(model.dataUrl).then((gltf) => gltf.scene);
}

async function loadViewportTextures(
  candidates: CreatorViewportTextureCandidate[]
): Promise<CreatorViewportMaterialTexture[]> {
  if (!candidates.length) {
    return [];
  }
  const loader = new TextureLoader();
  const loaded = await Promise.all(
    candidates
      .filter((candidate) => candidate.dataUrl)
      .map(async (candidate) => ({
        layer: candidate.layer,
        texture: await loader.loadAsync(candidate.dataUrl as string)
      }))
  );
  loaded.forEach(({ texture }) => {
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
  });
  return loaded;
}

function decodeBase64DataUrl(dataUrl: string): string {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  return window.atob(encoded);
}

function centerObject(object: Object3D): void {
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) {
    return;
  }
  object.position.sub(box.getCenter(new Vector3()));
}

function objectWidth(object: Object3D): number {
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) {
    return 1;
  }
  return box.getSize(new Vector3()).x;
}

function frameCamera(camera: PerspectiveCamera, object: Object3D): Vector3 {
  const box = new Box3().setFromObject(object);
  const size = box.isEmpty() ? new Vector3(1, 1, 1) : box.getSize(new Vector3());
  const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
  const largest = Math.max(size.x, size.y, size.z, 0.5);
  const distance = largest / (2 * Math.tan((camera.fov * Math.PI) / 360));
  camera.position.set(
    center.x + largest * 0.2,
    center.y + largest * 0.25,
    center.z + distance * 1.7
  );
  camera.lookAt(center);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  return center;
}

function applyCreatorViewportCameraState(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  state: CreatorViewportCameraState
): void {
  camera.position.fromArray(state.position);
  controls.target.fromArray(state.target);
  camera.near = Math.max(state.distance / 100, 0.01);
  camera.far = Math.max(state.distance * 100, 10);
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
}

function creatorViewportCameraState(
  camera: PerspectiveCamera,
  controls: OrbitControls
): CreatorViewportCameraState {
  return {
    distance: camera.position.distanceTo(controls.target),
    position: vectorTuple(camera.position),
    target: vectorTuple(controls.target)
  };
}

function vectorTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function disposeObject(object: Object3D): void {
  const disposable = object as Object3D & {
    geometry?: { dispose(): void };
    material?: Material | Material[];
  };
  disposable.geometry?.dispose();
  if (!disposable.material) {
    return;
  }
  disposeMaterials(disposable.material);
}

interface CreatorViewportSelectionState {
  helper: BoxHelper | null;
  overlays: Map<string, Object3D[]>;
  roots: Map<string, Object3D>;
  scene: Scene;
}

interface PointerStart {
  x: number;
  y: number;
}

function pointerDistance(start: PointerStart, event: PointerEvent): number {
  return Math.hypot(event.clientX - start.x, event.clientY - start.y);
}

function raycastViewportAsset(
  event: MouseEvent | PointerEvent,
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  roots: Map<string, Object3D>,
  raycaster: Raycaster,
  pointer: Vector2
): string | null {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return (
    raycaster
      .intersectObjects(
        [...roots.values()].filter((root) => root.visible),
        true
      )
      .map((hit) => assetIdFromObject(hit.object))
      .find((assetId): assetId is string => Boolean(assetId)) ?? null
  );
}

function assetIdFromObject(object: Object3D): string | null {
  let current: Object3D | null = object;
  while (current) {
    if (typeof current.userData.assetId === "string") {
      return current.userData.assetId;
    }
    current = current.parent;
  }
  return null;
}

function updateSelectionHighlight(
  state: CreatorViewportSelectionState | null,
  assetId: string | null
): void {
  if (!state) {
    return;
  }
  disposeSelectionHelper(state);
  const root = assetId ? state.roots.get(assetId) : null;
  if (!root?.visible) {
    return;
  }
  const helper = new BoxHelper(root, "#facc15");
  helper.name = "CMMCreatorViewportSelection";
  helper.renderOrder = 1000;
  const material = helper.material as Material;
  material.depthTest = false;
  state.scene.add(helper);
  state.helper = helper;
}

function disposeSelectionState(
  state: CreatorViewportSelectionState | null
): void {
  if (!state) {
    return;
  }
  disposeSelectionHelper(state);
  state.roots.clear();
}

function disposeSelectionHelper(state: CreatorViewportSelectionState): void {
  if (!state.helper) {
    return;
  }
  state.scene.remove(state.helper);
  state.helper.geometry.dispose();
  disposeMaterials(state.helper.material as Material | Material[]);
  state.helper = null;
}

function syncCanvasViewportState(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  controls: OrbitControls,
  selectedAssetId: string | null,
  selectionState: CreatorViewportSelectionState | null
): void {
  canvas.dataset.cameraDistance = camera.position
    .distanceTo(controls.target)
    .toFixed(6);
  canvas.dataset.cameraPosition = camera.position
    .toArray()
    .map((value) => value.toFixed(4))
    .join(",");
  canvas.dataset.cameraTarget = controls.target
    .toArray()
    .map((value) => value.toFixed(4))
    .join(",");
  canvas.dataset.selectedAssetId = selectedAssetId ?? "";
  canvas.dataset.assetScreenCenters = JSON.stringify(
    projectAssetScreenCenters(canvas, camera, selectionState)
  );
}

function projectAssetScreenCenters(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  selectionState: CreatorViewportSelectionState | null
): Record<string, { x: number; y: number }> {
  if (!selectionState || !canvas.clientWidth || !canvas.clientHeight) {
    return {};
  }
  const centers: Record<string, { x: number; y: number }> = {};
  const box = new Box3();
  const center = new Vector3();
  selectionState.roots.forEach((root, assetId) => {
    if (!root.visible) {
      return;
    }
    root.updateMatrixWorld(true);
    const hitPoint = firstMeshTriangleCenter(root);
    if (hitPoint) {
      hitPoint.project(camera);
      centers[assetId] = {
        x: ((hitPoint.x + 1) / 2) * canvas.clientWidth,
        y: ((1 - hitPoint.y) / 2) * canvas.clientHeight
      };
      return;
    }
    box.setFromObject(root);
    if (!box.isEmpty()) {
      box.getCenter(center).project(camera);
      centers[assetId] = {
        x: ((center.x + 1) / 2) * canvas.clientWidth,
        y: ((1 - center.y) / 2) * canvas.clientHeight
      };
    }
  });
  return centers;
}

function firstMeshTriangleCenter(root: Object3D): Vector3 | null {
  const center = new Vector3();
  const vertex = new Vector3();
  let found = false;
  root.traverse((object) => {
    if (found) {
      return;
    }
    const mesh = object as Object3D & {
      geometry?: {
        attributes?: {
          position?: {
            count: number;
            getX(index: number): number;
            getY(index: number): number;
            getZ(index: number): number;
          };
        };
      };
      isMesh?: boolean;
    };
    const position = mesh.geometry?.attributes?.position;
    if (!mesh.isMesh || !position || position.count < 3) {
      return;
    }
    for (let index = 0; index < 3; index += 1) {
      vertex
        .set(position.getX(index), position.getY(index), position.getZ(index))
        .applyMatrix4(mesh.matrixWorld);
      center.add(vertex);
    }
    center.multiplyScalar(1 / 3);
    found = true;
  });
  return found ? center : null;
}

function applyViewportItemVisibility(
  state: CreatorViewportSelectionState | null,
  items: CreatorViewportBundleItem[],
  showSkeletons: boolean,
  selectedAssetId: string | null
): void {
  if (!state) {
    return;
  }
  const visibility = new Map(
    items.map((item) => [item.assetId, item.visible] as const)
  );
  state.roots.forEach((root, assetId) => {
    const visible = visibility.get(assetId) ?? true;
    root.visible = visible;
    setCreatorSkeletonOverlaysVisible(
      state.overlays.get(assetId) ?? [],
      visible && showSkeletons
    );
  });
  updateSelectionHighlight(state, selectedAssetId);
}

interface CreatorViewportLightRig {
  bottomLeft: DirectionalLight;
  bottomRight: DirectionalLight;
  even: AmbientLight;
  topLeft: DirectionalLight;
  topRight: DirectionalLight;
}

function createCreatorViewportLightRig(scene: Scene): CreatorViewportLightRig {
  const rig = {
    bottomLeft: new DirectionalLight("#ffffff", 0.85),
    bottomRight: new DirectionalLight("#ffffff", 0.85),
    even: new AmbientLight("#ffffff", 0.55),
    topLeft: new DirectionalLight("#ffffff", 0.95),
    topRight: new DirectionalLight("#ffffff", 0.85)
  };
  rig.topLeft.position.set(-5, 5, 5);
  rig.topRight.position.set(5, 5, 5);
  rig.bottomLeft.position.set(-5, -5, 5);
  rig.bottomRight.position.set(5, -5, 5);
  Object.values(rig).forEach((light) => scene.add(light));
  return rig;
}

function applyCreatorViewportLightSettings(
  rig: CreatorViewportLightRig,
  settings: CreatorViewportLightSettings
): void {
  rig.even.visible = settings.even;
  rig.topLeft.visible = settings.topLeft;
  rig.topRight.visible = settings.topRight;
  rig.bottomLeft.visible = settings.bottomLeft;
  rig.bottomRight.visible = settings.bottomRight;
}
