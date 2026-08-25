import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";

import type {
  CreatorModelPreviewMetadata,
  CreatorViewportCameraState,
  CreatorViewportTextureCandidate,
  CreatorViewportTextureSelection
} from "../../shared/contracts/app";
import type {
  CreatorViewportBundleItem,
  CreatorViewportLightSettings
} from "../stores/creatorAssetStore";
import { ModalDialog } from "./ModalDialog";
import { CreatorViewportSurface } from "./CreatorViewportSurface";

interface CreatorModelViewportProps {
  cameraState: CreatorViewportCameraState | null;
  items: CreatorViewportBundleItem[];
  selectedAssetId: string | null;
  busy: boolean;
  error: string | null;
  onClear(): void;
  onCameraStateChange?(cameraState: CreatorViewportCameraState | null): void;
  onLightSettingsChange(settings: Partial<CreatorViewportLightSettings>): void;
  onPopOut?(): void;
  onRemoveItem(assetId: string): void;
  onReturnToMain?(): void;
  onSelectItem(assetId: string): void;
  onShowSkeletonsChange(showSkeletons: boolean): void;
  onStopRotationChange(stopRotation: boolean): void;
  onTextureSelectionChange(candidateId: string, selected: boolean): void;
  onToggleItemVisibility(assetId: string, visible: boolean): void;
  lightSettings: CreatorViewportLightSettings;
  showSkeletons: boolean;
  stopRotation: boolean;
  textureCandidates: CreatorViewportTextureCandidate[];
  textureError: string | null;
  textureSelections: CreatorViewportTextureSelection[];
  viewportMode?: "embedded" | "embeddedHidden" | "popout";
}

