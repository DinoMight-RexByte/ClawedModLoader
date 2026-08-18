import {
  CheckCircle2,
  Circle,
  FileArchive,
  FolderSearch,
  PackagePlus,
  Play,
  RefreshCw,
  Settings,
  UserPlus
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  GameDiscovery,
  ModProblem,
  ProfileListSnapshot,
  RuntimeSnapshot
} from "../../shared/contracts/app";
import { useAppStore } from "../stores/appStore";
import { ModalDialog } from "./ModalDialog";
import { ProblemDetails } from "./ProblemDetails";

const onboardingStorageKey = "cmm.onboardingDismissed";

type StepId = "find" | "runtime" | "profile" | "ready";

const steps: Array<{
  id: StepId;
  label: string;
}> = [
  { id: "find", label: "Find Clawed" },
  { id: "runtime", label: "Configure Runtime" },
  { id: "profile", label: "Import/Create Profile" },
  { id: "ready", label: "Ready to Play" }
];

function statusClass(done: boolean): string {
  return done
    ? "border-app-success/40 bg-app-success/10 text-app-success"
    : "border-app-border bg-app-surfaceRaised text-app-muted";
}

function runtimeConfigured(runtime: RuntimeSnapshot | null): boolean {
  return (
    runtime !== null &&
    runtime.ue4ss !== null &&
    runtime.status !== "missing" &&
    runtime.status !== "invalid" &&
    runtime.status !== "incompatible"
  );
}

function collectRuntimeProblems(runtime: RuntimeSnapshot | null): ModProblem[] {
  return runtime?.problems ?? [];
}

function runtimeSourceLabel(runtime: RuntimeSnapshot | null): string {
  return runtime?.ue4ss?.source === "bundled"
    ? "the packaged runtime"
    : "a user-selected runtime";
}

