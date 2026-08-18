import type { ThemeMode } from "../../shared/contracts/app";

export const defaultAccentColor = "#4fd1c5";

export const accentColorOptions = [
  { label: "Teal", value: "#4fd1c5" },
  { label: "Green", value: "#56d38c" },
  { label: "Gold", value: "#efb95c" },
  { label: "Coral", value: "#f16677" },
  { label: "Blue", value: "#6ea8ff" }
] as const;

export function normalizeThemeMode(mode: string | null): ThemeMode {
  if (mode === "light" || mode === "system") {
    return mode;
  }

  return "dark";
}

export function hexToRgbTriplet(hex: string): string {
  const normalized = hex.trim().replace("#", "");
  const valid = /^[0-9a-fA-F]{6}$/.test(normalized)
    ? normalized
    : defaultAccentColor.replace("#", "");

  const red = Number.parseInt(valid.slice(0, 2), 16);
  const green = Number.parseInt(valid.slice(2, 4), 16);
  const blue = Number.parseInt(valid.slice(4, 6), 16);

  return `${red} ${green} ${blue}`;
}

export function resolveThemeMode(
  mode: ThemeMode,
  prefersLight: boolean
): "dark" | "light" {
  if (mode === "system") {
    return prefersLight ? "light" : "dark";
  }

  return mode;
}
