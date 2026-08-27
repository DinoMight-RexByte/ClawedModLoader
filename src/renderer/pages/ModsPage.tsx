import {
  AlertTriangle,
  BookOpen,
  FolderOpen,
  PackagePlus,
  Search,
  Trash2
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ClawedModManifestV1,
  CreatorAssetMetadataV1,
  CreatorMetadataState,
  ImportModPackageResult,
  InstalledModVersion,
  ModLoader,
  ModOperationResult,
  PackageIdentityReplacementRequest,
  ModProblem
} from "../../shared/contracts/app";
import { ModalDialog } from "../components/ModalDialog";
import { ProblemDetails } from "../components/ProblemDetails";
import { useAppStore } from "../stores/appStore";

type EnabledFilter = "all" | "enabled" | "disabled";
type LoaderFilter = "all" | ModLoader;
type PendingIdentityReplacement = {
  packagePath: string;
  result: ImportModPackageResult;
};

function importResultMessage(result: ImportModPackageResult): string {
  if (result.status === "installed") {
    return `Mod package imported: ${result.mod?.name ?? "selected mod"}.`;
  }
  if (result.status === "alreadyInstalled") {
    return "That exact mod package is already installed.";
  }
  if (result.status === "duplicateDifferentHash") {
    return "A same-version package is installed, but the selected file is different.";
  }
  if (result.status === "needsReplacementConfirmation") {
    return "CMM found an installed mod with the same package identity.";
  }
  return "Import did not complete.";
}

function CreatorMetadataSummary({
  metadata,
  problems,
  state
}: {
  metadata: CreatorAssetMetadataV1 | null;
  problems: ModProblem[];
  state: CreatorMetadataState;
}): ReactElement {
  if (!metadata) {
    return (
      <div className="mt-4 border-t border-app-border pt-4">
        <h3 className="font-semibold">Creator Metadata</h3>
        <p className="mt-2 text-sm text-app-muted">
          State: {state === "missing" ? "Not declared" : state}
        </p>
        {problems.length ? (
          <div className="mt-3">
            <ProblemDetails problems={problems} />
          </div>
        ) : null}
      </div>
    );
  }

  const firstProvenance = metadata.importProvenance[0] ?? null;
  const sourceHashes = metadata.importProvenance.flatMap(
    (provenance) => provenance.sourceHashes
  );

  return (
    <div className="mt-4 grid gap-4 border-t border-app-border pt-4">
      <div>
        <h3 className="font-semibold">Creator Metadata</h3>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <CreatorStat label="Affected assets" value={metadata.affectedAssets.length} />
          <CreatorStat label="Replacements" value={metadata.replacements.length} />
          <CreatorStat
            label="Dependencies"
            value={metadata.assetDependencies.length}
          />
          <CreatorStat
            label="Preview assets"
            value={metadata.previewAssets.length}
          />
          <CreatorStat
            label="Export"
            value={metadata.exportEligibility.state}
          />
          <CreatorStat label="Cook target" value={formatCookTarget(metadata)} />
          <CreatorStat
            label="Steam builds"
            value={
              metadata.supportedSteamBuilds.length
                ? metadata.supportedSteamBuilds
                    .map((build) => `${build.buildId} ${build.status}`)
                    .join(", ")
                : "none declared"
            }
          />
          <CreatorStat
            label="Source"
            value={
              firstProvenance
                ? `${firstProvenance.sourceKind}${
                    firstProvenance.sourceName
                      ? ` / ${firstProvenance.sourceName}`
                      : ""
                  }`
                : "unknown"
            }
          />
        </div>
      </div>

      <CreatorList
        items={metadata.affectedAssets.slice(0, 4).map((asset) => ({
          id: asset.id,
          title: `${asset.role} / ${asset.assetClass}`,
          detail: firstText([
            asset.objectPath,
            asset.packagePath,
            asset.virtualPath,
            asset.payloadPath
          ])
        }))}
        title="Affected Assets"
      />

      <CreatorList
        items={metadata.replacements.slice(0, 4).map((replacement, index) => ({
          id: `${replacement.deploymentRoute}-${index}`,
          title: `${replacement.deploymentRoute} / ${replacement.validationState}`,
          detail: firstText([
            replacement.targetObjectPath,
            replacement.targetPackagePath,
            replacement.targetVirtualPath,
            replacement.replacementObjectPath,
            replacement.replacementPackagePath,
            replacement.replacementVirtualPath,
            replacement.payloadPaths.join(", ")
          ])
        }))}
        title="Replacements"
      />

      <CreatorList
        items={metadata.assetDependencies.slice(0, 4).map((dependency, index) => ({
          id: `${dependency.relation}-${index}`,
          title: `${dependency.relation}${
            dependency.required ? " / required" : ""
          }`,
          detail: firstText([
            dependency.fromObjectPath,
            dependency.fromPackagePath,
            dependency.fromVirtualPath,
            dependency.toObjectPath,
            dependency.toPackagePath,
            dependency.toVirtualPath,
            dependency.objectPath,
            dependency.packagePath
          ])
        }))}
        title="Dependency Paths"
      />

      <CreatorList
        items={sourceHashes.slice(0, 4).map((hash, index) => ({
          id: `${hash.scope}-${index}`,
          title: `${hash.scope} / ${hash.algorithm}`,
          detail: `${hash.path ? `${hash.path} / ` : ""}${hash.sha256}`
        }))}
        title="Source Hashes"
      />
    </div>
  );
}

