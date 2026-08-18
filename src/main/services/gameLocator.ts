import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  CLAWED_STEAM_APP_ID,
  type DiagnosticError,
  type GameDiscovery,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  GameLocatorContract,
  SettingsServiceContract
} from "../../shared/contracts/services";
import { findUnrealShippingExecutable } from "./gameExecutableDiscovery";
import type { LifecycleLogger } from "./lifecycleLogger";
import type { SteamPathProvider } from "./steamPathProvider";
import {
  parseAppManifest,
  parseSteamLibraryFolders
} from "./steam/vdf";

interface SteamDiscoveryResult {
  steamPath: string | null;
  libraries: Array<{
    path: string;
    appManifestPath: string | null;
  }>;
  errors: DiagnosticError[];
}

async function exists(targetPath: string): Promise<boolean> {
  return access(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function isDirectory(targetPath: string): Promise<boolean> {
  const targetStat = await stat(targetPath).catch(() => null);
  return targetStat?.isDirectory() ?? false;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const item of paths) {
    const normalized = path.normalize(item).toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(path.normalize(item));
  }

  return unique;
}

function diagnosticError(
  code: string,
  message: string
): DiagnosticError {
  return {
    category: "gameLocator",
    code,
    message
  };
}

export class SteamGameLocator implements GameLocatorContract {
  private cachedDiscovery: GameDiscovery | null = null;

  constructor(
    private readonly settingsService: SettingsServiceContract,
    private readonly steamPathProvider: SteamPathProvider,
    private readonly logger: LifecycleLogger
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "gameLocator",
      label: "Game Locator",
      status: "ready",
      detail: "Discovers Steam libraries, app manifests, and the Clawed executable."
    };
  }

  async discover(): Promise<GameDiscovery> {
    if (!this.cachedDiscovery) {
      this.cachedDiscovery = await this.rescan();
    }

    return this.cachedDiscovery;
  }

  async rescan(): Promise<GameDiscovery> {
    const settings = await this.settingsService.getSettings();
    const steamDiscovery = await this.discoverSteam();
    const base: Omit<GameDiscovery, "discoveryStatus"> = {
      appId: CLAWED_STEAM_APP_ID,
      steamPath: steamDiscovery.steamPath,
      steamLibrary: null,
      steamLibraries: steamDiscovery.libraries,
      appManifestPath: null,
      gameInstallPath: null,
      gameExecutable: null,
      source: "none" as const,
      manualOverride: settings.manualGameDirectory,
      diagnosticErrors: steamDiscovery.errors,
      discoveredAt: new Date().toISOString()
    };

    const discovery = settings.manualGameDirectory
      ? await this.discoverFromManualOverride(
          settings.manualGameDirectory,
          base
        )
      : await this.discoverFromSteam(base);

    this.cachedDiscovery = discovery;
    await this.logger.log({
      category: "gameLocator",
      action: "rescan",
      result: discovery.discoveryStatus === "READY" ? "ok" : "blocked",
      discoveryStatus: discovery.discoveryStatus
    });

    return discovery;
  }

  async getExecutablePath(): Promise<string | null> {
    return (await this.discover()).gameExecutable;
  }

  private async discoverSteam(): Promise<SteamDiscoveryResult> {
    const candidates = await this.steamPathProvider.findSteamPaths();
    const errors: DiagnosticError[] = [];
    const libraryPaths: string[] = [];

    for (const candidate of candidates) {
      const libraryFoldersPath = path.join(
        candidate.path,
        "steamapps",
        "libraryfolders.vdf"
      );

      if (!(await exists(libraryFoldersPath))) {
        libraryPaths.push(candidate.path);
        continue;
      }

      try {
        const content = await readFile(libraryFoldersPath, "utf8");
        const parsedLibraries = parseSteamLibraryFolders(
          content,
          candidate.path
        );
        libraryPaths.push(
          ...parsedLibraries.map((library) => library.path)
        );
      } catch {
        errors.push(
          diagnosticError(
            "STEAM_LIBRARYFOLDERS_PARSE_FAILED",
            "Steam library folders could not be parsed."
          )
        );
        libraryPaths.push(candidate.path);
      }
    }

    const libraries = await Promise.all(
      uniquePaths(libraryPaths).map(async (libraryPath) => {
        const appManifestPath = path.join(
          libraryPath,
          "steamapps",
          `appmanifest_${CLAWED_STEAM_APP_ID}.acf`
        );

        return {
          path: libraryPath,
          appManifestPath: (await exists(appManifestPath))
            ? appManifestPath
            : null
        };
      })
    );

    return {
      steamPath: candidates[0]?.path ?? null,
      libraries,
      errors
    };
  }

  private async discoverFromManualOverride(
    manualGameDirectory: string,
    base: Omit<GameDiscovery, "discoveryStatus">
  ): Promise<GameDiscovery> {
    if (!(await isDirectory(manualGameDirectory))) {
      return {
        ...base,
        source: "manual",
        discoveryStatus: "MANUAL_OVERRIDE_INVALID",
        diagnosticErrors: [
          ...base.diagnosticErrors,
          diagnosticError(
            "MANUAL_OVERRIDE_NOT_DIRECTORY",
            "The manual Clawed folder does not exist or is not a directory."
          )
        ]
      };
    }

    const gameExecutable =
      await findUnrealShippingExecutable(manualGameDirectory);

    return {
      ...base,
      source: "manual",
      gameInstallPath: path.normalize(manualGameDirectory),
      gameExecutable,
      discoveryStatus: gameExecutable ? "READY" : "EXECUTABLE_NOT_FOUND",
      diagnosticErrors: gameExecutable
        ? base.diagnosticErrors
        : [
            ...base.diagnosticErrors,
            diagnosticError(
              "SHIPPING_EXECUTABLE_NOT_FOUND",
              "No Unreal shipping executable was found in the selected Clawed folder."
            )
          ]
    };
  }

  private async discoverFromSteam(
    base: Omit<GameDiscovery, "discoveryStatus">
  ): Promise<GameDiscovery> {
    if (!base.steamPath) {
      return {
        ...base,
        discoveryStatus: "STEAM_NOT_FOUND",
        diagnosticErrors: [
          ...base.diagnosticErrors,
          diagnosticError(
            "STEAM_NOT_FOUND",
            "Steam could not be found on this Windows installation."
          )
        ]
      };
    }

    for (const library of base.steamLibraries) {
      if (!library.appManifestPath) {
        continue;
      }

      try {
        const manifest = parseAppManifest(
          await readFile(library.appManifestPath, "utf8")
        );

        if (manifest.appId !== CLAWED_STEAM_APP_ID || !manifest.installDir) {
          continue;
        }

        const gameInstallPath = path.join(
          library.path,
          "steamapps",
          "common",
          manifest.installDir
        );
        const gameExecutable =
          await findUnrealShippingExecutable(gameInstallPath);

        return {
          ...base,
          source: "steam",
          steamLibrary: library.path,
          appManifestPath: library.appManifestPath,
          gameInstallPath,
          gameExecutable,
          discoveryStatus: gameExecutable
            ? "READY"
            : "EXECUTABLE_NOT_FOUND",
          diagnosticErrors: gameExecutable
            ? base.diagnosticErrors
            : [
                ...base.diagnosticErrors,
                diagnosticError(
                  "SHIPPING_EXECUTABLE_NOT_FOUND",
                  "Clawed is installed, but no Unreal shipping executable was found."
                )
              ]
        };
      } catch {
        return {
          ...base,
          source: "steam",
          steamLibrary: library.path,
          appManifestPath: library.appManifestPath,
          discoveryStatus: "GAME_NOT_INSTALLED",
          diagnosticErrors: [
            ...base.diagnosticErrors,
            diagnosticError(
              "APP_MANIFEST_PARSE_FAILED",
              "The Clawed Steam app manifest could not be parsed."
            )
          ]
        };
      }
    }

    return {
      ...base,
      discoveryStatus: "GAME_NOT_INSTALLED",
      diagnosticErrors: [
        ...base.diagnosticErrors,
        diagnosticError(
          "APP_MANIFEST_NOT_FOUND",
          `Steam app manifest ${CLAWED_STEAM_APP_ID} was not found in any Steam library.`
        )
      ]
    };
  }
}
