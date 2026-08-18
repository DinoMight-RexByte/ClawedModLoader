import {
  AlertTriangle,
  CheckCircle2,
  Power,
  RefreshCw,
  Rocket,
  ShieldAlert
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  LaunchCommandKind,
  LaunchCommandResult,
  PlaySnapshot
} from "../../shared/contracts/app";
import { StatusCard } from "../components/StatusCard";
import { useAppStore } from "../stores/appStore";

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

export function PlayPage(): ReactElement {
  const profileRevision = useAppStore((state) => state.profileRevision);
  const [snapshot, setSnapshot] = useState<PlaySnapshot | null>(null);
  const [commandResult, setCommandResult] =
    useState<LaunchCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCommand, setBusyCommand] = useState<LaunchCommandKind | null>(
    null
  );
  const refreshInFlight = useRef(false);

  const refreshSnapshot = useCallback(async () => {
    if (refreshInFlight.current) {
      return;
    }

    refreshInFlight.current = true;
    try {
      const nextSnapshot = await window.cmm
        .getPlaySnapshot()
        .catch((): PlaySnapshot | null => null);

      if (nextSnapshot) {
        setSnapshot(nextSnapshot);
      } else {
        setError("Play status is unavailable.");
      }
    } finally {
      refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshSnapshot();
  }, [profileRevision, refreshSnapshot]);

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
    forceCloseConfirmed = false
  ) => {
    setBusyCommand(kind);
    setError(null);

    try {
      const result = await window.cmm.runLaunchCommand({
        kind,
        forceCloseConfirmed
      });
      setCommandResult(result);
      await refreshSnapshot();
    } catch {
      setError("The command could not be completed.");
    } finally {
      setBusyCommand(null);
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
          detail={`Current launch mode: ${snapshot?.launchMode ?? "VANILLA"}`}
          label="Deployment Status"
          tone={deploymentTone(snapshot?.deploymentState)}
          value={
            snapshot ? formatDeployment(snapshot.deploymentState) : "Loading"
          }
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
        <div className="grid gap-3 sm:grid-cols-[minmax(220px,1fr)_minmax(170px,auto)_minmax(150px,auto)]">
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
        </div>

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
                  onClick={() => void runCommand("restartGame", true)}
                  type="button"
                >
                  Force Close & Restart
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
