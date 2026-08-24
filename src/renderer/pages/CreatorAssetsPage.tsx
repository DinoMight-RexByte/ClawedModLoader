import {
  AlertTriangle,
  Bone,
  Box,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Clipboard,
  Cuboid,
  Database,
  Download,
  Eye,
  EyeOff,
  File,
  FileJson,
  FileSearch,
  Folder,
  FolderOpen,
  Loader2,
  Minus,
  Network,
  PackageSearch,
  PackagePlus,
  Plus,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";

import type {
  CreatorAssetIndexEntry,
  CreatorAssetReportOutput,
  CreatorAssetTreeNode,
  CreatorMeshExportFormat,
  CreatorMappingsDumpProgress,
  CreatorMappingsDumpProgressStage,
  CreatorModelPreviewResult,
  ModProblem
} from "../../shared/contracts/app";
import { CreatorModelViewport } from "../components/CreatorModelViewport";
import { ProblemDetails } from "../components/ProblemDetails";
import { useCreatorAssets } from "../hooks/useCreatorAssets";
import {
  rootTreeParentId,
  treeParentKey,
  type CreatorAssetFilters
} from "../stores/creatorAssetStore";

const sourceOptions: Array<{
  value: CreatorAssetFilters["source"];
  label: string;
}> = [
  { value: "all", label: "All sources" },
  { value: "baseGameMap", label: "Clawed map" },
  { value: "installedPackage", label: "Manifests" },
  { value: "packagePayload", label: "Payloads" },
  { value: "deployment", label: "Deployment" }
];

const reportActions: Array<{
  output: CreatorAssetReportOutput;
  label: string;
}> = [
  { output: "assetIndex", label: "Copy Metadata" },
  { output: "dependencyGraph", label: "Copy Dependencies" },
  { output: "conflictReport", label: "Copy Conflict Report" },
  { output: "validationReport", label: "Copy Validation" }
];

const meshExportActions: Array<{
  format: CreatorMeshExportFormat;
  label: string;
}> = [
  { format: "obj", label: "Export OBJ" },
  { format: "gltf", label: "Export glTF" },
  { format: "glb", label: "Export GLB" }
];

const mappingProcessSteps: Array<{
  stage: CreatorMappingsDumpProgressStage;
  label: string;
  detail: string;
}> = [
  {
    stage: "checking",
    label: "Check",
    detail: "Find Clawed and existing Mappings.usmap."
  },
  {
    stage: "staging",
    label: "Stage",
    detail: "Place the temporary UE4SS mapping dump."
  },
  {
    stage: "launching",
    label: "Launch",
    detail: "Start Clawed through Steam."
  },
  {
    stage: "waitingForGame",
    label: "Detect",
    detail: "Wait for Clawed-Win64-Shipping.exe."
  },
  {
    stage: "waitingForMappings",
    label: "Dump",
    detail: "Wait for UE4SS to write Mappings.usmap."
  },
  {
    stage: "closingGame",
    label: "Close",
    detail: "Ask Clawed to close without force-killing."
  },
  {
    stage: "restoringVanilla",
    label: "Restore",
    detail: "Remove CMM's temporary deployment."
  }
];

export function CreatorAssetsPage(): ReactElement {
  const {
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
    toggleTreeNode,
    planExport,
    exportMesh,
    toggleVisibleAsset,
    clearVisibleModels,
    exportVisiblePackage,
    generateMappings,
    copyReport,
    setFilters
  } = useCreatorAssets();
  const [dismissedProblemKeys, setDismissedProblemKeys] = useState<Set<string>>(
    () => new Set()
  );
  const visiblePreviews = visibleAssetIds
    .map((assetId) => visibleModelPreviews[assetId])
    .filter((item): item is CreatorModelPreviewResult => Boolean(item));
  const visibleError = Object.values(visibleModelErrors)[0] ?? null;
  const allProblems = uniqueProblems([
    ...(snapshot?.problems ?? []),
    ...treeProblems,
    ...(modelPreview?.problems ?? []),
    ...visiblePreviews.flatMap((preview) => preview.problems),
    ...(report?.problems ?? []),
    ...(exportPlan?.problems ?? []),
    ...(meshExport?.problems ?? []),
    ...(meshPackageExport?.problems ?? []),
    ...(mappingsDump?.problems ?? [])
  ]);
  const problemKeyList = useMemo(
    () => allProblems.map(problemKey).join("\n"),
    [allProblems]
  );
  const problems = allProblems.filter(
    (problem) =>
      problem.severity === "error" ||
      !dismissedProblemKeys.has(problemKey(problem))
  );
  const clearableWarningCount = allProblems.filter(
    (problem) =>
      problem.severity !== "error" &&
      !dismissedProblemKeys.has(problemKey(problem))
  ).length;
  const mappingsRequired = allProblems.some(
    (problem) => problem.code === "CUE4PARSE_MAPPINGS_REQUIRED"
  );
  const showMappingsProgress =
    mappingsRequired || Boolean(mappingsProgress) || Boolean(mappingsDump);
  const rootNodes = treeNodesByParentId[rootTreeParentId] ?? [];
  const selected = detail?.asset ?? null;

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const activeKeys = new Set(
      problemKeyList ? problemKeyList.split("\n") : []
    );
    setDismissedProblemKeys((current) => {
      const next = new Set(
        [...current].filter((key) => activeKeys.has(key))
      );
      return next.size === current.size ? current : next;
    });
  }, [problemKeyList]);

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-app-accent">Creator</p>
          <h1 className="mt-1 text-3xl font-semibold">
            Creator Asset Workspace
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            Browse Clawed map targets, package manifests, package payloads,
            active-profile overrides, conflicts, and export-safe reports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-app-warning/50 px-4 text-sm font-semibold text-app-warning hover:bg-app-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-warning disabled:opacity-60"
            disabled={busy}
            onClick={() => void generateMappings()}
            type="button"
          >
            <PackagePlus aria-hidden="true" size={18} />
            Generate Mappings
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={18} />
            Refresh
          </button>
        </div>
      </header>

      {showMappingsProgress ? (
        <MappingsProgressPanel
          progress={mappingsProgress}
          required={mappingsRequired}
        />
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={<Database aria-hidden="true" size={18} />}
          label="Map Rows"
          value={snapshot?.totals.baseGameEntries ?? 0}
        />
        <Metric
          icon={<PackageSearch aria-hidden="true" size={18} />}
          label="Packages"
          value={snapshot?.totals.installedPackages ?? 0}
        />
        <Metric
          icon={<FileSearch aria-hidden="true" size={18} />}
          label="Payload Entries"
          value={snapshot?.totals.packagePayloadEntries ?? 0}
        />
        <Metric
          icon={<Network aria-hidden="true" size={18} />}
          label="Active Winners"
          value={snapshot?.totals.activeWinners ?? 0}
        />
      </section>

      <section className="grid gap-3 rounded-lg border border-app-border bg-app-surface p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_190px_auto]">
          <label className="relative min-w-0">
            <FileSearch
              aria-hidden="true"
              className="absolute left-3 top-2.5 text-app-subtle"
              size={18}
            />
            <span className="sr-only">Search assets</span>
            <input
              className="h-10 w-full rounded-md border border-app-border bg-app-surfaceRaised pl-10 pr-3 text-sm text-app-text"
              onChange={(event) =>
                setFilters({ query: event.target.value, limit: 300 })
              }
              placeholder="Search paths, objects, packages"
              value={filters.query}
            />
          </label>

          <SelectField
            label="Asset source"
            onChange={(value) =>
              setFilters({
                source: value as CreatorAssetFilters["source"]
              })
            }
            options={sourceOptions}
            value={filters.source}
          />

          <label className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-sm text-app-muted">
            <input
              checked={filters.activeOnly}
              className="h-4 w-4 accent-app-accent"
              onChange={(event) =>
                setFilters({ activeOnly: event.target.checked })
              }
              type="checkbox"
            />
            Active Only
          </label>
        </div>

        {snapshot ? (
          <div className="flex flex-wrap gap-2 text-xs text-app-muted">
            <span className="rounded bg-app-surfaceRaised px-2 py-1">
              Profile: {snapshot.activeProfile.name}
            </span>
            <span className="rounded bg-app-surfaceRaised px-2 py-1">
              Build: {snapshot.map.steamBuildId ?? "unknown"}
            </span>
            <span className="rounded bg-app-surfaceRaised px-2 py-1">
              Conflicts: {snapshot.totals.activeConflictTargets}
            </span>
          </div>
        ) : null}
      </section>

      {error || problems.length > 0 ? (
        <section className="rounded-lg border border-app-warning/40 bg-app-warning/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-medium text-app-warning">
              <AlertTriangle aria-hidden="true" size={18} />
              {error ?? "Creator registry reported warnings."}
            </div>
            <div className="flex flex-wrap gap-2">
              {clearableWarningCount > 0 ? (
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-app-warning/50 px-2 text-xs font-semibold text-app-warning hover:bg-app-warning/15"
                  onClick={() =>
                    setDismissedProblemKeys(
                      new Set(
                        allProblems
                          .filter((problem) => problem.severity !== "error")
                          .map(problemKey)
                      )
                    )
                  }
                  type="button"
                >
                  <CheckCircle2 aria-hidden="true" size={14} />
                  Clear Warnings
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-3">
            <ProblemDetails problems={problems} />
          </div>
        </section>
      ) : null}

      <section className="grid min-h-[520px] gap-4 xl:grid-cols-[minmax(340px,0.92fr)_minmax(420px,1.08fr)]">
        <div className="min-w-0 rounded-lg border border-app-border bg-app-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border p-4">
            <div>
              <h2 className="text-lg font-semibold">Asset Tree</h2>
              <p className="mt-1 text-sm text-app-muted">
                {filters.query
                  ? "Search results"
                  : "Expand a source and browse by path"}
              </p>
            </div>
            {treeBusyNodeIds.includes(rootTreeParentId) ? (
              <span className="rounded bg-app-surfaceRaised px-2 py-1 text-xs text-app-muted">
                Loading
              </span>
            ) : null}
          </div>

          <div className="max-h-[680px] overflow-auto p-2">
            {rootNodes.length === 0 ? (
              <div className="p-6 text-center text-sm text-app-muted">
                {treeBusyNodeIds.includes(rootTreeParentId)
                  ? "Loading asset tree."
                  : "No asset tree entries match the current filters."}
              </div>
            ) : (
              <div className="grid gap-1">
                {rootNodes.map((node) => (
                  <TreeNodeRow
                    busyNodeIds={treeBusyNodeIds}
                    expandedNodeIds={expandedTreeNodeIds}
                    key={node.id}
                    node={node}
                    nodesByParentId={treeNodesByParentId}
                    onToggle={(nextNode) => void toggleTreeNode(nextNode)}
                    onVisibilityToggle={(assetId) =>
                      void toggleVisibleAsset(assetId)
                    }
                    selectedAssetId={selectedAssetId}
                    visibleAssetIds={visibleAssetIds}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-lg border border-app-border bg-app-surface p-4">
          {selected ? (
            <div className="flex h-full min-h-0 flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-app-accent">
                    {sourceLabel(selected)}
                  </p>
                  <h2 className="mt-1 break-words text-xl font-semibold [overflow-wrap:anywhere]">
                    {selected.label}
                  </h2>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {canShowEntryInViewport(selected) ? (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text disabled:opacity-60"
                      disabled={busy}
                      onClick={() => void toggleVisibleAsset(selected.id)}
                      type="button"
                    >
                      {visibleAssetIds.includes(selected.id) ? (
                        <Minus aria-hidden="true" size={16} />
                      ) : (
                        <Plus aria-hidden="true" size={16} />
                      )}
                      {visibleAssetIds.includes(selected.id)
                        ? "Remove From Viewport"
                        : "Add To Viewport"}
                    </button>
                  ) : null}
                  <StatusPill entry={selected} />
                </div>
              </div>

              <dl className="grid gap-3 text-sm">
                <Detail
                  label="Source Location"
                  mono
                  value={sourceLocation(selected)}
                />
                <Detail label="Object Path" mono value={selected.objectPath} />
                <Detail label="Asset Class" value={selected.assetClass} />
                <Detail label="Package Container" value={selected.containerName} />
                <Detail label="Package Owner" value={selected.packageName} />
                <Detail label="Package Path" mono value={selected.packagePath} />
                <Detail label="Virtual Path" mono value={selected.virtualPath} />
                <Detail label="Payload Entry" mono value={selected.payloadPath} />
                <Detail label="Mod Use" value={selected.modUses} />
                <Detail
                  label="Validation"
                  value={selected.validationState ?? "not declared"}
                />
                <Detail
                  label="Export Eligibility"
                  value={selected.exportState ?? "unknown"}
                />
                <Detail
                  label="Active Profile Winner"
                  value={
                    detail?.activeWinner
                      ? `${detail.activeWinner.packageName} ${detail.activeWinner.packageVersion}`
                      : "none"
                  }
                />
                <Detail label="Checksum" mono value={selected.sha256} />
              </dl>

              <div className="grid gap-3 rounded-md border border-app-border bg-app-surfaceRaised p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">Visible Models</h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-bg hover:text-app-text disabled:opacity-60"
                      disabled={busy || visibleAssetIds.length === 0}
                      onClick={() => void exportVisiblePackage()}
                      type="button"
                    >
                      <PackagePlus aria-hidden="true" size={16} />
                      Export Package
                    </button>
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-bg hover:text-app-text disabled:opacity-60"
                      disabled={visibleAssetIds.length === 0}
                      onClick={clearVisibleModels}
                      type="button"
                    >
                      <EyeOff aria-hidden="true" size={16} />
                      Clear
                    </button>
                  </div>
                </div>
                {visibleAssetIds.length ? (
                  <div className="grid gap-2">
                    {visibleAssetIds.map((assetId) => {
                      const preview = visibleModelPreviews[assetId];
                      const label =
                        preview?.asset?.label ?? preview?.model?.fileName ?? assetId;
                      return (
                        <div
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-app-border/70 bg-app-bg px-2 py-2 text-sm"
                          key={assetId}
                        >
                          <span className="min-w-0 truncate">{label}</span>
                          <button
                            aria-label={`Remove ${label} from viewport`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-app-border text-app-muted hover:bg-app-surface hover:text-app-text"
                            onClick={() => void toggleVisibleAsset(assetId)}
                            title="Remove from viewport"
                            type="button"
                          >
                            <Minus aria-hidden="true" size={16} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-app-muted">
                    No visible models.
                  </p>
                )}
              </div>

              <CreatorModelViewport
                busy={
                  visibleAssetIds.length ? visibleModelBusyIds.length > 0 : modelBusy
                }
                error={visibleAssetIds.length ? visibleError : modelError}
                preview={modelPreview}
                previews={visibleAssetIds.length ? visiblePreviews : undefined}
              />

              <div className="grid gap-3">
                <h3 className="font-semibold">Dependency Hints</h3>
                {detail?.dependencies.length ? (
                  <div className="grid gap-2">
                    {detail.dependencies.slice(0, 6).map((dependency) => (
                      <div
                        className="rounded-md border border-app-border bg-app-surfaceRaised p-3 text-sm"
                        key={`${dependency.relation}-${dependency.toObjectPath ?? dependency.toPackagePath ?? dependency.toVirtualPath}`}
                      >
                        <div className="font-medium">{dependency.relation}</div>
                        <div className="mt-1 break-words font-mono text-xs text-app-muted [overflow-wrap:anywhere]">
                          {dependency.toObjectPath ??
                            dependency.toPackagePath ??
                            dependency.toVirtualPath ??
                            dependency.objectPath ??
                            dependency.packagePath ??
                            "unknown"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-app-muted">
                    No dependency metadata is indexed for this asset.
                  </p>
                )}
              </div>

              <div className="grid gap-3">
                <h3 className="font-semibold">Conflict Graph</h3>
                {detail?.conflicts.length ? (
                  <div className="grid gap-2">
                    {detail.conflicts.map((conflict) => (
                      <div
                        className="rounded-md border border-app-border bg-app-surfaceRaised p-3"
                        key={conflict.targetKey}
                      >
                        <div className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                          {conflict.targetObjectPath ??
                            conflict.targetPackagePath ??
                            conflict.targetKey}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-app-muted">
                          <span>
                            Base: {conflict.baseGamePresent ? "present" : "missing"}
                          </span>
                          <span>
                            Winner: {conflict.winnerPackageId ?? "none"}
                          </span>
                          <span>
                            Effects: {conflict.loadOrderEffects.length}
                          </span>
                        </div>
                        {conflict.targetVirtualPath ? (
                          <div className="mt-2 break-words font-mono text-xs text-app-muted [overflow-wrap:anywhere]">
                            {conflict.targetVirtualPath}
                          </div>
                        ) : null}
                        <div className="mt-2 grid gap-1">
                          {conflict.entries.map((entry) => (
                            <div
                              className="grid gap-2 rounded border border-app-border/70 p-2 text-xs text-app-muted"
                              key={`${entry.packageId}-${entry.packageVersion}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span>
                                  {entry.packageName}{" "}
                                  {entry.enabled ? "enabled" : "installed"} / order{" "}
                                  {entry.profileOrder ?? "none"}
                                </span>
                                {entry.isWinner ? (
                                  <span className="inline-flex items-center gap-1 text-app-success">
                                    <CheckCircle2 aria-hidden="true" size={14} />
                                    Winner
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span>{entry.deploymentRoute}</span>
                                <span>{entry.validationState}</span>
                                <span>
                                  {entry.contributesReplacement
                                    ? "replacement"
                                    : "metadata"}
                                </span>
                              </div>
                              <RuleList
                                label="Dependencies"
                                values={entry.dependencies.map((dependency) =>
                                  dependency.version
                                    ? `${dependency.id}@${dependency.version}`
                                    : dependency.id
                                )}
                              />
                              <RuleList
                                label="Explicit conflicts"
                                values={entry.explicitConflicts}
                              />
                              <RuleList label="Load after" values={entry.loadAfter} />
                              <RuleList label="Load before" values={entry.loadBefore} />
                              <RuleList
                                label="Load-order effects"
                                values={entry.loadOrderEffects.map(
                                  (effect) => effect.code
                                )}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-app-muted">
                    No active replacement conflict is indexed for this asset.
                  </p>
                )}
              </div>

              <div className="grid gap-3">
                <h3 className="font-semibold">Safe Actions</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text disabled:opacity-60"
                    disabled={busy}
                    onClick={() => void planExport(selected.id, "assetIndex")}
                    type="button"
                  >
                    <Download aria-hidden="true" size={16} />
                    Plan Index Export
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text disabled:opacity-60"
                    disabled={busy}
                    onClick={() =>
                      void planExport(selected.id, "conflictReport")
                    }
                    type="button"
                  >
                    <ShieldCheck aria-hidden="true" size={16} />
                    Plan Conflict Report
                  </button>
                  {reportActions.map((action) => (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text disabled:opacity-60"
                      disabled={busy}
                      key={action.output}
                      onClick={() => void copyReport(selected.id, action.output)}
                      type="button"
                    >
                      {action.output === "assetIndex" ||
                      action.output === "dependencyGraph" ? (
                        <FileJson aria-hidden="true" size={16} />
                      ) : (
                        <Clipboard aria-hidden="true" size={16} />
                      )}
                      {action.label}
                    </button>
                  ))}
                  {meshExportActions.map((action) => (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text disabled:opacity-60"
                      disabled={busy}
                      key={action.format}
                      onClick={() =>
                        void exportMesh(selected.id, action.format)
                      }
                      type="button"
                    >
                      <Download aria-hidden="true" size={16} />
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>

              {exportPlan ? (
                <div className="rounded-md border border-app-border bg-app-surfaceRaised p-3 text-sm">
                  <div className="font-medium">
                    Export plan: {exportPlan.status}
                  </div>
                  <div className="mt-1 text-app-muted">
                    {exportPlan.items[0]?.reason ??
                      `${exportPlan.items.length} item ready for ${exportPlan.output}.`}
                  </div>
                </div>
              ) : null}

              {meshExport ? (
                <div className="rounded-md border border-app-border bg-app-surfaceRaised p-3 text-sm">
                  <div className="font-medium">
                    Mesh export: {meshExport.status}
                  </div>
                  <div className="mt-1 break-words text-app-muted [overflow-wrap:anywhere]">
                    {meshExport.destinationPath ??
                      meshExport.problems[0]?.message ??
                      `${meshExport.format} export did not write a file.`}
                  </div>
                </div>
              ) : null}

              {meshPackageExport ? (
                <div className="rounded-md border border-app-border bg-app-surfaceRaised p-3 text-sm">
                  <div className="font-medium">
                    Package export: {meshPackageExport.status}
                  </div>
                  <div className="mt-1 break-words text-app-muted [overflow-wrap:anywhere]">
                    {meshPackageExport.destinationPath ??
                      meshPackageExport.problems[0]?.message ??
                      `${meshPackageExport.exportedCount}/${meshPackageExport.itemCount} files exported.`}
                  </div>
                </div>
              ) : null}

              {mappingsDump ? (
                <div className="rounded-md border border-app-border bg-app-surfaceRaised p-3 text-sm">
                  <div className="font-medium">
                    Mappings: {mappingsDump.status}
                  </div>
                  <div className="mt-1 break-words text-app-muted [overflow-wrap:anywhere]">
                    {mappingsDump.mappingsPath ??
                      mappingsDump.evidencePath ??
                      mappingsDump.problems[0]?.message ??
                      "Mappings generation did not produce a file."}
                  </div>
                </div>
              ) : null}

              {report ? (
                <div className="rounded-md border border-app-border bg-app-surfaceRaised p-3 text-sm">
                  <div className="font-medium">Report: {report.status}</div>
                  <div className="mt-1 break-words text-app-muted [overflow-wrap:anywhere]">
                    {report.fileName}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-[320px] items-center justify-center text-center text-sm text-app-muted">
              Select an indexed asset.
            </div>
          )}
        </div>
      </section>

    </div>
  );
}

function Metric({
  icon,
  label,
  value
}: {
  icon: ReactElement;
  label: string;
  value: number;
}): ReactElement {
  return (
    <div className="rounded-lg border border-app-border bg-app-surface p-4">
      <div className="flex items-center gap-2 text-app-muted">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold">{formatNumber(value)}</div>
    </div>
  );
}

function MappingsProgressPanel({
  progress,
  required
}: {
  progress: CreatorMappingsDumpProgress | null;
  required: boolean;
}): ReactElement {
  const message =
    progress?.message ??
    (required
      ? "A Clawed .usmap mapping file is required before cooked Unreal models can be decoded."
      : "Mappings generation has not started.");
  const detail =
    progress?.detail ??
    progress?.mappingsPath ??
    progress?.evidencePath ??
    null;
  const tone =
    progress?.status === "failed" || progress?.status === "blocked"
      ? "text-app-warning"
      : progress?.status === "done"
        ? "text-app-success"
        : "text-app-accent";

  return (
    <section className="rounded-lg border border-app-border bg-app-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <MappingStepIcon
            className={`mt-0.5 ${tone}`}
            state={
              progress?.status === "failed"
                ? "failed"
                : progress?.status === "blocked"
                  ? "blocked"
                  : progress?.status === "running"
                    ? "active"
                    : progress?.status === "done"
                      ? "done"
                      : "pending"
            }
          />
          <div className="min-w-0">
            <h2 className="font-semibold">Unreal Mappings</h2>
            <p className="mt-1 break-words text-sm text-app-muted [overflow-wrap:anywhere]">
              {message}
            </p>
            {detail ? (
              <p className="mt-1 break-words font-mono text-xs text-app-subtle [overflow-wrap:anywhere]">
                {detail}
              </p>
            ) : null}
          </div>
        </div>
        {progress ? (
          <span className={`rounded bg-app-bg px-2 py-1 text-xs font-semibold ${tone}`}>
            {progress.status}
          </span>
        ) : null}
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-7">
        {mappingProcessSteps.map((step) => {
          const state = mappingStepState(step.stage, progress);
          return (
            <li
              className={`min-w-0 rounded-md border p-3 ${
                state === "active"
                  ? "border-app-accent/60 bg-app-accent/10"
                  : state === "failed" || state === "blocked"
                    ? "border-app-warning/60 bg-app-warning/10"
                    : state === "done"
                      ? "border-app-success/50 bg-app-success/10"
                      : "border-app-border bg-app-surfaceRaised"
              }`}
              key={step.stage}
            >
              <div className="flex items-center gap-2">
                <MappingStepIcon state={state} />
                <span className="truncate text-sm font-semibold">
                  {step.label}
                </span>
              </div>
              <p className="mt-1 text-xs text-app-muted">{step.detail}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function MappingStepIcon({
  className = "",
  state
}: {
  className?: string;
  state: "active" | "blocked" | "done" | "failed" | "pending";
}): ReactElement {
  if (state === "active") {
    return (
      <Loader2
        aria-hidden="true"
        className={`shrink-0 animate-spin text-app-accent ${className}`}
        size={16}
      />
    );
  }
  if (state === "done") {
    return (
      <CheckCircle2
        aria-hidden="true"
        className={`shrink-0 text-app-success ${className}`}
        size={16}
      />
    );
  }
  if (state === "failed" || state === "blocked") {
    return (
      <AlertTriangle
        aria-hidden="true"
        className={`shrink-0 text-app-warning ${className}`}
        size={16}
      />
    );
  }
  return (
    <Circle
      aria-hidden="true"
      className={`shrink-0 text-app-subtle ${className}`}
      size={16}
    />
  );
}

function mappingStepState(
  stage: CreatorMappingsDumpProgressStage,
  progress: CreatorMappingsDumpProgress | null
): "active" | "blocked" | "done" | "failed" | "pending" {
  if (!progress) {
    return "pending";
  }
  if (progress.stage === "complete" && progress.status === "done") {
    return "done";
  }
  const currentIndex = mappingProcessSteps.findIndex(
    (step) => step.stage === progress.stage
  );
  const stepIndex = mappingProcessSteps.findIndex((step) => step.stage === stage);
  if (currentIndex === -1) {
    return "pending";
  }
  if (stepIndex < currentIndex) {
    return "done";
  }
  if (stepIndex > currentIndex) {
    return "pending";
  }
  if (progress.status === "failed") {
    return "failed";
  }
  if (progress.status === "blocked") {
    return "blocked";
  }
  return progress.status === "done" ? "done" : "active";
}

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange(value: string): void;
  options: Array<{ value: string; label: string }>;
  value: string;
}): ReactElement {
  return (
    <select
      aria-label={label}
      className="h-10 min-w-0 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-sm text-app-text"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function TreeNodeRow({
  busyNodeIds,
  depth = 0,
  expandedNodeIds,
  node,
  nodesByParentId,
  onToggle,
  onVisibilityToggle,
  selectedAssetId,
  visibleAssetIds
}: {
  busyNodeIds: string[];
  depth?: number;
  expandedNodeIds: string[];
  node: CreatorAssetTreeNode;
  nodesByParentId: Record<string, CreatorAssetTreeNode[]>;
  onToggle(node: CreatorAssetTreeNode): void;
  onVisibilityToggle(assetId: string): void;
  selectedAssetId: string | null;
  visibleAssetIds: string[];
}): ReactElement {
  const expanded = expandedNodeIds.includes(node.id);
  const busy = busyNodeIds.includes(treeParentKey(node.id));
  const children = nodesByParentId[treeParentKey(node.id)] ?? [];
  const selected = node.assetId === selectedAssetId;
  const viewable = node.kind === "asset" && node.viewportState === "viewable";
  const visible = Boolean(node.assetId && visibleAssetIds.includes(node.assetId));

  return (
    <div>
      <div
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md text-sm ${
          selected
            ? "bg-app-accent/15 text-app-text"
            : "text-app-muted hover:bg-app-surfaceRaised hover:text-app-text"
        }`}
      >
        <button
          aria-expanded={node.hasChildren ? expanded : undefined}
          aria-pressed={node.kind === "asset" ? selected : undefined}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-left"
          onClick={() => onToggle(node)}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          type="button"
        >
          <span className="flex items-center gap-1">
            {node.hasChildren ? (
              expanded ? (
                <ChevronDown aria-hidden="true" size={16} />
              ) : (
                <ChevronRight aria-hidden="true" size={16} />
              )
            ) : (
              <span className="w-4" />
            )}
            <TreeIcon expanded={expanded} node={node} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{node.label}</span>
            {node.kind === "asset" ? (
              <span className="mt-0.5 block truncate font-mono text-[11px] text-app-subtle">
                {node.path}
              </span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-app-subtle">
            {busy ? <span>Loading</span> : null}
            {node.kind === "asset" ? (
              <span>{nodeStatusLabel(node)}</span>
            ) : (
              <span>{formatNumber(node.childCount)}</span>
            )}
          </span>
        </button>
        {viewable && node.assetId ? (
          <button
            aria-label={`${visible ? "Remove" : "Add"} ${node.label} ${
              visible ? "from" : "to"
            } viewport`}
            aria-pressed={visible}
            className={`mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-app-border ${
              visible
                ? "bg-app-accent/15 text-app-accent"
                : "text-app-muted hover:bg-app-bg hover:text-app-text"
            }`}
            onClick={() => onVisibilityToggle(node.assetId as string)}
            title={visible ? "Remove from viewport" : "Add to viewport"}
            type="button"
          >
            {visible ? (
              <EyeOff aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
          </button>
        ) : null}
      </div>
      {expanded && children.length ? (
        <div className="grid gap-1">
          {children.map((child) => (
            <TreeNodeRow
              busyNodeIds={busyNodeIds}
              depth={depth + 1}
              expandedNodeIds={expandedNodeIds}
              key={child.id}
              node={child}
              nodesByParentId={nodesByParentId}
              onToggle={onToggle}
              onVisibilityToggle={onVisibilityToggle}
              selectedAssetId={selectedAssetId}
              visibleAssetIds={visibleAssetIds}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TreeIcon({
  expanded,
  node
}: {
  expanded: boolean;
  node: CreatorAssetTreeNode;
}): ReactElement {
  if (node.kind === "root") {
    return <Box aria-hidden="true" size={16} />;
  }
  if (node.kind === "folder") {
    return expanded ? (
      <FolderOpen aria-hidden="true" size={16} />
    ) : (
      <Folder aria-hidden="true" size={16} />
    );
  }
  if (node.viewportState === "viewable") {
    return node.assetClass === "Skeleton" ? (
      <Bone aria-hidden="true" size={16} />
    ) : (
      <Cuboid aria-hidden="true" size={16} />
    );
  }
  return <File aria-hidden="true" size={16} />;
}

function nodeStatusLabel(node: CreatorAssetTreeNode): string {
  return (
    node.assetClass ??
    node.conflictState ??
    node.validationState ??
    node.exportState ??
    "asset"
  );
}

function StatusPill({
  entry
}: {
  entry: CreatorAssetIndexEntry;
}): ReactElement {
  const label =
    entry.conflictState === "winner"
      ? "Winner"
      : entry.conflictState === "conflicted"
        ? "Competing"
        : entry.conflictState === "overridden"
          ? "Overridden"
          : entry.activeProfileEnabled
            ? "Active"
            : "Indexed";
  const color =
    entry.conflictState === "winner"
      ? "text-app-success"
      : entry.conflictState === "conflicted" ||
          entry.conflictState === "overridden"
        ? "text-app-warning"
        : "text-app-muted";

  return (
    <span
      className={`shrink-0 rounded bg-app-bg px-2 py-1 text-xs font-medium ${color}`}
    >
      {label}
    </span>
  );
}

function RuleList({
  label,
  values
}: {
  label: string;
  values: string[];
}): ReactElement | null {
  if (!values.length) {
    return null;
  }

  return (
    <div className="min-w-0">
      <span className="font-semibold text-app-subtle">{label}: </span>
      <span className="break-words [overflow-wrap:anywhere]">
        {values.join(", ")}
      </span>
    </div>
  );
}

function Detail({
  label,
  mono,
  value
}: {
  label: string;
  mono?: boolean;
  value: string | null | undefined;
}): ReactElement | null {
  if (!value) {
    return null;
  }

  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-app-subtle">
        {label}
      </dt>
      <dd
        className={`mt-1 break-words text-app-muted [overflow-wrap:anywhere] ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function sourceLabel(entry: CreatorAssetIndexEntry): string {
  if (entry.source === "baseGameMap") {
    return "Clawed map";
  }
  if (entry.source === "installedPackage") {
    return "Package manifest";
  }
  if (entry.source === "packagePayload") {
    return "Package payload";
  }
  return "Deployment";
}

function sourceLocation(entry: CreatorAssetIndexEntry): string {
  return (
    entry.relativePath ??
    entry.payloadPath ??
    entry.objectPath ??
    entry.packagePath ??
    entry.virtualPath ??
    entry.containerName ??
    "indexed metadata"
  );
}

function canShowEntryInViewport(entry: CreatorAssetIndexEntry): boolean {
  return (
    entry.viewportState === "viewable" ||
    ["StaticMesh", "SkeletalMesh", "Skeleton", "ModelPreview"].includes(
      entry.assetClass ?? ""
    ) ||
    [".obj", ".gltf", ".glb"].includes((entry.extension ?? "").toLowerCase())
  );
}

function uniqueProblems(problems: ModProblem[]): ModProblem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = problemKey(problem);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function problemKey(problem: ModProblem): string {
  return [
    problem.severity,
    problem.code,
    problem.message,
    problem.technicalDetail ?? ""
  ].join("\0");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
