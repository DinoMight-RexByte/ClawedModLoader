import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AppSettings } from "../../src/shared/contracts/app";
import type { SettingsServiceContract } from "../../src/shared/contracts/services";
import { SteamGameLocator } from "../../src/main/services/gameLocator";
import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import type {
  SteamPathCandidate,
  SteamPathProvider
} from "../../src/main/services/steamPathProvider";

class FakeSettingsService implements SettingsServiceContract {
  constructor(
    settings: Partial<AppSettings> = {}
  ) {
    this.settings = {
      manualGameDirectory: null,
      autoUpdatePackagedRuntime: true,
      ...settings
    };
  }

  private settings: AppSettings;

  async getSettings(): Promise<AppSettings> {
    return this.settings;
  }

  async setManualGameDirectory(
    gameDirectory: string | null
  ): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      manualGameDirectory: gameDirectory
    };
    return this.settings;
  }

  async setAutoUpdatePackagedRuntime(
    enabled: boolean
  ): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      autoUpdatePackagedRuntime: enabled
    };
    return this.settings;
  }
}

class FakeSteamPathProvider implements SteamPathProvider {
  constructor(private readonly candidates: SteamPathCandidate[]) {}

  async findSteamPaths(): Promise<SteamPathCandidate[]> {
    return this.candidates;
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

function vdfPath(targetPath: string): string {
  return targetPath.replaceAll("\\", "\\\\");
}

async function createShippingExecutable(
  gameInstallPath: string,
  fileName = "UnexpectedTitle-Win64-Shipping.exe"
): Promise<string> {
  const executable = path.join(
    gameInstallPath,
    "Game",
    "Binaries",
    "Win64",
    fileName
  );
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, "");
  return executable;
}

async function writeLibraryFolders(
  steamPath: string,
  libraries: string[]
): Promise<void> {
  await mkdir(path.join(steamPath, "steamapps"), { recursive: true });
  const entries = libraries
    .map(
      (libraryPath, index) => `
  "${index}"
  {
    "path" "${vdfPath(libraryPath)}"
    "apps"
    {
      "3394840" "1"
    }
  }`
    )
    .join("\n");

  await writeFile(
    path.join(steamPath, "steamapps", "libraryfolders.vdf"),
    `"libraryfolders"\n{\n${entries}\n}\n`
  );
}

async function writeAppManifest(
  libraryPath: string,
  installDir: string
): Promise<void> {
  await mkdir(path.join(libraryPath, "steamapps"), { recursive: true });
  await writeFile(
    path.join(libraryPath, "steamapps", "appmanifest_3394840.acf"),
    `"AppState"
{
  "appid" "3394840"
  "name" "Clawed"
  "installdir" "${installDir}"
}
`
  );
}

describe("game locator", () => {
  it("finds Clawed across multiple Steam libraries", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-locator-"));
    const steamPath = path.join(tempRoot, "Steam");
    const libraryA = path.join(tempRoot, "LibraryA");
    const libraryB = path.join(tempRoot, "LibraryB");
    const gameInstallPath = path.join(
      libraryB,
      "steamapps",
      "common",
      "ClawedRelease"
    );
    const executable = await createShippingExecutable(gameInstallPath);
    await writeLibraryFolders(steamPath, [libraryA, libraryB]);
    await writeAppManifest(libraryB, "ClawedRelease");

    const locator = new SteamGameLocator(
      new FakeSettingsService(),
      new FakeSteamPathProvider([{ path: steamPath, source: "commonPath" }]),
      new NullLifecycleLogger()
    );

    const discovery = await locator.rescan();

    expect(discovery.discoveryStatus).toBe("READY");
    expect(discovery.steamLibrary).toBe(path.normalize(libraryB));
    expect(discovery.gameInstallPath).toBe(gameInstallPath);
    expect(discovery.gameExecutable).toBe(executable);
  });

  it("reports missing game when the app manifest is absent", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-locator-"));
    const steamPath = path.join(tempRoot, "Steam");
    const library = path.join(tempRoot, "Library");
    await writeLibraryFolders(steamPath, [library]);

    const locator = new SteamGameLocator(
      new FakeSettingsService(),
      new FakeSteamPathProvider([{ path: steamPath, source: "registry" }]),
      new NullLifecycleLogger()
    );

    expect((await locator.rescan()).discoveryStatus).toBe(
      "GAME_NOT_INSTALLED"
    );
  });

  it("supports a manual game directory override", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-locator-"));
    const manualInstallPath = path.join(tempRoot, "ManualClawed");
    const executable = await createShippingExecutable(
      manualInstallPath,
      "ReleaseCandidate-Win64-Shipping.exe"
    );

    const locator = new SteamGameLocator(
      new FakeSettingsService({ manualGameDirectory: manualInstallPath }),
      new FakeSteamPathProvider([]),
      new NullLifecycleLogger()
    );

    const discovery = await locator.rescan();

    expect(discovery.discoveryStatus).toBe("READY");
    expect(discovery.source).toBe("manual");
    expect(discovery.gameInstallPath).toBe(path.normalize(manualInstallPath));
    expect(discovery.gameExecutable).toBe(executable);
  });

  it("reports manual override directories that do not exist", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-locator-"));
    const missingPath = path.join(tempRoot, "MissingClawed");

    const locator = new SteamGameLocator(
      new FakeSettingsService({ manualGameDirectory: missingPath }),
      new FakeSteamPathProvider([]),
      new NullLifecycleLogger()
    );

    expect((await locator.rescan()).discoveryStatus).toBe(
      "MANUAL_OVERRIDE_INVALID"
    );
  });
});
