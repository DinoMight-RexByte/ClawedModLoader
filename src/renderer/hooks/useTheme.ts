import { useEffect } from "react";

import { hexToRgbTriplet, resolveThemeMode } from "../lib/theme";
import { useAppStore } from "../stores/appStore";

export function useTheme(): void {
  const themeMode = useAppStore((state) => state.themeMode);
  const accentColor = useAppStore((state) => state.accentColor);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    const applyTheme = () => {
      const resolvedTheme = resolveThemeMode(themeMode, mediaQuery.matches);
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themeMode = themeMode;
      document.documentElement.style.setProperty(
        "--color-accent",
        hexToRgbTriplet(accentColor)
      );
    };

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);

    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [accentColor, themeMode]);
}
