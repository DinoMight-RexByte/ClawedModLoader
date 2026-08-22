import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
  type Object3D
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

import type {
  CreatorModelPreviewMetadata,
  CreatorModelPreviewPayload,
  CreatorModelPreviewResult
} from "../../shared/contracts/app";
import { createSkeletonOverlays } from "./creatorSkeletonOverlay";

interface CreatorModelViewportProps {
  preview: CreatorModelPreviewResult | null;
  previews?: CreatorModelPreviewResult[];
  busy: boolean;
  error: string | null;
}

export function CreatorModelViewport({
  preview,
  previews,
  busy,
  error
}: CreatorModelViewportProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderWarning, setRenderWarning] = useState<string | null>(null);
  const previewItems = useMemo(
    () => (previews ? previews : preview ? [preview] : []),
    [preview, previews]
  );
  const modelItems = useMemo(
    () =>
      previewItems
        .map((item) =>
          (item.status === "available" || item.status === "ready") && item.model
            ? item.model
            : null
        )
        .filter(
          (item): item is CreatorModelPreviewPayload => item !== null
        ),
    [previewItems]
  );
  const metadata = previewItems[0]?.metadata ?? emptyModelPreviewMetadata();
  const viewportState = getViewportState(
    previewItems,
    busy,
    error,
    renderError,
    renderWarning
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || modelItems.length === 0) {
      setRenderError(null);
      setRenderWarning(null);
      return;
    }

    let frame = 0;
    let disposed = false;
    const renderer = new WebGLRenderer({
      antialias: true,
      canvas,
      preserveDrawingBuffer: true
    });
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.01, 100);
    const observer = new ResizeObserver(() => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });

    setRenderError(null);
    setRenderWarning(null);
    scene.background = new Color("#111827");
    scene.add(new AmbientLight("#ffffff", 0.8));
    const keyLight = new DirectionalLight("#ffffff", 1.2);
    keyLight.position.set(4, 5, 6);
    scene.add(keyLight);
    const fillLight = new DirectionalLight("#7dd3fc", 0.5);
    fillLight.position.set(-3, 2, -4);
    scene.add(fillLight);
    const grid = new GridHelper(3, 6, "#334155", "#1f2937");
    grid.position.y = -0.75;
    scene.add(grid);
    observer.observe(canvas);

    void Promise.allSettled(modelItems.map((model) => loadPreviewObject(model)))
      .then((results) => {
        const objects = results
          .filter(
            (result): result is PromiseFulfilledResult<Object3D> =>
              result.status === "fulfilled"
          )
          .map((result) => result.value);
        const failedCount = results.length - objects.length;
        if (disposed) {
          objects.forEach(disposeObject);
          return;
        }
        if (!objects.length) {
          setRenderError("Model preview failed");
          return;
        }
        if (failedCount > 0) {
          setRenderWarning(
            `${failedCount} selected model${failedCount === 1 ? "" : "s"} could not be rendered.`
          );
        }

        const group = new Group();
        const skeletonHelpers: Object3D[] = [];
        const centerOffset = (objects.length - 1) / 2;
        objects.forEach((object, index) => {
          prepareObject(object);
          object.position.x += (index - centerOffset) * 2;
          group.add(object);
          skeletonHelpers.push(...createSkeletonOverlays(object));
        });
        frameObject(camera, group);
        scene.add(group);
        skeletonHelpers.forEach((helper) => scene.add(helper));
        const animate = () => {
          group.rotation.y += 0.008;
          renderer.render(scene, camera);
          frame = window.requestAnimationFrame(animate);
        };
        animate();
      })
      .catch(() => {
        if (!disposed) {
          setRenderError("Model preview failed");
        }
      });

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      scene.traverse(disposeObject);
      renderer.dispose();
    };
  }, [modelItems]);

  return (
    <section
      className="grid min-w-0 gap-3 border-y border-app-border py-4"
      data-testid="creator-model-viewport"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Model Viewport</h3>
        <span className="max-w-full break-words rounded bg-app-surfaceRaised px-2 py-1 text-xs text-app-muted">
          {viewportState.detail
            ? `${viewportState.title}: ${viewportState.detail}`
            : viewportState.title}
        </span>
      </div>
      <div className="grid min-w-0 gap-4">
        <div className="relative min-h-96 min-w-0 overflow-hidden rounded-md border border-app-border bg-app-surfaceRaised">
          {modelItems.length > 0 && !renderError ? (
            <canvas
              aria-label="Model preview"
              className="block h-96 w-full"
              ref={canvasRef}
            />
          ) : (
            <ViewportMessage
              detail={viewportState.detail}
              title={viewportState.title}
            />
          )}
          {busy ? <ViewportMessage title="Loading model preview" /> : null}
        </div>
        <div className="min-w-0 overflow-hidden">
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <Metadata label="Mesh Type" value={meshTypeLabel(metadata.meshType)} />
            <Metadata label="Preview Source" value={metadata.previewSource} />
            <Metadata label="Skeleton" mono value={metadata.skeleton} />
            <Metadata label="Physics Asset" mono value={metadata.physicsAsset} />
            <Metadata
              label="Target Object Path"
              mono
              value={metadata.targetObjectPath}
            />
            <Metadata label="Package Path" mono value={metadata.packagePath} />
            <Metadata label="Package Source" value={metadata.packageSource} />
            <Metadata
              label="Source Container"
              mono
              value={metadata.sourceContainer}
            />
            <Metadata
              label="LOD Count"
              value={metadata.lodCount == null ? null : String(metadata.lodCount)}
            />
            <Metadata
              label="Vertex Count"
              value={
                metadata.vertexCount == null
                  ? null
                  : formatNumber(metadata.vertexCount)
              }
            />
            <Metadata
              label="Triangle Count"
              value={
                metadata.triangleCount == null
                  ? null
                  : formatNumber(metadata.triangleCount)
              }
            />
            <Metadata
              label="Material Slot Count"
              value={
                metadata.materialSlotCount == null
                  ? null
                  : formatNumber(metadata.materialSlotCount)
              }
            />
            <Metadata
              label="Validation"
              value={metadata.validationState ?? "not declared"}
            />
            <Metadata
              label="Conflict Winner"
              value={metadata.conflictWinner ?? "none"}
            />
            <Metadata
              label="Export Eligibility"
              value={metadata.exportState ?? "unknown"}
            />
          </dl>
          <MetadataList
            label="Material Slots"
            values={metadata.materialSlots.map((slot) =>
              slot.materialPath ? `${slot.name}: ${slot.materialPath}` : slot.name
            )}
          />
          <MetadataList
            label="LODs"
            values={metadata.lods.map((lod) =>
              [
                `LOD${lod.index}`,
                lod.triangleCount === null
                  ? null
                  : `${lod.triangleCount} triangles`,
                lod.vertexCount === null ? null : `${lod.vertexCount} vertices`
              ]
                .filter(Boolean)
                .join(" / ")
            )}
          />
          <MetadataList label="Dependency Paths" mono values={metadata.dependencyPaths} />
        </div>
      </div>
    </section>
  );
}

