import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";
import { z } from "zod";

import {
  ClawedModManifestV1Schema,
  InstalledModManifestRecordSchema,
  InstalledModVersionSchema,
  type ClawedModManifestV1,
  type ImportModPackageRequest,
  type ImportModPackageResult,
  type InspectManifestResult,
  type InstalledModManifestRecord,
  type InstalledModVersion,
  type ModIdentityRequest,
  type ModLibrarySnapshot,
  type ModOperationResult,
  type ModProblem,
  type ReadmeResult,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  ModLibraryServiceContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import {
  ClawedModPackageError
} from "./clawedModPackageService";
import type { ClawedModPackageService } from "./clawedModPackageService";
import { modProblem } from "./packageProblems";
import { getInstalledModPath, isPathInside } from "./packagePaths";

const MetadataSchema = InstalledModVersionSchema.omit({
  iconDataUrl: true
}).extend({
  manifest: ClawedModManifestV1Schema,
  iconPath: z.string().nullable(),
  readmePath: z.string().nullable(),
  checksumsPath: z.string().nullable()
});

type InstalledModMetadata = z.infer<typeof MetadataSchema>;

export interface FolderOpener {
  openFolder(folderPath: string): Promise<string>;
}

export class ElectronFolderOpener implements FolderOpener {
  async openFolder(folderPath: string): Promise<string> {
    return shell.openPath(folderPath);
  }
}

export class LocalModLibraryService implements ModLibraryServiceContract {
  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly packageService: ClawedModPackageService,
    private readonly folderOpener: FolderOpener = new ElectronFolderOpener()
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "modLibraryService",
      label: "Mod Library Service",
      status: "ready",
      detail: "Stores canonical .clawedmod packages outside the game installation."
    };
  }

  async listInstalledMods(): Promise<ModLibrarySnapshot> {
    const metadataRecords = await this.readAllMetadata();
    const mods = await Promise.all(
      metadataRecords.map((metadata) => this.toInstalledModVersion(metadata))
    );
    mods.sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name);
      return nameCompare === 0
        ? left.version.localeCompare(right.version)
        : nameCompare;
    });

    return {
      mods,
      totals: {
        installed: mods.length,
        enabled: mods.filter((mod) => mod.enabled).length,
        disabled: mods.filter((mod) => !mod.enabled).length,
        problems: mods.reduce((sum, mod) => sum + mod.problems.length, 0)
      }
    };
  }

  async listInstalledModManifests(): Promise<InstalledModManifestRecord[]> {
    const metadataRecords = await this.readAllMetadata();
    const records = await Promise.all(
      metadataRecords.map(async (metadata) =>
        InstalledModManifestRecordSchema.parse({
          mod: await this.toInstalledModVersion(metadata),
          manifest: metadata.manifest
        })
      )
    );

    records.sort((left, right) => {
      const nameCompare = left.mod.name.localeCompare(right.mod.name);
      return nameCompare === 0
        ? left.mod.version.localeCompare(right.mod.version)
        : nameCompare;
    });

    return records;
  }

  async importModPackage(
    request: ImportModPackageRequest
  ): Promise<ImportModPackageResult> {
    let parsedPackage;
    try {
      parsedPackage = await this.packageService.parsePackage(
        request.packagePath
      );
    } catch (error) {
      return {
        status: "failed",
        mod: null,
        problems:
          error instanceof ClawedModPackageError
            ? error.problems
            : [
                modProblem(
                  "error",
                  "PACKAGE_IMPORT_FAILED",
                  "The mod package could not be imported.",
                  error instanceof Error ? error.message : String(error)
                )
              ]
      };
    }

    const layout = await this.storageService.getLayout();
    const packageIdentityId = parsedPackage.manifest.packageIdentity?.id ?? null;
    const replacementConfirmed =
      request.replacement?.action === "replaceMatchingIdentity" &&
      request.replacement.packageIdentityId === packageIdentityId;

    if (request.replacement && !replacementConfirmed) {
      return {
        status: "failed",
        mod: null,
        packageIdentityId,
        problems: [
          modProblem(
            "error",
            "PACKAGE_IDENTITY_REPLACEMENT_MISMATCH",
            "CMM blocked replacement because the selected package identity did not match the confirmation."
          )
        ]
      };
    }

    const targetPath = getInstalledModPath(
      layout.directories.libraryMods,
      parsedPackage.manifest.id,
      parsedPackage.manifest.version
    );
    const existingMetadata = await this.readMetadataAt(targetPath);
    const identityMatches = packageIdentityId
      ? uniqueMetadataByPath(
          (await this.readAllMetadata()).filter(
            (metadata) =>
              metadata.packageIdentityId === packageIdentityId ||
              metadata.manifest.packageIdentity?.id === packageIdentityId
          )
        )
      : [];

    if (existingMetadata) {
      const existingMod = await this.toInstalledModVersion(existingMetadata);
      if (existingMetadata.sha256 === parsedPackage.sha256) {
        return {
          status: "alreadyInstalled",
          mod: existingMod,
          problems: [
            modProblem(
              "info",
              "PACKAGE_ALREADY_INSTALLED",
              "This exact mod package is already installed."
            )
          ]
        };
      }

      if (
        packageIdentityId &&
        !identityMatches.some((metadata) =>
          samePath(metadata.installPath, existingMetadata.installPath)
        )
      ) {
        identityMatches.push(existingMetadata);
      }
    }

    if (identityMatches.length > 0 && !replacementConfirmed) {
      return {
        status: "needsReplacementConfirmation",
        mod: null,
        packageIdentityId,
        replacementCandidates: await Promise.all(
          identityMatches.map((metadata) => this.toInstalledModVersion(metadata))
        ),
        problems: [
          modProblem(
            "warning",
            "PACKAGE_IDENTITY_ALREADY_INSTALLED",
            identityMatches.length === 1
              ? "A mod with the same package identity is already installed."
              : "Mods with the same package identity are already installed.",
            identityMatches
              .map(
                (metadata) =>
                  `${metadata.name} (${metadata.id}@${metadata.version})`
              )
              .join("; ")
          )
        ]
      };
    }

    if (existingMetadata) {
      const existingMod = await this.toInstalledModVersion(existingMetadata);
      return {
        status: "duplicateDifferentHash",
        mod: existingMod,
        packageIdentityId,
        problems: [
          modProblem(
            "warning",
            "DUPLICATE_VERSION_DIFFERENT_HASH",
            "A mod with the same ID and version is already installed, but the files are not identical.",
            `Existing SHA-256: ${existingMetadata.sha256}; selected SHA-256: ${parsedPackage.sha256}`
          )
        ]
      };
    }

    const targetReplaced = identityMatches.some((metadata) =>
      samePath(metadata.installPath, targetPath)
    );
    if (!targetReplaced && (await pathExists(targetPath))) {
      return {
        status: "failed",
        mod: null,
        packageIdentityId,
        problems: [
          modProblem(
            "error",
            "TARGET_DIRECTORY_EXISTS",
            "CMM found an existing library folder for this mod version that it cannot safely replace.",
            targetPath
          )
        ]
      };
    }

    const stagingPath = path.join(
      layout.directories.staging,
      `import-${Date.now()}-${randomUUID()}`
    );
    let backups: ReplacementBackup[] = [];

    try {
      await this.packageService.extractPackage(parsedPackage, stagingPath);
      await copyFile(
        parsedPackage.packagePath,
        path.join(stagingPath, "package.clawedmod")
      );

      const metadata = this.createMetadata({
        manifest: parsedPackage.manifest,
        sha256: parsedPackage.sha256,
        targetPath
      });
      await writeFile(
        path.join(stagingPath, "metadata.json"),
        `${JSON.stringify(metadata, null, 2)}\n`
      );

      backups = await moveReplacementsToBackup(
        identityMatches,
        layout.directories.libraryMods,
        layout.directories.staging
      );
      await mkdir(path.dirname(targetPath), { recursive: true });
      await renameDirectoryWithRetry(stagingPath, targetPath);
      const installedMetadata = await this.readMetadataAt(targetPath);
      const cleanupProblem = await cleanupReplacementBackups(backups);
      const replacementProblem =
        backups.length > 0
          ? modProblem(
              "info",
              "PACKAGE_IDENTITY_REPLACED",
              backups.length === 1
                ? "Replaced the installed mod with the same package identity."
                : "Replaced installed mods with the same package identity.",
              backups
                .map((backup) => `${backup.id}@${backup.version}`)
                .join("; ")
            )
          : null;

      return {
        status: "installed",
        mod: installedMetadata
          ? await this.toInstalledModVersion(installedMetadata)
          : null,
        packageIdentityId,
        problems: [replacementProblem, cleanupProblem].filter(
          (problem): problem is ModProblem => problem !== null
        )
      };
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true });
      const rollbackProblem = await restoreReplacementBackups(backups).then(
        () => null,
        (rollbackError: unknown) =>
          modProblem(
            "error",
            "PACKAGE_REPLACEMENT_ROLLBACK_FAILED",
            "CMM could not fully restore packages after a failed replacement.",
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          )
      );
      return {
        status: "failed",
        mod: null,
        packageIdentityId,
        problems: [
          modProblem(
            "error",
            "PACKAGE_INSTALL_FAILED",
            "CMM could not safely install the mod package.",
            error instanceof Error ? error.message : String(error)
          ),
          rollbackProblem
        ].filter((problem): problem is ModProblem => problem !== null)
      };
    }
  }

  async uninstallMod(
    request: ModIdentityRequest
  ): Promise<ModOperationResult> {
    const targetPath = await this.getInstalledPath(request);
    const metadata = await this.readMetadataAt(targetPath);

    if (!metadata) {
      return {
        status: "notFound",
        mod: null,
        problems: [
          modProblem(
            "warning",
            "MOD_NOT_FOUND",
            "That installed mod version could not be found."
          )
        ]
      };
    }

    const layout = await this.storageService.getLayout();
    if (!isPathInside(layout.directories.libraryMods, targetPath)) {
      return {
        status: "blocked",
        mod: await this.toInstalledModVersion(metadata),
        problems: [
          modProblem(
            "error",
            "UNINSTALL_PATH_OUTSIDE_LIBRARY",
            "CMM blocked uninstall because the target path is outside the mod library."
          )
        ]
      };
    }

    await rm(targetPath, { recursive: true, force: false });
    await rmdir(path.dirname(targetPath)).catch(() => undefined);

    return {
      status: "ok",
      mod: null,
      problems: []
    };
  }

  async inspectManifest(
    request: ModIdentityRequest
  ): Promise<InspectManifestResult> {
    const metadata = await this.readMetadataAt(await this.getInstalledPath(request));
    return metadata
      ? {
          manifest: metadata.manifest,
          creatorMetadataState: metadata.manifest.creatorAssets
            ? "present"
            : "missing",
          creatorMetadataProblems: [],
          problems: []
        }
      : {
          manifest: null,
          creatorMetadataState: "missing",
          creatorMetadataProblems: [],
          problems: [
            modProblem(
              "warning",
              "MOD_NOT_FOUND",
              "That installed mod version could not be found."
            )
          ]
        };
  }

  async readReadme(request: ModIdentityRequest): Promise<ReadmeResult> {
    const metadata = await this.readMetadataAt(await this.getInstalledPath(request));

    if (!metadata) {
      return {
        content: null,
        problems: [
          modProblem(
            "warning",
            "MOD_NOT_FOUND",
            "That installed mod version could not be found."
          )
        ]
      };
    }

    if (!metadata.readmePath) {
      return {
        content: null,
        problems: [
          modProblem(
            "info",
            "README_MISSING",
            "This mod package does not include a README."
          )
        ]
      };
    }

    return {
      content: await readFile(metadata.readmePath, "utf8"),
      problems: []
    };
  }

  async openModFolder(
    request: ModIdentityRequest
  ): Promise<ModOperationResult> {
    const targetPath = await this.getInstalledPath(request);
    const metadata = await this.readMetadataAt(targetPath);

    if (!metadata) {
      return this.notFoundResult();
    }

    const errorMessage = await this.folderOpener.openFolder(targetPath);
    return errorMessage
      ? {
          status: "failed",
          mod: await this.toInstalledModVersion(metadata),
          problems: [
            modProblem(
              "error",
              "OPEN_FOLDER_FAILED",
              "CMM could not open the mod folder.",
              errorMessage
            )
          ]
        }
      : {
          status: "ok",
          mod: await this.toInstalledModVersion(metadata),
          problems: []
        };
  }

  async countInstalledPackages(): Promise<number> {
    return (await this.listInstalledMods()).totals.installed;
  }

  private createMetadata({
    manifest,
    sha256,
    targetPath
  }: {
    manifest: ClawedModManifestV1;
    sha256: string;
    targetPath: string;
  }): InstalledModMetadata {
    const metadata = {
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      author: manifest.author,
      description: manifest.description,
      loader: manifest.loader,
      sha256,
      packageIdentityId: manifest.packageIdentity?.id ?? null,
      enabled: false,
      installPath: targetPath,
      packagePath: path.join(targetPath, "package.clawedmod"),
      iconPath: path.join(targetPath, "icon.png"),
      readmePath: path.join(targetPath, "README.md"),
      checksumsPath: path.join(targetPath, "checksums.json"),
      hasReadme: true,
      status: "ready" as const,
      problems: [],
      installedAt: new Date().toISOString(),
      manifest
    };

    return MetadataSchema.parse({
      ...metadata,
      iconPath: metadata.iconPath,
      readmePath: metadata.readmePath,
      checksumsPath: metadata.checksumsPath
    });
  }

  private async toInstalledModVersion(
    metadata: InstalledModMetadata
  ): Promise<InstalledModVersion> {
    const [iconExists, readmeExists] = await Promise.all([
      metadata.iconPath ? pathExists(metadata.iconPath) : Promise.resolve(false),
      metadata.readmePath
        ? pathExists(metadata.readmePath)
        : Promise.resolve(false)
    ]);

    const iconDataUrl =
      iconExists && metadata.iconPath
        ? `data:image/png;base64,${(await readFile(metadata.iconPath)).toString(
            "base64"
          )}`
        : null;

    return InstalledModVersionSchema.parse({
      ...metadata,
      installPath: await this.rewriteInstalledPath(metadata.installPath),
      packagePath: await this.rewriteInstalledPath(metadata.packagePath),
      iconDataUrl,
      hasReadme: readmeExists
    });
  }

  private async rewriteInstalledPath(storedPath: string): Promise<string> {
    const layout = await this.storageService.getLayout();
    if (path.isAbsolute(storedPath)) {
      return storedPath;
    }

    return path.join(layout.root, storedPath);
  }

  private async readAllMetadata(): Promise<InstalledModMetadata[]> {
    const layout = await this.storageService.getLayout();
    const modIdDirectories = await readdir(layout.directories.libraryMods, {
      withFileTypes: true
    }).catch(() => []);

    const records: InstalledModMetadata[] = [];
    for (const modIdDirectory of modIdDirectories) {
      if (!modIdDirectory.isDirectory()) {
        continue;
      }

      const versionRoot = path.join(
        layout.directories.libraryMods,
        modIdDirectory.name
      );
      const versionDirectories = await readdir(versionRoot, {
        withFileTypes: true
      }).catch(() => []);

      for (const versionDirectory of versionDirectories) {
        if (!versionDirectory.isDirectory()) {
          continue;
        }

        const metadata = await this.readMetadataAt(
          path.join(versionRoot, versionDirectory.name)
        );
        if (metadata) {
          records.push(metadata);
        }
      }
    }

    return records;
  }

  private async readMetadataAt(
    targetPath: string
  ): Promise<InstalledModMetadata | null> {
    const metadataPath = path.join(targetPath, "metadata.json");
    try {
      const rawMetadata = JSON.parse(await readFile(metadataPath, "utf8"));
      const parsed = MetadataSchema.parse(rawMetadata);
      return {
        ...parsed,
        packageIdentityId:
          parsed.packageIdentityId ?? parsed.manifest.packageIdentity?.id ?? null,
        installPath: targetPath,
        packagePath: path.join(targetPath, "package.clawedmod"),
        iconPath: (await pathExists(path.join(targetPath, "icon.png")))
          ? path.join(targetPath, "icon.png")
          : null,
        readmePath: (await pathExists(path.join(targetPath, "README.md")))
          ? path.join(targetPath, "README.md")
          : null,
        checksumsPath: (await pathExists(path.join(targetPath, "checksums.json")))
          ? path.join(targetPath, "checksums.json")
          : null
      };
    } catch {
      return null;
    }
  }

  private async getInstalledPath(request: ModIdentityRequest): Promise<string> {
    const layout = await this.storageService.getLayout();
    return getInstalledModPath(
      layout.directories.libraryMods,
      request.id,
      request.version
    );
  }

  private notFoundResult(): ModOperationResult {
    return {
      status: "notFound",
      mod: null,
      problems: [
        modProblem(
          "warning",
          "MOD_NOT_FOUND",
          "That installed mod version could not be found."
        )
      ]
    };
  }
}