export function CreatorModelViewport({
  cameraState,
  items,
  selectedAssetId,
  busy,
  error,
  onClear,
  onCameraStateChange,
  onLightSettingsChange,
  onPopOut,
  onRemoveItem,
  onReturnToMain,
  onSelectItem,
  onShowSkeletonsChange,
  onStopRotationChange,
  onTextureSelectionChange,
  onToggleItemVisibility,
  lightSettings,
  showSkeletons,
  stopRotation,
  textureCandidates,
  textureError,
  textureSelections,
  viewportMode = "embedded"
}: CreatorModelViewportProps): ReactElement {
  const [confirmation, setConfirmation] =
    useState<ViewportConfirmation | null>(null);
  const [metadataOpen, setMetadataOpen] = useState(viewportMode !== "popout");
  const [renderError, setRenderError] = useState<string | null>(null);
  const selectedItem =
    items.find((item) => item.assetId === selectedAssetId) ?? items[0] ?? null;
  const metadata = selectedItem?.preview?.metadata ?? emptyModelPreviewMetadata();
  const visibleItems = items.filter((item) => item.visible);
  const loadableItems = items.filter(isLoadableViewportItem);
  const visibleRenderableItems = loadableItems.filter((item) => item.visible);
  const renderableKey = loadableItems
    .map((item) => `${item.assetId}:${item.preview?.model?.fileName ?? ""}`)
    .join("\0");
  const selectedTextureCandidateIds = new Set(
    textureSelections.map((selection) => selection.candidateId)
  );
  const selectedTextureCandidates = textureCandidates.filter((candidate) =>
    selectedTextureCandidateIds.has(candidate.id)
  );
  const viewportState = getViewportState({
    busy: busy || items.some((item) => item.busy),
    error,
    items,
    loadableItems,
    renderError,
    visibleItems,
    visibleRenderableItems
  });
  const handleRenderError = useCallback((message: string | null) => {
    setRenderError(message);
  }, []);
  const handleConfirm = (): void => {
    if (!confirmation) {
      return;
    }
    if (confirmation.kind === "clear") {
      onClear();
    } else {
      onRemoveItem(confirmation.item.assetId);
    }
    setConfirmation(null);
  };

  useEffect(() => {
    setRenderError(null);
  }, [renderableKey]);

  useEffect(() => {
    setMetadataOpen(viewportMode !== "popout");
  }, [viewportMode]);

  if (viewportMode === "embeddedHidden") {
    return (
      <section
        className="grid min-w-0 gap-3 border-y border-app-border py-4"
        data-testid="creator-model-viewport"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Model Viewport</h3>
          <ViewportWindowButton
            icon={<RotateCcw aria-hidden="true" size={16} />}
            label="Return to CMM"
            onClick={onReturnToMain}
          />
        </div>
        <div
          className="relative min-h-96 min-w-0 overflow-hidden rounded-md border border-app-border bg-app-surfaceRaised"
          data-testid="creator-viewport-popout-placeholder"
        >
          <ViewportMessage
            detail="The active viewport is open in a separate window."
            title="Viewport popped out"
          />
        </div>
      </section>
    );
  }

  return (
    <section
      className="grid min-w-0 gap-3 border-y border-app-border py-4"
      data-testid="creator-model-viewport"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Model Viewport</h3>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="inline-flex h-8 items-center gap-2 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-xs font-semibold text-app-muted">
            <input
              aria-label="Stop rotation"
              checked={stopRotation}
              className="h-4 w-4 accent-app-accent"
              onChange={(event) =>
                onStopRotationChange(event.currentTarget.checked)
              }
              type="checkbox"
            />
            Stop rotation
          </label>
          <label className="inline-flex h-8 items-center gap-2 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-xs font-semibold text-app-muted">
            <input
              aria-label="Show skeleton overlay"
              checked={showSkeletons}
              className="h-4 w-4 accent-app-accent"
              onChange={(event) =>
                onShowSkeletonsChange(event.currentTarget.checked)
              }
              type="checkbox"
            />
            Skeleton
          </label>
          <div
            aria-label="Viewport lights"
            className="flex h-8 items-center gap-1 rounded-md border border-app-border bg-app-surfaceRaised px-2"
            role="group"
          >
            <LightToggle
              checked={lightSettings.even}
              label="Even"
              name="Even viewport light"
              onChange={(checked) =>
                onLightSettingsChange({ even: checked })
              }
            />
            <LightToggle
              checked={lightSettings.topLeft}
              label="TL"
              name="Top-left viewport light"
              onChange={(checked) =>
                onLightSettingsChange({ topLeft: checked })
              }
            />
            <LightToggle
              checked={lightSettings.topRight}
              label="TR"
              name="Top-right viewport light"
              onChange={(checked) =>
                onLightSettingsChange({ topRight: checked })
              }
            />
            <LightToggle
              checked={lightSettings.bottomLeft}
              label="BL"
              name="Bottom-left viewport light"
              onChange={(checked) =>
                onLightSettingsChange({ bottomLeft: checked })
              }
            />
            <LightToggle
              checked={lightSettings.bottomRight}
              label="BR"
              name="Bottom-right viewport light"
              onChange={(checked) =>
                onLightSettingsChange({ bottomRight: checked })
              }
            />
          </div>
          <TextureLayerMenu
            candidates={textureCandidates}
            error={textureError}
            onChange={onTextureSelectionChange}
            selectedIds={selectedTextureCandidateIds}
          />
          {viewportMode === "embedded" ? (
            <ViewportWindowButton
              icon={<ExternalLink aria-hidden="true" size={16} />}
              label="Pop Out"
              onClick={onPopOut}
            />
          ) : null}
          {viewportMode === "popout" ? (
            <ViewportWindowButton
              icon={<RotateCcw aria-hidden="true" size={16} />}
              label="Return to CMM"
              onClick={onReturnToMain}
            />
          ) : null}
          <span className="max-w-full break-words rounded bg-app-surfaceRaised px-2 py-1 text-xs text-app-muted">
            {viewportState.detail
              ? `${viewportState.title}: ${viewportState.detail}`
              : viewportState.title}
          </span>
        </div>
      </div>
      <div className="grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-4">
          <div className="relative min-h-96 min-w-0 overflow-hidden rounded-md border border-app-border bg-app-surfaceRaised">
            {loadableItems.length && !renderError ? (
              <CreatorViewportSurface
                cameraState={cameraState}
                items={items}
                lightSettings={lightSettings}
                onCameraStateChange={onCameraStateChange}
                onRenderError={handleRenderError}
                onSelectItem={onSelectItem}
                onStopRotationChange={onStopRotationChange}
                selectedAssetId={selectedAssetId}
                selectedTextureCandidates={selectedTextureCandidates}
                showSkeletons={showSkeletons}
                stopRotation={stopRotation}
              />
            ) : null}
            {(!loadableItems.length ||
              !visibleRenderableItems.length ||
              renderError) &&
            !(busy || items.some((item) => item.busy)) ? (
              <ViewportMessage
                detail={viewportState.detail}
                title={viewportState.title}
              />
            ) : null}
            {busy || items.some((item) => item.busy) ? (
              <ViewportMessage title="Loading viewport bundle" />
            ) : null}
          </div>

          {viewportMode !== "popout" ? (
            <ViewportOutliner
              items={items}
              onClear={() => setConfirmation({ kind: "clear" })}
              onRemove={(item) => setConfirmation({ kind: "remove", item })}
              onSelect={onSelectItem}
              onToggleVisibility={onToggleItemVisibility}
            />
          ) : null}
        </div>

        {viewportMode === "popout" ? (
          <details
            className="grid min-w-0 gap-3 rounded-md border border-app-border bg-app-surface/60 p-3"
            onToggle={(event) =>
              setMetadataOpen(event.currentTarget.open)
            }
            open={metadataOpen}
          >
            <summary className="cursor-pointer list-none text-sm font-semibold text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent">
              Viewport metadata
            </summary>
            <div className="mt-3 grid min-w-0 gap-4">
              <ViewportOutliner
                items={items}
                onClear={() => setConfirmation({ kind: "clear" })}
                onRemove={(item) => setConfirmation({ kind: "remove", item })}
                onSelect={onSelectItem}
                onToggleVisibility={onToggleItemVisibility}
              />
              {selectedItem ? (
                <SelectedViewportMetadata metadata={metadata} />
              ) : null}
            </div>
          </details>
        ) : selectedItem ? (
          <SelectedViewportMetadata metadata={metadata} />
        ) : null}
      </div>
      {confirmation ? (
        <ConfirmViewportActionDialog
          confirmation={confirmation}
          onCancel={() => setConfirmation(null)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </section>
  );
}

function LightToggle({
  checked,
  label,
  name,
  onChange
}: {
  checked: boolean;
  label: string;
  name: string;
  onChange(checked: boolean): void;
}): ReactElement {
  return (
    <label className="inline-flex items-center gap-1 text-[11px] font-semibold text-app-muted">
      <input
        aria-label={name}
        checked={checked}
        className="h-3.5 w-3.5 accent-app-accent"
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function SelectedViewportMetadata({
  metadata
}: {
  metadata: CreatorModelPreviewMetadata;
}): ReactElement {
  return (
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
        <Metadata label="Source Container" mono value={metadata.sourceContainer} />
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
      <MetadataList
        label="Dependency Paths"
        mono
        values={metadata.dependencyPaths}
      />
    </div>
  );
}

function TextureLayerMenu({
  candidates,
  error,
  onChange,
  selectedIds
}: {
  candidates: CreatorViewportTextureCandidate[];
  error: string | null;
  onChange(candidateId: string, selected: boolean): void;
  selectedIds: Set<string>;
}): ReactElement {
  const grouped = groupedTextureCandidates(candidates);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnOutside = (event: PointerEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative z-40" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className="flex h-8 items-center rounded-md border border-app-border bg-app-surfaceRaised px-3 text-xs font-semibold text-app-muted hover:bg-app-surface hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        Textures {selectedIds.size ? selectedIds.size : candidates.length}
      </button>
      {open ? (
        <div
          aria-label="Viewport texture layers"
          className="fixed right-6 top-24 z-[100] grid max-h-[70vh] w-[min(34rem,calc(100vw-3rem))] gap-3 overflow-auto rounded-md border border-app-border bg-app-surface p-3 shadow-xl"
          role="group"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-app-text">
              Texture layers
            </div>
            <button
              aria-label="Close texture list"
              className="h-7 rounded-md border border-app-border px-2 text-xs font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onClick={() => setOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
          {error ? (
            <div className="text-xs text-app-warning">{error}</div>
          ) : null}
          {grouped.length ? (
            grouped.map((meshGroup) => (
              <div className="grid gap-2" key={meshGroup.meshAssetId}>
                <div className="break-words text-xs font-semibold text-app-text [overflow-wrap:anywhere]">
                  {meshGroup.meshLabel}
                </div>
                {meshGroup.slots.map((slotGroup) => (
                  <div className="grid gap-1" key={slotGroup.slot}>
                    <div className="text-[11px] font-semibold uppercase text-app-subtle">
                      {slotGroup.slot}
                    </div>
                    {slotGroup.layers.map((layerGroup) => (
                      <div className="grid gap-1" key={layerGroup.layer}>
                        <div className="text-[11px] text-app-muted">
                          {textureLayerLabel(layerGroup.layer)}
                        </div>
                        {layerGroup.candidates.map((candidate) => (
                          <label
                            className={`grid min-w-0 grid-cols-[auto_1fr] items-start gap-2 rounded border border-app-border bg-app-surfaceRaised px-2 py-1 text-xs text-app-muted ${
                              candidate.dataUrl ? "" : "opacity-65"
                            }`}
                            key={candidate.id}
                          >
                            <input
                              aria-label={`Apply ${textureLayerLabel(candidate.layer)} ${candidate.textureLabel} to ${candidate.meshLabel}`}
                              checked={selectedIds.has(candidate.id)}
                              className="mt-0.5 h-3.5 w-3.5 accent-app-accent"
                              disabled={!candidate.dataUrl}
                              onChange={(event) =>
                                onChange(
                                  candidate.id,
                                  event.currentTarget.checked
                                )
                              }
                              type="checkbox"
                            />
                            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                              {candidate.textureLabel}
                              {candidate.dataUrl ? "" : " (preview unavailable)"}
                            </span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="text-xs text-app-muted">
              No applicable texture layers.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ViewportWindowButton({
  icon,
  label,
  onClick
}: {
  icon: ReactElement;
  label: string;
  onClick?(): void;
}): ReactElement {
  return (
    <button
      className="inline-flex h-8 items-center gap-2 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-xs font-semibold text-app-muted hover:bg-app-surface hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
      disabled={!onClick}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function groupedTextureCandidates(
  candidates: CreatorViewportTextureCandidate[]
): Array<{
  meshAssetId: string;
  meshLabel: string;
  slots: Array<{
    slot: string;
    layers: Array<{
      layer: CreatorViewportTextureCandidate["layer"];
      candidates: CreatorViewportTextureCandidate[];
    }>;
  }>;
}> {
  const meshGroups = new Map<
    string,
    {
      meshAssetId: string;
      meshLabel: string;
      slots: Map<
        string,
        Map<CreatorViewportTextureCandidate["layer"], CreatorViewportTextureCandidate[]>
      >;
    }
  >();
  candidates.forEach((candidate) => {
    const mesh = meshGroups.get(candidate.meshAssetId) ?? {
      meshAssetId: candidate.meshAssetId,
      meshLabel: candidate.meshLabel,
      slots: new Map()
    };
    const slot = candidate.materialSlotName ?? "Material";
    const slotGroup = mesh.slots.get(slot) ?? new Map();
    slotGroup.set(candidate.layer, [
      ...(slotGroup.get(candidate.layer) ?? []),
      candidate
    ]);
    mesh.slots.set(slot, slotGroup);
    meshGroups.set(candidate.meshAssetId, mesh);
  });
  return [...meshGroups.values()].map((mesh) => ({
    meshAssetId: mesh.meshAssetId,
    meshLabel: mesh.meshLabel,
    slots: [...mesh.slots.entries()].map(([slot, layers]) => ({
      slot,
      layers: [...layers.entries()].map(([layer, layerCandidates]) => ({
        layer,
        candidates: layerCandidates
      }))
    }))
  }));
}

function textureLayerLabel(
  layer: CreatorViewportTextureCandidate["layer"]
): string {
  if (layer === "baseColor") {
    return "Base Color";
  }
  if (layer === "lightMap") {
    return "Light Map";
  }
  if (layer === "maskOrm") {
    return "Mask/ORM";
  }
  return layer[0].toUpperCase() + layer.slice(1);
}

type ViewportConfirmation =
  | { kind: "clear" }
  | { kind: "remove"; item: CreatorViewportBundleItem };

function ViewportOutliner({
  items,
  onClear,
  onRemove,
  onSelect,
  onToggleVisibility
}: {
  items: CreatorViewportBundleItem[];
  onClear(): void;
  onRemove(item: CreatorViewportBundleItem): void;
  onSelect(assetId: string): void;
  onToggleVisibility(assetId: string, visible: boolean): void;
}): ReactElement {
  return (
    <aside
      aria-label="Viewport outliner"
      className="grid min-w-0 content-start gap-2 rounded-md border border-app-border bg-app-surface/60 p-3"
      data-testid="creator-viewport-outliner"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Active Bundle</h4>
        {items.length ? (
          <button
            className="inline-flex h-8 items-center rounded-md border border-app-border px-3 text-xs font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            onClick={onClear}
            type="button"
          >
            Clear Viewport
          </button>
        ) : null}
      </div>
      {items.length ? (
        <div className="grid gap-2" role="list">
          {items.map((item) => (
            <article
              className={`grid min-w-0 gap-2 rounded-md border p-2 text-sm ${
                item.selected
                  ? "border-app-accent bg-app-accent/10 text-app-text ring-2 ring-app-accent/40"
                  : "border-app-border bg-app-surfaceRaised text-app-muted"
              } ${item.visible ? "" : "opacity-70"}`}
              key={item.assetId}
              role="listitem"
            >
              <button
                aria-label={`Select ${item.label} in viewport`}
                aria-pressed={item.selected}
                className="grid min-w-0 gap-1 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                onClick={() => onSelect(item.assetId)}
                type="button"
              >
                <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                  {item.label}
                </span>
                <span className="text-xs text-app-subtle">
                  {[
                    sourceLabel(item.source),
                    item.assetClass,
                    viewportPreviewSource(item),
                    item.visible ? "visible" : "hidden",
                    viewportItemStatus(item)
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </span>
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  aria-label={`${item.visible ? "Hide" : "Show"} ${item.label}`}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-app-border px-2 text-xs font-semibold text-app-muted hover:bg-app-surface hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                  onClick={() =>
                    onToggleVisibility(item.assetId, !item.visible)
                  }
                  type="button"
                >
                  {item.visible ? (
                    <EyeOff aria-hidden="true" size={14} />
                  ) : (
                    <Eye aria-hidden="true" size={14} />
                  )}
                  {item.visible ? "Hide" : "Show"}
                </button>
                <button
                  aria-label={`Remove ${item.label} from viewport`}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-app-danger/40 px-2 text-xs font-semibold text-app-danger hover:bg-app-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger"
                  onClick={() => onRemove(item)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="text-sm text-app-muted">No model added to viewport.</div>
      )}
    </aside>
  );
}

function ConfirmViewportActionDialog({
  confirmation,
  onCancel,
  onConfirm
}: {
  confirmation: ViewportConfirmation;
  onCancel(): void;
  onConfirm(): void;
}): ReactElement {
  const isClear = confirmation.kind === "clear";
  const title = isClear ? "Clear viewport bundle" : "Remove viewport model";
  const description = isClear
    ? "This removes every model from the active viewport bundle."
    : `Remove ${confirmation.item.label} from the active viewport bundle.`;
  return (
    <ModalDialog
      describedById="viewport-confirmation-description"
      description={description}
      labelledById="viewport-confirmation-title"
      title={title}
    >
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          className="h-9 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="h-9 rounded-md border border-app-danger/40 px-3 text-sm font-semibold text-app-danger hover:bg-app-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger"
          onClick={onConfirm}
          type="button"
        >
          {isClear ? "Clear bundle" : "Remove model"}
        </button>
      </div>
    </ModalDialog>
  );
}

function isLoadableViewportItem(item: CreatorViewportBundleItem): boolean {
  return Boolean(
    !item.busy &&
      item.preview?.model &&
      (item.preview.status === "available" || item.preview.status === "ready")
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

function getViewportState({
  busy,
  error,
  items,
  loadableItems,
  renderError,
  visibleItems,
  visibleRenderableItems
}: {
  busy: boolean;
  error: string | null;
  items: CreatorViewportBundleItem[];
  loadableItems: CreatorViewportBundleItem[];
  renderError: string | null;
  visibleItems: CreatorViewportBundleItem[];
  visibleRenderableItems: CreatorViewportBundleItem[];
}): { title: string; detail: string | null } {
  const firstProblem = items
    .flatMap((item) => item.preview?.problems ?? [])
    .at(0);
  const firstItemError = items.find((item) => item.error)?.error ?? null;
  if (!items.length) {
    return { title: "No model added to viewport", detail: null };
  }
  if (busy) {
    return { title: "Loading viewport bundle", detail: null };
  }
  if (error || renderError || firstItemError) {
    return {
      title: "Model preview failed",
      detail: error ?? renderError ?? firstItemError
    };
  }
  if (visibleRenderableItems.length) {
    return {
      title: "Model preview available",
      detail:
        visibleRenderableItems.length === 1
          ? visibleRenderableItems[0].preview?.model?.fileName ??
            visibleRenderableItems[0].label
          : `${visibleRenderableItems.length} visible models`
    };
  }
  if (!visibleItems.length) {
    return {
      title: "No visible model preview available",
      detail: "All viewport bundle items are hidden."
    };
  }
  if (loadableItems.length) {
    return {
      title: "No visible model preview available",
      detail: "Visible viewport assets are hidden or unavailable."
    };
  }
  return {
    title: "No renderable model preview available",
    detail:
      firstProblem?.message ??
      "Visible viewport assets did not return a renderable model payload."
  };
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

function sourceLabel(source: CreatorViewportBundleItem["source"]): string {
  if (source === "baseGameMap") {
    return "Clawed map";
  }
  if (source === "installedPackage") {
    return "Package manifest";
  }
  if (source === "packagePayload") {
    return "Package payload";
  }
  return "Deployment";
}

function viewportPreviewSource(item: CreatorViewportBundleItem): string {
  return item.preview?.metadata.previewSource ?? "preview pending";
}

function viewportItemStatus(item: CreatorViewportBundleItem): string {
  if (item.busy) {
    return "loading";
  }
  if (item.error) {
    return "failed";
  }
  return item.preview?.status ?? "queued";
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
