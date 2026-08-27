import {
  AlertTriangle,
  CheckCircle2,
  FileArchive,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  LogBundleMode,
  LogBundlePlan,
  LogBundleResult,
  LogBundleSource
} from "../../shared/contracts/app";

function modeLabel(mode: LogBundleMode): string {
  return mode === "modded" ? "Modded" : "Vanilla";
}

function sourceStatus(source: LogBundleSource): {
  label: string;
  className: string;
} {
  if (!source.included) {
    return {
      label: "Not included",
      className: "text-app-subtle"
    };
  }
  if (!source.exists) {
    return {
      label: "Missing",
      className: "text-app-warning"
    };
  }
  return {
    label: "Included",
    className: "text-app-success"
  };
}

export function LogBundlerPage(): ReactElement {
  const [mode, setMode] = useState<LogBundleMode>("vanilla");
  const [includeHardware, setIncludeHardware] = useState(false);
  const [plan, setPlan] = useState<LogBundlePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const missingSources =
    plan?.sources.filter((source) => source.included && !source.exists) ?? [];

  const loadPlan = useCallback(async (): Promise<void> => {
    setError(null);
    const nextPlan = await window.cmm
      .getLogBundlePlan({ mode, includeHardware })
      .catch((): LogBundlePlan | null => null);
    if (nextPlan) {
      setPlan(nextPlan);
    } else {
      setError("Log bundle details are unavailable.");
    }
  }, [includeHardware, mode]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const createBundle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result: LogBundleResult = await window.cmm.chooseAndCreateLogBundle({
        mode,
        includeHardware
      });
      if (result.status === "created") {
        setMessage(
          `${modeLabel(mode)} bundle created with ${result.fileCount} files.`
        );
        await loadPlan();
      } else if (result.status === "cancelled") {
        setMessage("Log bundle creation cancelled.");
      } else {
        setError(
          result.problems[0]?.message ?? "The log bundle could not be created."
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-app-accent">Log Bundler</p>
          <h1 className="mt-1 text-3xl font-semibold">Support Log Bundle</h1>
        </div>
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => void loadPlan()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={17} />
          Refresh
        </button>
      </header>

      {message || error ? (
        <div
          className={`rounded-lg border p-4 text-sm ${
            error
              ? "border-app-danger/40 bg-app-danger/10 text-app-danger"
              : "border-app-border bg-app-surface"
          }`}
          role={error ? "alert" : "status"}
        >
          {error ?? message}
        </div>
      ) : null}

      <section className="rounded-lg border border-app-border bg-app-surface p-4">
        <div className="flex flex-wrap gap-3">
          {(["vanilla", "modded"] as LogBundleMode[]).map((nextMode) => {
            const active = nextMode === mode;
            return (
              <button
                aria-pressed={active}
                className={`inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
                  active
                    ? "bg-app-accent text-app-accentText"
                    : "border border-app-border text-app-muted hover:bg-app-surfaceRaised hover:text-app-text"
                }`}
                disabled={busy}
                key={nextMode}
                onClick={() => setMode(nextMode)}
                type="button"
              >
                <FileArchive aria-hidden="true" size={17} />
                {modeLabel(nextMode)}
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-md border border-app-border bg-app-bg p-3">
          <label className="flex items-start gap-3 text-sm">
            <input
              checked={includeHardware}
              className="mt-1 h-4 w-4 rounded border-app-border accent-app-accent"
              disabled={busy}
              onChange={(event) => setIncludeHardware(event.target.checked)}
              type="checkbox"
            />
            <span>
              <span className="block font-semibold text-app-text">
                I consent to include my PC hardware specs in this log report.
              </span>
              <span className="mt-1 block text-app-muted">
                Hardware specs include Windows version, CPU, GPU, and RAM
                summary. CMM does not collect serial numbers, account names, or
                machine names for this section.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-app-border bg-app-surface p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-app-accent"
            size={20}
          />
          <div className="text-sm text-app-muted">
            <p className="font-semibold text-app-text">Files CMM may access</p>
            <p className="mt-1">
              CMM only reads and copies the files shown below for this bundle.
              It does not access Desktop, Documents, browser data, Steam account
              data, or unrelated app folders. Game saves, logs, configs, and
              modded evidence can still contain local paths and gameplay state.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-app-border bg-app-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Bundle Contents</h2>
            <p className="mt-1 break-all text-sm text-app-muted">
              {plan?.fileName ?? "Loading generated file name"}
            </p>
          </div>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-app-accent px-3 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busy || !plan}
            onClick={() => void createBundle()}
            type="button"
          >
            <FileArchive aria-hidden="true" size={17} />
            Create {modeLabel(mode)} Bundle
          </button>
        </div>

        {plan ? (
          <>
            {missingSources.length > 0 ? (
              <div
                className="mt-4 flex items-start gap-3 rounded-md border border-app-warning/40 bg-app-warning/10 p-3 text-sm text-app-warning"
                role="status"
              >
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                  size={17}
                />
                <p>
                  Some included sources are missing. Use the next step shown on
                  each missing row, then refresh.
                </p>
              </div>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-md border border-app-border">
              {plan.sources.map((source) => {
                const status = sourceStatus(source);
                return (
                  <div
                    className="grid gap-2 border-b border-app-border px-3 py-3 text-sm last:border-b-0 md:grid-cols-[170px_110px_1fr]"
                    key={`${source.scope}-${source.archivePath}-${source.sourcePath}`}
                  >
                    <div className="font-medium">{source.label}</div>
                    <div
                      className={`flex items-center gap-2 ${status.className}`}
                    >
                      {source.included && source.exists ? (
                        <CheckCircle2 aria-hidden="true" size={15} />
                      ) : null}
                      {status.label}
                    </div>
                    <div className="min-w-0">
                      <div className="break-all text-app-muted">
                        {source.sourcePath}
                      </div>
                      <div className="mt-1 break-all text-xs text-app-subtle">
                        ZIP: {source.archivePath}
                      </div>
                      {source.included &&
                      !source.exists &&
                      source.missingAction ? (
                        <div className="mt-2 rounded-md border border-app-warning/30 bg-app-warning/10 p-2 text-xs text-app-warning">
                          <span className="font-semibold">Next step:</span>{" "}
                          {source.missingAction}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-md border border-app-border bg-app-bg p-3 text-sm text-app-muted">
            Loading bundle contents
          </div>
        )}
      </section>
    </div>
  );
}
