import {
  AlertTriangle,
  CheckCircle2,
  Power,
  RefreshCw,
  Rocket,
  ShieldAlert,
  XCircle
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  LaunchCommandKind,
  LaunchCommandResult,
  PlaySnapshot,
  ValidatePackagedRuntimeResult
} from "../../shared/contracts/app";
import { StatusCard } from "../components/StatusCard";
import { useAppStore } from "../stores/appStore";

type BusyAction = LaunchCommandKind | "validateRuntime";

const commandButtons: Array<{
  kind: LaunchCommandKind;
  label: string;
  icon: ReactElement;
  style: "primary" | "secondary";
}> = [
  {
    kind: "launchModded",
    label: "Launch Modded",
    icon: <Rocket aria-hidden="true" size={18} />,
    style: "primary"
  },
  {
    kind: "launchVanilla",
    label: "Launch Vanilla",
    icon: <Power aria-hidden="true" size={18} />,
    style: "secondary"
  },
  {
    kind: "restartGame",
    label: "Restart",
    icon: <RefreshCw aria-hidden="true" size={18} />,
    style: "secondary"
  }
];

function formatGameState(state: PlaySnapshot["gameState"]): string {
  const labels: Record<PlaySnapshot["gameState"], string> = {
    STARTING: "Starting",
    RUNNING: "Running",
    STOPPING: "Stopping",
    STOPPED: "Stopped",
    UNKNOWN: "Unknown"
  };

  return labels[state];
}

function formatDiscoveryStatus(
  status: PlaySnapshot["discovery"]["discoveryStatus"]
): string {
  const labels: Record<PlaySnapshot["discovery"]["discoveryStatus"], string> = {
    READY: "Ready",
    STEAM_NOT_FOUND: "Steam not found",
    GAME_NOT_INSTALLED: "Game not installed",
    EXECUTABLE_NOT_FOUND: "Executable not found",
    MANUAL_OVERRIDE_INVALID: "Override invalid",
    UNSUPPORTED_PLATFORM: "Unsupported platform"
  };

  return labels[status];
}

function formatDeployment(state: PlaySnapshot["deploymentState"]): string {
  const labels: Record<PlaySnapshot["deploymentState"], string> = {
    deploymentError: "Deployment Error",
    deploymentRequired: "Deployment Required",
    moddedReady: "Modded Ready",
    runtimeIncompatible: "Runtime Incompatible",
    runtimeUnvalidated: "Runtime Unvalidated",
    vanillaReady: "Vanilla Ready",
    current: "Current",
    failed: "Failed",
    notDeployed: "Not Deployed",
    stale: "Stale",
    unknown: "Unknown"
  };

  return labels[state];
}

function deploymentTone(
  state: PlaySnapshot["deploymentState"] | undefined
): "success" | "warning" | "danger" | undefined {
  if (state === "deploymentError" || state === "runtimeIncompatible") {
    return "danger";
  }

  if (state === "deploymentRequired" || state === "runtimeUnvalidated") {
    return "warning";
  }

  if (state === "vanillaReady" || state === "moddedReady" || state === "current") {
    return "success";
  }

  return undefined;
}

function isSignatureCompatibilityFailure(
  result: ValidatePackagedRuntimeResult
): boolean {
  const firstProblem = result.problems[0];
  const detail = firstProblem?.technicalDetail ?? "";

  return (
    result.status === "incompatible" &&
    firstProblem?.code === "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE" &&
    (detail.includes("UE4SS pattern scan failed") ||
      detail.includes("PS scan timed out") ||
      detail.includes("GUObjectArray") ||
      detail.includes("FText::FText(FString&&)"))
  );
}

function validationTitle(result: ValidatePackagedRuntimeResult): string {
  if (isSignatureCompatibilityFailure(result)) {
    return "UE4SS signatures required";
  }

  switch (result.status) {
    case "validated":
      return "Runtime validated";
    case "incompatible":
      return "Runtime validation failed";
    case "blocked":
      return "Runtime validation blocked";
    case "failed":
      return "Runtime validation failed";
    case "cancelled":
      return "Runtime validation cancelled";
  }
}

function validationMessage(result: ValidatePackagedRuntimeResult): string {
  const firstProblem = result.problems[0];
  if (isSignatureCompatibilityFailure(result)) {
    return "Validation completed safely and Clawed was restored to vanilla, but the packaged UE4SS runtime cannot resolve this Clawed build's engine signatures yet.";
  }

  if (firstProblem) {
    return firstProblem.message;
  }

  if (result.status === "validated") {
    return "The packaged UE4SS runtime is now validated for the detected Clawed build.";
  }

  if (result.status === "cancelled") {
    return "CMM stopped the validation run and restored vanilla state.";
  }

  return "CMM could not validate the packaged UE4SS runtime.";
}

