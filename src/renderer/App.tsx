import type { ReactElement } from "react";

import { AppShell } from "./components/AppShell";
import { FirstRunOnboarding } from "./components/FirstRunOnboarding";
import { useTheme } from "./hooks/useTheme";
import { CreatorAssetsPage } from "./pages/CreatorAssetsPage";
import { CreatorViewportWindowPage } from "./pages/CreatorViewportWindowPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { LoadOrderPage } from "./pages/LoadOrderPage";
import { ModsPage } from "./pages/ModsPage";
import { ModpacksPage } from "./pages/ModpacksPage";
import { PlayPage } from "./pages/PlayPage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { useAppStore } from "./stores/appStore";

export function App(): ReactElement {
  useTheme();
  const activePage = useAppStore((state) => state.activePage);

  if (isCreatorViewportPopout()) {
    return <CreatorViewportWindowPage />;
  }

  return (
    <AppShell>
      {activePage === "play" ? <PlayPage /> : null}
      {activePage === "mods" ? <ModsPage /> : null}
      {activePage === "creator" ? <CreatorAssetsPage /> : null}
      {activePage === "profiles" ? <ProfilesPage /> : null}
      {activePage === "loadOrder" ? <LoadOrderPage /> : null}
      {activePage === "modpacks" ? <ModpacksPage /> : null}
      {activePage === "diagnostics" ? <DiagnosticsPage /> : null}
      {activePage === "settings" ? <SettingsPage /> : null}
      <FirstRunOnboarding />
    </AppShell>
  );
}

function isCreatorViewportPopout(): boolean {
  return (
    new URLSearchParams(window.location.search).get("creatorViewport") ===
    "popout"
  );
}
