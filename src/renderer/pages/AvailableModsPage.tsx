import {
  AlertTriangle,
  CheckCircle2,
  Download,
  PackageCheck,
  RefreshCw,
  Search,
  Server,
  Users
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AvailableMod,
  AvailableModCatalog,
  AvailableModInstallScope,
  ImportModPackageResult,
  ModProblem,
  PackageIdentityReplacementRequest
} from "../../shared/contracts/app";
import { ModalDialog } from "../components/ModalDialog";
import { ProblemDetails } from "../components/ProblemDetails";
import { useAppStore } from "../stores/appStore";

type PendingIdentityReplacement = {
  mod: AvailableMod;
  result: ImportModPackageResult;
};

function installResultMessage(
  mod: AvailableMod,
  result: ImportModPackageResult
): string {
  if (result.status === "installed") {
    return `Installed ${result.mod?.name ?? mod.name}.`;
  }
  if (result.status === "alreadyInstalled") {
    return `${mod.name} is already installed.`;
  }
  if (result.status === "duplicateDifferentHash") {
    return `${mod.name} has the same ID and version as an installed package, but the bundled file is different.`;
  }
  if (result.status === "needsReplacementConfirmation") {
    return `${mod.name} matches an installed package identity.`;
  }
  return `${mod.name} was not installed.`;
}

function scopeContent(scope: AvailableModInstallScope): {
  icon: ReactNode;
  label: string;
  className: string;
} {
  if (scope === "hostOnly") {
    return {
      icon: <Server aria-hidden="true" size={15} />,
      label: "Host PC only",
      className: "border-app-warning/50 bg-app-warning/10 text-app-warning"
    };
  }

  return {
    icon: <Users aria-hidden="true" size={15} />,
    label: "Everyone's PC",
    className: "border-app-accent/50 bg-app-accent/10 text-app-accent"
  };
}

function actionLabel(mod: AvailableMod): string {
  if (mod.installState === "installed") {
    return "Installed";
  }
  if (mod.installState === "sameIdentityInstalled") {
    return "Replace";
  }
  if (mod.installState === "duplicateDifferentHash") {
    return "Review";
  }
  return "Install";
}

function emptyGroupText(category: AvailableMod["category"]): string {
  return category === "release"
    ? "No official release mods were found."
    : "No prototype mods were found.";
}

