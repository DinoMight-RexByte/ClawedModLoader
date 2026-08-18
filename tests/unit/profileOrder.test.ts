import { describe, expect, it } from "vitest";

import {
  moveModId,
  normalizeOrderedModIds,
  placeModRelative,
  setModPosition
} from "../../src/main/services/profileOrder";

describe("profile order operations", () => {
  it("normalizes persisted order without adding unselected mods", () => {
    expect(
      normalizeOrderedModIds(["core", "characters"], ["characters", "old"])
    ).toEqual(["characters", "core"]);
  });

  it("supports keyboard-style up and down moves", () => {
    expect(moveModId(["core", "characters", "skin"], "skin", "up")).toEqual([
      "core",
      "skin",
      "characters"
    ]);
    expect(moveModId(["core", "skin", "characters"], "skin", "down")).toEqual([
      "core",
      "characters",
      "skin"
    ]);
  });

  it("moves selected mods to the top and bottom", () => {
    expect(moveModId(["core", "characters", "skin"], "skin", "top")).toEqual([
      "skin",
      "core",
      "characters"
    ]);
    expect(
      moveModId(["skin", "core", "characters"], "skin", "bottom")
    ).toEqual(["core", "characters", "skin"]);
  });

  it("sets numeric positions using one-based indexing", () => {
    expect(setModPosition(["core", "characters", "skin"], "skin", 1)).toEqual([
      "skin",
      "core",
      "characters"
    ]);
    expect(setModPosition(["core", "characters", "skin"], "core", 99)).toEqual([
      "characters",
      "skin",
      "core"
    ]);
  });

  it("places a dragged mod before or after another mod", () => {
    expect(
      placeModRelative(["core", "characters", "skin"], "skin", "core", "before")
    ).toEqual(["skin", "core", "characters"]);
    expect(
      placeModRelative(["core", "characters", "skin"], "core", "skin", "after")
    ).toEqual(["characters", "skin", "core"]);
  });
});
