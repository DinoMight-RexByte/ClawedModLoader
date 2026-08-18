import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

import {
  ImportUe4ssRuntimeResultSchema,
  RuntimeSnapshotSchema,
  Ue4ssRuntimeInstallSchema,
  type ImportUe4ssRuntimeRequest,
  type ImportUe4ssRuntimeResult,
  type ModProblem,
  type RuntimeSnapshot,
  type ServiceStatus,
  type Ue4ssRuntimeInstall
} from "../../shared/contracts/app";
import type {
  RuntimeManagerContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import {
  getOriginalZipEntryName,
  hashFileSha256,
  resolveSafeArchiveEntryDestination,
  validateArchivePaths
} from "./clawedModPackageService";
import { modProblem } from "./packageProblems";
import { isPathInside } from "./packagePaths";
import { atomicWriteJson } from "./profileService";
import type { LifecycleLogger } from "./lifecycleLogger";
import { isUe4ssRuntimeStructureValid } from "./ue4ssRuntimeLayout";

const RUNTIME_INDEX_FILENAME = "ue4ss-runtime.json";
const DEFAULT_BUNDLED_RUNTIME_VERSION = "bundled-default";

export interface LocalRuntimeManagerOptions {
  bundledUe4ssRuntimePath?: string;
  bundledUe4ssVersion?: string;
  bundledUe4ssCompatibility?: BundledUe4ssCompatibility;
}

export type BundledUe4ssCompatibility =
  | {
      status: "unvalidated";
      message?: string;
    }
  | {
      status: "validated";
      message?: string;
      technicalDetail?: string;
      validatedSteamBuildIds?: string[];
    }
  | {
      status: "incompatible";
      message: string;
      technicalDetail?: string;
    };

export class LocalRuntimeManager implements RuntimeManagerContract {
  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly logger?: LifecycleLogger,
    private readonly options: LocalRuntimeManagerOptions = {}
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "runtimeManager",
      label: "Runtime Manager",
      status: "ready",
      detail:
        "Stores packaged or manually imported UE4SS runtime packages under userData."
    };
  }

  async getRuntimeSnapshot(
    currentSteamBuildId?: string | null
  ): Promise<RuntimeSnapshot> {
    const runtime = await this.readRuntimeInstall();
    if (!runtime) {
      const bundledSource = await this.readBundledRuntimeSource();
      return RuntimeSnapshotSchema.parse({
        ue4ss: null,
        status: "missing",
        problems: [
          modProblem(
            "warning",
            "UE4SS_RUNTIME_MISSING",
            bundledSource.problems.length > 0
              ? "No UE4SS runtime is configured, and the packaged runtime is unavailable."
              : "No UE4SS runtime is configured. The packaged runtime can be installed from setup."
          )
        ]
      });
    }

    const runtimeForSnapshot = this.runtimeWithBuildReleaseValidation(
      runtime,
      currentSteamBuildId
    );
    const validationProblems = await this.validateRuntimeInstall(runtime);
    const releaseProblems =
      validationProblems.length === 0
        ? this.runtimeReleaseProblems(runtimeForSnapshot, currentSteamBuildId)
        : [];
    return RuntimeSnapshotSchema.parse({
      ue4ss: runtimeForSnapshot,
      status:
        validationProblems.length > 0
          ? "invalid"
          : releaseProblems.some((problem) => problem.severity === "error")
            ? "incompatible"
          : runtimeForSnapshot.releaseValidation === "UNVALIDATED"
            ? "unvalidated"
            : "configured",
      problems: [...validationProblems, ...releaseProblems]
    });
  }

  async ensureBundledUe4ssRuntime(): Promise<ImportUe4ssRuntimeResult | null> {
    const existingRuntime = await this.readRuntimeInstall();
    if (existingRuntime) {
      const validationProblems = await this.validateRuntimeInstall(existingRuntime);
      if (
        existingRuntime.source === "bundled" &&
        (validationProblems.length > 0 ||
          !this.isCurrentBundledRuntime(existingRuntime))
      ) {
        return this.installBundledUe4ssRuntime();
      }

      const runtime =
        existingRuntime.source === "bundled"
          ? await this.normalizeBundledRuntimeReleaseValidation(existingRuntime)
          : existingRuntime;
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "alreadyInstalled",
        runtime,
        problems:
          validationProblems.length > 0
            ? validationProblems
            : this.runtimeReleaseProblems(runtime)
      });
    }

    const result = await this.installBundledUe4ssRuntime();
    return result.status === "failed" ? null : result;
  }

  async installBundledUe4ssRuntime(): Promise<ImportUe4ssRuntimeResult> {
    const bundledSource = await this.readBundledRuntimeSource();
    if (bundledSource.problems.length > 0 || bundledSource.files.length === 0) {
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_bundled_runtime_unavailable",
        result: "blocked",
        errorCode: "UE4SS_BUNDLED_RUNTIME_UNAVAILABLE"
      });
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "failed",
        runtime: null,
        problems:
          bundledSource.problems.length > 0
            ? bundledSource.problems
            : [
                modProblem(
                  "warning",
                  "UE4SS_BUNDLED_RUNTIME_UNAVAILABLE",
                  "The packaged UE4SS runtime is not available in this build."
                )
              ]
      });
    }

    const layout = await this.storageService.getLayout();
    const runtimeBase = path.join(layout.directories.runtime, "ue4ss");
    const sourceSha256 = await hashRuntimeDirectorySha256(
      bundledSource.files
    );
    const existingRuntime = await this.readRuntimeInstall();
    const existingProblems = existingRuntime
      ? await this.validateRuntimeInstall(existingRuntime)
      : [];

    if (
      existingRuntime?.source === "bundled" &&
      existingRuntime.sourceSha256 === sourceSha256 &&
      this.isCurrentBundledRuntime(existingRuntime) &&
      existingProblems.length === 0
    ) {
      const runtime = await this.normalizeBundledRuntimeReleaseValidation(
        existingRuntime
      );
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "alreadyInstalled",
        runtime,
        problems: this.runtimeReleaseProblems(runtime)
      });
    }

    const requestedVersion = sanitizeRuntimeVersion(
      this.options.bundledUe4ssVersion ?? DEFAULT_BUNDLED_RUNTIME_VERSION
    );
    const reusableRuntimeVersion = await findReusableRuntimeDirectory(
      runtimeBase,
      requestedVersion,
      sourceSha256
    );
    const runtimeVersion =
      reusableRuntimeVersion ??
      (await createUniqueRuntimeVersion(runtimeBase, requestedVersion));
    const runtimeRoot = path.join(runtimeBase, runtimeVersion);
    const stagingPath = path.join(
      layout.directories.staging,
      `runtime-ue4ss-bundled-${Date.now()}-${randomUUID()}`
    );

    try {
      if (!reusableRuntimeVersion) {
        await mkdir(stagingPath, { recursive: true });
        await copyRuntimeDirectoryFiles(bundledSource.files, stagingPath);
        await mkdir(path.dirname(runtimeRoot), { recursive: true });
        await renameRuntimeDirectoryWithRetry(stagingPath, runtimeRoot);
      }

      const runtime = Ue4ssRuntimeInstallSchema.parse({
        version: runtimeVersion,
        installPath: runtimeRoot,
        importedAt: new Date().toISOString(),
        sourceSha256,
        source: "bundled",
        releaseValidation: this.bundledRuntimeReleaseValidation()
      });
      await atomicWriteJson(await this.getRuntimeIndexPath(), runtime);
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_bundled_runtime_installed",
        result: "ok"
      });

      return ImportUe4ssRuntimeResultSchema.parse({
        status: "imported",
        runtime,
        problems: this.runtimeReleaseProblems(runtime)
      });
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true }).catch(
        () => undefined
      );
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_bundled_runtime_failed",
        result: "failed",
        errorCode: "UE4SS_BUNDLED_RUNTIME_INSTALL_FAILED"
      });
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "failed",
        runtime: null,
        problems: [
          modProblem(
            "error",
            "UE4SS_BUNDLED_RUNTIME_INSTALL_FAILED",
            "CMM could not install the packaged UE4SS runtime.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    }
  }

  async importUe4ssRuntime(
    request: ImportUe4ssRuntimeRequest
  ): Promise<ImportUe4ssRuntimeResult> {
    if (path.extname(request.sourcePath).toLowerCase() !== ".zip") {
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_runtime_import_rejected",
        result: "blocked",
        errorCode: "UE4SS_RUNTIME_EXTENSION_UNSUPPORTED"
      });
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "failed",
        runtime: null,
        problems: [
          modProblem(
            "error",
            "UE4SS_RUNTIME_EXTENSION_UNSUPPORTED",
            "Select a UE4SS release ZIP archive."
          )
        ]
      });
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await readFile(request.sourcePath));
    } catch (error) {
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_runtime_import_failed",
        result: "failed",
        errorCode: "UE4SS_RUNTIME_ARCHIVE_INVALID"
      });
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "failed",
        runtime: null,
        problems: [
          modProblem(
            "error",
            "UE4SS_RUNTIME_ARCHIVE_INVALID",
            "The UE4SS runtime package is not a readable ZIP archive.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    }

    const pathProblems = validateArchivePaths(zip);
    if (pathProblems.length > 0) {
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_runtime_import_rejected",
        result: "blocked",
        errorCode: "UNSAFE_ARCHIVE_PATH"
      });
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "failed",
        runtime: null,
        problems: pathProblems
      });
    }

    const entries = normalizeRuntimeEntries(zip);
    const structureProblems = validateUe4ssStructure(entries);
    if (structureProblems.length > 0) {
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_runtime_import_rejected",
        result: "blocked",
        errorCode: "UE4SS_RUNTIME_FILE_MISSING"
      });
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "failed",
        runtime: null,
        problems: structureProblems
      });
    }

    const layout = await this.storageService.getLayout();
    const sourceSha256 = await hashFileSha256(request.sourcePath);
    const runtimeVersion = await createUniqueRuntimeVersion(
      path.join(layout.directories.runtime, "ue4ss"),
      sanitizeRuntimeVersion(path.basename(request.sourcePath, ".zip"))
    );
    const runtimeRoot = path.join(
      layout.directories.runtime,
      "ue4ss",
      runtimeVersion
    );
    const stagingPath = path.join(
      layout.directories.staging,
      `runtime-ue4ss-${Date.now()}-${randomUUID()}`
    );

    try {
      await mkdir(stagingPath, { recursive: true });
      for (const entry of entries) {
        if (entry.dir) {
          await mkdir(
            resolveSafeArchiveEntryDestination(stagingPath, entry.relativeName),
            { recursive: true }
          );
          continue;
        }

        const destinationPath = resolveSafeArchiveEntryDestination(
          stagingPath,
          entry.relativeName
        );
        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, await entry.entry.async("nodebuffer"));
      }

      await mkdir(path.dirname(runtimeRoot), { recursive: true });
      await renameRuntimeDirectoryWithRetry(stagingPath, runtimeRoot);
      const runtime = Ue4ssRuntimeInstallSchema.parse({
        version: runtimeVersion,
        installPath: runtimeRoot,
        importedAt: new Date().toISOString(),
        sourceSha256,
        source: "user",
        releaseValidation: "UNVALIDATED"
      });
      await atomicWriteJson(await this.getRuntimeIndexPath(), runtime);
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_runtime_imported",
        result: "ok"
      });

      return ImportUe4ssRuntimeResultSchema.parse({
        status: "imported",
        runtime,
        problems: unvalidatedRuntimeProblems(
          "UE4SS was imported but has not been validated against the Clawed release build."
        )
      });
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true }).catch(
        () => undefined
      );
      await this.logger?.log({
        category: "RUNTIME",
        action: "ue4ss_runtime_import_failed",
        result: "failed",
        errorCode: "UE4SS_RUNTIME_IMPORT_FAILED"
      });
      return ImportUe4ssRuntimeResultSchema.parse({
        status: "failed",
        runtime: null,
        problems: [
          modProblem(
            "error",
            "UE4SS_RUNTIME_IMPORT_FAILED",
            "CMM could not import the UE4SS runtime package.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    }
  }

  private async readRuntimeInstall(): Promise<Ue4ssRuntimeInstall | null> {
    try {
      const runtime = Ue4ssRuntimeInstallSchema.parse(
        JSON.parse(await readFile(await this.getRuntimeIndexPath(), "utf8"))
      );
      const layout = await this.storageService.getLayout();

      if (!isPathInside(path.join(layout.directories.runtime, "ue4ss"), runtime.installPath)) {
        return null;
      }

      return runtime;
    } catch {
      return null;
    }
  }

  private async validateRuntimeInstall(
    runtime: Ue4ssRuntimeInstall
  ): Promise<ModProblem[]> {
    let runtimeFiles: RuntimeDirectoryFile[];
    try {
      runtimeFiles = await listRuntimeDirectoryFiles(runtime.installPath);
    } catch (error) {
      return [
        modProblem(
          "error",
          "UE4SS_RUNTIME_INVALID_PATH",
          "UE4SS runtime files could not be inspected.",
          error instanceof Error ? error.message : String(error)
        )
      ];
    }

    return validateUe4ssStructure(runtimeFiles);
  }

  private runtimeReleaseProblems(
    runtime: Ue4ssRuntimeInstall,
    currentSteamBuildId?: string | null
  ): ModProblem[] {
    if (runtime.source === "bundled") {
      const compatibility = this.options.bundledUe4ssCompatibility;
      if (!this.isCurrentBundledRuntime(runtime)) {
        return [
          modProblem(
            "error",
            "UE4SS_BUNDLED_RUNTIME_STALE",
            "The installed packaged UE4SS runtime is not the current validated bundled runtime.",
            `Installed version '${runtime.version}' does not match expected packaged runtime '${this.currentBundledRuntimeVersion()}'. Reinstall the packaged runtime.`
          )
        ];
      }

      if (compatibility?.status === "validated") {
        if (
          currentSteamBuildId &&
          compatibility.validatedSteamBuildIds?.length &&
          !compatibility.validatedSteamBuildIds.includes(currentSteamBuildId)
        ) {
          return [
            modProblem(
              "warning",
              "UE4SS_BUNDLED_RUNTIME_BUILD_UNVALIDATED",
              "The packaged UE4SS runtime is installed, but this Clawed build has not been validated yet.",
              `Steam build ${currentSteamBuildId} is not in the retained runtime validation set: ${compatibility.validatedSteamBuildIds.join(", ")}.`
            )
          ];
        }

        return [];
      }

      if (compatibility?.status === "incompatible") {
        return [
          modProblem(
            "error",
            "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE",
            compatibility.message,
            compatibility.technicalDetail
          )
        ];
      }

      return unvalidatedRuntimeProblems(
        compatibility?.message ??
          "UE4SS is packaged with CMM but has not been validated against the Clawed release build."
      );
    }

    return unvalidatedRuntimeProblems(
      "UE4SS was imported but has not been validated against the Clawed release build."
    );
  }

  private bundledRuntimeReleaseValidation(): "UNVALIDATED" | "VALIDATED" {
    return this.options.bundledUe4ssCompatibility?.status === "validated"
      ? "VALIDATED"
      : "UNVALIDATED";
  }

  private runtimeWithBuildReleaseValidation(
    runtime: Ue4ssRuntimeInstall,
    currentSteamBuildId?: string | null
  ): Ue4ssRuntimeInstall {
    if (
      runtime.source === "bundled" &&
      currentSteamBuildId &&
      this.options.bundledUe4ssCompatibility?.status === "validated" &&
      this.options.bundledUe4ssCompatibility.validatedSteamBuildIds?.length &&
      !this.options.bundledUe4ssCompatibility.validatedSteamBuildIds.includes(
        currentSteamBuildId
      )
    ) {
      return Ue4ssRuntimeInstallSchema.parse({
        ...runtime,
        releaseValidation: "UNVALIDATED"
      });
    }

    return runtime;
  }

  private currentBundledRuntimeVersion(): string {
    return sanitizeRuntimeVersion(
      this.options.bundledUe4ssVersion ?? DEFAULT_BUNDLED_RUNTIME_VERSION
    );
  }

  private isCurrentBundledRuntime(runtime: Ue4ssRuntimeInstall): boolean {
    return runtime.version === this.currentBundledRuntimeVersion();
  }

  private async normalizeBundledRuntimeReleaseValidation(
    runtime: Ue4ssRuntimeInstall
  ): Promise<Ue4ssRuntimeInstall> {
    const releaseValidation = this.bundledRuntimeReleaseValidation();
    if (runtime.releaseValidation === releaseValidation) {
      return runtime;
    }

    const normalizedRuntime = Ue4ssRuntimeInstallSchema.parse({
      ...runtime,
      releaseValidation
    });
    await atomicWriteJson(await this.getRuntimeIndexPath(), normalizedRuntime);
    return normalizedRuntime;
  }

  private async getRuntimeIndexPath(): Promise<string> {
    const layout = await this.storageService.getLayout();
    return path.join(layout.directories.runtime, "ue4ss", RUNTIME_INDEX_FILENAME);
  }

  private async readBundledRuntimeSource(): Promise<BundledRuntimeSource> {
    const sourcePath = this.options.bundledUe4ssRuntimePath;
    if (!sourcePath) {
      return {
        files: [],
        problems: [
          modProblem(
            "warning",
            "UE4SS_BUNDLED_RUNTIME_UNAVAILABLE",
            "This build does not define a packaged UE4SS runtime source."
          )
        ]
      };
    }

    try {
      const sourceStats = await lstat(sourcePath);
      if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
        return {
          files: [],
          problems: [
            modProblem(
              "error",
              "UE4SS_BUNDLED_RUNTIME_INVALID",
              "The packaged UE4SS runtime source is not a normal directory."
            )
          ]
        };
      }

      const files = await listRuntimeDirectoryFiles(sourcePath);
      const problems = validateUe4ssStructure(files);
      return { files, problems };
    } catch (error) {
      return {
        files: [],
        problems: [
          modProblem(
            "warning",
            "UE4SS_BUNDLED_RUNTIME_UNAVAILABLE",
            "The packaged UE4SS runtime is not present in this build.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      };
    }
  }
}

interface RuntimeEntryLike {
  relativeName: string;
  dir: boolean;
}

interface RuntimeZipEntry extends RuntimeEntryLike {
  entry: JSZip.JSZipObject;
}

interface RuntimeDirectoryFile extends RuntimeEntryLike {
  sourcePath: string;
  dir: false;
}

interface BundledRuntimeSource {
  files: RuntimeDirectoryFile[];
  problems: ModProblem[];
}

function normalizeRuntimeEntries(zip: JSZip): RuntimeZipEntry[] {
  const rawEntries = Object.values(zip.files).map((entry) => ({
    entry,
    name: getOriginalZipEntryName(entry).replaceAll("\\", "/"),
    dir: entry.dir
  }));
  const nonDirectoryEntries = rawEntries.filter((entry) => !entry.dir);
  const commonRoot = findCommonRoot(nonDirectoryEntries.map((entry) => entry.name));

  return rawEntries
    .map((entry) => {
      const relativeName = commonRoot
        ? entry.name.slice(commonRoot.length + 1)
        : entry.name;
      return {
        entry: entry.entry,
        relativeName,
        dir: entry.dir
      };
    })
    .filter((entry) => entry.relativeName.length > 0);
}

function findCommonRoot(entryNames: string[]): string | null {
  const roots = new Set(
    entryNames
      .map((entryName) => entryName.split("/")[0])
      .filter((root) => root.length > 0)
  );

  return roots.size === 1 ? [...roots][0] : null;
}

function validateUe4ssStructure(entries: RuntimeEntryLike[]): ModProblem[] {
  if (isUe4ssRuntimeStructureValid(entries)) {
    return [];
  }

  return [
    modProblem(
      "error",
      "UE4SS_RUNTIME_FILE_MISSING",
      "UE4SS runtime must include either root UE4SS.dll, dwmapi.dll, and UE4SS-settings.ini; root legacy xinput1_3.dll and UE4SS-settings.ini; or the official nested layout with root dwmapi.dll and ue4ss/UE4SS.dll plus ue4ss/UE4SS-settings.ini."
    )
  ];
}

function sanitizeRuntimeVersion(version: string): string {
  return (
    version
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 80) || "manual"
  );
}

async function createUniqueRuntimeVersion(
  runtimeRoot: string,
  requestedVersion: string
): Promise<string> {
  let candidate = requestedVersion;
  let suffix = 2;

  while (await pathExists(path.join(runtimeRoot, candidate))) {
    candidate = `${requestedVersion}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function renameRuntimeDirectoryWithRetry(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isTransientRenameError(error)) {
        throw error;
      }
      await sleep(attempt * 150);
    }
  }
}

function isTransientRenameError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return ["EPERM", "EACCES", "EBUSY"].includes(
    String((error as { code?: unknown }).code)
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function listRuntimeDirectoryFiles(
  root: string,
  currentPath = root
): Promise<RuntimeDirectoryFile[]> {
  const rootPath = path.resolve(root);
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files: RuntimeDirectoryFile[] = [];

  for (const entry of entries) {
    const sourcePath = path.join(currentPath, entry.name);
    const entryStats = await lstat(sourcePath);
    const relativeName = path
      .relative(rootPath, sourcePath)
      .replaceAll("\\", "/");

    assertSafeRuntimeDirectoryEntry(rootPath, sourcePath, relativeName);

    if (entryStats.isSymbolicLink()) {
      throw new Error(`Runtime directory contains a symbolic link: ${relativeName}`);
    }

    if (entryStats.isDirectory()) {
      files.push(...(await listRuntimeDirectoryFiles(rootPath, sourcePath)));
    } else if (entryStats.isFile()) {
      files.push({
        sourcePath,
        relativeName,
        dir: false
      });
    }
  }

  return files;
}

function assertSafeRuntimeDirectoryEntry(
  rootPath: string,
  sourcePath: string,
  relativeName: string
): void {
  if (
    relativeName.length === 0 ||
    relativeName.startsWith("..") ||
    path.isAbsolute(relativeName) ||
    !isPathInside(rootPath, sourcePath)
  ) {
    throw new Error(`Runtime directory entry escapes its root: ${sourcePath}`);
  }

  const segments = relativeName.replaceAll("\\", "/").split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw new Error(`Runtime directory entry is unsafe: ${relativeName}`);
  }
}

async function copyRuntimeDirectoryFiles(
  files: RuntimeDirectoryFile[],
  destinationRoot: string
): Promise<void> {
  for (const file of files) {
    const destinationPath = resolveSafeArchiveEntryDestination(
      destinationRoot,
      file.relativeName
    );
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(file.sourcePath, destinationPath);
  }
}

async function hashRuntimeDirectorySha256(
  files: RuntimeDirectoryFile[]
): Promise<string> {
  const hash = createHash("sha256");
  const sortedFiles = [...files].sort((first, second) => {
    if (first.relativeName < second.relativeName) {
      return -1;
    }
    if (first.relativeName > second.relativeName) {
      return 1;
    }
    return 0;
  });

  for (const file of sortedFiles) {
    hash.update(file.relativeName);
    hash.update("\0");
    hash.update(await hashFileSha256(file.sourcePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

async function findReusableRuntimeDirectory(
  runtimeRoot: string,
  requestedVersion: string,
  expectedSha256: string
): Promise<string | null> {
  const candidatePath = path.join(runtimeRoot, requestedVersion);
  if (!(await pathExists(candidatePath))) {
    return null;
  }

  try {
    const files = await listRuntimeDirectoryFiles(candidatePath);
    if (
      validateUe4ssStructure(files).length === 0 &&
      (await hashRuntimeDirectorySha256(files)) === expectedSha256
    ) {
      return requestedVersion;
    }
  } catch {
    return null;
  }

  return null;
}

function unvalidatedRuntimeProblems(message: string): ModProblem[] {
  return [
    modProblem(
      "warning",
      "UE4SS_RUNTIME_UNVALIDATED",
      message
    )
  ];
}
