import { lstat, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { DeploymentAdapterDescriptor } from "../../../shared/contracts/deployment";
import {
  GameFingerprintSchema,
  type GameDiscovery,
  type GameFingerprint,
  type GameFingerprintFile,
  type GameFingerprintMode
} from "../../../shared/contracts/app";
import {
  hashBufferSha256,
  hashFileSha256
} from "../../services/clawedModPackageService";
import { modProblem } from "../../services/packageProblems";
import { isPathInside } from "../../services/packagePaths";
import { parseAppManifest } from "../../services/steam/vdf";

export interface ClawedGameLayout {
  gameInstallPath: string | null;
  executablePath: string | null;
  projectDirectory: string | null;
  binaryDirectory: string | null;
  pakDirectory: string | null;
  runtimePath: string | null;
  compatibility: "UNKNOWN" | "UNVALIDATED" | "VALIDATED";
}

export interface GameFingerprintOptions {
  mode?: GameFingerprintMode;
}

export class ClawedGameAdapter {
  readonly descriptor: DeploymentAdapterDescriptor = {
    id: "clawed-game",
    label: "Clawed Game Adapter",
    layer: "clawed",
    status: "ready",
    releaseValidation: "UNVALIDATED",
    capabilities: {
      supportsEnableDisable: false,
      supportsOrdering: false,
      supportsExternalStorage: false,
      supportsHotChanges: false,
      requiresRestart: true,
      requiresRuntime: false
    }
  };

  getLayout(discovery: GameDiscovery): ClawedGameLayout {
    const projectDirectory = deriveUnrealProjectDirectory(
      discovery.gameInstallPath,
      discovery.gameExecutable
    );
    const binaryDirectory = discovery.gameExecutable
      ? path.dirname(discovery.gameExecutable)
      : null;

    return {
      gameInstallPath: discovery.gameInstallPath,
      executablePath: discovery.gameExecutable,
      projectDirectory,
      binaryDirectory,
      pakDirectory: projectDirectory
        ? path.join(projectDirectory, "Content", "Paks")
        : null,
      runtimePath: binaryDirectory,
      compatibility: "UNVALIDATED"
    };
  }

  async getFingerprint(
    discovery: GameDiscovery,
    reference?: Partial<GameFingerprint> | null,
    options: GameFingerprintOptions = {}
  ): Promise<GameFingerprint> {
    const fingerprintMode = options.mode ?? "full";
    const problems = [...discovery.diagnosticErrors.map((error) =>
      modProblem("warning", error.code, error.message)
    )];
    const gameInstallPath = discovery.gameInstallPath;
    const executablePath = discovery.gameExecutable;
    const executableSha256 =
      executablePath && (await pathExists(executablePath))
        ? await hashFileSha256(executablePath)
        : null;
    const appManifestSha256 =
      discovery.appManifestPath && (await pathExists(discovery.appManifestPath))
        ? await hashFileSha256(discovery.appManifestPath)
        : null;
    const steamBuildId = discovery.appManifestPath
      ? await readSteamBuildId(discovery.appManifestPath)
      : null;
    const contentFiles = gameInstallPath
      ? await fingerprintUnrealContentFiles(gameInstallPath, fingerprintMode)
      : [];

    if (!gameInstallPath || !executablePath || !executableSha256) {
      problems.push(
        modProblem(
          "warning",
          "GAME_FINGERPRINT_INCOMPLETE",
          "CMM cannot create a complete game fingerprint until Clawed is detected."
        )
      );
    }

    const fingerprintInput = {
      executableSha256,
      steamBuildId,
      contentFiles
    };
    const fingerprintSha256 =
      executableSha256 || steamBuildId || contentFiles.length > 0
        ? hashBufferSha256(Buffer.from(JSON.stringify(fingerprintInput)))
        : null;
    const status = classifyFingerprint(
      fingerprintSha256,
      reference,
      fingerprintMode
    );

    if (status === "NEW_CHANGED_BUILD") {
      problems.push(
        modProblem(
          "warning",
          "GAME_BUILD_CHANGED",
          "The detected Clawed build differs from the build recorded by the active CMM deployment."
        )
      );
    }

    return GameFingerprintSchema.parse({
      fingerprintMode,
      status,
      generatedAt: new Date().toISOString(),
      gameInstallPath,
      executablePath,
      executableSha256,
      steamBuildId,
      appManifestPath: discovery.appManifestPath,
      appManifestSha256,
      contentFiles,
      fingerprintSha256,
      releaseValidation: "UNVALIDATED",
      problems
    });
  }
}

async function fingerprintUnrealContentFiles(
  gameInstallPath: string,
  mode: GameFingerprintMode
): Promise<GameFingerprintFile[]> {
  const files = await listFilesRecursive(gameInstallPath);
  const contentFiles: GameFingerprintFile[] = [];

  for (const filePath of files.filter(isFingerprintContentFile)) {
    const fileStat = await stat(filePath);
    const relativePath = path.relative(gameInstallPath, filePath);
    contentFiles.push({
      relativePath,
      sha256:
        mode === "full"
          ? await hashFileSha256(filePath)
          : hashBufferSha256(
              Buffer.from(
                JSON.stringify({
                  relativePath,
                  size: fileStat.size,
                  mtimeMs: Math.trunc(fileStat.mtimeMs)
                })
              )
            ),
      size: fileStat.size
    });
  }

  contentFiles.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  return contentFiles;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const entryInfo = await lstat(entryPath);
    if (!isPathInside(root, entryPath) || entryInfo.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function isFingerprintContentFile(filePath: string): boolean {
  return [".pak", ".utoc", ".ucas"].includes(path.extname(filePath).toLowerCase());
}

function classifyFingerprint(
  fingerprintSha256: string | null,
  reference?: Partial<GameFingerprint> | null,
  mode: GameFingerprintMode = "full"
): GameFingerprint["status"] {
  if (!fingerprintSha256) {
    return "UNKNOWN_BUILD";
  }

  const referenceMode = reference?.fingerprintMode ?? "full";
  if (reference?.fingerprintSha256 && referenceMode !== mode) {
    return "UNKNOWN_BUILD";
  }

  if (
    reference?.fingerprintSha256 &&
    reference.fingerprintSha256 !== fingerprintSha256
  ) {
    return "NEW_CHANGED_BUILD";
  }

  if (
    reference?.fingerprintSha256 === fingerprintSha256 &&
    reference.releaseValidation === "VALIDATED"
  ) {
    return "CURRENT_VALIDATED_BUILD";
  }

  return "UNKNOWN_BUILD";
}

async function readSteamBuildId(
  appManifestPath: string
): Promise<string | null> {
  try {
    return parseAppManifest(await readFile(appManifestPath, "utf8")).buildId;
  } catch {
    return null;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

function deriveUnrealProjectDirectory(
  gameInstallPath: string | null,
  executablePath: string | null
): string | null {
  if (!gameInstallPath) {
    return null;
  }

  if (!executablePath || !isPathInside(gameInstallPath, executablePath)) {
    return path.normalize(gameInstallPath);
  }

  const segments = path.normalize(executablePath).split(path.sep);
  let binariesIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].toLowerCase() === "binaries") {
      binariesIndex = index;
      break;
    }
  }
  if (binariesIndex <= 0) {
    return path.normalize(gameInstallPath);
  }

  const projectDirectory = segments.slice(0, binariesIndex).join(path.sep);
  return isPathInside(gameInstallPath, projectDirectory)
    ? projectDirectory
    : path.normalize(gameInstallPath);
}
