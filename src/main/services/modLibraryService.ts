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
    const targetPath = getInstalledModPath(
      layout.directories.libraryMods,
      parsedPackage.manifest.id,
      parsedPackage.manifest.version
    );
    const existingMetadata = await this.readMetadataAt(targetPath);

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

      return {
        status: "duplicateDifferentHash",
        mod: existingMod,
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

    if (await pathExists(targetPath)) {
      return {
        status: "failed",
        mod: null,
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

    try {
      await this.packageService.extractPackage(parsedPackage, stagingPath);
      await copyFile(
        parsedPackage.packagePath,
        path.join(stagingPath, "package.clawedmod")
      );

      const metadata = this.createMetadata({
        manifest: parsedPackage.manifest,
        sha256: parsedPackage.sha256,
        targetPath: stagingPath
      });
      await writeFile(
        path.join(stagingPath, "metadata.json"),
        `${JSON.stringify(metadata, null, 2)}\n`
      );

      await mkdir(path.dirname(targetPath), { recursive: true });
      await renameDirectoryWithRetry(stagingPath, targetPath);
      const installedMetadata = await this.readMetadataAt(targetPath);

      return {
        status: "installed",
        mod: installedMetadata
          ? await this.toInstalledModVersion(installedMetadata)
          : null,
        problems: []
      };
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true });
      return {
        status: "failed",
        mod: null,
        problems: [
          modProblem(
            "error",
            "PACKAGE_INSTALL_FAILED",
            "CMM could not safely install the mod package.",
            error instanceof Error ? error.message : String(error)
          )
        ]
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
