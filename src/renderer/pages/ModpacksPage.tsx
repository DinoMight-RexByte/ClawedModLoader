import {
  AlertTriangle,
  Clipboard,
  FileArchive,
  PackageCheck,
  RefreshCw,
  Send,
  Share2
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  ModpackCompareResult,
  ModpackExportResult,
  ModpackHistoryEntry,
  ModpackImportResult,
  ModpackInspectResult,
  ModpackPackageInspection
} from "../../shared/contracts/app";
import { ProblemDetails } from "../components/ProblemDetails";
import { useAppStore } from "../stores/appStore";

function inspectionTone(status: ModpackPackageInspection["status"]): string {
  if (status === "hashMismatch" || status === "invalid") {
    return "bg-app-danger/10 text-app-danger";
  }
  if (status === "missing") {
    return "bg-app-warning/10 text-app-warning";
  }
  return "bg-app-success/10 text-app-success";
}

function inspectionLabel(status: ModpackPackageInspection["status"]): string {
  const labels: Record<ModpackPackageInspection["status"], string> = {
    hashMismatch: "Different files",
    installed: "Already have it",
    invalid: "Cannot use",
    missing: "Will install"
  };

  return labels[status];
}

function comparisonLabel(status: ModpackCompareResult["status"]): string {
  if (status === "MATCH") {
    return "Your profile matches this modpack.";
  }
  if (status === "DIFFERENT") {
    return "Your profile is different from this modpack.";
  }

  return "Comparison could not be completed.";
}

function exportMessage(result: ModpackExportResult): string {
  if (result.status === "exported") {
    return `Exported ${result.packageCount} packages.`;
  }
  if (result.status === "blocked") {
    return "Export was blocked.";
  }
  return "Export did not complete.";
}

function importMessage(result: ModpackImportResult): string {
  if (result.status === "imported") {
    return `Imported ${result.profile?.name ?? "profile"}.`;
  }
  if (result.status === "blocked") {
    return "Import was blocked.";
  }
  return "Import did not complete.";
}

