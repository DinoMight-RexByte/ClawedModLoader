import { useCallback, useEffect } from "react";

import type {
  CreatorAssetIndexEntry,
  CreatorAssetReportOutput,
  CreatorAssetTreeNode,
  CreatorExportOutput,
  CreatorMeshExportFormat,
  CreatorViewportCameraState,
  CreatorViewportTextureHint,
  CreatorViewportSession,
  CreatorViewportWindowMode
} from "../../shared/contracts/app";
import {
  creatorViewportSessionFromState,
  treeParentKey,
  type CreatorAssetFilters,
  type CreatorViewportLightSettings,
  viewportBundleItemFromAsset,
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
  const exportPlan = useCreatorAssetStore((state) => state.exportPlan);
  const meshExport = useCreatorAssetStore((state) => state.meshExport);
  const report = useCreatorAssetStore((state) => state.report);
  const viewportBundle = useCreatorAssetStore((state) => state.viewportBundle);
  const viewportTextureCandidates = useCreatorAssetStore(
    (state) => state.viewportTextureCandidates
  );
  const viewportTextureSelections = useCreatorAssetStore(
    (state) => state.viewportTextureSelections
  );
  const viewportTextureError = useCreatorAssetStore(
    (state) => state.viewportTextureError
  );
  const selectedViewportAssetId = useCreatorAssetStore(
    (state) => state.selectedViewportAssetId
  );
  const viewportCameraState = useCreatorAssetStore(
    (state) => state.viewportCameraState
  );
  const viewportWindowMode = useCreatorAssetStore(
    (state) => state.viewportWindowMode
  );
  const showSkeletons = useCreatorAssetStore((state) => state.showSkeletons);
  const stopRotation = useCreatorAssetStore((state) => state.stopRotation);
  const viewportLightSettings = useCreatorAssetStore(
    (state) => state.viewportLightSettings
  );
  const filters = useCreatorAssetStore((state) => state.filters);
  const selectedAssetId = useCreatorAssetStore(
    (state) => state.selectedAssetId
  );
  const busy = useCreatorAssetStore((state) => state.busy);
  const error = useCreatorAssetStore((state) => state.error);
  const visibleViewportAssetKey = viewportBundle
    .filter((item) => item.visible)
    .map((item) => item.assetId)
    .join("\0");

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
        await selectAssetById(node.assetId);
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
    [loadTree]
  );

  const selectAsset = useCallback(async (assetId: string) => {
    await selectAssetById(assetId);
  }, []);

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

  const addToViewport = useCallback(
    async (
      asset: CreatorAssetIndexEntry,
      preview = useCreatorAssetStore.getState().modelPreview
    ) => {
      const store = useCreatorAssetStore.getState();
      if (!asset.viewportCapable) {
        store.setError("Selected asset is not available for the viewport.");
        return;
      }
      store.upsertViewportItem({
        ...viewportBundleItemFromAsset(asset, preview),
        busy: !hasRenderableModel(preview),
        error: null
      });
      if (hasRenderableModel(preview)) {
        return;
      }

      try {
        store.setViewportItemPreview(
          asset.id,
          await window.cmm.getCreatorModelPreview({ assetId: asset.id })
        );
      } catch {
        store.setViewportItemError(asset.id, "Model preview is unavailable.");
      }
    },
    []
  );

  const addAssetToViewport = useCallback(async (assetId: string) => {
    const store = useCreatorAssetStore.getState();
    store.setSelectedAssetId(assetId);
    store.setModelPreview(null);
    store.setModelError(null);
    store.setBusy(true);
    store.setModelBusy(true);
    try {
      const [nextDetail, nextPreview] = await Promise.all([
        window.cmm.getCreatorAssetDetail({ assetId }),
        window.cmm.getCreatorModelPreview({ assetId })
      ]);
      store.setDetail(nextDetail);
      store.setModelPreview(nextPreview);
      if (nextDetail.asset) {
        store.upsertViewportItem({
          ...viewportBundleItemFromAsset(nextDetail.asset, nextPreview),
          busy: false,
          error: null
        });
      }
      store.setExportPlan(null);
      store.setMeshExport(null);
      store.setReport(null);
      store.setError(null);
    } catch {
      store.setError("Creator viewport asset is unavailable.");
    } finally {
      if (useCreatorAssetStore.getState().selectedAssetId === assetId) {
        store.setModelBusy(false);
      }
      store.setBusy(false);
    }
  }, []);

  const clearViewport = useCallback(() => {
    useCreatorAssetStore.getState().clearViewportBundle();
  }, []);

  const setViewportItemVisibility = useCallback(
    (assetId: string, visible: boolean) => {
      useCreatorAssetStore
        .getState()
        .setViewportItemVisibility(assetId, visible);
    },
    []
  );

  const removeViewportItem = useCallback((assetId: string) => {
    useCreatorAssetStore.getState().removeViewportItem(assetId);
  }, []);

  const selectViewportItem = useCallback((assetId: string) => {
    useCreatorAssetStore.getState().setSelectedViewportAssetId(assetId);
  }, []);

  const setShowSkeletons = useCallback((showSkeletons: boolean) => {
    useCreatorAssetStore.getState().setShowSkeletons(showSkeletons);
  }, []);

  const setStopRotation = useCallback((stopRotation: boolean) => {
    useCreatorAssetStore.getState().setStopRotation(stopRotation);
  }, []);

  const setViewportLightSettings = useCallback(
    (viewportLightSettings: Partial<CreatorViewportLightSettings>) => {
      useCreatorAssetStore
        .getState()
        .setViewportLightSettings(viewportLightSettings);
    },
    []
  );

  const setViewportCameraState = useCallback(
    (viewportCameraState: CreatorViewportCameraState | null) => {
      useCreatorAssetStore
        .getState()
        .setViewportCameraState(viewportCameraState);
    },
    []
  );

  const refreshViewportTextureCandidates = useCallback(async () => {
    const store = useCreatorAssetStore.getState();
    const visibleAssetIds = store.viewportBundle
      .filter((item) => item.visible)
      .map((item) => item.assetId);
    if (!visibleAssetIds.length) {
      store.setViewportTextureCandidates([]);
      store.setViewportTextureError(null);
      return;
    }
    try {
      const result = await window.cmm.getCreatorViewportTextureCandidates({
        textureHints: viewportTextureHints(store.viewportBundle),
        visibleAssetIds
      });
      store.setViewportTextureCandidates(result.candidates);
      store.setViewportTextureError(null);
    } catch {
      store.setViewportTextureCandidates([]);
      store.setViewportTextureError("Viewport texture options are unavailable.");
    }
  }, []);

  const setViewportTextureSelected = useCallback(
    (candidateId: string, selected: boolean) => {
      useCreatorAssetStore
        .getState()
        .setViewportTextureSelected(candidateId, selected);
    },
    []
  );

  const applyViewportSession = useCallback(
    async (session: CreatorViewportSession) => {
      useCreatorAssetStore.getState().applyViewportSession(session);
      await loadMissingViewportPreviews();
    },
    []
  );

  const updateViewportWindowSession = useCallback(
    async (
      windowMode: CreatorViewportWindowMode =
        useCreatorAssetStore.getState().viewportWindowMode
    ) => {
      await window.cmm.updateCreatorViewportSession(
        creatorViewportSessionFromState(
          useCreatorAssetStore.getState(),
          windowMode
        )
      );
    },
    []
  );

  const openViewportWindow = useCallback(async () => {
    const store = useCreatorAssetStore.getState();
    store.setViewportWindowMode("poppedOut");
    try {
      store.applyViewportSession(
        await window.cmm.openCreatorViewportWindow(
          creatorViewportSessionFromState(store, "poppedOut")
        )
      );
      store.setError(null);
    } catch {
      store.setViewportWindowMode("embedded");
      store.setError("Creator viewport pop-out is unavailable.");
    }
  }, []);

  const returnViewportWindow = useCallback(
    async (source: "local" | "service" = "local") => {
      const store = useCreatorAssetStore.getState();
      try {
        const session =
          source === "service"
            ? await window.cmm.getCreatorViewportSession()
            : creatorViewportSessionFromState(store, "embedded");
        await applyViewportSession(
          await window.cmm.returnCreatorViewportWindow({
            ...session,
            windowMode: "embedded"
          })
        );
        store.setError(null);
      } catch {
        store.setError("Creator viewport return is unavailable.");
      }
    },
    [applyViewportSession]
  );

  useEffect(() => {
    return window.cmm.onCreatorViewportWindowEvent((event) => {
      void applyViewportSession(event.session);
    });
  }, [applyViewportSession]);

  useEffect(() => {
    void refreshViewportTextureCandidates();
  }, [refreshViewportTextureCandidates, visibleViewportAssetKey]);

  const planVisibleExport = useCallback(async () => {
    const store = useCreatorAssetStore.getState();
    const assetIds = store.viewportBundle
      .filter((item) => item.visible)
      .map((item) => item.assetId);
    if (!assetIds.length) {
      store.setError("No visible viewport assets are available for export.");
      return;
    }

    store.setBusy(true);
    try {
      store.setExportPlan(
        await window.cmm.getCreatorExportPlan({
          assetIds,
          output: "clawedmod"
        })
      );
      store.setError(null);
    } catch {
      store.setError("Creator visible set export plan is unavailable.");
    } finally {
      store.setBusy(false);
    }
  }, []);

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
    exportPlan,
    meshExport,
    report,
    viewportBundle,
    viewportTextureCandidates,
    viewportTextureSelections,
    viewportTextureError,
    selectedViewportAssetId,
    viewportCameraState,
    viewportWindowMode,
    showSkeletons,
    stopRotation,
    viewportLightSettings,
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
    addToViewport,
    addAssetToViewport,
    clearViewport,
    setViewportItemVisibility,
    removeViewportItem,
    selectViewportItem,
    setShowSkeletons,
    setStopRotation,
    setViewportLightSettings,
    setViewportCameraState,
    setViewportTextureSelected,
    refreshViewportTextureCandidates,
    applyViewportSession,
    openViewportWindow,
    returnViewportWindow,
    updateViewportWindowSession,
    planVisibleExport,
    copyReport,
    setFilters
  };
}

