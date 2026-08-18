import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import {
  type AppSettings,
  ThemeModeSchema,
  type GameDiscovery,
  type ImportUe4ssRuntimeResult,
  type RuntimeSnapshot,
  type ThemeMode
} from "../../shared/contracts/app";
import { accentColorOptions } from "../lib/theme";
import { useAppStore } from "../stores/appStore";

function FieldValue({ value }: { value: string | null }): ReactElement {
  return (
    <code className="break-all rounded bg-app-surfaceRaised px-2 py-1 text-sm text-app-muted">
      {value ?? "Not detected"}
    </code>
  );
}

function runtimeSourceLabel(runtime: RuntimeSnapshot | null): string {
  if (!runtime?.ue4ss) {
    return "Not configured";
  }

  return runtime.ue4ss.source === "bundled"
    ? "Packaged with CMM"
    : "User selected";
}

export function SettingsPage(): ReactElement {
  const themeMode = useAppStore((state) => state.themeMode);
  const accentColor = useAppStore((state) => state.accentColor);
  const setThemeMode = useAppStore((state) => state.setThemeMode);
  const setAccentColor = useAppStore((state) => state.setAccentColor);
  const [discovery, setDiscovery] = useState<GameDiscovery | null>(null);
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [runtimeResult, setRuntimeResult] =
    useState<ImportUe4ssRuntimeResult | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runtimeDragActive, setRuntimeDragActive] = useState(false);

  const loadDiscovery = useCallback(async () => {
    const nextDiscovery = await window.cmm
      .getGameDiscovery()
      .catch((): GameDiscovery | null => null);

    if (nextDiscovery) {
      setDiscovery(nextDiscovery);
      setDiscoveryError(null);
    } else {
      setDiscoveryError("Discovery status is unavailable.");
    }
  }, []);

  const loadRuntime = useCallback(async () => {
    const nextRuntime = await window.cmm
      .getRuntimeSnapshot()
      .catch((): RuntimeSnapshot | null => null);

    if (nextRuntime) {
      setRuntime(nextRuntime);
      setRuntimeError(null);
    } else {
      setRuntimeError("Runtime status is unavailable.");
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const nextSettings = await window.cmm
      .getAppSettings()
      .catch((): AppSettings | null => null);

    if (nextSettings) {
      setSettings(nextSettings);
      setSettingsError(null);
    } else {
      setSettingsError("Settings are unavailable.");
    }
  }, []);

  useEffect(() => {
    void loadDiscovery();
    void loadRuntime();
    void loadSettings();
  }, [loadDiscovery, loadRuntime, loadSettings]);

  const runDiscoveryAction = async (
    action: () => Promise<GameDiscovery>
  ): Promise<void> => {
    setBusy(true);
    setDiscoveryError(null);

    try {
      setDiscovery(await action());
    } catch {
      setDiscoveryError("The discovery action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const importRuntime = async (): Promise<void> => {
    setBusy(true);
    setRuntimeError(null);

    try {
      const result = await window.cmm.chooseAndImportUe4ssRuntime();
      setRuntimeResult(result);
      await loadRuntime();
    } catch {
      setRuntimeError("The UE4SS runtime import could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const installBundledRuntime = async (): Promise<void> => {
    setBusy(true);
    setRuntimeError(null);

    try {
      const result = await window.cmm.installBundledUe4ssRuntime();
      setRuntimeResult(result);
      await loadRuntime();
    } catch {
      setRuntimeError("The packaged UE4SS runtime could not be configured.");
    } finally {
      setBusy(false);
    }
  };

  const setAutoUpdatePackagedRuntime = async (
    enabled: boolean
  ): Promise<void> => {
    setBusy(true);
    setSettingsError(null);

    try {
      setSettings(await window.cmm.setAutoUpdatePackagedRuntime({ enabled }));
    } catch {
      setSettingsError("The runtime update preference could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const importRuntimePath = async (sourcePath: string): Promise<void> => {
    setBusy(true);
    setRuntimeError(null);

    try {
      const result = await window.cmm.importUe4ssRuntime({ sourcePath });
      setRuntimeResult(result);
      await loadRuntime();
    } catch {
      setRuntimeError("The UE4SS runtime import could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRuntimeDrop = async (
    event: React.DragEvent<HTMLElement>
  ): Promise<void> => {
    event.preventDefault();
    setRuntimeDragActive(false);

    const runtimePath = Array.from(event.dataTransfer.files)
      .map((file) => window.cmmFileDrops.getPathForFile(file))
      .find((filePath) => filePath?.toLowerCase().endsWith(".zip"));

    if (!runtimePath) {
      setRuntimeResult(null);
      setRuntimeError("Drop a UE4SS .zip archive.");
      return;
    }

    await importRuntimePath(runtimePath);
  };

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header>
        <p className="text-sm font-medium text-app-accent">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold">Preferences</h1>
      </header>

      <section className="rounded-lg border border-app-border bg-app-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Game Discovery</h2>
            <p className="mt-1 text-sm text-app-muted">
              Status: {discovery?.discoveryStatus ?? "Checking"}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="h-10 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
              disabled={busy}
              onClick={() =>
                void runDiscoveryAction(() => window.cmm.rescanGameDiscovery())
              }
              type="button"
            >
              Rescan
            </button>
            <button
              className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-text hover:bg-app-surfaceRaised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
              disabled={busy}
              onClick={() =>
                void runDiscoveryAction(() =>
                  window.cmm.chooseManualGameDirectory()
                )
              }
              type="button"
            >
              Manual Override
            </button>
            <button
              className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
              disabled={busy || !discovery?.manualOverride}
              onClick={() =>
                void runDiscoveryAction(() =>
                  window.cmm.clearManualGameDirectory()
                )
              }
              type="button"
            >
              Clear Override
            </button>
          </div>
        </div>

        <dl className="mt-5 grid gap-3">
          <div className="grid gap-2 md:grid-cols-[190px_1fr]">
            <dt className="text-sm text-app-subtle">Detected Steam</dt>
            <dd>
              <FieldValue value={discovery?.steamPath ?? null} />
            </dd>
          </div>
          <div className="grid gap-2 md:grid-cols-[190px_1fr]">
            <dt className="text-sm text-app-subtle">
              Detected Clawed installation
            </dt>
            <dd>
              <FieldValue value={discovery?.gameInstallPath ?? null} />
            </dd>
          </div>
          <div className="grid gap-2 md:grid-cols-[190px_1fr]">
            <dt className="text-sm text-app-subtle">Detected executable</dt>
            <dd>
              <FieldValue value={discovery?.gameExecutable ?? null} />
            </dd>
          </div>
          <div className="grid gap-2 md:grid-cols-[190px_1fr]">
            <dt className="text-sm text-app-subtle">Manual override</dt>
            <dd>
              <FieldValue value={discovery?.manualOverride ?? null} />
            </dd>
          </div>
        </dl>

        {discovery?.diagnosticErrors.length ? (
          <ul className="mt-4 grid gap-2 text-sm text-app-danger">
            {discovery.diagnosticErrors.map((error) => (
              <li key={`${error.code}-${error.message}`}>{error.message}</li>
            ))}
          </ul>
        ) : null}

        {discoveryError ? (
          <div
            className="mt-4 rounded-md border border-app-danger/40 bg-app-danger/10 p-3 text-sm text-app-danger"
            role="alert"
          >
            {discoveryError}
          </div>
        ) : null}
      </section>

      <section
        className={`rounded-lg border p-5 ${
          runtimeDragActive
            ? "border-app-accent bg-app-accent/10"
            : "border-app-border bg-app-surface"
        }`}
        onDragLeave={() => setRuntimeDragActive(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setRuntimeDragActive(true);
        }}
        onDrop={(event) => void handleRuntimeDrop(event)}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">UE4SS Runtime</h2>
            <p className="mt-1 text-sm text-app-muted">
              Status: {runtime?.status ?? "Checking"}. Use the packaged
              runtime or replace it with a UE4SS release ZIP.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="h-10 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
              disabled={busy}
              onClick={() => void installBundledRuntime()}
              type="button"
            >
              Use Packaged Runtime
            </button>
            <button
              className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-text hover:bg-app-surfaceRaised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
              disabled={busy}
              onClick={() => void importRuntime()}
              type="button"
            >
              Import Different Runtime
            </button>
          </div>
        </div>

        <dl className="mt-5 grid gap-3">
          <div className="grid gap-2 md:grid-cols-[190px_1fr]">
            <dt className="text-sm text-app-subtle">Auto update</dt>
            <dd>
              <label className="flex max-w-2xl items-start gap-3 rounded-md border border-app-border bg-app-surfaceRaised p-3">
                <input
                  checked={settings?.autoUpdatePackagedRuntime ?? true}
                  className="mt-1 h-4 w-4 accent-app-accent"
                  disabled={busy || !settings}
                  onChange={(event) =>
                    void setAutoUpdatePackagedRuntime(event.target.checked)
                  }
                  type="checkbox"
                />
                <span className="grid gap-1">
                  <span className="text-sm font-medium text-app-text">
                    Update packaged runtime automatically
                  </span>
                  <span className="text-sm text-app-muted">
                    CMM may replace only its packaged UE4SS copy when Clawed
                    changes and the installed packaged runtime is missing,
                    invalid, or stale.
                  </span>
                </span>
              </label>
            </dd>
          </div>
          <div className="grid gap-2 md:grid-cols-[190px_1fr]">
            <dt className="text-sm text-app-subtle">Source</dt>
            <dd>
              <FieldValue value={runtimeSourceLabel(runtime)} />
            </dd>
          </div>
          <div className="grid gap-2 md:grid-cols-[190px_1fr]">
            <dt className="text-sm text-app-subtle">Version</dt>
            <dd>
              <FieldValue value={runtime?.ue4ss?.version ?? null} />
            </dd>
          </div>
          <div className="grid gap-2 md:grid-cols-[190px_1fr]">
            <dt className="text-sm text-app-subtle">Install path</dt>
            <dd>
              <FieldValue value={runtime?.ue4ss?.installPath ?? null} />
            </dd>
          </div>
        </dl>

        {runtime?.problems.length ? (
          <ul className="mt-4 grid gap-2 text-sm text-app-warning">
            {runtime.problems.map((problem) => (
              <li key={`${problem.code}-${problem.message}`}>
                {problem.message}
              </li>
            ))}
          </ul>
        ) : null}

        {runtimeResult?.problems.length ? (
          <div className="mt-4 rounded-md border border-app-border bg-app-surfaceRaised p-3 text-sm">
            <div className="font-medium">Runtime result: {runtimeResult.status}</div>
            <ul className="mt-2 grid gap-1 text-app-muted">
              {runtimeResult.problems.map((problem) => (
                <li
                  className={
                    problem.severity === "error"
                      ? "text-app-danger"
                      : "text-app-muted"
                  }
                  key={`${problem.code}-${problem.message}`}
                >
                  {problem.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {runtimeError ? (
          <div
            className="mt-4 rounded-md border border-app-danger/40 bg-app-danger/10 p-3 text-sm text-app-danger"
            role="alert"
          >
            {runtimeError}
          </div>
        ) : null}

        {settingsError ? (
          <div
            className="mt-4 rounded-md border border-app-danger/40 bg-app-danger/10 p-3 text-sm text-app-danger"
            role="alert"
          >
            {settingsError}
          </div>
        ) : null}
      </section>

      <section className="max-w-2xl rounded-lg border border-app-border bg-app-surface p-5">
        <div className="grid gap-5">
          <label className="grid gap-2">
            <span className="text-sm font-medium">Theme</span>
            <select
              className="h-10 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onChange={(event) => {
                const parsed = ThemeModeSchema.parse(event.target.value);
                setThemeMode(parsed);
              }}
              value={themeMode}
            >
              {(["dark", "light", "system"] satisfies ThemeMode[]).map(
                (mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Accent Color</span>
            <div className="flex flex-wrap items-center gap-2">
              {accentColorOptions.map((option) => (
                <button
                  aria-label={`Use ${option.label} accent`}
                  aria-pressed={
                    accentColor.toLowerCase() === option.value.toLowerCase()
                  }
                  className={`h-9 w-9 rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
                    accentColor.toLowerCase() === option.value.toLowerCase()
                      ? "border-app-text"
                      : "border-app-border"
                  }`}
                  key={option.value}
                  onClick={() => setAccentColor(option.value)}
                  style={{ backgroundColor: option.value }}
                  title={option.label}
                  type="button"
                />
              ))}
              <input
                aria-label="Custom accent color"
                className="h-10 w-24 rounded-md border border-app-border bg-app-surfaceRaised p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                onChange={(event) => setAccentColor(event.target.value)}
                type="color"
                value={accentColor}
              />
            </div>
          </label>
        </div>
      </section>
    </div>
  );
}
