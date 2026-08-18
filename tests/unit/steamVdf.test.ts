import { describe, expect, it } from "vitest";

import {
  parseAppManifest,
  parseSteamLibraryFolders
} from "../../src/main/services/steam/vdf";

describe("Steam VDF parsing", () => {
  it("parses modern libraryfolders.vdf entries", () => {
    const libraries = parseSteamLibraryFolders(`
"libraryfolders"
{
  "0"
  {
    "path" "C:\\\\Program Files (x86)\\\\Steam"
    "apps"
    {
      "123" "1"
    }
  }
  "1"
  {
    "path" "D:\\\\SteamLibrary"
    "apps"
    {
      "3394840" "1"
    }
  }
}
`);

    expect(libraries).toEqual([
      {
        path: "C:\\Program Files (x86)\\Steam",
        hasTargetApp: false
      },
      {
        path: "D:\\SteamLibrary",
        hasTargetApp: true
      }
    ]);
  });

  it("parses appmanifest installdir without assuming an executable name", () => {
    const manifest = parseAppManifest(`
"AppState"
{
  "appid" "3394840"
  "name" "Clawed"
  "installdir" "Clawed Release"
}
`);

    expect(manifest).toEqual({
      appId: "3394840",
      installDir: "Clawed Release",
      name: "Clawed",
      buildId: null,
      lastUpdated: null
    });
  });
});