function validationNextStep(
  result: ValidatePackagedRuntimeResult
): string | undefined {
  return (
    result.problems[0]?.technicalDetail ??
    result.evidencePath ??
    undefined
  );
}

function isRuntimeValidationNotRequired(
  result: ValidatePackagedRuntimeResult
): boolean {
  return (
    result.status === "blocked" &&
    result.problems.some(
      (problem) => problem.code === "UE4SS_RUNTIME_VALIDATION_NOT_REQUIRED"
    )
  );
}

function isValidatedPackagedRuntime(snapshot: PlaySnapshot | null): boolean {
  return (
    snapshot?.runtime.ue4ss?.source === "bundled" &&
    snapshot.runtime.status === "validated"
  );
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = `${seconds % 60}`.padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

export function PlayPage(): ReactElement {
  const profileRevision = useAppStore((state) => state.profileRevision);
  const [snapshot, setSnapshot] = useState<PlaySnapshot | null>(null);
  const [commandResult, setCommandResult] =
    useState<LaunchCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCommand, setBusyCommand] = useState<BusyAction | null>(null);
  const [validationStartedAt, setValidationStartedAt] = useState<number | null>(
    null
  );
  const [validationElapsedSeconds, setValidationElapsedSeconds] = useState(0);
  const [validationCancelRequested, setValidationCancelRequested] =
    useState(false);
  const refreshInFlight = useRef(false);
  const snapshotRequestId = useRef(0);
  const runtimeValidationRunning = busyCommand === "validateRuntime";
  const deploymentValue = runtimeValidationRunning
    ? "Validation Running"
    : snapshot
      ? formatDeployment(snapshot.deploymentState)
      : "Loading";
  const deploymentDetail = runtimeValidationRunning
    ? "Packaged runtime validation launch in progress"
    : `Current launch mode: ${snapshot?.launchMode ?? "VANILLA"}`;
  const deploymentStatusTone = runtimeValidationRunning
    ? "warning"
    : deploymentTone(snapshot?.deploymentState);
  const canValidateRuntime =
    snapshot?.runtime.ue4ss?.source === "bundled" &&
    (snapshot.runtime.status === "unvalidated" ||
      snapshot.runtime.status === "incompatible");

  const loadSnapshot = useCallback(async (): Promise<PlaySnapshot | null> => {
    const requestId = snapshotRequestId.current + 1;
    snapshotRequestId.current = requestId;
    const nextSnapshot = await window.cmm
      .getPlaySnapshot()
      .catch((): PlaySnapshot | null => null);

    if (requestId !== snapshotRequestId.current) {
      return nextSnapshot;
    }

    if (nextSnapshot) {
      setSnapshot(nextSnapshot);
    } else {
      setError("Play status is unavailable.");
    }

    return nextSnapshot;
  }, []);

  const refreshSnapshot = useCallback(async (): Promise<PlaySnapshot | null> => {
    if (refreshInFlight.current) {
      return null;
    }

    refreshInFlight.current = true;
    try {
      return await loadSnapshot();
    } finally {
      refreshInFlight.current = false;
    }
  }, [loadSnapshot]);

  useEffect(() => {
    void refreshSnapshot();
  }, [profileRevision, refreshSnapshot]);

  useEffect(() => {
    if (validationStartedAt === null) {
      setValidationElapsedSeconds(0);
      return;
    }

    const updateElapsed = () =>
      setValidationElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - validationStartedAt) / 1_000))
      );

    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1_000);

    return () => window.clearInterval(intervalId);
  }, [validationStartedAt]);

  useEffect(() => {
    const pollIntervalMs =
      snapshot?.gameState === "RUNNING" || snapshot?.gameState === "STARTING"
        ? 1_000
        : 3_000;
    const intervalId = window.setInterval(() => {
      void refreshSnapshot();
    }, pollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [refreshSnapshot, snapshot?.gameState]);

  const runCommand = async (
    kind: LaunchCommandKind,
    options: {
      forceCloseConfirmed?: boolean;
      runtimeValidationConfirmed?: boolean;
    } = {}
  ) => {
    setBusyCommand(kind);
    setError(null);

    try {
      const result = await window.cmm.runLaunchCommand({
        kind,
        ...options
      });
      setCommandResult(result);
      await loadSnapshot();
    } catch {
      setError("The command could not be completed.");
    } finally {
      setBusyCommand(null);
    }
  };

  const runRuntimeValidation = async () => {
    setBusyCommand("validateRuntime");
    setValidationStartedAt(Date.now());
    setValidationCancelRequested(false);
    setCommandResult(null);
    setError(null);

    try {
      const result = await window.cmm.validatePackagedRuntime();
      const nextSnapshot = await loadSnapshot();
      const alreadyValidated =
        isRuntimeValidationNotRequired(result) &&
        isValidatedPackagedRuntime(nextSnapshot);
      setCommandResult({
        kind: "launchModded",
        launchMode: "MODDED",
        lifecycleState: snapshot?.gameState === "RUNNING" ? "RUNNING" : "STOPPED",
        status:
          result.status === "validated" || alreadyValidated
            ? "completed"
            : "blocked",
        title: alreadyValidated ? "Runtime already validated" : validationTitle(result),
        message: alreadyValidated
          ? "The packaged UE4SS runtime is already validated for the detected Clawed build."
          : validationMessage(result),
        nextStep: alreadyValidated
          ? nextSnapshot?.runtime.ue4ss?.validation?.evidencePath
          : validationNextStep(result),
        occurredAt: new Date().toISOString()
      });
    } catch {
      setError("The runtime validation could not be completed.");
    } finally {
      setValidationStartedAt(null);
      setValidationCancelRequested(false);
      setBusyCommand(null);
    }
  };

  const cancelRuntimeValidation = async () => {
    if (!runtimeValidationRunning || validationCancelRequested) {
      return;
    }

    setValidationCancelRequested(true);
    setError(null);

    try {
      const result = await window.cmm.cancelPackagedRuntimeValidation();
      if (result.status === "blocked") {
        setCommandResult({
          kind: "launchModded",
          launchMode: "MODDED",
          lifecycleState:
            snapshot?.gameState === "RUNNING" ? "RUNNING" : "STOPPED",
          status: "blocked",
          title: validationTitle(result),
          message: validationMessage(result),
          nextStep: validationNextStep(result),
          occurredAt: new Date().toISOString()
        });
        setValidationCancelRequested(false);
      }
    } catch {
      setError("The runtime validation cancel request could not be sent.");
      setValidationCancelRequested(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header>
        <p className="text-sm font-medium text-app-accent">Play</p>
        <h1 className="mt-1 text-3xl font-semibold">Launch Clawed</h1>
        <p className="mt-2 max-w-2xl text-sm text-app-muted">
          The launch dashboard shows the active profile, setup state, and
          whether CMM needs deployment work before starting the game.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <StatusCard
          detail={`Preferred launch: ${snapshot?.launchMode ?? "VANILLA"}`}
          label="Active Profile"
          value={snapshot?.activeProfile.name ?? "Loading"}
        />
        <StatusCard
          detail={
            snapshot
              ? formatDiscoveryStatus(snapshot.discovery.discoveryStatus)
              : "Checking"
          }
          icon={<AlertTriangle aria-hidden="true" size={20} />}
          label="Game Status"
          tone={snapshot?.gameState === "RUNNING" ? "success" : "warning"}
          value={snapshot ? formatGameState(snapshot.gameState) : "Loading"}
        />
        <StatusCard
          detail="Enabled in active profile"
          label="Enabled Mods"
          value={`${snapshot?.enabledMods ?? 0}`}
        />
        <StatusCard
          detail={
            snapshot?.profileValidity === "invalid"
              ? "Dependency or version errors"
              : "Profile rules validated"
          }
          icon={<CheckCircle2 aria-hidden="true" size={20} />}
          label="Profile Status"
          tone={snapshot?.profileValidity === "invalid" ? "danger" : "success"}
          value={snapshot?.profileValidity ?? "Unknown"}
        />
        <StatusCard
          detail={deploymentDetail}
          label="Deployment Status"
          tone={deploymentStatusTone}
          value={deploymentValue}
        />
        <StatusCard
          detail={
            snapshot?.conflicts.severity === "none"
              ? "No active warnings"
              : "Profile warnings or errors"
          }
          icon={<ShieldAlert aria-hidden="true" size={20} />}
          label="Conflict Status"
          tone={snapshot?.conflicts.severity === "none" ? "success" : "danger"}
          value={`${snapshot?.conflicts.count ?? 0}`}
        />
      </div>

      <section
        aria-labelledby="play-actions-title"
        className="rounded-lg border border-app-border bg-app-surface p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold" id="play-actions-title">
            Actions
          </h2>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            onClick={() => void refreshSnapshot()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={16} />
            Refresh
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {commandButtons.map((command) => (
            <button
              className={`inline-flex h-12 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60 ${
                command.style === "primary"
                  ? "bg-app-accent text-app-accentText hover:brightness-105"
                  : "border border-app-border text-app-text hover:bg-app-surfaceRaised"
              }`}
              disabled={busyCommand !== null}
              key={command.kind}
              onClick={() => void runCommand(command.kind)}
              type="button"
            >
              {busyCommand === command.kind ? (
                <RefreshCw
                  aria-hidden="true"
                  className="motion-safe:animate-spin"
                  size={18}
                />
              ) : (
                command.icon
              )}
              <span>{command.label}</span>
            </button>
          ))}
          {canValidateRuntime ? (
            <button
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-app-border px-4 text-sm font-semibold text-app-text transition hover:bg-app-surfaceRaised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busyCommand !== null}
              onClick={() => void runRuntimeValidation()}
              type="button"
            >
              {busyCommand === "validateRuntime" ? (
                <RefreshCw
                  aria-hidden="true"
                  className="motion-safe:animate-spin"
                  size={18}
                />
              ) : (
                <CheckCircle2 aria-hidden="true" size={18} />
              )}
              <span>{runtimeValidationRunning ? "Validating" : "Validate"}</span>
            </button>
          ) : null}
        </div>

        {runtimeValidationRunning ? (
          <div
            aria-label="Packaged runtime validation is running"
            aria-live="polite"
            className="mt-4 rounded-md border border-app-accent/40 bg-app-accent/10 p-4"
            role="status"
          >
            <div className="flex items-start gap-3">
              <RefreshCw
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-app-accent motion-safe:animate-spin"
                size={18}
              />
              <div className="min-w-0">
                <div className="font-medium">
                  {validationCancelRequested
                    ? "Cancelling packaged runtime validation"
                    : "Validating packaged runtime"}
                </div>
                <p className="mt-1 text-sm leading-5 text-app-muted">
                  {validationCancelRequested
                    ? "CMM is stopping the validation run. If Clawed has already started, CMM will request a normal close before restoring vanilla."
                    : "CMM is staging the validation marker, launching Clawed through Steam, waiting for UE4SS evidence, and restoring vanilla after the validation launch closes."}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="text-xs font-medium uppercase text-app-subtle">
                    Elapsed {formatElapsed(validationElapsedSeconds)}
                  </div>
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-text hover:bg-app-surfaceRaised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={validationCancelRequested}
                    onClick={() => void cancelRuntimeValidation()}
                    type="button"
                  >
                    {validationCancelRequested ? (
                      <RefreshCw
                        aria-hidden="true"
                        className="motion-safe:animate-spin"
                        size={16}
                      />
                    ) : (
                      <XCircle aria-hidden="true" size={16} />
                    )}
                    <span>
                      {validationCancelRequested ? "Cancelling" : "Cancel"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {commandResult ? (
          <div
            className="mt-4 rounded-md border border-app-border bg-app-surfaceRaised p-4"
            role={
              commandResult.requiresForceCloseConfirmation ? "alert" : "status"
            }
          >
            <div className="font-medium">{commandResult.title}</div>
            <p className="mt-1 text-sm text-app-muted">
              {commandResult.message}
            </p>
            {commandResult.nextStep ? (
              <p className="mt-2 text-sm text-app-subtle">
                {commandResult.nextStep}
              </p>
            ) : null}
            {commandResult.requiresForceCloseConfirmation ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-text hover:bg-app-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                  onClick={() => setCommandResult(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-10 rounded-md bg-app-danger px-4 text-sm font-semibold text-app-accentText hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger"
                  onClick={() =>
                    void runCommand("restartGame", {
                      forceCloseConfirmed: true
                    })
                  }
                  type="button"
                >
                  Force Close & Restart
                </button>
              </div>
            ) : null}
            {commandResult.canOpenRuntimeValidationFlow &&
            !isValidatedPackagedRuntime(snapshot) ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={busyCommand !== null}
                  onClick={() => void runRuntimeValidation()}
                  type="button"
                >
                  {runtimeValidationRunning ? (
                    <RefreshCw
                      aria-hidden="true"
                      className="motion-safe:animate-spin"
                      size={16}
                    />
                  ) : null}
                  <span>
                    {runtimeValidationRunning ? "Validating" : "Validate"}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div
            className="mt-4 rounded-md border border-app-danger/40 bg-app-danger/10 p-4 text-sm text-app-danger"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </section>
    </div>
  );
}
