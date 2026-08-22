import { create } from "zustand";

import type {
  CreatorAssetDetail,
  CreatorAssetReportResult,
  CreatorAssetRegistrySnapshot,
  CreatorAssetSearchRequest,
  CreatorAssetTreeNode,
  CreatorExportPlanResult,
  CreatorMeshExportResult,
  CreatorMeshPackageExportResult,
  CreatorMappingsDumpProgress,
  CreatorMappingsDumpResult,
  CreatorModelPreviewResult,
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

interface CreatorAssetStoreState {
  snapshot: CreatorAssetRegistrySnapshot | null;
  treeNodesByParentId: Record<string, CreatorAssetTreeNode[]>;
  expandedTreeNodeIds: string[];
  treeBusyNodeIds: string[];
  treeProblems: ModProblem[];
  detail: CreatorAssetDetail | null;
  modelPreview: CreatorModelPreviewResult | null;
  modelError: string | null;
  visibleAssetIds: string[];
  visibleModelPreviews: Record<string, CreatorModelPreviewResult>;
  visibleModelBusyIds: string[];
  visibleModelErrors: Record<string, string>;
  exportPlan: CreatorExportPlanResult | null;
  meshExport: CreatorMeshExportResult | null;
  meshPackageExport: CreatorMeshPackageExportResult | null;
  mappingsProgress: CreatorMappingsDumpProgress | null;
  mappingsDump: CreatorMappingsDumpResult | null;
  report: CreatorAssetReportResult | null;
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
  setVisibleAsset(assetId: string, visible: boolean): void;
  setVisibleModelPreview(
    assetId: string,
    modelPreview: CreatorModelPreviewResult | null
  ): void;
  setVisibleModelBusy(assetId: string, busy: boolean): void;
  setVisibleModelError(assetId: string, error: string | null): void;
  clearVisibleModels(): void;
  setExportPlan(exportPlan: CreatorExportPlanResult | null): void;
  setMeshExport(meshExport: CreatorMeshExportResult | null): void;
  setMeshPackageExport(meshPackageExport: CreatorMeshPackageExportResult | null): void;
  setMappingsProgress(mappingsProgress: CreatorMappingsDumpProgress | null): void;
  setMappingsDump(mappingsDump: CreatorMappingsDumpResult | null): void;
  setReport(report: CreatorAssetReportResult | null): void;
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
  visibleAssetIds: [],
  visibleModelPreviews: {},
  visibleModelBusyIds: [],
  visibleModelErrors: {},
  exportPlan: null,
  meshExport: null,
  meshPackageExport: null,
  mappingsProgress: null,
  mappingsDump: null,
  report: null,
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
  setVisibleAsset: (assetId, visible) =>
    set((state) => ({
      visibleAssetIds: visible
        ? [...new Set([...state.visibleAssetIds, assetId])]
        : state.visibleAssetIds.filter((id) => id !== assetId),
      visibleModelPreviews: visible
        ? state.visibleModelPreviews
        : omitRecordKey(state.visibleModelPreviews, assetId),
      visibleModelBusyIds: visible
        ? state.visibleModelBusyIds
        : state.visibleModelBusyIds.filter((id) => id !== assetId),
      visibleModelErrors: visible
        ? state.visibleModelErrors
        : omitRecordKey(state.visibleModelErrors, assetId)
    })),
  setVisibleModelPreview: (assetId, modelPreview) =>
    set((state) => ({
      visibleModelPreviews: modelPreview
        ? { ...state.visibleModelPreviews, [assetId]: modelPreview }
        : omitRecordKey(state.visibleModelPreviews, assetId)
    })),
  setVisibleModelBusy: (assetId, busy) =>
    set((state) => ({
      visibleModelBusyIds: busy
        ? [...new Set([...state.visibleModelBusyIds, assetId])]
        : state.visibleModelBusyIds.filter((id) => id !== assetId)
    })),
  setVisibleModelError: (assetId, error) =>
    set((state) => ({
      visibleModelErrors: error
        ? { ...state.visibleModelErrors, [assetId]: error }
        : omitRecordKey(state.visibleModelErrors, assetId)
    })),
  clearVisibleModels: () =>
    set({
      visibleAssetIds: [],
      visibleModelPreviews: {},
      visibleModelBusyIds: [],
      visibleModelErrors: {}
    }),
  setExportPlan: (exportPlan) => set({ exportPlan }),
  setMeshExport: (meshExport) => set({ meshExport }),
  setMeshPackageExport: (meshPackageExport) => set({ meshPackageExport }),
  setMappingsProgress: (mappingsProgress) => set({ mappingsProgress }),
  setMappingsDump: (mappingsDump) => set({ mappingsDump }),
  setReport: (report) => set({ report }),
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

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