export function FirstRunOnboarding(): ReactElement | null {
  const [visible, setVisible] = useState(
    () => localStorage.getItem(onboardingStorageKey) !== "true"
  );
  const [activeStep, setActiveStep] = useState<StepId>("find");
  const [discovery, setDiscovery] = useState<GameDiscovery | null>(null);
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [profiles, setProfiles] = useState<ProfileListSnapshot | null>(null);
  const [runtimeSkipped, setRuntimeSkipped] = useState(false);
  const [newProfileName, setNewProfileName] = useState("Co-op Night");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<ModProblem[]>([]);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const bumpProfileRevision = useAppStore((state) => state.bumpProfileRevision);

  const loadSetupState = useCallback(async (): Promise<void> => {
    const [nextDiscovery, nextRuntime, nextProfiles] = await Promise.all([
      window.cmm.getGameDiscovery().catch((): GameDiscovery | null => null),
      window.cmm.getRuntimeSnapshot().catch((): RuntimeSnapshot | null => null),
      window.cmm.listProfiles().catch((): ProfileListSnapshot | null => null)
    ]);

    setDiscovery(nextDiscovery);
    setRuntime(nextRuntime);
    setProfiles(nextProfiles);
  }, []);

  useEffect(() => {
    if (visible) {
      void loadSetupState();
    }
  }, [loadSetupState, visible]);

  const stepDone = {
    find: discovery?.discoveryStatus === "READY",
    runtime: runtimeConfigured(runtime) || runtimeSkipped,
    profile: (profiles?.profiles.length ?? 0) > 0,
    ready:
      discovery?.discoveryStatus === "READY" &&
      (runtimeConfigured(runtime) || runtimeSkipped) &&
      (profiles?.profiles.length ?? 0) > 0
  };

  if (!visible) {
    return null;
  }

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setProblems([]);

    try {
      await action();
      await loadSetupState();
    } catch {
      setMessage("That setup action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const finish = (finishLater: boolean): void => {
    localStorage.setItem(onboardingStorageKey, "true");
    setVisible(false);
    setActivePage(finishLater ? "settings" : "play");
  };

  const createProfile = async (): Promise<void> => {
    if (busy || newProfileName.trim().length === 0) {
      return;
    }

    await runAction(async () => {
      const result = await window.cmm.createProfile({
        name: newProfileName
      });
      setProblems(result.problems);
      bumpProfileRevision();
      setMessage("Profile created.");
    });
  };

  return (
    <ModalDialog
      describedById="first-run-description"
      labelledById="first-run-title"
      title="First-Run Setup"
      description="Confirm the basics once, then CMM opens directly to Play."
    >
      <div className="mt-5 grid gap-5 lg:grid-cols-[220px_1fr]">
        <nav
          aria-label="Onboarding steps"
          className="flex gap-2 overflow-x-auto pb-1 lg:grid lg:content-start lg:overflow-visible lg:pb-0"
        >
          {steps.map((step) => {
            const done = stepDone[step.id];
            return (
              <button
                aria-current={activeStep === step.id ? "step" : undefined}
                className={`flex h-11 min-w-max shrink-0 items-center gap-2 rounded-md border px-3 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent lg:min-w-0 ${
                  activeStep === step.id
                    ? "border-app-accent bg-app-accent/10 text-app-text"
                    : "border-app-border text-app-muted hover:bg-app-surfaceRaised hover:text-app-text"
                }`}
                key={step.id}
                onClick={() => setActiveStep(step.id)}
                type="button"
              >
                {done ? (
                  <CheckCircle2
                    aria-hidden="true"
                    className="text-app-success"
                    size={18}
                  />
                ) : (
                  <Circle aria-hidden="true" size={18} />
                )}
                <span>{step.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="min-h-[300px] rounded-lg border border-app-border bg-app-surfaceRaised p-4 lg:min-h-[340px]">
          {activeStep === "find" ? (
            <div className="grid gap-4">
              <div className="flex items-start gap-3">
                <FolderSearch
                  aria-hidden="true"
                  className="mt-1 text-app-accent"
                  size={22}
                />
                <div>
                  <h3 className="text-lg font-semibold">Find Clawed</h3>
                  <p className="mt-1 text-sm text-app-muted">
                    Status: {discovery?.discoveryStatus ?? "Checking"}
                  </p>
                </div>
              </div>
              <dl className="grid gap-2 text-sm">
                <div className="grid gap-2 md:grid-cols-[160px_1fr]">
                  <dt className="text-app-subtle">Steam</dt>
                  <dd className="break-all text-app-muted">
                    {discovery?.steamPath ?? "Not detected"}
                  </dd>
                </div>
                <div className="grid gap-2 md:grid-cols-[160px_1fr]">
                  <dt className="text-app-subtle">Clawed</dt>
                  <dd className="break-all text-app-muted">
                    {discovery?.gameInstallPath ?? "Not detected"}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      setDiscovery(await window.cmm.rescanGameDiscovery());
                      setMessage("Game discovery refreshed.");
                    })
                  }
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={17} />
                  Rescan
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      setDiscovery(await window.cmm.chooseManualGameDirectory());
                      setMessage("Manual game directory updated.");
                    })
                  }
                  type="button"
                >
                  <Settings aria-hidden="true" size={17} />
                  Manual Override
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === "runtime" ? (
            <div className="grid gap-4">
              <div>
                <h3 className="text-lg font-semibold">Configure Runtime</h3>
                <p className="mt-1 text-sm text-app-muted">
                  Runtime status: {runtime?.status ?? "Checking"}
                </p>
              </div>
              <div className={`rounded-md border p-3 ${statusClass(stepDone.runtime)}`}>
                {runtimeConfigured(runtime)
                  ? `UE4SS ${runtime?.ue4ss?.version ?? "runtime"} is configured from ${runtimeSourceLabel(
                      runtime
                    )}.`
                  : runtimeSkipped
                    ? "Runtime setup skipped for vanilla-only play."
                    : "No runtime is configured yet. Use the packaged runtime or import a different UE4SS ZIP."}
              </div>
              <ProblemDetails problems={collectRuntimeProblems(runtime)} />
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const result = await window.cmm.installBundledUe4ssRuntime();
                      setProblems(result.problems);
                      setMessage(
                        result.status === "failed"
                          ? "The packaged runtime is not available in this build."
                          : result.problems.some(
                                (problem) => problem.severity === "error"
                              )
                            ? "Packaged runtime installed but is not compatible with this Clawed build."
                          : result.status === "alreadyInstalled"
                            ? "Packaged runtime already configured."
                            : "Packaged runtime configured."
                      );
                    })
                  }
                  type="button"
                >
                  <PackagePlus aria-hidden="true" size={17} />
                  Use Packaged Runtime
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const result = await window.cmm.chooseAndImportUe4ssRuntime();
                      setProblems(result.problems);
                      setMessage(
                        result.status === "imported"
                          ? "Runtime imported."
                          : "Runtime import did not complete."
                      );
                    })
                  }
                  type="button"
                >
                  <PackagePlus aria-hidden="true" size={17} />
                  Import Different Runtime
                </button>
                <button
                  className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                  onClick={() => {
                    setRuntimeSkipped(true);
                    setMessage("Runtime setup skipped. Vanilla launch remains available.");
                  }}
                  type="button"
                >
                  Skip Runtime for Vanilla
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === "profile" ? (
            <div className="grid gap-4">
              <div>
                <h3 className="text-lg font-semibold">Import or Create Profile</h3>
                <p className="mt-1 text-sm text-app-muted">
                  Active profile:{" "}
                  {profiles?.profiles.find(
                    (profile) => profile.id === profiles.activeProfileId
                  )?.name ?? "Loading"}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <label>
                  <span className="sr-only">New profile name</span>
                  <input
                    className="h-10 w-full rounded-md border border-app-border bg-app-surface px-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                    onChange={(event) => setNewProfileName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createProfile();
                      }
                    }}
                    value={newProfileName}
                  />
                </label>
                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                  disabled={busy || newProfileName.trim().length === 0}
                  onClick={() => void createProfile()}
                  type="button"
                >
                  <UserPlus aria-hidden="true" size={17} />
                  Create Profile
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const result = await window.cmm.chooseAndInspectModpack();
                      if (result.status === "ok") {
                        const importResult = await window.cmm.importModpack({
                          modpackPath: result.modpackPath
                        });
                        setProblems(importResult.problems);
                        bumpProfileRevision();
                        setMessage("Friend's modpack imported.");
                      } else {
                        setProblems(result.problems);
                        setMessage("Modpack could not be imported safely.");
                      }
                    })
                  }
                  type="button"
                >
                  <FileArchive aria-hidden="true" size={17} />
                  Import Friend's Modpack
                </button>
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                  disabled={busy}
                  onClick={() =>
                    void runAction(async () => {
                      const result = await window.cmm.chooseAndImportModPackage();
                      setProblems(result.problems);
                      setMessage(
                        result.status === "installed"
                          ? "Mod imported into the active profile."
                          : "Mod import did not complete."
                      );
                      bumpProfileRevision();
                    })
                  }
                  type="button"
                >
                  <PackagePlus aria-hidden="true" size={17} />
                  Import Mod
                </button>
              </div>
            </div>
          ) : null}

          {activeStep === "ready" ? (
            <div className="grid gap-4">
              <div className="flex items-start gap-3">
                <Play
                  aria-hidden="true"
                  className="mt-1 text-app-accent"
                  size={22}
                />
                <div>
                  <h3 className="text-lg font-semibold">Ready to Play</h3>
                  <p className="mt-1 text-sm text-app-muted">
                    {stepDone.ready
                      ? "The launch dashboard is ready."
                      : "Setup is incomplete. CMM will show the missing state on Play and Settings."}
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                {steps.map((step) => (
                  <div
                    className={`flex items-center gap-2 rounded-md border p-3 text-sm ${statusClass(
                      stepDone[step.id]
                    )}`}
                    key={step.id}
                  >
                    {stepDone[step.id] ? (
                      <CheckCircle2 aria-hidden="true" size={17} />
                    ) : (
                      <Circle aria-hidden="true" size={17} />
                    )}
                    <span>{step.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {message ? (
            <div
              className="mt-4 rounded-md border border-app-border bg-app-surface p-3 text-sm"
              role="status"
            >
              {message}
            </div>
          ) : null}
          {problems.length ? (
            <div className="mt-3">
              <ProblemDetails problems={problems} />
            </div>
          ) : null}
        </section>
      </div>

      <footer className="mt-5 flex flex-wrap justify-between gap-3 border-t border-app-border pt-4">
        <button
          className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
          onClick={() => finish(true)}
          type="button"
        >
          Finish Later
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            disabled={activeStep === "find"}
            onClick={() => {
              const currentIndex = steps.findIndex(
                (step) => step.id === activeStep
              );
              setActiveStep(steps[Math.max(0, currentIndex - 1)].id);
            }}
            type="button"
          >
            Back
          </button>
          {activeStep !== "ready" ? (
            <button
              className="h-10 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onClick={() => {
                const currentIndex = steps.findIndex(
                  (step) => step.id === activeStep
                );
                setActiveStep(steps[Math.min(steps.length - 1, currentIndex + 1)].id);
              }}
              type="button"
            >
              Continue
            </button>
          ) : (
            <button
              className="h-10 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onClick={() => finish(!stepDone.ready)}
              type="button"
            >
              {stepDone.ready ? "Open Play" : "Finish With Incomplete Setup"}
            </button>
          )}
        </div>
      </footer>
    </ModalDialog>
  );
}
