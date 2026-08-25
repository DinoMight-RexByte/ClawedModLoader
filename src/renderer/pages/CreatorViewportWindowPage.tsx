import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { CreatorModelViewport } from "../components/CreatorModelViewport";
import { useCreatorAssets } from "../hooks/useCreatorAssets";

export function CreatorViewportWindowPage(): ReactElement {
  const {
    viewportBundle,
    viewportTextureCandidates,
    viewportTextureSelections,
    viewportTextureError,
    selectedViewportAssetId,
    viewportCameraState,
    showSkeletons,
    stopRotation,
    viewportLightSettings,
    applyViewportSession,
    clearViewport,
    removeViewportItem,
    returnViewportWindow,
    selectViewportItem,
    setShowSkeletons,
    setStopRotation,
    setViewportCameraState,
    setViewportItemVisibility,
    setViewportLightSettings,
    setViewportTextureSelected,
    updateViewportWindowSession
  } = useCreatorAssets();
  const initializedRef = useRef(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.cmm
      .getCreatorViewportSession()
      .then((session) =>
        applyViewportSession({ ...session, windowMode: "poppedOut" })
      )
      .then(() => {
        if (!cancelled) {
          initializedRef.current = true;
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Viewport session is unavailable.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyViewportSession]);

  useEffect(() => {
    if (!initializedRef.current) {
      return;
    }
    void updateViewportWindowSession("poppedOut");
  }, [
    selectedViewportAssetId,
    showSkeletons,
    stopRotation,
    updateViewportWindowSession,
    viewportBundle,
    viewportCameraState,
    viewportTextureSelections,
    viewportLightSettings
  ]);

  return (
    <main className="min-h-screen bg-app-bg p-4 text-app-text">
      <CreatorModelViewport
        busy={busy}
        cameraState={viewportCameraState}
        error={error}
        items={viewportBundle}
        lightSettings={viewportLightSettings}
        onCameraStateChange={setViewportCameraState}
        onClear={clearViewport}
        onLightSettingsChange={setViewportLightSettings}
        onRemoveItem={removeViewportItem}
        onReturnToMain={() => void returnViewportWindow("local")}
        onSelectItem={selectViewportItem}
        onShowSkeletonsChange={setShowSkeletons}
        onStopRotationChange={setStopRotation}
        onTextureSelectionChange={setViewportTextureSelected}
        onToggleItemVisibility={setViewportItemVisibility}
        selectedAssetId={selectedViewportAssetId}
        showSkeletons={showSkeletons}
        stopRotation={stopRotation}
        textureCandidates={viewportTextureCandidates}
        textureError={viewportTextureError}
        textureSelections={viewportTextureSelections}
        viewportMode="popout"
      />
    </main>
  );
}