function hasRenderableModel(
  preview: ReturnType<typeof useCreatorAssetStore.getState>["modelPreview"]
): boolean {
  return Boolean(
    preview?.model &&
      (preview.status === "available" || preview.status === "ready")
  );
}

function viewportTextureHints(
  items: ReturnType<typeof useCreatorAssetStore.getState>["viewportBundle"]
): CreatorViewportTextureHint[] {
  return items
    .filter((item) => item.visible && item.preview?.metadata)
    .flatMap((item) => {
      const metadata = item.preview?.metadata;
      if (!metadata) {
        return [];
      }
      const dependencyPaths = metadata.dependencyPaths.slice(0, 80);
      const slotHints: CreatorViewportTextureHint[] = metadata.materialSlots
        .filter((slot) => slot.materialPath)
        .map((slot) => ({
          dependencyPaths,
          materialPath: slot.materialPath,
          materialSlotName: slot.name,
          meshAssetId: item.assetId
        }));
      return slotHints.length
        ? slotHints
        : [
            {
              dependencyPaths,
              materialPath: null,
              materialSlotName: null,
              meshAssetId: item.assetId
            }
          ];
    });
}

async function loadMissingViewportPreviews(): Promise<void> {
  const store = useCreatorAssetStore.getState();
  const items = store.viewportBundle.filter((item) => !item.preview);
  await Promise.all(
    items.map(async (item) => {
      try {
        store.setViewportItemPreview(
          item.assetId,
          await window.cmm.getCreatorModelPreview({
            assetId: item.assetId,
            ...(item.previewId ? { previewId: item.previewId } : {})
          })
        );
      } catch {
        store.setViewportItemError(item.assetId, "Model preview is unavailable.");
      }
    })
  );
}

async function selectAssetById(assetId: string): Promise<void> {
  const store = useCreatorAssetStore.getState();
  store.setSelectedAssetId(assetId);
  store.setModelPreview(null);
  store.setModelError(null);
  store.setBusy(true);
  try {
    store.setDetail(await window.cmm.getCreatorAssetDetail({ assetId }));
    store.setExportPlan(null);
    store.setMeshExport(null);
    store.setReport(null);
    store.setError(null);
  } catch {
    store.setError("Creator asset detail is unavailable.");
  } finally {
    store.setBusy(false);
  }
}
