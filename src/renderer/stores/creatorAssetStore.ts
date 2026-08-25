import { create } from "zustand";

import type {
  CreatorAssetDetail,
  CreatorAssetIndexEntry,
  CreatorAssetReportResult,
  CreatorAssetRegistrySnapshot,
  CreatorAssetSearchRequest,
  CreatorAssetTreeNode,
  CreatorExportPlanResult,
  CreatorMeshExportResult,
  CreatorMeshPackageExportResult,
  CreatorMappingsDumpProgress,
  CreatorMappingsDumpResult,
  CreatorViewportTextureCandidate,
  CreatorViewportTextureSelection,
  CreatorViewportCameraState,
  CreatorViewportLightSettings as SharedCreatorViewportLightSettings,
  CreatorViewportSession,
  CreatorViewportWindowMode,
  CreatorModelPreviewResult,
  CreatorRegistrySource,
  ModProblem
} from "../../shared/contracts/app";

export type CreatorAssetFilters = CreatorAssetSearchRequest;
export const rootTreeParentId = "__root__";

export const defaultCreatorAssetFilters: CreatorAssetFilters = {
  query: "",
  source: "all",
  physicalPath: "",
  objectPath: "",
  tags: [],
  modUse: "",
  conflictState: "any",
  exportState: "any",
  sortBy: "relevance",
  sortDirection: "asc",
  activeOnly: false,
  limit: 80
};

export interface CreatorViewportBundleItem {
  assetId: string;
  previewId: string | null;
  label: string;
  source: CreatorRegistrySource;
  assetClass: string | null;
  visible: boolean;
  selected: boolean;
  preview: CreatorModelPreviewResult | null;
  busy: boolean;
  error: string | null;
}

export type CreatorViewportLightSettings = SharedCreatorViewportLightSettings;

export const defaultCreatorViewportLightSettings: CreatorViewportLightSettings = {
  bottomLeft: false,
  bottomRight: false,
  even: true,
  topLeft: true,
  topRight: false
};

type CreatorViewportBundleItemInput = Pick<
  CreatorViewportBundleItem,
  "assetId" | "label" | "source" | "assetClass"
> &
  Partial<
    Pick<
      CreatorViewportBundleItem,
      "previewId" | "visible" | "preview" | "busy" | "error"
    >
  >;

export interface CreatorAssetStoreState {
  snapshot: CreatorAssetRegistrySnapshot | null;
  treeNodesByParentId: Record<string, CreatorAssetTreeNode[]>;
  expandedTreeNodeIds: string[];
  treeBusyNodeIds: string[];
  treeProblems: ModProblem[];
  detail: CreatorAssetDetail | null;
  modelPreview: CreatorModelPreviewResult | null;
  modelError: string | null;
  exportPlan: CreatorExportPlanResult | null;
  meshExport: CreatorMeshExportResult | null;
  meshPackageExport: CreatorMeshPackageExportResult | null;
  mappingsProgress: CreatorMappingsDumpProgress | null;
  mappingsDump: CreatorMappingsDumpResult | null;
  report: CreatorAssetReportResult | null;
  viewportBundle: CreatorViewportBundleItem[];
  viewportTextureCandidates: CreatorViewportTextureCandidate[];
  viewportTextureSelections: CreatorViewportTextureSelection[];
  viewportTextureError: string | null;
  selectedViewportAssetId: string | null;
  viewportCameraState: CreatorViewportCameraState | null;
  viewportWindowMode: CreatorViewportWindowMode;
  showSkeletons: boolean;
  stopRotation: boolean;
  viewportLightSettings: CreatorViewportLightSettings;
  filters: CreatorAssetFilters;
  selectedAssetId: string | null;
  busy: boolean;
  modelBusy: boolean;
  error: string | null;
  setSnapshot(snapshot: CreatorAssetRegistrySnapshot | null): void;
  setTreeNodes(
    parentId: string | null,
    nodes: CreatorAssetTreeNode[],
    problems: ModProblem[]
  ): void;
  clearTree(): void;
  setTreeNodeExpanded(nodeId: string, expanded: boolean): void;
  setTreeBusy(parentId: string | null, busy: boolean): void;
  setDetail(detail: CreatorAssetDetail | null): void;
  setModelPreview(modelPreview: CreatorModelPreviewResult | null): void;
  setModelError(modelError: string | null): void;
  setExportPlan(exportPlan: CreatorExportPlanResult | null): void;
  setMeshExport(meshExport: CreatorMeshExportResult | null): void;
  setMeshPackageExport(meshPackageExport: CreatorMeshPackageExportResult | null): void;
  setMappingsProgress(mappingsProgress: CreatorMappingsDumpProgress | null): void;
  setMappingsDump(mappingsDump: CreatorMappingsDumpResult | null): void;
  setReport(report: CreatorAssetReportResult | null): void;
  upsertViewportItem(item: CreatorViewportBundleItemInput): void;
  setViewportItemPreview(
    assetId: string,
    preview: CreatorModelPreviewResult | null
  ): void;
  setViewportItemError(assetId: string, error: string | null): void;
  setViewportItemVisibility(assetId: string, visible: boolean): void;
  removeViewportItem(assetId: string): void;
  clearViewportBundle(): void;
  applyViewportSession(session: CreatorViewportSession): void;
  setViewportTextureCandidates(
    viewportTextureCandidates: CreatorViewportTextureCandidate[]
  ): void;
  setViewportTextureError(viewportTextureError: string | null): void;
  setViewportTextureSelected(candidateId: string, selected: boolean): void;
  setSelectedViewportAssetId(selectedViewportAssetId: string | null): void;
  setViewportCameraState(
    viewportCameraState: CreatorViewportCameraState | null
  ): void;
  setViewportWindowMode(viewportWindowMode: CreatorViewportWindowMode): void;
  setShowSkeletons(showSkeletons: boolean): void;
  setStopRotation(stopRotation: boolean): void;
  setViewportLightSettings(
    viewportLightSettings: Partial<CreatorViewportLightSettings>
  ): void;
  setFilters(filters: Partial<CreatorAssetFilters>): void;
  setSelectedAssetId(selectedAssetId: string | null): void;
  setBusy(busy: boolean): void;
  setModelBusy(modelBusy: boolean): void;
  setError(error: string | null): void;
}