function ViewportMessage({
  detail,
  title
}: {
  detail?: string | null;
  title: string;
}): ReactElement {
  return (
    <div className="absolute inset-0 flex min-w-0 items-center justify-center px-4 text-center text-sm text-app-muted">
      <div className="min-w-0">
        <div className="font-medium text-app-text">{title}</div>
        {detail ? (
          <div className="mt-2 max-w-full break-words text-xs leading-5 [overflow-wrap:anywhere]">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Metadata({
  label,
  mono = false,
  value
}: {
  label: string;
  mono?: boolean;
  value: string | null;
}): ReactElement {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs font-semibold uppercase text-app-subtle">{label}</dt>
      <dd
        className={`min-w-0 break-words [overflow-wrap:anywhere] ${
          mono ? "font-mono text-xs" : ""
        } text-app-text`}
      >
        {value ?? "none"}
      </dd>
    </div>
  );
}

function MetadataList({
  label,
  mono = false,
  values
}: {
  label: string;
  mono?: boolean;
  values: string[];
}): ReactElement {
  return (
    <div className="mt-3 grid min-w-0 gap-1 text-sm">
      <div className="text-xs font-semibold uppercase text-app-subtle">
        {label}
      </div>
      {values.length ? (
        <div className="grid gap-1">
          {values.slice(0, 6).map((value) => (
            <div
              className={`min-w-0 break-words rounded bg-app-surfaceRaised px-2 py-1 [overflow-wrap:anywhere] ${
                mono ? "font-mono text-xs" : "text-sm"
              }`}
              key={value}
            >
              {value}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-app-muted">none</div>
      )}
    </div>
  );
}

function getViewportState(
  previews: CreatorModelPreviewResult[],
  busy: boolean,
  error: string | null,
  renderError: string | null,
  renderWarning: string | null
): { title: string; detail: string | null } {
  const preview = previews[0] ?? null;
  const problem =
    previews.flatMap((item) => item.problems)[0] ?? preview?.problems[0];
  const visibleModels = previews.filter(
    (item) =>
      (item.status === "available" || item.status === "ready") && item.model
  );
  if (busy) {
    return { title: "Loading model preview", detail: null };
  }
  if (error || renderError || preview?.status === "error") {
    return {
      title: "Model preview failed",
      detail: error ?? renderError ?? problem?.message ?? null
    };
  }
  if (visibleModels.length > 0) {
    if (renderWarning) {
      return {
        title: "Model previews partially visible",
        detail: renderWarning
      };
    }
    if (visibleModels.length > 1) {
      return {
        title: "Model previews visible",
        detail: `${visibleModels.length} files in the viewport`
      };
    }
    return {
      title: "Model preview available",
      detail:
        preview.model && preview.metadata.previewSource
          ? `${preview.metadata.previewSource}: ${preview.model.fileName}`
          : preview.model
            ? `${previewSourceLabel(preview.model.source)}: ${preview.model.fileName}`
            : null
    };
  }
  if (preview?.status === "unsupported" || preview?.status === "dependency-missing") {
    return {
      title: "Unsupported model preview",
      detail: problem?.message ?? null
    };
  }
  if (preview?.status === "blocked" || preview?.status === "decode-error") {
    return {
      title: "Model preview unavailable",
      detail: problem?.message ?? null
    };
  }
  if (preview?.status === "empty") {
    return {
      title: "No renderable model preview available",
      detail:
        preview?.problems[0]?.message ??
        "Select a model asset with direct decoded data, a cached normalized preview, or a package preview."
    };
  }
  return { title: "No model preview available", detail: null };
}

function emptyModelPreviewMetadata(): CreatorModelPreviewMetadata {
  return {
    meshType: "unknown",
    skeleton: null,
    physicsAsset: null,
    materialSlots: [],
    lods: [],
    dependencyPaths: [],
    targetObjectPath: null,
    packagePath: null,
    packageSource: null,
    sourceContainer: null,
    previewSource: null,
    lodCount: null,
    vertexCount: null,
    triangleCount: null,
    materialSlotCount: null,
    validationState: null,
    conflictWinner: null,
    exportState: null
  };
}

function previewSourceLabel(
  source: CreatorModelPreviewPayload["source"]
): string {
  if (source === "decodedBaseGame") {
    return "Direct decoded base-game asset";
  }
  if (source === "cachedBaseGame") {
    return "Cached normalized preview";
  }
  if (source === "generated") {
    return "Generated package preview";
  }
  if (source === "packagePayload") {
    return "Package model payload";
  }
  return "User-owned package preview";
}

function meshTypeLabel(value: CreatorModelPreviewMetadata["meshType"]): string {
  if (value === "staticMesh") {
    return "StaticMesh";
  }
  if (value === "skeletalMesh") {
    return "SkeletalMesh";
  }
  if (value === "skeleton") {
    return "Skeleton";
  }
  return "unknown";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

async function loadPreviewObject(
  model: CreatorModelPreviewPayload
): Promise<Object3D> {
  if (model.format === "obj") {
    return new OBJLoader().parse(decodeBase64DataUrl(model.dataUrl));
  }

  return new GLTFLoader().loadAsync(model.dataUrl).then((gltf) => gltf.scene);
}

function decodeBase64DataUrl(dataUrl: string): string {
  const encoded = dataUrl.split(",", 2)[1] ?? "";
  return window.atob(encoded);
}

function prepareObject(object: Object3D): void {
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh && !mesh.material) {
      mesh.material = new MeshStandardMaterial({
        color: "#38bdf8",
        metalness: 0.1,
        roughness: 0.55
      });
    }
  });
}

function frameObject(camera: PerspectiveCamera, object: Object3D): void {
  const box = new Box3().setFromObject(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  if (
    !Number.isFinite(size.x) ||
    !Number.isFinite(size.y) ||
    !Number.isFinite(size.z)
  ) {
    camera.position.set(1.4, 1.1, 3);
    camera.lookAt(0, 0, 0);
    camera.near = 0.01;
    camera.far = 100;
    camera.updateProjectionMatrix();
    return;
  }
  const largest = Math.max(size.x, size.y, size.z, 0.5);
  const distance = largest / (2 * Math.tan((camera.fov * Math.PI) / 360));
  object.position.sub(center);
  camera.position.set(largest * 0.2, largest * 0.25, distance * 1.7);
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
}

function disposeObject(object: Object3D): void {
  const renderable = object as Mesh & {
    geometry?: { dispose(): void };
    material?: Material | Material[];
  };
  renderable.geometry?.dispose();
  if (!renderable.material) {
    return;
  }
  const materials = Array.isArray(renderable.material)
    ? renderable.material
    : [renderable.material];
  materials.forEach((material) => material.dispose());
}
