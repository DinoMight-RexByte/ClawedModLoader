import {
  CheckCircle2,
  Copy,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  ModProblem,
  ProfileActionResult,
  ProfileListSnapshot,
  ProfileMissingModsSnapshot
} from "../../shared/contracts/app";
import { ProblemDetails } from "../components/ProblemDetails";
import { useAppStore } from "../stores/appStore";

function profileMessage(result: ProfileActionResult): string {
  if (result.status === "ok") {
    return "Profiles updated.";
  }
  if (result.status === "blocked") {
    return "Profile action was blocked.";
  }
  if (result.status === "notFound") {
    return "Profile could not be found.";
  }
  return "Profile action failed.";
}

export function ProfilesPage(): ReactElement {
  const profileRevision = useAppStore((state) => state.profileRevision);
  const bumpProfileRevision = useAppStore((state) => state.bumpProfileRevision);
  const [snapshot, setSnapshot] = useState<ProfileListSnapshot | null>(null);
  const [missingSnapshot, setMissingSnapshot] =
    useState<ProfileMissingModsSnapshot | null>(null);
  const [newProfileName, setNewProfileName] = useState("New Profile");
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<ModProblem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshProfiles = useCallback(async () => {
    const [nextSnapshot, nextMissingSnapshot] = await Promise.all([
      window.cmm.listProfiles(),
      window.cmm.getMissingProfileMods()
    ]);
    setSnapshot(nextSnapshot);
    setMissingSnapshot(nextMissingSnapshot);
    setRenameValues(
      Object.fromEntries(
        nextSnapshot.profiles.map((profile) => [profile.id, profile.name])
      )
    );
  }, []);

  useEffect(() => {
    void refreshProfiles().catch(() => {
      setError("Profiles are unavailable.");
    });
  }, [profileRevision, refreshProfiles]);

  const runAction = async (
    action: () => Promise<ProfileActionResult>
  ): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const result = await action();
      setMessage(profileMessage(result));
      setProblems(result.problems);
      if (result.status === "ok") {
        bumpProfileRevision();
      }
      await refreshProfiles();
    } catch {
      setError("The profile action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const profileCount = snapshot?.profiles.length ?? 0;
  const canCreateProfile = !busy && newProfileName.trim().length > 0;
  const createProfile = async (): Promise<void> => {
    if (!canCreateProfile) {
      return;
    }

    await runAction(() => window.cmm.createProfile({ name: newProfileName }));
  };

  const acceptMissingMods = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const [profileResult, modpackResult] = await Promise.all([
        window.cmm.acceptMissingProfileMods(),
        window.cmm.acceptMissingModpackMods()
      ]);
      setMessage(
        `Accepted missing mods. Updated ${profileResult.profilesUpdated} profiles and ${modpackResult.entriesUpdated} modpack records.`
      );
      setProblems([...profileResult.problems, ...modpackResult.problems]);
      bumpProfileRevision();
      await refreshProfiles();
    } catch {
      setError("Missing mods could not be accepted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-app-accent">Profiles</p>
          <h1 className="mt-1 text-3xl font-semibold">Mod Profiles</h1>
          <p className="mt-2 max-w-2xl text-sm text-app-muted">
            Profiles hold exact versions, enabled state, launch preference, and
            logical order while packages remain shared.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center gap-2 rounded-md border border-app-border px-4 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
          disabled={busy}
          onClick={() => void refreshProfiles()}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={18} />
          Refresh
        </button>
      </header>

      <section className="rounded-lg border border-app-border bg-app-surface p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <label>
            <span className="sr-only">New profile name</span>
            <input
              className="h-10 w-full rounded-md border border-app-border bg-app-surfaceRaised px-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
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
            disabled={!canCreateProfile}
            onClick={() => void createProfile()}
            type="button"
          >
            <Plus aria-hidden="true" size={18} />
            Create
          </button>
        </div>
      </section>

      {missingSnapshot && missingSnapshot.totalMissing > 0 ? (
        <section
          className="rounded-lg border border-app-warning/40 bg-app-warning/10 p-4"
          role="status"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-app-warning">
                Missing Mods In Profiles
              </h2>
              <p className="mt-1 text-sm text-app-muted">
                These profiles reference mod versions that are no longer
                installed. Accepting removes only those missing references from
                profile tracking.
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
          <div className="mt-3 grid gap-2">
            {missingSnapshot.profiles.map((profile) => (
              <div
                className="rounded-md border border-app-border bg-app-surface p-3 text-sm"
                key={profile.profileId}
              >
                <div className="font-medium">{profile.profileName}</div>
                <div className="mt-1 text-app-muted">
                  {profile.missingMods
                    .map(
                      (mod) =>
                        `${mod.id} ${mod.version} ${
                          mod.enabled ? "(enabled)" : "(disabled)"
                        }`
                    )
                    .join(", ")}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {message || error ? (
        <section
          className={`rounded-lg border p-4 ${
            error
              ? "border-app-danger/40 bg-app-danger/10 text-app-danger"
              : "border-app-border bg-app-surface"
          }`}
          role={error ? "alert" : "status"}
        >
          <div className="font-medium">{error ?? message}</div>
          {problems.length ? (
            <div className="mt-3">
              <ProblemDetails problems={problems} />
            </div>
          ) : null}
        </section>
      ) : null}

      {snapshot ? (
        <section className="grid gap-3">
          {snapshot.profiles.map((profile) => (
            <article
              className={`rounded-lg border p-4 ${
                profile.isActive
                  ? "border-app-accent bg-app-accent/10"
                  : "border-app-border bg-app-surface"
              }`}
              key={profile.id}
            >
              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{profile.name}</h2>
                    {profile.isActive ? (
                      <span className="inline-flex items-center gap-1 rounded bg-app-success/10 px-2 py-1 text-xs font-semibold text-app-success">
                        <CheckCircle2 aria-hidden="true" size={14} />
                        Active
                      </span>
                    ) : null}
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm text-app-muted sm:grid-cols-3">
                    <div>
                      <dt className="text-app-subtle">selected</dt>
                      <dd>{profile.modCount}</dd>
                    </div>
                    <div>
                      <dt className="text-app-subtle">enabled</dt>
                      <dd>{profile.enabledCount}</dd>
                    </div>
                    <div>
                      <dt className="text-app-subtle">launch</dt>
                      <dd>{profile.preferredLaunchMode}</dd>
                    </div>
                  </dl>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[220px_repeat(4,auto)] xl:justify-end">
                  <label>
                    <span className="sr-only">Rename {profile.name}</span>
                    <input
                      className="h-9 w-full rounded-md border border-app-border bg-app-surfaceRaised px-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                      onChange={(event) =>
                        setRenameValues((values) => ({
                          ...values,
                          [profile.id]: event.target.value
                        }))
                      }
                      value={renameValues[profile.id] ?? profile.name}
                    />
                  </label>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                    disabled={
                      busy ||
                      (renameValues[profile.id] ?? profile.name).trim()
                        .length === 0
                    }
                    onClick={() =>
                      void runAction(() =>
                        window.cmm.renameProfile({
                          id: profile.id,
                          name: renameValues[profile.id] ?? profile.name
                        })
                      )
                    }
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={16} />
                    Rename
                  </button>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                    disabled={busy}
                    onClick={() =>
                      void runAction(() =>
                        window.cmm.duplicateProfile({ id: profile.id })
                      )
                    }
                    type="button"
                  >
                    <Copy aria-hidden="true" size={16} />
                    Duplicate
                  </button>
                  <button
                    className="h-9 rounded-md border border-app-border px-3 text-sm font-semibold text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                    disabled={busy || profile.isActive}
                    onClick={() =>
                      void runAction(() =>
                        window.cmm.switchProfile({ id: profile.id })
                      )
                    }
                    type="button"
                  >
                    Switch
                  </button>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-app-danger/40 px-3 text-sm font-semibold text-app-danger hover:bg-app-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger disabled:opacity-60"
                    disabled={busy || profileCount <= 1}
                    onClick={() =>
                      void runAction(() =>
                        window.cmm.deleteProfile({ id: profile.id })
                      )
                    }
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="rounded-lg border border-app-border bg-app-surface p-4 text-app-muted">
          Loading profiles
        </section>
      )}
    </div>
  );
}
