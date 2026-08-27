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

import type { ProfileListSnapshot } from "../../shared/contracts/app";
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
  const bumpProfileRevision = useAppStore((state) => state.bumpProfileRevision);
  const setActivePage = useAppStore((state) => state.setActivePage);
  const [profiles, setProfiles] = useState<ProfileListSnapshot | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

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
    </div>
  );
}
