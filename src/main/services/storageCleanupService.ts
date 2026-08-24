import { lstat, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import {
  Ue4ssRuntimeInstallSchema,
  type AppStorageLayout,
  type ModProblem,
  type Ue4ssRuntimeInstall
} from "../../shared/contracts/app";
import type { StorageServiceContract } from "../../shared/contracts/services";
import { rmWithRetry } from "./fileRemoval";
import type { LifecycleLogger } from "./lifecycleLogger";
import { modProblem } from "./packageProblems";
import { isPathInside } from "./packagePaths";

const dayMs = 24 * 60 * 60 * 1000;
const runtimeIndexFileName = "ue4ss-runtime.json";
const knownStagingPrefixes = [
  "deployment-",
  "external-import-",
  "import-",
  "import-modpack-",
  "inspect-modpack-",
  "runtime-ue4ss-",
  "runtime-ue4ss-bundled-",
  "runtime-validation-",
  "unreal-mappings-"
];

export interface AppStorageCleanupOptions {
  now?: Date;
  staleStagingAgeMs?: number;
  obsoleteRuntimeAgeMs?: number;
  runtimeValidationEvidenceAgeMs?: number;
}

export interface AppStorageCleanupResult {
  removedPaths: string[];
  problems: ModProblem[];
}

interface ResolvedStorageCleanupOptions {
  nowMs: number;
  staleStagingAgeMs: number;
  obsoleteRuntimeAgeMs: number;
  runtimeValidationEvidenceAgeMs: number;
}

export async function cleanupAppStorageArtifacts(
  storageService: StorageServiceContract,
  logger?: LifecycleLogger,
  options: AppStorageCleanupOptions = {}
): Promise<AppStorageCleanupResult> {
  const layout = await storageService.getLayout();
  const cleanupOptions = resolveCleanupOptions(options);
  const result = emptyCleanupResult();
  const activeRuntime = await readActiveRuntime(layout);

  await collectStaleStagingArtifacts(layout, cleanupOptions, result);
  await collectObsoleteUe4ssRuntimeInstalls(
    layout,
    activeRuntime?.installPath ?? null,
    cleanupOptions,
    result
  );
  await collectOldRuntimeValidationEvidence(
    layout,
    activeRuntime?.validation?.evidencePath ?? null,
    cleanupOptions,
    result
  );
  await logCleanupResult(logger, result);

  return result;
}

export async function cleanupObsoleteUe4ssRuntimeInstalls(
  layout: AppStorageLayout,
  activeRuntimeInstallPath: string | null,
  options: AppStorageCleanupOptions = {}
): Promise<AppStorageCleanupResult> {
  const result = emptyCleanupResult();
  await collectObsoleteUe4ssRuntimeInstalls(
    layout,
    activeRuntimeInstallPath,
    resolveCleanupOptions(options),
    result
  );
  return result;
}

function emptyCleanupResult(): AppStorageCleanupResult {
  return {
    removedPaths: [],
    problems: []
  };
}

function resolveCleanupOptions(
  options: AppStorageCleanupOptions
): ResolvedStorageCleanupOptions {
  return {
    nowMs: options.now?.getTime() ?? Date.now(),
    staleStagingAgeMs: validAge(options.staleStagingAgeMs, dayMs),
    obsoleteRuntimeAgeMs: validAge(options.obsoleteRuntimeAgeMs, dayMs),
    runtimeValidationEvidenceAgeMs: validAge(
      options.runtimeValidationEvidenceAgeMs,
      30 * dayMs
    )
  };
}

function validAge(value: number | undefined, fallback: number): number {
  return typeof value === "number" && value >= 0 ? value : fallback;
}

async function collectStaleStagingArtifacts(
  layout: AppStorageLayout,
  options: ResolvedStorageCleanupOptions,
  result: AppStorageCleanupResult
): Promise<void> {
  const entries = await readDirectoryEntries(
    layout.directories.staging,
    "APP_STORAGE_STAGING_SCAN_FAILED",
    "CMM could not inspect its staging directory for stale artifacts.",
    result
  );

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !knownStagingPrefixes.some((prefix) => entry.name.startsWith(prefix))
    ) {
      continue;
    }

    const targetPath = path.join(layout.directories.staging, entry.name);
    if (
      !(await isOlderThan(
        targetPath,
        options.staleStagingAgeMs,
        options.nowMs
      ))
    ) {
      continue;
    }

    await removeOwnedPath(
      layout,
      layout.directories.staging,
      targetPath,
      "APP_STORAGE_STAGING_CLEANUP_FAILED",
      `CMM could not remove stale staging artifact ${entry.name}.`,
      result
    );
  }
}

