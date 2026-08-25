import { createRoot } from "react-dom/client";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { CreatorModelPreviewResult } from "../../../src/shared/contracts/app";
import { CreatorModelViewport } from "../../../src/renderer/components/CreatorModelViewport";
import {
  createCreatorSkeletonOverlays,
  measureCreatorSkeletonOverlay
} from "../../../src/renderer/components/creatorSkeletonOverlay";
import "../../../src/renderer/styles/global.css";

interface VisualHarnessWindow extends Window {
  __CMM_CREATOR_VISUAL_ERROR__?: string;
  __CMM_CREATOR_VISUAL_METRICS__?: unknown;
  __CMM_CREATOR_VISUAL_PREVIEW__?: CreatorModelPreviewResult;
  __CMM_CREATOR_VISUAL_READY__?: boolean;
}

const harnessWindow = window as VisualHarnessWindow;
const preview = harnessWindow.__CMM_CREATOR_VISUAL_PREVIEW__;
const root = document.getElementById("root");

if (!root) {
  throw new Error("Visual harness root is missing.");
}

if (!preview?.asset || !preview.model) {
  throw new Error("Visual harness preview model was not provided.");
}

createRoot(root).render(
  <div className="min-h-screen bg-app-bg p-4 text-app-text">
    <CreatorModelViewport
      busy={false}
      cameraState={null}
      error={null}
      items={[
        {
          assetClass: preview.asset.assetClass,
          assetId: preview.asset.id,
          busy: false,
          error: null,
          label: preview.asset.label,
          preview,
          previewId: preview.preview?.id ?? null,
          selected: true,
          source: preview.asset.source,
          visible: true
        }
      ]}
      lightSettings={{
        bottomLeft: false,
        bottomRight: false,
        even: true,
        topLeft: true,
        topRight: false
      }}
      onClear={() => undefined}
      onCameraStateChange={() => undefined}
      onLightSettingsChange={() => undefined}
      onRemoveItem={() => undefined}
      onSelectItem={() => undefined}
      onShowSkeletonsChange={() => undefined}
      onStopRotationChange={() => undefined}
      onTextureSelectionChange={() => undefined}
      onToggleItemVisibility={() => undefined}
      selectedAssetId={preview.asset.id}
      showSkeletons
      stopRotation={false}
      textureCandidates={[]}
      textureError={null}
      textureSelections={[]}
    />
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

async function collectSkeletonOverlayMetrics(dataUrl: string): Promise<unknown> {
  const object = await new GLTFLoader().loadAsync(dataUrl).then((gltf) => gltf.scene);
  object.updateMatrixWorld(true);
  const overlays = createCreatorSkeletonOverlays(object).overlays;
  return measureCreatorSkeletonOverlay(object, overlays);
}
