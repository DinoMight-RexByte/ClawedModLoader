import {
  Clipboard,
  FolderOpen,
  RefreshCw,
  RotateCcw
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  BackupRestoreResult,
  DiagnosticsSummary,
  LogOpenResult
} from "../../shared/contracts/app";

function Field({
  label,
  value
}: {
  label: string;
  value: string | number | null;
}): ReactElement {
  return (
    <div className="grid gap-2 md:grid-cols-[190px_1fr]">
      <dt className="text-app-subtle">{label}</dt>
      <dd className="break-all text-app-muted">{value ?? "unknown"}</dd>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="rounded-lg border border-app-border bg-app-surface p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function runtimeStatusLabel(
  status: DiagnosticsSummary["runtime"]["status"]
): string {
  switch (status) {
    case "missing":
      return "Missing";
    case "invalid":
      return "Invalid";
    case "unvalidated":
      return "Unvalidated";
    case "validated":
      return "Validated";
    case "incompatible":
      return "Incompatible";
    case "configured":
      return "Configured";
  }
}

export function DiagnosticsPage(): ReactElement {
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(async () => {
    setError(null);
    const nextSummary = await window.cmm
      .getDiagnosticsSummary()
      .catch((): DiagnosticsSummary | null => null);

    if (nextSummary) {
      setSummary(nextSummary);
    } else {
      setError("Diagnostics are unavailable.");
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const copyDiagnosticReport = async (): Promise<void> => {
    setBusy(true);
    try {
      const report = await window.cmm.getDiagnosticReport();
      await navigator.clipboard.writeText(report.text);
      setMessage("Diagnostic report copied.");
    } catch {
      setError("The diagnostic report could not be copied.");
    } finally {
      setBusy(false);
    }
  };

  const copyLatestErrors = async (): Promise<void> => {
    setBusy(true);
    try {
      const report = await window.cmm.getLatestErrorsReport();
      await navigator.clipboard.writeText(report.text);
      setMessage("Latest errors copied.");
    } catch {
      setError("The latest errors could not be copied.");
    } finally {
      setBusy(false);
    }
  };

  const openLogs = async (): Promise<void> => {
    setBusy(true);
    try {
      const result: LogOpenResult = await window.cmm.openLogs();
      setMessage(
        result.status === "ok"
          ? "Logs folder opened."
          : result.problems[0]?.message ?? "Logs folder could not be opened."
      );
    } finally {
      setBusy(false);
    }
  };

  const restoreCmmChanges = async (): Promise<void> => {
    setBusy(true);
    try {
      const result: BackupRestoreResult = await window.cmm.restoreCmmChanges();
      setMessage(
        result.status === "ok"
          ? "CMM changes restored."
          : result.problems[0]?.message ?? "Restore did not complete."
      );
      await loadSummary();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-app-accent">Diagnostics</p>
          <h1 className="mt-1 text-3xl font-semibold">Support Snapshot</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => void loadSummary()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={17} />
            Refresh
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-app-accent px-3 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => void copyDiagnosticReport()}
            type="button"
          >
            <Clipboard aria-hidden="true" size={17} />
            Copy Report
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => void copyLatestErrors()}
            type="button"
          >
            <Clipboard aria-hidden="true" size={17} />
            Copy Latest Errors
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => void openLogs()}
            type="button"
          >
            <FolderOpen aria-hidden="true" size={17} />
            Open Logs
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-app-danger/50 px-3 text-sm font-semibold text-app-danger hover:bg-app-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger disabled:opacity-60"
            disabled={busy}
            onClick={() => void restoreCmmChanges()}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={17} />
            Restore CMM Changes
          </button>
        </div>
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

      {summary ? (
        <>
          <Section title="Discovery">
            <dl className="mt-3 grid gap-2 text-sm">
              <Field
                label="Steam detected"
                value={summary.discovery.steamPath ? "yes" : "no"}
              />
              <Field
                label="Clawed detected"
                value={summary.discovery.gameInstallPath ? "yes" : "no"}
              />
              <Field label="Executable" value={summary.discovery.gameExecutable} />
              <Field
                label="Fingerprint status"
                value={summary.gameFingerprint.status}
              />
              <Field
                label="Fingerprint"
                value={summary.gameFingerprint.fingerprintSha256}
              />
              <Field
                label="Steam build ID"
                value={summary.gameFingerprint.steamBuildId}
              />
              <Field label="Running state" value={summary.process.lifecycleState} />
            </dl>
          </Section>

          <Section title="Runtime">
            <dl className="mt-3 grid gap-2 text-sm">
              <Field
                label="Runtime installed"
                value={summary.runtime.ue4ss ? "yes" : "no"}
              />
              <Field
                label="Validation state"
                value={runtimeStatusLabel(summary.runtime.status)}
              />
              <Field
                label="Runtime source"
                value={
                  summary.runtime.ue4ss?.source === "bundled"
                    ? "Packaged with CMM"
                    : summary.runtime.ue4ss
                      ? "User selected"
                      : null
                }
              />
              <Field
                label="Runtime version"
                value={summary.runtime.ue4ss?.version ?? null}
              />
              <Field
                label="Runtime validation"
                value={summary.runtime.ue4ss?.releaseValidation ?? null}
              />
              <Field
                label="Validated build"
                value={summary.runtime.ue4ss?.validation?.steamBuildId ?? null}
              />
              <Field
                label="Evidence"
                value={summary.runtime.ue4ss?.validation?.evidencePath ?? null}
              />
            </dl>
          </Section>

          <Section title="Profile">
            <dl className="mt-3 grid gap-2 text-sm">
              <Field label="Active profile" value={summary.activeProfile.name} />
              <Field label="Profile validity" value={summary.profileValidity} />
              <Field label="Enabled mods" value={summary.enabledModCount} />
              <Field
                label="Dependencies"
                value={summary.dependencyProblems.length}
              />
              <Field label="Conflicts" value={summary.conflictProblems.length} />
            </dl>
          </Section>

          <Section title="Creator Assets">
            <dl className="mt-3 grid gap-2 text-sm">
              <Field
                label="Metadata packages"
                value={summary.creatorAssets.packagesWithMetadata}
              />
              <Field
                label="Metadata missing"
                value={summary.creatorAssets.packagesMissingMetadata}
              />
              <Field
                label="Affected assets"
                value={summary.creatorAssets.affectedAssets}
              />
              <Field
                label="Replacements"
                value={summary.creatorAssets.replacements}
              />
              <Field
                label="Payload entries"
                value={summary.creatorAssets.packagePayloadEntries}
              />
              <Field
                label="Checksum records"
                value={summary.creatorAssets.checksumRecords}
              />
              <Field
                label="Active winners"
                value={summary.creatorAssets.activeWinners}
              />
              <Field
                label="Asset conflict targets"
                value={summary.creatorAssets.activeConflictTargets}
              />
              <Field
                label="Load-order effects"
                value={summary.creatorAssets.loadOrderEffectProblems}
              />
              <Field
                label="Stale profile references"
                value={summary.creatorAssets.staleProfileReferences}
              />
            </dl>
          </Section>

          <Section title="Deployment">
            <dl className="mt-3 grid gap-2 text-sm">
              <Field label="State" value={summary.deployment.state} />
              <Field
                label="Manager-owned files"
                value={summary.managerOwnedFiles.length}
              />
              <Field label="Last launch mode" value={summary.lastLaunchMode} />
              <Field label="Last game exit" value={summary.lastGameExit} />
              <Field
                label="Last deployment problem"
                value={summary.lastDeploymentProblem?.message ?? null}
              />
            </dl>
            {summary.managerOwnedFiles.length ? (
              <div className="mt-4 overflow-hidden rounded-md border border-app-border">
                {summary.managerOwnedFiles.map((file) => (
                  <div
                    className="grid gap-2 border-b border-app-border px-3 py-2 text-sm last:border-b-0 md:grid-cols-[120px_90px_1fr]"
                    key={`${file.action}-${file.relativePath}`}
                  >
                    <span className="text-app-subtle">{file.action}</span>
                    <span>{file.exists ? "present" : "missing"}</span>
                    <span className="break-all text-app-muted">
                      {file.relativePath}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {summary.deployment.problems.length ? (
              <ul className="mt-4 grid gap-2 text-sm text-app-warning">
                {summary.deployment.problems.map((problem) => (
                  <li key={`${problem.code}-${problem.message}`}>
                    {problem.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          <Section title="Logs">
            <dl className="mt-3 grid gap-2 text-sm">
              <Field label="Log folder" value={summary.logs.logDirectory} />
              <Field
                label="Crash dump folder"
                value={summary.logs.crashDumpsDirectory}
              />
              <Field
                label="Crash dump files"
                value={summary.logs.crashDumpCount}
              />
              <Field label="Latest errors" value={summary.logs.latestErrors.length} />
            </dl>
            {summary.logs.latestErrors.length ? (
              <pre className="mt-4 max-h-56 overflow-auto rounded-md bg-app-surfaceRaised p-3 text-xs text-app-muted">
                {summary.logs.latestErrors.join("\n")}
              </pre>
            ) : null}
          </Section>

          <Section title="Services">
            <div className="mt-3 divide-y divide-app-border">
              {summary.services.map((service) => (
                <div
                  className="grid gap-2 py-3 md:grid-cols-[220px_120px_1fr]"
                  key={service.id}
                >
                  <div className="font-medium">{service.label}</div>
                  <div className="text-sm uppercase text-app-accent">
                    {service.status}
                  </div>
                  <div className="text-sm text-app-muted">
                    {service.detail}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      ) : (
        <div className="rounded-lg border border-app-border bg-app-surface p-4 text-app-muted">
          Loading diagnostics
        </div>
      )}
    </div>
  );
}