export const useCreatorAssetStore = create<CreatorAssetStoreState>((set) => ({
  snapshot: null,
  treeNodesByParentId: {},
  expandedTreeNodeIds: [],
  treeBusyNodeIds: [],
  treeProblems: [],
  detail: null,
  modelPreview: null,
  modelError: null,
  exportPlan: null,
  meshExport: null,
  meshPackageExport: null,
  mappingsProgress: null,
  mappingsDump: null,
  report: null,
  viewportBundle: [],
  viewportTextureCandidates: [],
  viewportTextureSelections: [],
  viewportTextureError: null,
  selectedViewportAssetId: null,
  viewportCameraState: null,
  viewportWindowMode: "embedded",
  showSkeletons: true,
  stopRotation: false,
  viewportLightSettings: defaultCreatorViewportLightSettings,
  filters: defaultCreatorAssetFilters,
  selectedAssetId: null,
  busy: false,
  modelBusy: false,
  error: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setTreeNodes: (parentId, nodes, problems) =>
    set((state) => ({
      treeNodesByParentId: {
        ...state.treeNodesByParentId,
        [treeParentKey(parentId)]: nodes
      },
      treeProblems: problems
    })),
  clearTree: () =>
    set({
      treeNodesByParentId: {},
      expandedTreeNodeIds: [],
      treeBusyNodeIds: [],
      treeProblems: []
    }),
  setTreeNodeExpanded: (nodeId, expanded) =>
    set((state) => ({
      expandedTreeNodeIds: expanded
        ? [...new Set([...state.expandedTreeNodeIds, nodeId])]
        : state.expandedTreeNodeIds.filter((id) => id !== nodeId)
    })),
  setTreeBusy: (parentId, busy) =>
    set((state) => {
      const key = treeParentKey(parentId);
      return {
        treeBusyNodeIds: busy
          ? [...new Set([...state.treeBusyNodeIds, key])]
          : state.treeBusyNodeIds.filter((id) => id !== key)
      };
    }),
  setDetail: (detail) => set({ detail }),
  setModelPreview: (modelPreview) => set({ modelPreview }),
  setModelError: (modelError) => set({ modelError }),
  setExportPlan: (exportPlan) => set({ exportPlan }),
  setMeshExport: (meshExport) => set({ meshExport }),
  setMeshPackageExport: (meshPackageExport) => set({ meshPackageExport }),
  setMappingsProgress: (mappingsProgress) => set({ mappingsProgress }),
  setMappingsDump: (mappingsDump) => set({ mappingsDump }),
  setReport: (report) => set({ report }),
  upsertViewportItem: (item) =>
    set((state) => ({
      selectedViewportAssetId: item.assetId,
      viewportBundle: upsertViewportBundleItem(state.viewportBundle, item)
    })),
  setViewportItemPreview: (assetId, preview) =>
    set((state) => ({
      viewportBundle: state.viewportBundle.map((item) =>
        item.assetId === assetId
          ? {
              ...item,
              preview,
              previewId: preview?.preview?.id ?? item.previewId,
              busy: false,
              error: null
            }
          : item
      )
    })),
  setViewportItemError: (assetId, error) =>
    set((state) => ({
      viewportBundle: state.viewportBundle.map((item) =>
        item.assetId === assetId ? { ...item, busy: false, error } : item
      )
    })),
  setViewportItemVisibility: (assetId, visible) =>
    set((state) => {
      const itemIndex = state.viewportBundle.findIndex(
        (item) => item.assetId === assetId
      );
      const viewportBundle = state.viewportBundle.map((item) =>
        item.assetId === assetId ? { ...item, visible } : item
      );
      const selectedViewportAssetId = nextSelectedViewportAssetId({
        bundle: viewportBundle,
        currentSelectedAssetId: state.selectedViewportAssetId,
        fallbackAssetId: visible ? assetId : null,
        removedOrHiddenAssetId: visible ? null : assetId,
        removedOrHiddenIndex: itemIndex
      });
      return {
        selectedViewportAssetId,
        viewportBundle: markSelectedViewportItem(
          viewportBundle,
          selectedViewportAssetId
        )
      };
    }),
  removeViewportItem: (assetId) =>
    set((state) => {
      const itemIndex = state.viewportBundle.findIndex(
        (item) => item.assetId === assetId
      );
      const viewportBundle = state.viewportBundle.filter(
        (item) => item.assetId !== assetId
      );
      const selectedViewportAssetId = nextSelectedViewportAssetId({
        bundle: viewportBundle,
        currentSelectedAssetId: state.selectedViewportAssetId,
        fallbackAssetId: null,
        removedOrHiddenAssetId: assetId,
        removedOrHiddenIndex: itemIndex
      });
      return {
        selectedViewportAssetId,
        viewportBundle: markSelectedViewportItem(
          viewportBundle,
          selectedViewportAssetId
        )
      };
    }),
  clearViewportBundle: () =>
    set({
      selectedViewportAssetId: null,
      viewportBundle: [],
      viewportCameraState: null,
      viewportTextureCandidates: [],
      viewportTextureSelections: []
    }),
  applyViewportSession: (session) =>
    set((state) => {
      const existingItems = new Map(
        state.viewportBundle.map((item) => [item.assetId, item])
      );
      const selectedViewportAssetId = nextSessionSelectedAssetId(session);
      return {
        selectedViewportAssetId,
        showSkeletons: session.showSkeletons,
        stopRotation: session.stopRotation,
        viewportTextureSelections: session.textureSelections,
        viewportBundle: session.items.map((item) => {
          const existing = existingItems.get(item.assetId);
          return {
            ...item,
            busy: existing?.preview ? false : true,
            error: existing?.error ?? null,
            preview: existing?.preview ?? null,
            selected: item.assetId === selectedViewportAssetId
          };
        }),
        viewportCameraState: session.cameraState,
        viewportLightSettings: session.lightSettings,
        viewportWindowMode: session.windowMode
      };
    }),
  setViewportTextureCandidates: (viewportTextureCandidates) =>
    set((state) => ({
      viewportTextureCandidates,
      viewportTextureSelections: state.viewportTextureSelections.filter(
        (selection) =>
          viewportTextureCandidates.some(
            (candidate) => candidate.id === selection.candidateId
          )
      )
    })),
  setViewportTextureError: (viewportTextureError) =>
    set({ viewportTextureError }),
  setViewportTextureSelected: (candidateId, selected) =>
    set((state) => ({
      viewportTextureSelections: selected
        ? [
            ...state.viewportTextureSelections.filter(
              (selection) => selection.candidateId !== candidateId
            ),
            { candidateId }
          ]
        : state.viewportTextureSelections.filter(
            (selection) => selection.candidateId !== candidateId
          )
    })),
  setSelectedViewportAssetId: (selectedViewportAssetId) =>
    set((state) => ({
      selectedViewportAssetId,
      viewportBundle: state.viewportBundle.map((item) => ({
        ...item,
        selected: item.assetId === selectedViewportAssetId
      }))
    })),
  setViewportCameraState: (viewportCameraState) => set({ viewportCameraState }),
  setViewportWindowMode: (viewportWindowMode) => set({ viewportWindowMode }),
  setShowSkeletons: (showSkeletons) => set({ showSkeletons }),
  setStopRotation: (stopRotation) => set({ stopRotation }),
  setViewportLightSettings: (viewportLightSettings) =>
    set((state) => ({
      viewportLightSettings: {
        ...state.viewportLightSettings,
        ...viewportLightSettings
      }
    })),
  setFilters: (filters) =>
    set((state) => ({
      filters: {
        ...state.filters,
        ...filters
      }
    })),
  setSelectedAssetId: (selectedAssetId) => set({ selectedAssetId }),
  setBusy: (busy) => set({ busy }),
  setModelBusy: (modelBusy) => set({ modelBusy }),
  setError: (error) => set({ error })
}));