interface ReplacementBackup {
  id: string;
  version: string;
  originalPath: string;
  backupPath: string;
  backupRoot: string;
}

function uniqueMetadataByPath(
  metadataRecords: InstalledModMetadata[]
): InstalledModMetadata[] {
  const seen = new Set<string>();
  const unique: InstalledModMetadata[] = [];

  for (const metadata of metadataRecords) {
    const key = normalizedPathKey(metadata.installPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(metadata);
  }

  return unique;
}

async function moveReplacementsToBackup(
  metadataRecords: InstalledModMetadata[],
  libraryRoot: string,
  stagingRoot: string
): Promise<ReplacementBackup[]> {
  if (metadataRecords.length === 0) {
    return [];
  }

  const backupRoot = path.join(
    stagingRoot,
    `replace-${Date.now()}-${randomUUID()}`
  );
  const backups: ReplacementBackup[] = [];

  try {
    await mkdir(backupRoot, { recursive: true });
    for (const metadata of metadataRecords) {
      if (!isPathInside(libraryRoot, metadata.installPath)) {
        throw new Error(
          `Replacement target is outside the mod library: ${metadata.installPath}`
        );
      }

      const backupPath = path.join(
        backupRoot,
        `${backups.length}-${encodeURIComponent(metadata.id)}-${encodeURIComponent(
          metadata.version
        )}`
      );
      await mkdir(path.dirname(backupPath), { recursive: true });
      await renameDirectoryWithRetry(metadata.installPath, backupPath);
      backups.push({
        id: metadata.id,
        version: metadata.version,
        originalPath: metadata.installPath,
        backupPath,
        backupRoot
      });
    }

    return backups;
  } catch (error) {
    await restoreReplacementBackups(backups);
    await rm(backupRoot, { recursive: true, force: true });
    throw error;
  }
}

async function restoreReplacementBackups(
  backups: ReplacementBackup[]
): Promise<void> {
  for (const backup of [...backups].reverse()) {
    if (
      !(await pathExists(backup.backupPath)) ||
      (await pathExists(backup.originalPath))
    ) {
      continue;
    }
    await mkdir(path.dirname(backup.originalPath), { recursive: true });
    await renameDirectoryWithRetry(backup.backupPath, backup.originalPath);
  }
}

async function cleanupReplacementBackups(
  backups: ReplacementBackup[]
): Promise<ModProblem | null> {
  if (backups.length === 0) {
    return null;
  }

  try {
    for (const backup of backups) {
      await rm(backup.backupPath, { recursive: true, force: true });
    }
    for (const backupRoot of new Set(backups.map((backup) => backup.backupRoot))) {
      await rm(backupRoot, { recursive: true, force: true });
    }
    for (const parentPath of new Set(
      backups.map((backup) => path.dirname(backup.originalPath))
    )) {
      await rmdir(parentPath).catch(() => undefined);
    }
    return null;
  } catch (error) {
    return modProblem(
      "warning",
      "PACKAGE_REPLACEMENT_BACKUP_CLEANUP_FAILED",
      "The replacement succeeded, but CMM could not remove every temporary backup folder.",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function samePath(left: string, right: string): boolean {
  return normalizedPathKey(left) === normalizedPathKey(right);
}

function normalizedPathKey(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function renameDirectoryWithRetry(
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
