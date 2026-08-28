import {
  Boxes,
  CheckCircle2,
  ClipboardList,
  Download,
  FileArchive,
  FolderTree,
  Gauge,
  PackageOpen,
  Play,
  RefreshCw,
  Settings,
  SlidersHorizontal
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import type {
  AppSettings,
  AppUpdateSnapshot,
  ProfileListSnapshot
} from "../../shared/contracts/app";
import logoUrl from "../../../assets/branding/logo.svg";
import type { NavigationPage } from "../stores/appStore";
import { useAppStore } from "../stores/appStore";

const navigationItems: Array<{
  id: NavigationPage;
  label: string;
  icon: ReactNode;
}> = [
  { id: "play", label: "Play", icon: <Play aria-hidden="true" size={18} /> },
  { id: "mods", label: "Mods", icon: <Boxes aria-hidden="true" size={18} /> },
  {
    id: "availableMods",
    label: "Available",
    icon: <Download aria-hidden="true" size={18} />
  },
  {
    id: "creator",
    label: "Creator",
    icon: <FolderTree aria-hidden="true" size={18} />
  },
  {
    id: "profiles",
    label: "Profiles",
    icon: <ClipboardList aria-hidden="true" size={18} />
  },
  {
    id: "loadOrder",
    label: "Load Order",
    icon: <SlidersHorizontal aria-hidden="true" size={18} />
  },
  {
    id: "modpacks",
    label: "Modpacks",
    icon: <PackageOpen aria-hidden="true" size={18} />
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    icon: <Gauge aria-hidden="true" size={18} />
  },
  {
    id: "logBundler",
    label: "Log Bundler",
    icon: <FileArchive aria-hidden="true" size={18} />
  },
  {
    id: "settings",
    label: "Settings",
    icon: <Settings aria-hidden="true" size={18} />
  }
];

export function AppShell({
  children
}: {
  children: ReactNode;
}): ReactElement {
  const activePage = useAppStore((state) => state.activePage);
  const profileRevision = useAppStore((state) => state.profileRevision);
  const settings = useAppStore((state) => state.appSettings);
  const bumpProfileRevision = useAppStore((state) => state.bumpProfileRevision);
  const setSettings = useAppStore((state) => state.setAppSettings);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const [profiles, setProfiles] = useState<ProfileListSnapshot | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateSnapshot | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptRemember, setPromptRemember] = useState(false);
  const [promptDismissedVersion, setPromptDismissedVersion] = useState<
    string | null
  >(null);
  const [acceptedUpdateVersion, setAcceptedUpdateVersion] = useState<
    string | null
  >(null);

  const loadProfiles = useCallback(async (): Promise<void> => {
    const snapshot = await window.cmm
      .listProfiles()
      .catch((): ProfileListSnapshot | null => null);

    if (snapshot) {
      setProfiles(snapshot);
      setProfileError(null);
    } else {
      setProfileError("Profiles unavailable");
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles, profileRevision]);

  useEffect(() => {
    void window.cmm
      .getAppUpdateSnapshot()
      .then(setAppUpdate)
      .catch(() => undefined);
    void window.cmm
      .getAppSettings()
      .then(setSettings)
      .catch(() => undefined);
    return window.cmm.onAppUpdateEvent(setAppUpdate);
  }, [setSettings]);

  const savePromptPreference = async (): Promise<void> => {
    if (!promptRemember) {
      return;
    }

    setSettings(
      await window.cmm.setSuppressAppUpdatePrompt({
        enabled: true
      })
    );
  };

  const dismissUpdatePrompt = async (version: string): Promise<void> => {
    setPromptBusy(true);
    setPromptError(null);

    try {
      await savePromptPreference();
      setPromptDismissedVersion(version);
    } catch {
      setPromptError("The update prompt preference could not be saved.");
    } finally {
      setPromptBusy(false);
    }
  };

  const downloadPromptUpdate = async (version: string): Promise<void> => {
    setPromptBusy(true);
    setPromptError(null);

    try {
      await savePromptPreference();
      setPromptDismissedVersion(version);
      setAcceptedUpdateVersion(version);
      setAppUpdate(await window.cmm.downloadAppUpdate());
    } catch {
      setPromptError("The app update could not be downloaded.");
    } finally {
      setPromptBusy(false);
    }
  };

  const installPromptUpdate = async (): Promise<void> => {
    setPromptBusy(true);
    setPromptError(null);

    try {
      setAppUpdate(await window.cmm.installAppUpdate());
    } catch {
      setPromptError("The downloaded app update could not be started.");
      setPromptBusy(false);
    }
  };

  const switchProfile = async (profileId: string): Promise<void> => {
    if (!profiles || profileId === profiles.activeProfileId) {
      return;
    }

    setProfileBusy(true);
    try {
      const result = await window.cmm.switchProfile({ id: profileId });
      setProfiles({
        activeProfileId: result.activeProfile.id,
        profiles: result.profiles
      });
      bumpProfileRevision();
    } catch {
      setProfileError("Profile switch failed");
    } finally {
      setProfileBusy(false);
    }
  };

  const activeProfile = profiles?.profiles.find(
    (profile) => profile.id === profiles.activeProfileId
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app-bg text-app-text lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-app-border bg-app-surface px-4 py-3 lg:w-60 lg:border-b-0 lg:border-r lg:py-5">
        <div className="mb-3 lg:mb-7">
          <div className="flex items-center gap-3">
            <img
              alt=""
              className="h-10 w-10 rounded-md"
              height={40}
              src={logoUrl}
              width={40}
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase text-app-muted">
                CMM
              </div>
              <div className="mt-1 truncate text-lg font-semibold">
                Clawed Mod Manager
              </div>
              <div className="mt-0.5 text-xs text-app-subtle">
                Version {appUpdate?.currentVersion ?? "..."}
              </div>
            </div>
          </div>
        </div>

        <nav aria-label="Primary">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0 lg:pb-0">
            {navigationItems.map((item) => {
              const isActive = item.id === activePage;

              return (
                <button
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-10 min-w-max shrink-0 items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent lg:w-full lg:min-w-0 ${
                    isActive
                      ? "bg-app-accent text-app-accentText"
                      : "text-app-muted hover:bg-app-surfaceRaised hover:text-app-text"
                  }`}
                  key={item.id}
                  onClick={() => setActivePage(item.id)}
                  type="button"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-app-border bg-app-bg px-4 py-3 sm:px-6 lg:min-h-16 lg:flex-nowrap lg:py-0">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase text-app-subtle">
              Active Profile
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-app-muted">
              {activeProfile ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="text-app-success"
                  size={16}
                />
              ) : (
                <RefreshCw aria-hidden="true" size={16} />
              )}
              <span className="truncate">
                {activeProfile?.name ?? profileError ?? "Loading profiles"}
              </span>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
            {appUpdateNotice(appUpdate) ? (
              <button
                className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-app-border bg-app-surface px-3 text-sm font-medium text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                onClick={() => setActivePage("settings")}
                title="App update status"
                type="button"
              >
                <Download aria-hidden="true" size={16} />
                <span className="truncate">{appUpdateNotice(appUpdate)}</span>
              </button>
            ) : null}
            <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              <ClipboardList
                aria-hidden="true"
                className="text-app-subtle"
                size={18}
              />
              <span className="sr-only">Switch active profile</span>
              <select
                aria-label="Switch active profile"
                className="h-10 w-full min-w-0 rounded-md border border-app-border bg-app-surface px-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60 sm:w-56"
                disabled={profileBusy || !profiles}
                onChange={(event) => void switchProfile(event.target.value)}
                value={profiles?.activeProfileId ?? ""}
              >
                {profiles?.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="Refresh profiles"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-app-border text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
              disabled={profileBusy}
              onClick={() => void loadProfiles()}
              title="Refresh profiles"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={17} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-5">
            {children}
          </div>
        </div>
      </main>

      <AppUpdatePrompt
        acceptedVersion={acceptedUpdateVersion}
        busy={promptBusy}
        dismissedVersion={promptDismissedVersion}
        error={promptError}
        onDismiss={(version) => void dismissUpdatePrompt(version)}
        onDownload={(version) => void downloadPromptUpdate(version)}
        onInstall={() => void installPromptUpdate()}
        onRememberChange={setPromptRemember}
        remember={promptRemember}
        settings={settings}
        update={appUpdate}
      />
    </div>
  );
}

function appUpdateNotice(update: AppUpdateSnapshot | null): string | null {
  switch (update?.status) {
    case "checking":
      return "Checking for updates";
    case "available":
      return `Update ${update.availableVersion ?? ""} available`.trim();
    case "downloading":
      return update.progress
        ? `Downloading ${Math.round(update.progress.percent)}%`
        : "Downloading update";
    case "downloaded":
      return `Update ${update.availableVersion ?? ""} ready`.trim();
    case "error":
      return "Update check failed";
    default:
      return null;
  }
}

function AppUpdatePrompt({
  acceptedVersion,
  busy,
  dismissedVersion,
  error,
  onDismiss,
  onDownload,
  onInstall,
  onRememberChange,
  remember,
  settings,
  update
}: {
  acceptedVersion: string | null;
  busy: boolean;
  dismissedVersion: string | null;
  error: string | null;
  onDismiss(version: string): void;
  onDownload(version: string): void;
  onInstall(): void;
  onRememberChange(remember: boolean): void;
  remember: boolean;
  settings: AppSettings | null;
  update: AppUpdateSnapshot | null;
}): ReactElement | null {
  const version = update?.availableVersion ?? null;
  const showAvailable =
    update?.status === "available" &&
    version !== null &&
    settings?.suppressAppUpdatePrompt !== true &&
    dismissedVersion !== version;
  const showDownloaded =
    update?.status === "downloaded" &&
    version !== null &&
    acceptedVersion === version;

  if (!showAvailable && !showDownloaded) {
    return null;
  }

  return (
    <div
      aria-labelledby="app-update-prompt-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg border border-app-border bg-app-surface p-5 shadow-xl">
        <h2 className="text-lg font-semibold" id="app-update-prompt-title">
          {showDownloaded ? "Update Ready" : "Update Available"}
        </h2>
        <p className="mt-2 text-sm text-app-muted">
          {showDownloaded
            ? `Version ${version} is ready to install. Restart CMM to finish the update.`
            : `Version ${version} is available. Update CMM now?`}
        </p>

        {showAvailable ? (
          <label className="mt-4 flex items-start gap-3 text-sm text-app-muted">
            <input
              checked={remember}
              className="mt-1 h-4 w-4 accent-app-accent"
              disabled={busy}
              onChange={(event) => onRememberChange(event.target.checked)}
              type="checkbox"
            />
            <span>Remember this setting and do not prompt me on launch.</span>
          </label>
        ) : null}

        {error ? (
          <div
            className="mt-4 rounded-md border border-app-danger/40 bg-app-danger/10 p-3 text-sm text-app-danger"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          {showAvailable ? (
            <button
              className="h-10 rounded-md border border-app-border px-4 text-sm font-semibold text-app-text hover:bg-app-surfaceRaised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
              disabled={busy}
              onClick={() => {
                if (version) {
                  onDismiss(version);
                }
              }}
              type="button"
            >
              Not Now
            </button>
          ) : null}
          <button
            className="h-10 rounded-md bg-app-accent px-4 text-sm font-semibold text-app-accentText focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
            disabled={busy}
            onClick={() => {
              if (showDownloaded) {
                onInstall();
                return;
              }

              if (version) {
                onDownload(version);
              }
            }}
            type="button"
          >
            {showDownloaded
              ? "Restart to Update"
              : busy
                ? "Downloading"
                : "Update Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