function CreatorStat({
  label,
  value
}: {
  label: string;
  value: number | string;
}): ReactElement {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase text-app-subtle">
        {label}
      </div>
      <div className="mt-1 break-words text-app-muted">{value}</div>
    </div>
  );
}

function CreatorList({
  items,
  title
}: {
  items: Array<{ id: string; title: string; detail?: string }>;
  title: string;
}): ReactElement | null {
  if (!items.length) {
    return null;
  }

  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-2 grid gap-2 text-sm text-app-muted">
        {items.map((item) => (
          <div className="min-w-0" key={item.id}>
            <div className="font-medium text-app-text">{item.title}</div>
            {item.detail ? (
              <div className="mt-1 break-all font-mono text-xs">
                {item.detail}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatCookTarget(metadata: CreatorAssetMetadataV1): string {
  return metadata.cookTarget
    ? `${metadata.cookTarget.unrealVersion} / ${metadata.cookTarget.containerFormat}`
    : "not declared";
}

function firstText(values: Array<string | undefined | null>): string | undefined {
  return values.find((value): value is string => Boolean(value));
}

export function ModsPage(): ReactElement {
  const profileRevision = useAppStore((state) => state.profileRevision);
  const bumpProfileRevision = useAppStore((state) => state.bumpProfileRevision);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const [mods, setMods] = useState<InstalledModVersion[]>([]);
  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [loaderFilter, setLoaderFilter] = useState<LoaderFilter>("all");
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [problems, setProblems] = useState<ModProblem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingReplacement, setPendingReplacement] =
    useState<PendingIdentityReplacement | null>(null);
  const [selectedMod, setSelectedMod] = useState<InstalledModVersion | null>(
    null
  );
  const [selectedManifest, setSelectedManifest] =
    useState<ClawedModManifestV1 | null>(null);
  const [creatorMetadataState, setCreatorMetadataState] =
    useState<CreatorMetadataState>("missing");
  const [creatorMetadataProblems, setCreatorMetadataProblems] = useState<
    ModProblem[]
  >([]);
  const [readme, setReadme] = useState<string | null>(null);
  const hasErrorProblems = problems.some(
    (problem) => problem.severity === "error"
  );
  const canOpenAvailableMods = problems.some((problem) =>
    [
      "UNREAL_SOURCE_PLUGIN_UNSUPPORTED",
      "ZIP_PAYLOAD_NOT_RECOGNIZED",
      "EXTERNAL_IMPORT_UNSUPPORTED"
    ].includes(problem.code)
  );

  const refreshMods = useCallback(async () => {
    const snapshot = await window.cmm.listInstalledMods();
    setMods(snapshot.mods);
  }, []);

  useEffect(() => {
    void refreshMods();
  }, [profileRevision, refreshMods]);

  const filteredMods = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return mods.filter((mod) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        [mod.name, mod.id, mod.author, mod.version, mod.loader]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesEnabled =
        enabledFilter === "all" ||
        (enabledFilter === "enabled" && mod.enabled) ||
        (enabledFilter === "disabled" && !mod.enabled);
      const matchesLoader =
        loaderFilter === "all" || mod.loader === loaderFilter;

      return matchesSearch && matchesEnabled && matchesLoader;
    });
  }, [enabledFilter, loaderFilter, mods, search]);

  const handleImportResult = async (
    result: ImportModPackageResult,
    packagePath?: string
  ) => {
    setMessage(importResultMessage(result));
    setProblems(result.problems);

    if (
      result.status === "needsReplacementConfirmation" &&
      packagePath &&
      result.packageIdentityId
    ) {
      setPendingReplacement({ packagePath, result });
      return;
    }

    setPendingReplacement(null);
    bumpProfileRevision();
    await refreshMods();
  };

  const chooseAndImport = async () => {
    setBusy(true);
    try {
      await handleImportResult(await window.cmm.chooseAndImportModPackage());
    } finally {
      setBusy(false);
    }
  };

  const importPackagePath = async (
    packagePath: string,
    replacement?: PackageIdentityReplacementRequest
  ): Promise<ImportModPackageResult> => {
    const result = await window.cmm.importExternalModPackage({
      packagePath,
      replacement
    });
    await handleImportResult(result, packagePath);
    return result;
  };

  const confirmIdentityReplacement = async () => {
    const pending = pendingReplacement;
    const packageIdentityId = pending?.result.packageIdentityId;
    if (!pending || !packageIdentityId) {
      return;
    }

    setBusy(true);
    try {
      await importPackagePath(pending.packagePath, {
        action: "replaceMatchingIdentity",
        packageIdentityId
      });
    } finally {
      setBusy(false);
    }
  };

  const cancelIdentityReplacement = () => {
    setPendingReplacement(null);
    setMessage("Import cancelled.");
    setProblems([
      {
        severity: "info",
        code: "PACKAGE_IDENTITY_REPLACEMENT_CANCELLED",
        message: "Mod import was cancelled before replacing installed mods."
      }
    ]);
  };

  const replacementCandidates = pendingReplacement?.result.replacementCandidates ?? [];

  const replacementDetail = pendingReplacement
    ? replacementCandidates.length === 1
      ? "One installed mod version has the same package identity."
      : `${replacementCandidates.length} installed mod versions have the same package identity.`
    : undefined;

  const replacementProblemDetails = pendingReplacement
    ? pendingReplacement.result.problems
    : [];

  const replacementCandidateList = replacementCandidates.map((candidate) => (
    <li
      className="grid gap-1 border-t border-app-border py-3 text-sm first:border-t-0"
      key={`${candidate.id}-${candidate.version}`}
    >
      <span className="font-medium text-app-text">{candidate.name}</span>
      <span className="break-all font-mono text-xs text-app-muted">
        {candidate.id} / {candidate.version}
      </span>
    </li>
  ));

  const replacementDialog = pendingReplacement ? (
    <ModalDialog
      describedById="mod-replacement-description"
      description="Display names are not used for this replacement decision."
      labelledById="mod-replacement-title"
      title="Replace Installed Mod?"
    >
      <div className="mt-5 grid gap-4">
        {replacementDetail ? (
          <p className="break-all text-sm text-app-muted">
            {replacementDetail}
          </p>
        ) : null}
        <ProblemDetails problems={replacementProblemDetails} />
        {replacementCandidateList.length ? (
          <div>
            <h3 className="text-sm font-semibold">Matching Installed Mods</h3>
            <ul className="mt-2">{replacementCandidateList}</ul>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            disabled={busy}
            onClick={cancelIdentityReplacement}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => void confirmIdentityReplacement()}
            type="button"
          >
            Replace Matching Mods
          </button>
        </div>
      </div>
    </ModalDialog>
  ) : null;

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    setBusy(true);

    try {
      const packagePaths = Array.from(event.dataTransfer.files)
        .map((file) => window.cmmFileDrops.getPathForFile(file))
        .filter((filePath): filePath is string => filePath !== null)
        .filter(isSupportedImportFile);

      if (packagePaths.length === 0) {
        setMessage(
          "Drop a .clawedmod, .zip, .pak, .utoc, .ucas, .rar, or .7z file to inspect it."
        );
        setProblems([]);
        return;
      }

      for (const packagePath of packagePaths) {
        const result = await importPackagePath(packagePath);
        if (result.status === "needsReplacementConfirmation") {
          break;
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const runModOperation = async (
    operation: () => Promise<ModOperationResult>
  ) => {
    setBusy(true);
    try {
      const result = await operation();
      setProblems(result.problems);
      setMessage(
        result.status === "ok"
          ? "Active profile updated."
          : "Action did not complete."
      );
      if (result.status === "ok") {
        bumpProfileRevision();
      }
      await refreshMods();
    } finally {
      setBusy(false);
    }
  };

  const inspectMod = async (mod: InstalledModVersion) => {
    const [manifestResult, readmeResult] = await Promise.all([
      window.cmm.inspectModManifest({ id: mod.id, version: mod.version }),
      window.cmm.readModReadme({ id: mod.id, version: mod.version })
    ]);

    setSelectedMod(mod);
    setSelectedManifest(manifestResult.manifest);
    setCreatorMetadataState(manifestResult.creatorMetadataState);
    setCreatorMetadataProblems(manifestResult.creatorMetadataProblems);
    setReadme(readmeResult.content);
    setProblems([
      ...manifestResult.problems,
      ...manifestResult.creatorMetadataProblems,
      ...readmeResult.problems
    ]);
  };

  return (
    <div className="flex flex-1 flex-col gap-5">
      {replacementDialog}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-app-accent">Mods</p>
          <h1 className="mt-1 text-3xl font-semibold">Local Mods</h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            Manage installed packages and the enabled state for the active
            profile.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => void chooseAndImport()}
          type="button"
        >
          <PackagePlus aria-hidden="true" size={18} />
          Import Mod
        </button>
      </header>

      <section
        aria-label="Drag and drop mod import area"
        className={`rounded-lg border border-dashed p-5 ${
          dragActive
            ? "border-app-accent bg-app-accent/10"
            : "border-app-border bg-app-surface"
        }`}
        onDragLeave={() => setDragActive(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDrop={(event) => void handleDrop(event)}
        tabIndex={0}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Import Mods</h2>
            <p className="mt-1 text-sm text-app-muted">
              Drop .clawedmod, ZIP, Pak, or IoStore files here. External
              packages are inspected and converted only when CMM recognizes a
              safe layout.
            </p>
          </div>
          <div className="text-sm text-app-muted">
            {mods.length} installed versions
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-lg border border-app-border bg-app-surface p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_160px_160px]">
          <label className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-2.5 text-app-subtle"
              size={18}
            />
            <span className="sr-only">Search mods</span>
            <input
              className="h-10 w-full rounded-md border border-app-border bg-app-surfaceRaised pl-10 pr-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search mods"
              value={search}
            />
          </label>

          <select
            aria-label="Enabled filter"
            className="h-10 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            onChange={(event) =>
              setEnabledFilter(event.target.value as EnabledFilter)
            }
            value={enabledFilter}
          >
            <option value="all">All states</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>

          <select
            aria-label="Loader filter"
            className="h-10 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            onChange={(event) =>
              setLoaderFilter(event.target.value as LoaderFilter)
            }
            value={loaderFilter}
          >
            <option value="all">All loaders</option>
            <option value="ue4ss">UE4SS</option>
            <option value="pak">Pak</option>
            <option value="loose">Loose</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </section>

      {message ? (
        <section
          className={`rounded-lg border p-4 ${
            hasErrorProblems
              ? "border-app-danger/40 bg-app-danger/10"
              : "border-app-border bg-app-surface"
          }`}
        >
          <div
            className={`flex items-center gap-2 font-medium ${
              hasErrorProblems ? "text-app-danger" : "text-app-text"
            }`}
          >
            {hasErrorProblems ? (
              <AlertTriangle
                aria-hidden="true"
                className="text-app-danger"
                size={18}
              />
            ) : null}
            {message}
          </div>
          <div className="mt-3">
            <ProblemDetails problems={problems} />
          </div>
          {canOpenAvailableMods ? (
            <button
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onClick={() => setActivePage("availableMods")}
              type="button"
            >
              <PackagePlus aria-hidden="true" size={17} />
              Open Available Mods
            </button>
          ) : null}
        </section>
      ) : null}

      {filteredMods.length === 0 ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-8 text-center">
          <h2 className="text-lg font-semibold">
            {mods.length === 0 ? "No mods installed" : "No mods match"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-app-muted">
            {mods.length === 0
              ? "Import a .clawedmod package or a recognized external mod file to add it to the shared local library."
              : "Adjust search text or filters to show more installed mods."}
          </p>
        </section>
      ) : (
        <section className="grid gap-3">
          {filteredMods.map((mod) => (
            <article
              aria-label={`${mod.name} ${mod.version}`}
              className="rounded-lg border border-app-border bg-app-surface p-4"
              key={`${mod.id}-${mod.version}`}
            >
              <div className="grid gap-4 lg:grid-cols-[64px_1fr_auto]">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-app-surfaceRaised">
                  {mod.iconDataUrl ? (
                    <img
                      alt=""
                      className="h-full w-full object-cover"
                      src={mod.iconDataUrl}
                    />
                  ) : (
                    <PackagePlus aria-hidden="true" size={24} />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{mod.name}</h2>
                    <span className="rounded bg-app-surfaceRaised px-2 py-1 text-xs uppercase text-app-muted">
                      {mod.loader}
                    </span>
                    {mod.problems.length ? (
                      <span className="rounded bg-app-warning/10 px-2 py-1 text-xs text-app-warning">
                        {mod.problems.length} problem
                        {mod.problems.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-sm text-app-muted">
                    Version {mod.version} by {mod.author}
                  </div>
                  <p className="mt-2 max-w-3xl text-sm text-app-muted">
                    {mod.description}
                  </p>
                </div>

                <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                  <button
                    aria-pressed={mod.enabled}
                    className={`h-9 rounded-md px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
                      mod.enabled
                        ? "bg-app-accent text-app-accentText"
                        : "border border-app-border text-app-muted hover:bg-app-surfaceRaised hover:text-app-text"
                    }`}
                    disabled={busy}
                    onClick={() =>
                      void runModOperation(() =>
                        window.cmm.setModEnabled({
                          id: mod.id,
                          version: mod.version,
                          enabled: !mod.enabled
                        })
                      )
                    }
                    type="button"
                  >
                    {mod.enabled ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                    onClick={() => void inspectMod(mod)}
                    type="button"
                  >
                    <BookOpen aria-hidden="true" size={16} />
                    Inspect
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                    onClick={() =>
                      void runModOperation(() =>
                        window.cmm.openModFolder({
                          id: mod.id,
                          version: mod.version
                        })
                      )
                    }
                    type="button"
                  >
                    <FolderOpen aria-hidden="true" size={16} />
                    Folder
                  </button>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-app-danger/40 px-3 text-sm font-semibold text-app-danger hover:bg-app-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger"
                    disabled={busy}
                    onClick={() =>
                      void runModOperation(() =>
                        window.cmm.uninstallMod({
                          id: mod.id,
                          version: mod.version
                        })
                      )
                    }
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                    Uninstall
                  </button>
                </div>
              </div>

              {mod.problems.length ? (
                <div className="mt-4">
                  <ProblemDetails problems={mod.problems} />
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}

      {selectedMod ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{selectedMod.name}</h2>
              <p className="mt-1 text-sm text-app-muted">
                {selectedMod.id} / {selectedMod.version}
              </p>
            </div>
            <button
              className="h-9 rounded-md border border-app-border px-3 text-sm text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onClick={() => setSelectedMod(null)}
              type="button"
            >
              Close
            </button>
          </div>

          <CreatorMetadataSummary
            metadata={selectedManifest?.creatorAssets ?? null}
            problems={creatorMetadataProblems}
            state={creatorMetadataState}
          />

          {selectedManifest ? (
            <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-app-surfaceRaised p-3 text-xs text-app-muted">
              {JSON.stringify(selectedManifest, null, 2)}
            </pre>
          ) : null}

          <div className="mt-4">
            <h3 className="font-semibold">README</h3>
            {readme ? (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-app-surfaceRaised p-3 text-sm text-app-muted">
                {readme}
              </pre>
            ) : (
              <p className="mt-2 text-sm text-app-muted">
                This mod did not include a README.
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function isSupportedImportFile(filePath: string): boolean {
  return [
    ".clawedmod",
    ".zip",
    ".pak",
    ".utoc",
    ".ucas",
    ".rar",
    ".7z"
  ].some((extension) => filePath.toLowerCase().endsWith(extension));
}
