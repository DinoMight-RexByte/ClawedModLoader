import { describe, expect, it } from "vitest";

import {
  hexToRgbTriplet,
  normalizeThemeMode,
  resolveThemeMode
} from "../../src/renderer/lib/theme";

describe("theme helpers", () => {
  it("defaults unknown theme modes to dark", () => {
    expect(normalizeThemeMode("blue")).toBe("dark");
    expect(normalizeThemeMode(null)).toBe("dark");
  });

  it("converts accent colors to rgb triplets", () => {
    expect(hexToRgbTriplet("#4fd1c5")).toBe("79 209 197");
  });

  it("resolves system theme from media preference", () => {
    expect(resolveThemeMode("system", true)).toBe("light");
    expect(resolveThemeMode("system", false)).toBe("dark");
  });
});
