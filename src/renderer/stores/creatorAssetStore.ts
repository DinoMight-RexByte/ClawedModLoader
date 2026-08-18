import { create } from "zustand";

import type {
  CreatorAssetDetail,
  CreatorAssetReportResult,
  CreatorAssetRegistrySnapshot,
  CreatorAssetSearchRequest,
  CreatorAssetTreeNode,
  CreatorExportPlanResult,
  CreatorMeshExportResult,
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
  exportPlan: CreatorExportPlanResult | null;
  meshExport: CreatorMeshExportResult | null;
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
  setExportPlan(exportPlan: CreatorExportPlanResult | null): void;
  setMeshExport(meshExport: CreatorMeshExportResult | null): void;
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
  exportPlan: null,
  meshExport: null,
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
  setExportPlan: (exportPlan) => set({ exportPlan }),
  setMeshExport: (meshExport) => set({ meshExport }),
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