export function treeParentKey(parentId: string | null): string {
  return parentId ?? rootTreeParentId;
}

export function viewportBundleItemFromAsset(
  asset: CreatorAssetIndexEntry,
  preview: CreatorModelPreviewResult | null = null
): CreatorViewportBundleItemInput {
  return {
    assetId: asset.id,
    assetClass: asset.assetClass,
    error: null,
    label: asset.label,
    preview,
    previewId: preview?.preview?.id ?? null,
    source: asset.source,
    visible: true
  };
}

export function creatorViewportSessionFromState(
  state: Pick<
    CreatorAssetStoreState,
    | "selectedViewportAssetId"
    | "showSkeletons"
    | "stopRotation"
    | "viewportBundle"
    | "viewportCameraState"
    | "viewportLightSettings"
    | "viewportTextureSelections"
    | "viewportWindowMode"
  >,
  windowMode: CreatorViewportWindowMode = state.viewportWindowMode
): CreatorViewportSession {
  return {
    cameraState: state.viewportCameraState,
    items: state.viewportBundle.map((item) => ({
      assetClass: item.assetClass,
      assetId: item.assetId,
      label: item.label,
      previewId: item.previewId,
      selected: item.assetId === state.selectedViewportAssetId,
      source: item.source,
      visible: item.visible
    })),
    lightSettings: state.viewportLightSettings,
    selectedAssetId: state.selectedViewportAssetId,
    showSkeletons: state.showSkeletons,
    stopRotation: state.stopRotation,
    textureSelections: state.viewportTextureSelections,
    windowMode
  };
}

