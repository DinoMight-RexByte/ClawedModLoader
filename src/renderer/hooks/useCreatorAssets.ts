import { useCallback, useEffect } from "react";

import type {
  CreatorAssetReportOutput,
  CreatorAssetTreeNode,
  CreatorExportOutput,
  CreatorMeshExportFormat
} from "../../shared/contracts/app";
import {
  treeParentKey,
  type CreatorAssetFilters,
  useCreatorAssetStore
} from "../stores/creatorAssetStore";

export function useCreatorAssets() {
  const snapshot = useCreatorAssetStore((state) => state.snapshot);
  const treeNodesByParentId = useCreatorAssetStore(
    (state) => state.treeNodesByParentId
  );
  const expandedTreeNodeIds = useCreatorAssetStore(
    (state) => state.expandedTreeNodeIds
  );
  const treeBusyNodeIds = useCreatorAssetStore(
    (state) => state.treeBusyNodeIds
  );
  const treeProblems = useCreatorAssetStore((state) => state.treeProblems);
  const detail = useCreatorAssetStore((state) => state.detail);
  const modelPreview = useCreatorAssetStore((state) => state.modelPreview);
  const modelBusy = useCreatorAssetStore((state) => state.modelBusy);
  const modelError = useCreatorAssetStore((state) => state.modelError);
  const visibleAssetIds = useCreatorAssetStore((state) => state.visibleAssetIds);
  const visibleModelPreviews = useCreatorAssetStore(
    (state) => state.visibleModelPreviews
  );
  const visibleModelBusyIds = useCreatorAssetStore(
    (state) => state.visibleModelBusyIds
  );
  const visibleModelErrors = useCreatorAssetStore(
    (state) => state.visibleModelErrors
  );
  const exportPlan = useCreatorAssetStore((state) => state.exportPlan);
  const meshExport = useCreatorAssetStore((state) => state.meshExport);
  const meshPackageExport = useCreatorAssetStore(
    (state) => state.meshPackageExport
  );
  const mappingsProgress = useCreatorAssetStore(
    (state) => state.mappingsProgress
  );
  const mappingsDump = useCreatorAssetStore((state) => state.mappingsDump);
  const report = useCreatorAssetStore((state) => state.report);
  const filters = useCreatorAssetStore((state) => state.filters);
  const selectedAssetId = useCreatorAssetStore(
    (state) => state.selectedAssetId
  );
  const busy = useCreatorAssetStore((state) => state.busy);
  const error = useCreatorAssetStore((state) => state.error);

  useEffect(
    () =>
      window.cmm.onCreatorMappingsProgress((progress) => {
        useCreatorAssetStore.getState().setMappingsProgress(progress);
      }),
    []
  );

  const loadModelPreview = useCallback(async (assetId: string | null) => {
    const store = useCreatorAssetStore.getState();
    store.setModelPreview(null);
    store.setModelError(null);
    if (!assetId) {
      store.setModelBusy(false);
      return;
    }

    store.setModelBusy(true);
    try {
      const nextPreview = await window.cmm.getCreatorModelPreview({ assetId });
      if (useCreatorAssetStore.getState().selectedAssetId === assetId) {
        store.setModelPreview(nextPreview);
      }
    } catch {
      if (useCreatorAssetStore.getState().selectedAssetId === assetId) {
        store.setModelError("Model preview is unavailable.");
      }
    } finally {
      if (useCreatorAssetStore.getState().selectedAssetId === assetId) {
        store.setModelBusy(false);
      }
    }
  }, []);

  const loadTree = useCallback(async (parentId: string | null) => {
    const store = useCreatorAssetStore.getState();
    const currentFilters = store.filters;
    store.setTreeBusy(parentId, true);
    try {
      const nextTree = await window.cmm.getCreatorAssetTree({
        parentId,
        source: currentFilters.source,
        query: currentFilters.query,
        activeOnly: currentFilters.activeOnly,
        limit: 300
      });
      store.setTreeNodes(parentId, nextTree.nodes, nextTree.problems);
      store.setError(null);
    } catch {
      store.setError("Creator asset tree is unavailable.");
    } finally {
      store.setTreeBusy(parentId, false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const store = useCreatorAssetStore.getState();
    store.setBusy(true);
    try {
      store.clearTree();
      store.clearVisibleModels();
      const nextSnapshot = await window.cmm.getCreatorAssetRegistrySnapshot();
      store.setSnapshot(nextSnapshot);
      store.setError(null);
      await loadTree(null);
    } catch {
      store.setError("Creator asset registry is unavailable.");
    } finally {
      store.setBusy(false);
    }
  }, [loadTree]);

  const toggleTreeNode = useCallback(
    async (node: CreatorAssetTreeNode) => {
      if (node.kind === "asset" && node.assetId) {
        await selectAssetById(node.assetId, loadModelPreview);
        return;
      }
      if (!node.hasChildren) {
        return;
      }

      const store = useCreatorAssetStore.getState();
      const expanded = store.expandedTreeNodeIds.includes(node.id);
      store.setTreeNodeExpanded(node.id, !expanded);
      if (!expanded && !store.treeNodesByParentId[treeParentKey(node.id)]) {
        await loadTree(node.id);
      }
    },
    [loadModelPreview, loadTree]
  );

  const selectAsset = useCallback(async (assetId: string) => {
    await selectAssetById(assetId, loadModelPreview);
  }, [loadModelPreview]);

  const planExport = useCallback(
    async (assetId: string, output: CreatorExportOutput) => {
      const store = useCreatorAssetStore.getState();
      store.setBusy(true);
      try {
        store.setExportPlan(
          await window.cmm.getCreatorExportPlan({
            assetIds: [assetId],
            output
          })
        );
        store.setError(null);
      } catch {
        store.setError("Creator export plan is unavailable.");
      } finally {
        store.setBusy(false);
      }
    },
    []
  );

  const copyReport = useCallback(
    async (assetId: string, output: CreatorAssetReportOutput) => {
      const store = useCreatorAssetStore.getState();
      store.setBusy(true);
      try {
        const nextReport = await window.cmm.getCreatorAssetReport({
          assetIds: [assetId],
          output
        });
        store.setReport(nextReport);
        await navigator.clipboard.writeText(nextReport.text);
        store.setError(null);
      } catch {
        store.setError("Creator asset report is unavailable.");
      } finally {
        store.setBusy(false);
      }
    },
    []
  );

  const exportMesh = useCallback(
    async (assetId: string, format: CreatorMeshExportFormat) => {
      const store = useCreatorAssetStore.getState();
      store.setBusy(true);
      try {
        store.setMeshExport(
          await window.cmm.chooseAndExportCreatorMesh({ assetId, format })
        );
        store.setError(null);
      } catch {
        store.setError("Creator mesh export is unavailable.");
      } finally {
        store.setBusy(false);
      }
    },
    []
  );

  const toggleVisibleAsset = useCallback(async (assetId: string) => {
    const store = useCreatorAssetStore.getState();
    if (store.visibleAssetIds.includes(assetId)) {
      store.setVisibleAsset(assetId, false);
      return;
    }

    store.setVisibleAsset(assetId, true);
    store.setVisibleModelBusy(assetId, true);
    store.setVisibleModelError(assetId, null);
    try {
      const nextPreview = await window.cmm.getCreatorModelPreview({ assetId });
      if (useCreatorAssetStore.getState().visibleAssetIds.includes(assetId)) {
        store.setVisibleModelPreview(assetId, nextPreview);
      }
      store.setError(null);
    } catch {
      if (useCreatorAssetStore.getState().visibleAssetIds.includes(assetId)) {
        store.setVisibleModelError(assetId, "Model preview is unavailable.");
      }
    } finally {
      store.setVisibleModelBusy(assetId, false);
    }
  }, []);

  const clearVisibleModels = useCallback(() => {
    useCreatorAssetStore.getState().clearVisibleModels();
  }, []);

  const exportVisiblePackage = useCallback(async () => {
    const store = useCreatorAssetStore.getState();
    const assetIds = store.visibleAssetIds;
    if (!assetIds.length) {
      store.setError("No visible Creator models are selected for package export.");
      return;
    }

    store.setBusy(true);
    try {
      store.setMeshPackageExport(
        await window.cmm.chooseAndExportCreatorMeshPackage({ assetIds })
      );
      store.setError(null);
    } catch {
      store.setError("Creator model package export is unavailable.");
    } finally {
      store.setBusy(false);
    }
  }, []);

  const generateMappings = useCallback(async () => {
    const store = useCreatorAssetStore.getState();
    store.setBusy(true);
    store.setMappingsDump(null);
    store.setMappingsProgress({
      stage: "checking",
      status: "running",
      message: "Checking Clawed install and existing mappings.",
      detail: null,
      mappingsPath: null,
      evidencePath: null
    });
    try {
      const nextDump = await window.cmm.generateCreatorMappings();
      store.setMappingsDump(nextDump);
      if (nextDump.status === "generated" || nextDump.status === "ready") {
        store.setMappingsProgress({
          stage: "complete",
          status: "done",
          message: "Mappings generation complete.",
          detail: null,
          mappingsPath: nextDump.mappingsPath,
          evidencePath: nextDump.evidencePath
        });
        const selected = store.selectedAssetId;
        await refresh();
        if (selected) {
          await selectAssetById(selected, loadModelPreview);
        }
      }
      store.setError(null);
    } catch {
      store.setError("Creator mappings generation is unavailable.");
      store.setMappingsProgress({
        stage: "failed",
        status: "failed",
        message: "Creator mappings generation is unavailable.",
        detail: null,
        mappingsPath: null,
        evidencePath: null
      });
    } finally {
      store.setBusy(false);
    }
  }, [loadModelPreview, refresh]);

  const setFilters = useCallback(
    (nextFilters: Partial<CreatorAssetFilters>) => {
      const store = useCreatorAssetStore.getState();
      store.setFilters(nextFilters);
      store.clearTree();
      void loadTree(null);
    },
    [loadTree]
  );

  return {
    snapshot,
    treeNodesByParentId,
    expandedTreeNodeIds,
    treeBusyNodeIds,
    treeProblems,
    detail,
    modelPreview,
    modelBusy,
    modelError,
    visibleAssetIds,
    visibleModelPreviews,
    visibleModelBusyIds,
    visibleModelErrors,
    exportPlan,
    meshExport,
    meshPackageExport,
    mappingsProgress,
    mappingsDump,
    report,
    filters,
    selectedAssetId,
    busy,
    error,
    refresh,
    loadTree,
    toggleTreeNode,
    selectAsset,
    planExport,
    exportMesh,
    toggleVisibleAsset,
    clearVisibleModels,
    exportVisiblePackage,
    generateMappings,
    copyReport,
    setFilters
  };
}

async function selectAssetById(
  assetId: string,
  loadModelPreview: (assetId: string | null) => Promise<void>
): Promise<void> {
  const store = useCreatorAssetStore.getState();
  store.setSelectedAssetId(assetId);
  store.setModelPreview(null);
  store.setModelError(null);
  store.setBusy(true);
  try {
    store.setDetail(await window.cmm.getCreatorAssetDetail({ assetId }));
    await loadModelPreview(assetId);
    store.setExportPlan(null);
    store.setMeshExport(null);
    store.setMeshPackageExport(null);
    store.setReport(null);
    store.setError(null);
  } catch {
    store.setError("Creator asset detail is unavailable.");
  } finally {
    store.setBusy(false);
  }
}
