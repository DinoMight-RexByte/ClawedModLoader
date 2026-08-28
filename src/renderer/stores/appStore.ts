import { create } from "zustand";

import type { AppSettings, ThemeMode } from "../../shared/contracts/app";
import { defaultAccentColor, normalizeThemeMode } from "../lib/theme";

export type NavigationPage =
  | "play"
  | "mods"
  | "availableMods"
  | "creator"
  | "profiles"
  | "loadOrder"
  | "modpacks"
  | "diagnostics"
  | "logBundler"
  | "settings";

interface AppStoreState {
  activePage: NavigationPage;
  themeMode: ThemeMode;
  accentColor: string;
  appSettings: AppSettings | null;
  profileRevision: number;
  setActivePage(page: NavigationPage): void;
  setThemeMode(mode: ThemeMode): void;
  setAccentColor(color: string): void;
  setAppSettings(settings: AppSettings): void;
  bumpProfileRevision(): void;
}

const themeModeStorageKey = "cmm.themeMode";
const accentStorageKey = "cmm.accentColor";

function readStoredThemeMode(): ThemeMode {
  return normalizeThemeMode(localStorage.getItem(themeModeStorageKey));
}

function readStoredAccentColor(): string {
  return localStorage.getItem(accentStorageKey) ?? defaultAccentColor;
}

export const useAppStore = create<AppStoreState>((set) => ({
  activePage: "play",
  themeMode: readStoredThemeMode(),
  accentColor: readStoredAccentColor(),
  appSettings: null,
  profileRevision: 0,
  setActivePage: (activePage) => set({ activePage }),
  setThemeMode: (themeMode) => {
    localStorage.setItem(themeModeStorageKey, themeMode);
    set({ themeMode });
  },
  setAccentColor: (accentColor) => {
    localStorage.setItem(accentStorageKey, accentColor);
    set({ accentColor });
  },
  setAppSettings: (appSettings) => set({ appSettings }),
  bumpProfileRevision: () =>
    set((state) => ({ profileRevision: state.profileRevision + 1 }))
}));