function upsertViewportBundleItem(
  bundle: CreatorViewportBundleItem[],
  item: CreatorViewportBundleItemInput
): CreatorViewportBundleItem[] {
  const existing = bundle.find((candidate) => candidate.assetId === item.assetId);
  const nextItem: CreatorViewportBundleItem = {
    assetId: item.assetId,
    assetClass: item.assetClass,
    busy: item.busy ?? existing?.busy ?? false,
    error: "error" in item ? item.error ?? null : existing?.error ?? null,
    label: item.label,
    preview:
      "preview" in item ? item.preview ?? null : existing?.preview ?? null,
    previewId:
      "previewId" in item ? item.previewId ?? null : existing?.previewId ?? null,
    selected: true,
    source: item.source,
    visible: item.visible ?? existing?.visible ?? true
  };
  const nextBundle = existing
    ? bundle.map((candidate) =>
        candidate.assetId === item.assetId ? nextItem : candidate
      )
    : [...bundle, nextItem];
  return nextBundle.map((candidate) => ({
    ...candidate,
    selected: candidate.assetId === item.assetId
  }));
}

function markSelectedViewportItem(
  bundle: CreatorViewportBundleItem[],
  selectedAssetId: string | null
): CreatorViewportBundleItem[] {
  return bundle.map((item) => ({
    ...item,
    selected: item.assetId === selectedAssetId
  }));
}

function nextSelectedViewportAssetId({
  bundle,
  currentSelectedAssetId,
  fallbackAssetId,
  removedOrHiddenAssetId,
  removedOrHiddenIndex
}: {
  bundle: CreatorViewportBundleItem[];
  currentSelectedAssetId: string | null;
  fallbackAssetId: string | null;
  removedOrHiddenAssetId: string | null;
  removedOrHiddenIndex: number;
}): string | null {
  if (
    currentSelectedAssetId &&
    currentSelectedAssetId !== removedOrHiddenAssetId &&
    bundle.some((item) => item.assetId === currentSelectedAssetId)
  ) {
    return currentSelectedAssetId;
  }

  if (fallbackAssetId && bundle.some((item) => item.assetId === fallbackAssetId)) {
    return fallbackAssetId;
  }

  const visibleItems = bundle.filter((item) => item.visible);
  if (!visibleItems.length) {
    return null;
  }
  if (removedOrHiddenIndex >= 0) {
    const nextVisible = bundle
      .slice(removedOrHiddenIndex)
      .find((item) => item.visible);
    if (nextVisible) {
      return nextVisible.assetId;
    }
    const previousVisible = [...bundle]
      .slice(0, removedOrHiddenIndex)
      .reverse()
      .find((item) => item.visible);
    return previousVisible?.assetId ?? null;
  }
  return visibleItems[0].assetId;
}

function nextSessionSelectedAssetId(
  session: CreatorViewportSession
): string | null {
  if (
    session.selectedAssetId &&
    session.items.some((item) => item.assetId === session.selectedAssetId)
  ) {
    return session.selectedAssetId;
  }
  return (
    session.items.find((item) => item.selected)?.assetId ??
    session.items.find((item) => item.visible)?.assetId ??
    session.items[0]?.assetId ??
    null
  );
}