export function AvailableModsPage(): ReactElement {
  const bumpProfileRevision = useAppStore((state) => state.bumpProfileRevision);
  const [catalog, setCatalog] = useState<AvailableModCatalog | null>(null);
  const [search, setSearch] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<ModProblem[]>([]);
  const [pendingReplacement, setPendingReplacement] =
    useState<PendingIdentityReplacement | null>(null);
  const hasErrorProblems = problems.some(
    (problem) => problem.severity === "error"
  );

  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      const nextCatalog = await window.cmm.listAvailableMods();
      setCatalog(nextCatalog);
      setProblems(nextCatalog.problems);
      setMessage(null);
    } catch (error) {
      setMessage("Available mods are unavailable.");
      setProblems([
        {
          severity: "error",
          code: "AVAILABLE_MODS_UNAVAILABLE",
          message: "CMM could not load the bundled mod catalog.",
          technicalDetail: error instanceof Error ? error.message : String(error)
        }
      ]);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const filteredGroups = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (catalog?.groups ?? []).map((group) => ({
      ...group,
      mods: group.mods.filter((mod) => {
        if (!normalizedSearch) {
          return true;
        }
        return [
          mod.name,
          mod.id,
          mod.author,
          mod.version,
          mod.description,
          mod.loader,
          mod.fileName
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      })
    }));
  }, [catalog, search]);

  const installMod = async (
    mod: AvailableMod,
    replacement?: PackageIdentityReplacementRequest
  ): Promise<void> => {
    setBusyKey(mod.key);
    try {
      const response = await window.cmm.installAvailableMod({
        key: mod.key,
        replacement
      });
      setCatalog(response.catalog);
      setMessage(installResultMessage(mod, response.result));
      setProblems(response.result.problems);

      if (
        response.result.status === "needsReplacementConfirmation" &&
        response.result.packageIdentityId
      ) {
        setPendingReplacement({ mod, result: response.result });
        return;
      }

      setPendingReplacement(null);
      if (
        response.result.status === "installed" ||
        response.result.status === "alreadyInstalled"
      ) {
        bumpProfileRevision();
      }
    } catch (error) {
      setMessage(`${mod.name} was not installed.`);
      setProblems([
        {
          severity: "error",
          code: "AVAILABLE_MOD_INSTALL_FAILED",
          message: "CMM could not install the bundled mod.",
          technicalDetail: error instanceof Error ? error.message : String(error)
        }
      ]);
    } finally {
      setBusyKey(null);
    }
  };

  const confirmIdentityReplacement = async (): Promise<void> => {
    const pending = pendingReplacement;
    const packageIdentityId = pending?.result.packageIdentityId;
    if (!pending || !packageIdentityId) {
      return;
    }

    await installMod(pending.mod, {
      action: "replaceMatchingIdentity",
      packageIdentityId
    });
  };

  const cancelIdentityReplacement = (): void => {
    setPendingReplacement(null);
    setMessage("Install cancelled.");
    setProblems([
      {
        severity: "info",
        code: "AVAILABLE_MOD_REPLACEMENT_CANCELLED",
        message: "Bundled mod install was cancelled before replacing installed mods."
      }
    ]);
  };

  const replacementCandidates =
    pendingReplacement?.result.replacementCandidates ?? [];
  const replacementDetail = pendingReplacement
    ? replacementCandidates.length === 1
      ? "One installed mod version has the same package identity."
      : `${replacementCandidates.length} installed mod versions have the same package identity.`
    : undefined;

  const replacementDialog = pendingReplacement ? (
    <ModalDialog
      describedById="available-mod-replacement-description"
      description="Display names are not used for this replacement decision."
      labelledById="available-mod-replacement-title"
      title="Replace Installed Mod?"
    >
      <div className="mt-5 grid gap-4">
        {replacementDetail ? (
          <p className="break-all text-sm text-app-muted">
            {replacementDetail}
          </p>
        ) : null}
        <ProblemDetails problems={pendingReplacement.result.problems} />
        {replacementCandidates.length ? (
          <div>
            <h3 className="text-sm font-semibold">Matching Installed Mods</h3>
            <ul className="mt-2">
              {replacementCandidates.map((candidate) => (
                <li
                  className="grid gap-1 border-t border-app-border py-3 text-sm first:border-t-0"
                  key={`${candidate.id}-${candidate.version}`}
                >
                  <span className="font-medium text-app-text">
                    {candidate.name}
                  </span>
                  <span className="break-all font-mono text-xs text-app-muted">
                    {candidate.id} / {candidate.version}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            disabled={busyKey !== null}
            onClick={cancelIdentityReplacement}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busyKey !== null}
            onClick={() => void confirmIdentityReplacement()}
            type="button"
          >
            Replace Matching Mods
          </button>
        </div>
      </div>
    </ModalDialog>
  ) : null;

  return (
    <div className="flex flex-1 flex-col gap-5">
      {replacementDialog}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-app-accent">Bundled Catalog</p>
          <h1 className="mt-1 text-3xl font-semibold">Available Mods</h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            Install CMM-packaged official release and prototype mods into the
            local library without finding files manually.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
          disabled={busyKey !== null}
          onClick={() => void loadCatalog()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          Refresh
        </button>
      </header>

      <section className="grid gap-3 rounded-lg border border-app-border bg-app-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1 text-sm">
            <span className="font-medium text-app-text">
              {catalog
                ? `${catalog.totals.available} bundled mods`
                : "Loading bundled mods"}
            </span>
            <span className="text-app-muted">
              {catalog
                ? `${catalog.totals.release} release, ${catalog.totals.prototype} prototype, ${catalog.totals.installed} installed`
                : "Scanning official release and prototype folders"}
            </span>
          </div>
          <label className="relative w-full sm:w-72">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-2.5 text-app-subtle"
              size={18}
            />
            <span className="sr-only">Search available mods</span>
            <input
              className="h-10 w-full rounded-md border border-app-border bg-app-surfaceRaised pl-10 pr-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search available mods"
              value={search}
            />
          </label>
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
        </section>
      ) : null}

      <section className="grid gap-5">
        {filteredGroups.map((group) => (
          <div className="grid gap-3" key={group.category}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">{group.title}</h2>
              <span className="text-sm text-app-muted">
                {group.mods.length} mod{group.mods.length === 1 ? "" : "s"}
              </span>
            </div>

            {group.mods.length === 0 ? (
              <div className="rounded-lg border border-app-border bg-app-surface p-5 text-sm text-app-muted">
                {emptyGroupText(group.category)}
              </div>
            ) : (
              <div className="grid gap-3">
                {group.mods.map((mod) => {
                  const scope = scopeContent(mod.installScope);
                  const installed = mod.installState === "installed";
                  const busy = busyKey === mod.key;

                  return (
                    <article
                      aria-label={`${mod.name} ${mod.version}`}
                      className="rounded-lg border border-app-border bg-app-surface p-4"
                      key={mod.key}
                    >
                      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold">
                              {mod.name}
                            </h3>
                            <span className="rounded bg-app-surfaceRaised px-2 py-1 text-xs uppercase text-app-muted">
                              {mod.loader}
                            </span>
                            <span className="rounded bg-app-surfaceRaised px-2 py-1 text-xs text-app-muted">
                              {mod.category === "release"
                                ? "Official"
                                : "Prototype"}
                            </span>
                            <span
                              aria-label={`Install scope: ${scope.label}`}
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold ${scope.className}`}
                            >
                              {scope.icon}
                              {scope.label}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-app-muted">
                            Version {mod.version} by {mod.author}
                          </div>
                          <p className="mt-2 max-w-3xl text-sm text-app-muted">
                            {mod.description}
                          </p>
                          {mod.installState === "sameIdentityInstalled" ? (
                            <p className="mt-2 text-sm text-app-warning">
                              A mod with the same package identity is already
                              installed.
                            </p>
                          ) : null}
                          {mod.installState === "duplicateDifferentHash" ? (
                            <p className="mt-2 text-sm text-app-warning">
                              A same-version mod is installed, but this bundled
                              file has a different hash.
                            </p>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                          <button
                            className={`inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60 ${
                              installed
                                ? "border border-app-border text-app-muted"
                                : "bg-app-accent text-app-accentText"
                            }`}
                            disabled={busyKey !== null || installed}
                            onClick={() => void installMod(mod)}
                            type="button"
                          >
                            {installed ? (
                              <PackageCheck aria-hidden="true" size={17} />
                            ) : busy ? (
                              <RefreshCw aria-hidden="true" size={17} />
                            ) : (
                              <Download aria-hidden="true" size={17} />
                            )}
                            {busy ? "Installing" : actionLabel(mod)}
                          </button>
                        </div>
                      </div>

                      {mod.problems.length ? (
                        <div className="mt-4">
                          <ProblemDetails problems={mod.problems} />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </section>

      {catalog?.problems.length ? (
        <section className="rounded-lg border border-app-warning/40 bg-app-warning/10 p-4">
          <div className="mb-3 flex items-center gap-2 font-medium text-app-warning">
            <AlertTriangle aria-hidden="true" size={18} />
            Some bundled packages could not be listed.
          </div>
          <ProblemDetails problems={catalog.problems} />
        </section>
      ) : null}

      {catalog && catalog.totals.available === 0 ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-8 text-center">
          <CheckCircle2
            aria-hidden="true"
            className="mx-auto text-app-muted"
            size={24}
          />
          <h2 className="mt-3 text-lg font-semibold">No Bundled Mods Found</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-app-muted">
            CMM did not find .clawedmod packages in the official release or
            prototype mod folders.
          </p>
        </section>
      ) : null}
    </div>
  );
}
