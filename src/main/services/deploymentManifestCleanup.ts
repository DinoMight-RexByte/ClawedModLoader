import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import type {
  DeploymentDirectoryRecord,
  DeploymentManifest,
  ModProblem,
  RuntimeGeneratedFileRecord
} from "../../shared/contracts/app";
import { isPathInside } from "./packagePaths";
import { modProblem } from "./packageProblems";

export interface ManifestCleanupResult {
  removedRuntimeGeneratedFiles: string[];
  prunedDirectories: string[];
  problems: ModProblem[];
}

export async function collectMissingParentDirectories({
  gameInstallPath,
  directoryPath,
  seenKeys
}: {
  gameInstallPath: string;
  directoryPath: string;
  seenKeys: Set<string>;
}): Promise<DeploymentDirectoryRecord[]> {
  const gameRoot = path.resolve(gameInstallPath);
  let currentDirectory = path.resolve(directoryPath);
  const missingDirectories: DeploymentDirectoryRecord[] = [];

  while (
    isPathInside(gameRoot, currentDirectory) &&
    path.resolve(currentDirectory) !== gameRoot &&
    !(await pathExists(currentDirectory))
  ) {
    const relativePath = path.normalize(
      path.relative(gameRoot, currentDirectory)
    );
    const key = relativePath.toLowerCase();
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      missingDirectories.push({
        relativePath,
        absolutePath: currentDirectory
      });
    }
    currentDirectory = path.dirname(currentDirectory);
  }

  return missingDirectories.reverse();
}

export async function inspectKnownRuntimeGeneratedFiles(
  gameInstallPath: string,
  runtimeConfiguration: Record<string, unknown>
): Promise<RuntimeGeneratedFileRecord[]> {
  const records = new Map<string, RuntimeGeneratedFileRecord>();

  for (const configuration of extractUe4ssRuntimeConfigurations(
    runtimeConfiguration
  )) {
    const relativePath = getUe4ssLogRelativePath(configuration);
    if (!relativePath) {
      continue;
    }

    if (path.isAbsolute(relativePath) || relativePath.includes("\0")) {
      throw new Error(`Runtime-generated file target is not relative: ${relativePath}`);
    }

    const absolutePath = path.resolve(gameInstallPath, relativePath);
    if (!isPathInside(gameInstallPath, absolutePath)) {
      throw new Error(`Runtime-generated file escapes game install: ${relativePath}`);
    }

    const key = path.normalize(relativePath).toLowerCase();
    if (records.has(key)) {
      continue;
    }

    records.set(key, {
      relativePath: path.normalize(relativePath),
      absolutePath,
      preexisting: await pathExists(absolutePath)
    });
  }

  return [...records.values()];
}

export async function cleanupManifestGeneratedArtifacts(
  manifest: DeploymentManifest
): Promise<ManifestCleanupResult> {
  const removedRuntimeGeneratedFiles: string[] = [];
  const prunedDirectories: string[] = [];
  const problems: ModProblem[] = [];

  for (const file of manifest.runtimeGeneratedFiles) {
    if (file.preexisting) {
      continue;
    }

    if (!isPathInside(manifest.gameInstallPath, file.absolutePath)) {
      problems.push(
        modProblem(
          "error",
          "RUNTIME_GENERATED_FILE_OUTSIDE_GAME",
          `CMM blocked removal of ${file.relativePath} because it is outside the game installation.`
        )
      );
      continue;
    }

    const fileInfo = await lstat(file.absolutePath).catch(() => null);
    if (!fileInfo) {
      continue;
    }

    if (!fileInfo.isFile()) {
      problems.push(
        modProblem(
          "warning",
          "RUNTIME_GENERATED_FILE_NOT_REGULAR",
          `${file.relativePath} is recorded as a runtime-generated file but is not a regular file, so it was preserved.`
        )
      );
      continue;
    }

    await rm(file.absolutePath, { force: true });
    removedRuntimeGeneratedFiles.push(file.relativePath);
  }

  const directories = [...manifest.directoriesCreated].sort(
    (left, right) => right.absolutePath.length - left.absolutePath.length
  );
  for (const directory of directories) {
    if (!isPathInside(manifest.gameInstallPath, directory.absolutePath)) {
      problems.push(
        modProblem(
          "error",
          "OWNED_DIRECTORY_OUTSIDE_GAME",
          `CMM blocked removal of ${directory.relativePath} because it is outside the game installation.`
        )
      );
      continue;
    }

    const directoryInfo = await lstat(directory.absolutePath).catch(() => null);
    if (!directoryInfo || !directoryInfo.isDirectory()) {
      continue;
    }

    const entries = await readdir(directory.absolutePath);
    if (entries.length > 0) {
      continue;
    }

    await rmdir(directory.absolutePath);
    prunedDirectories.push(directory.relativePath);
  }

  return {
    removedRuntimeGeneratedFiles,
    prunedDirectories,
    problems
  };
}

function extractUe4ssRuntimeConfigurations(
  configuration: Record<string, unknown>
): Array<Record<string, unknown>> {
  if (configuration.type === "ue4ss") {
    return [configuration];
  }

  if (
    configuration.type !== "composite" ||
    typeof configuration.adapters !== "object" ||
    configuration.adapters === null
  ) {
    return [];
  }

  return Object.values(configuration.adapters).flatMap((adapterConfiguration) =>
    typeof adapterConfiguration === "object" && adapterConfiguration !== null
      ? extractUe4ssRuntimeConfigurations(
          adapterConfiguration as Record<string, unknown>
        )
      : []
  );
}

function getUe4ssLogRelativePath(
  configuration: Record<string, unknown>
): string | null {
  const runtimeModsRelativePath =
    typeof configuration.runtimeModsRelativePath === "string"
      ? path.normalize(configuration.runtimeModsRelativePath)
      : "Mods";
  const runtimeTargetRelativePath =
    typeof configuration.runtimeTargetRelativePath === "string"
      ? path.normalize(configuration.runtimeTargetRelativePath)
      : null;
  const runtimeSubdirectory = path.dirname(runtimeModsRelativePath);
  const logRelativePath =
    runtimeSubdirectory === "."
      ? "UE4SS.log"
      : path.join(runtimeSubdirectory, "UE4SS.log");

  return runtimeTargetRelativePath
    ? path.join(runtimeTargetRelativePath, logRelativePath)
    : logRelativePath;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return lstat(targetPath)
    .then(() => true)
    .catch(() => false);
}