async function collectObsoleteUe4ssRuntimeInstalls(
  layout: AppStorageLayout,
  activeRuntimeInstallPath: string | null,
  options: ResolvedStorageCleanupOptions,
  result: AppStorageCleanupResult
): Promise<void> {
  const runtimeRoot = path.join(layout.directories.runtime, "ue4ss");
  const activeRuntimePath = activeRuntimeInstallPath
    ? path.resolve(activeRuntimeInstallPath)
    : null;
  const entries = await readDirectoryEntries(
    runtimeRoot,
    "APP_STORAGE_RUNTIME_SCAN_FAILED",
    "CMM could not inspect its UE4SS runtime directory for obsolete installs.",
    result
  );

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const targetPath = path.join(runtimeRoot, entry.name);
    if (activeRuntimePath && path.resolve(targetPath) === activeRuntimePath) {
      continue;
    }
    if (
      !(await isOlderThan(
        targetPath,
        options.obsoleteRuntimeAgeMs,
        options.nowMs
      ))
    ) {
      continue;
    }

    await removeOwnedPath(
      layout,
      runtimeRoot,
      targetPath,
      "APP_STORAGE_RUNTIME_CLEANUP_FAILED",
      `CMM could not remove obsolete UE4SS runtime install ${entry.name}.`,
      result
    );
  }
}

async function collectOldRuntimeValidationEvidence(
  layout: AppStorageLayout,
  activeEvidencePath: string | null,
  options: ResolvedStorageCleanupOptions,
  result: AppStorageCleanupResult
): Promise<void> {
  const evidenceRoot = path.join(layout.directories.logs, "runtime-validation");
  const activeEvidence = activeEvidencePath
    ? path.resolve(activeEvidencePath)
    : null;
  const entries = await readDirectoryEntries(
    evidenceRoot,
    "APP_STORAGE_RUNTIME_EVIDENCE_SCAN_FAILED",
    "CMM could not inspect old runtime validation evidence.",
    result
  );

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isFile()) {
      continue;
    }

    const targetPath = path.join(evidenceRoot, entry.name);
    if (
      activeEvidence &&
      (path.resolve(targetPath) === activeEvidence ||
        isPathInside(targetPath, activeEvidence))
    ) {
      continue;
    }
    if (
      !(await isOlderThan(
        targetPath,
        options.runtimeValidationEvidenceAgeMs,
        options.nowMs
      ))
    ) {
      continue;
    }

    await removeOwnedPath(
      layout,
      evidenceRoot,
      targetPath,
      "APP_STORAGE_RUNTIME_EVIDENCE_CLEANUP_FAILED",
      `CMM could not remove old runtime validation evidence ${entry.name}.`,
      result
    );
  }
}

async function readActiveRuntime(
  layout: AppStorageLayout
): Promise<Ue4ssRuntimeInstall | null> {
  try {
    const runtimeRoot = path.join(layout.directories.runtime, "ue4ss");
    const runtime = Ue4ssRuntimeInstallSchema.parse(
      JSON.parse(
        await readFile(path.join(runtimeRoot, runtimeIndexFileName), "utf8")
      )
    );

    return isPathInside(runtimeRoot, runtime.installPath) ? runtime : null;
  } catch {
    return null;
  }
}

async function readDirectoryEntries(
  directoryPath: string,
  code: string,
  message: string,
  result: AppStorageCleanupResult
): Promise<Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      result.problems.push(
        modProblem(
          "warning",
          code,
          message,
          error instanceof Error ? error.message : String(error)
        )
      );
    }
    return [];
  }
}

async function isOlderThan(
  targetPath: string,
  ageMs: number,
  nowMs: number
): Promise<boolean> {
  const info = await lstat(targetPath).catch(() => null);
  return info ? nowMs - info.mtimeMs >= ageMs : false;
}

async function removeOwnedPath(
  layout: AppStorageLayout,
  parentDirectory: string,
  targetPath: string,
  code: string,
  message: string,
  result: AppStorageCleanupResult
): Promise<void> {
  if (!isPathInside(parentDirectory, targetPath)) {
    result.problems.push(
      modProblem(
        "error",
        "APP_STORAGE_CLEANUP_PATH_OUTSIDE_ROOT",
        `CMM blocked cleanup outside its owned storage root: ${targetPath}.`
      )
    );
    return;
  }

  try {
    await rmWithRetry(targetPath, { recursive: true, force: true });
    result.removedPaths.push(storageRelativePath(layout, targetPath));
  } catch (error) {
    result.problems.push(
      modProblem(
        "warning",
        code,
        message,
        error instanceof Error ? error.message : String(error)
      )
    );
  }
}

function storageRelativePath(
  layout: AppStorageLayout,
  targetPath: string
): string {
  const relativePath = path.relative(layout.root, targetPath);
  return relativePath &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
    ? path.normalize(relativePath)
    : targetPath;
}

async function logCleanupResult(
  logger: LifecycleLogger | undefined,
  result: AppStorageCleanupResult
): Promise<void> {
  if (!logger || (result.removedPaths.length === 0 && result.problems.length === 0)) {
    return;
  }

  await logger
    .log({
      category: "APP",
      action: "app_storage_cleanup_completed",
      result: result.problems.length > 0 ? "failed" : "ok",
      errorCode:
        result.problems.length > 0 ? "APP_STORAGE_CLEANUP_PARTIAL" : undefined,
      details: {
        removedPaths: result.removedPaths.length,
        problems: result.problems.length
      }
    })
    .catch(() => undefined);
}