export function ModpacksPage(): ReactElement {
  const profileRevision = useAppStore((state) => state.profileRevision);
  const bumpProfileRevision = useAppStore((state) => state.bumpProfileRevision);
  const [inspectResult, setInspectResult] =
    useState<ModpackInspectResult | null>(null);
  const [importResult, setImportResult] =
    useState<ModpackImportResult | null>(null);
  const [exportResult, setExportResult] =
    useState<ModpackExportResult | null>(null);
  const [compareResult, setCompareResult] =
    useState<ModpackCompareResult | null>(null);
  const [history, setHistory] = useState<ModpackHistoryEntry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    setHistory((await window.cmm.listRecentModpacks()).entries);
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [profileRevision, refreshHistory]);

  const inspectPath = async (modpackPath: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setImportResult(null);
    setCompareResult(null);

    try {
      const result = await window.cmm.inspectModpack({ modpackPath });
      setInspectResult(result);
      setMessage(
        result.status === "ok"
          ? "Modpack inspected."
          : "Modpack could not be imported safely."
      );
    } catch {
      setError("The modpack could not be inspected.");
    } finally {
      setBusy(false);
    }
  };

  const chooseAndInspect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setImportResult(null);
    setCompareResult(null);

    try {
      const result = await window.cmm.chooseAndInspectModpack();
      setInspectResult(result);
      setMessage(
        result.status === "ok"
          ? "Modpack inspected."
          : "Modpack could not be imported safely."
      );
    } catch {
      setError("The modpack could not be inspected.");
    } finally {
      setBusy(false);
    }
  };

  const exportCurrentProfile = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const result = await window.cmm.chooseAndExportCurrentProfileModpack();
      setExportResult(result);
      setMessage(exportMessage(result));
      await refreshHistory();
    } catch {
      setError("The current profile could not be exported.");
    } finally {
      setBusy(false);
    }
  };

  const importInspectedModpack = async (): Promise<void> => {
    if (!inspectResult) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await window.cmm.importModpack({
        modpackPath: inspectResult.modpackPath
      });
      setImportResult(result);
      setMessage(importMessage(result));
      if (result.status === "imported") {
        bumpProfileRevision();
      }
      await refreshHistory();
    } catch {
      setError("The modpack could not be imported.");
    } finally {
      setBusy(false);
    }
  };

  const compareInspectedModpack = async (): Promise<void> => {
    if (!inspectResult) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await window.cmm.compareCurrentProfileToModpack({
        modpackPath: inspectResult.modpackPath
      });
      setCompareResult(result);
      setMessage(comparisonLabel(result.status));
    } catch {
      setError("The comparison could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);

    const modpackPath = Array.from(event.dataTransfer.files)
      .map((file) => window.cmmFileDrops.getPathForFile(file))
      .find((filePath) => filePath?.toLowerCase().endsWith(".clawedpack"));

    if (!modpackPath) {
      setMessage("Drop a .clawedpack file.");
      return;
    }

    await inspectPath(modpackPath);
  };

  const copyReport = async (): Promise<void> => {
    if (!compareResult) {
      return;
    }

    await navigator.clipboard.writeText(compareResult.copyableReport);
    setMessage("Comparison copied.");
  };

  const acceptMissingMods = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const [profileResult, modpackResult] = await Promise.all([
        window.cmm.acceptMissingProfileMods(),
        window.cmm.acceptMissingModpackMods()
      ]);
      setHistory(modpackResult.history.entries);
      setMessage(
        `Accepted missing mods. Updated ${profileResult.profilesUpdated} profiles and ${modpackResult.entriesUpdated} modpack records.`
      );
      if (profileResult.profilesUpdated > 0) {
        bumpProfileRevision();
      }
    } catch {
      setError("Missing mods could not be accepted.");
    } finally {
      setBusy(false);
    }
  };

  const importProblems = importResult?.problems ?? [];
  const exportProblems = exportResult?.problems ?? [];
  const inspectProblems = inspectResult?.problems ?? [];
  const missingHistoryPackageCount = history.reduce(
    (total, entry) => total + entry.missingPackages.length,
    0
  );

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header>
        <p className="text-sm font-medium text-app-accent">Modpacks</p>
        <h1 className="mt-1 text-3xl font-semibold">Friend Modpacks</h1>
        <p className="mt-2 max-w-2xl text-sm text-app-muted">
          Import a friend's setup or share your current profile as a portable
          file that includes exact package bytes.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-2">
        <button
          className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => void chooseAndInspect()}
          type="button"
        >
          <FileArchive aria-hidden="true" size={18} />
          Import Friend's Modpack
        </button>
        <button
          className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => void exportCurrentProfile()}
          type="button"
        >
          <Share2 aria-hidden="true" size={18} />
          Share Current Profile
        </button>
      </section>

      <section
        aria-label="Drag and drop .clawedpack import area"
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
            <h2 className="text-base font-semibold">Drop .clawedpack</h2>
            <p className="mt-1 text-sm text-app-muted">
              The archive is inspected before packages are installed.
            </p>
          </div>
          <PackageCheck aria-hidden="true" className="text-app-muted" size={22} />
        </div>
      </section>

      {message || error ? (
        <section
          className={`rounded-lg border p-4 text-sm ${
            error
              ? "border-app-danger/40 bg-app-danger/10 text-app-danger"
              : "border-app-border bg-app-surface"
          }`}
          role={error ? "alert" : "status"}
        >
          <div className="font-medium">{error ?? message}</div>
        </section>
      ) : null}

      {missingHistoryPackageCount > 0 ? (
        <section
          className="rounded-lg border border-app-warning/40 bg-app-warning/10 p-4"
          role="status"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-app-warning">
                Missing Mods In Modpack Tracking
              </h2>
              <p className="mt-1 text-sm text-app-muted">
                Recent modpack records reference packages that are no longer in
                the local library. Accepting removes those missing package
                references from tracking.
              </p>
            </div>
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-app-warning/50 px-4 text-sm font-semibold text-app-warning hover:bg-app-warning/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
              disabled={busy}
              onClick={() => void acceptMissingMods()}
              type="button"
            >
              Accept Missing Mods
            </button>
          </div>
          <div className="mt-3 grid gap-2 text-sm">
            {history
              .filter((entry) => entry.missingPackages.length > 0)
              .map((entry) => (
                <div
                  className="rounded-md border border-app-border bg-app-surface p-3"
                  key={entry.id}
                >
                  <div className="font-medium">{entry.profileName}</div>
                  <div className="mt-1 text-app-muted">
                    {entry.missingPackages
                      .map((mod) => `${mod.id} ${mod.version}`)
                      .join(", ")}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {exportResult ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-4">
          <h2 className="text-base font-semibold">Export</h2>
          <dl className="mt-3 grid gap-2 text-sm text-app-muted">
            <div className="grid gap-2 md:grid-cols-[160px_1fr]">
              <dt className="text-app-subtle">status</dt>
              <dd>{exportResult.status}</dd>
            </div>
            <div className="grid gap-2 md:grid-cols-[160px_1fr]">
              <dt className="text-app-subtle">packages</dt>
              <dd>{exportResult.packageCount}</dd>
            </div>
          </dl>
          {exportProblems.length ? (
            <div className="mt-3">
              <ProblemDetails problems={exportProblems} />
            </div>
          ) : null}
        </section>
      ) : null}

      {inspectResult ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">
                {inspectResult.summary?.profileName ?? "Modpack"}
              </h2>
              <p className="mt-1 text-sm text-app-muted">
                {inspectResult.summary
                  ? `${inspectResult.summary.packageCount} packages, ${inspectResult.summary.enabledCount} enabled`
                  : "No valid summary"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                disabled={busy || inspectResult.status !== "ok"}
                onClick={() => void compareInspectedModpack()}
                type="button"
              >
                <Send aria-hidden="true" size={16} />
                Compare
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-app-accent px-3 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                disabled={busy || inspectResult.status !== "ok"}
                onClick={() => void importInspectedModpack()}
                type="button"
              >
                <PackageCheck aria-hidden="true" size={16} />
                Import
              </button>
            </div>
          </div>

          {inspectProblems.length ? (
            <div className="mt-3">
              <ProblemDetails problems={inspectProblems} />
            </div>
          ) : null}

          {inspectResult.packages.length ? (
            <div className="mt-4 divide-y divide-app-border">
              {inspectResult.packages.map((packagedMod) => (
                <div
                  className="grid gap-2 py-3 lg:grid-cols-[1fr_120px_120px]"
                  key={`${packagedMod.id}-${packagedMod.version}`}
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {packagedMod.name ?? packagedMod.id}
                    </div>
                    <div className="mt-1 text-sm text-app-muted">
                      {packagedMod.id} / {packagedMod.version}
                    </div>
                  </div>
                  <div className="text-sm uppercase text-app-muted">
                    {packagedMod.loader ?? "unknown"}
                  </div>
                  <div>
                    <span
                      className={`rounded px-2 py-1 text-xs font-semibold ${inspectionTone(
                        packagedMod.status
                      )}`}
                    >
                      {inspectionLabel(packagedMod.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {importResult ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-4">
          <h2 className="text-base font-semibold">Import Result</h2>
          <dl className="mt-3 grid gap-2 text-sm text-app-muted">
            <div className="grid gap-2 md:grid-cols-[160px_1fr]">
              <dt className="text-app-subtle">status</dt>
              <dd>{importResult.status}</dd>
            </div>
            <div className="grid gap-2 md:grid-cols-[160px_1fr]">
              <dt className="text-app-subtle">profile</dt>
              <dd>{importResult.profile?.name ?? "none"}</dd>
            </div>
            <div className="grid gap-2 md:grid-cols-[160px_1fr]">
              <dt className="text-app-subtle">packages</dt>
              <dd>
                {importResult.installedPackageCount} installed,{" "}
                {importResult.reusedPackageCount} reused
              </dd>
            </div>
          </dl>
          {importProblems.length ? (
            <div className="mt-3">
              <ProblemDetails problems={importProblems} />
            </div>
          ) : null}
        </section>
      ) : null}

      {compareResult ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Comparison</h2>
              <p className="mt-1 text-sm text-app-muted">
                {comparisonLabel(compareResult.status)} Order:{" "}
                {compareResult.orderStatus.toLowerCase()}.
              </p>
            </div>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onClick={() => void copyReport()}
              type="button"
            >
              <Clipboard aria-hidden="true" size={16} />
              Copy
            </button>
          </div>

          {compareResult.status !== "MATCH" ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-app-warning">
              <AlertTriangle aria-hidden="true" size={18} />
              Differences found.
            </div>
          ) : null}

          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-app-surfaceRaised p-3 text-sm text-app-muted">
            {compareResult.copyableReport}
          </pre>
        </section>
      ) : null}

      {history.length ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-4">
          <div className="flex items-center gap-2">
            <RefreshCw aria-hidden="true" size={16} />
            <h2 className="text-base font-semibold">Recent</h2>
          </div>
          <div className="mt-3 divide-y divide-app-border">
            {history.map((entry) => (
              <div
                className="grid gap-2 py-3 text-sm md:grid-cols-[120px_1fr_120px]"
                key={entry.id}
              >
                <div className="uppercase text-app-accent">{entry.kind}</div>
                <div className="min-w-0">
                  <div className="font-medium">{entry.profileName}</div>
                  <div className="mt-1 truncate text-app-muted">
                    {entry.fileName}
                  </div>
                  {entry.missingPackages.length ? (
                    <div className="mt-1 text-app-warning">
                      Missing {entry.missingPackages.length} package
                      {entry.missingPackages.length === 1 ? "" : "s"}
                    </div>
                  ) : null}
                </div>
                <div className="text-app-muted">{entry.packageCount} packages</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
