import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  AvailableModCatalogSchema,
  InstallAvailableModResultSchema,
  type AvailableMod,
  type AvailableModCatalog,
  type AvailableModCategory,
  type AvailableModInstallScope,
  type ClawedModManifestV1,
  type InstallAvailableModRequest,
  type InstallAvailableModResult,
  type InstalledModManifestRecord,
  type ModProblem,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  AvailableModServiceContract,
  ModLibraryServiceContract
} from "../../shared/contracts/services";
import {
  ClawedModPackageError,
  type ClawedModPackageService
} from "./clawedModPackageService";
import { modProblem } from "./packageProblems";

export interface AvailableModSourceDirectory {
  category: AvailableModCategory;
  title: string;
  directory: string;
}

interface AvailableModPackage {
  key: string;
  category: AvailableModCategory;
  title: string;
  fileName: string;
  packagePath: string;
  manifest: ClawedModManifestV1;
  sha256: string;
}

const categoryOrder: AvailableModCategory[] = ["release", "prototype"];
const defaultTitles: Record<AvailableModCategory, string> = {
  release: "Official Release Mods",
  prototype: "Prototype Mods"
};
const hostOnlyModIds = new Set([
  "CoopCapacity8",
  "CoopCatchupTeleport",
  "SaveBackupRotator"
]);

export class LocalAvailableModService implements AvailableModServiceContract {
  constructor(
    private readonly packageService: ClawedModPackageService,
    private readonly modLibraryService: ModLibraryServiceContract,
    private readonly sourceDirectories: AvailableModSourceDirectory[]
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "availableModService",
      label: "Available Mod Service",
      status: "ready",
      detail:
        "Lists curated prototype and official release packages from bundled CMM mod folders."
    };
  }

  async listAvailableMods(): Promise<AvailableModCatalog> {
    const [{ packages, problems }, installedRecords] = await Promise.all([
      this.readAvailablePackages(),
      this.modLibraryService.listInstalledModManifests()
    ]);

    return this.toCatalog(packages, installedRecords, problems);
  }

  async installAvailableMod(
    request: InstallAvailableModRequest
  ): Promise<InstallAvailableModResult> {
    const { packages } = await this.readAvailablePackages();
    const selected = packages.find((available) => available.key === request.key);

    if (!selected) {
      return InstallAvailableModResultSchema.parse({
        result: {
          status: "failed",
          mod: null,
          problems: [
            modProblem(
              "warning",
              "AVAILABLE_MOD_NOT_FOUND",
              "That bundled mod package is no longer available."
            )
          ]
        },
        catalog: await this.listAvailableMods()
      });
    }

    const result = await this.modLibraryService.importModPackage({
      packagePath: selected.packagePath,
      replacement: request.replacement
    });

    return InstallAvailableModResultSchema.parse({
      result,
      catalog: await this.listAvailableMods()
    });
  }

  private async readAvailablePackages(): Promise<{
    packages: AvailableModPackage[];
    problems: ModProblem[];
  }> {
    const packages: AvailableModPackage[] = [];
    const problems: ModProblem[] = [];
    const seenKeys = new Set<string>();

    for (const source of uniqueSourceDirectories(this.sourceDirectories)) {
      if (!(await isDirectory(source.directory))) {
        continue;
      }

      const entries = await readdir(source.directory, {
        withFileTypes: true
      }).catch((error: unknown) => {
        problems.push(
          modProblem(
            "warning",
            "AVAILABLE_MOD_FOLDER_UNREADABLE",
            `${source.title} could not be read.`,
            error instanceof Error ? error.message : String(error)
          )
        );
        return [];
      });

      for (const entry of entries) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".clawedmod") {
          continue;
        }

        const key = `${source.category}:${entry.name}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);

        const packagePath = path.join(source.directory, entry.name);
        try {
          const parsed = await this.packageService.parsePackage(packagePath);
          packages.push({
            key,
            category: source.category,
            title: source.title,
            fileName: entry.name,
            packagePath,
            manifest: parsed.manifest,
            sha256: parsed.sha256
          });
        } catch (error) {
          problems.push(toReadProblem(source, entry.name, error));
        }
      }
    }

    packages.sort((left, right) => {
      const categoryCompare =
        categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category);
      if (categoryCompare !== 0) {
        return categoryCompare;
      }
      const nameCompare = left.manifest.name.localeCompare(right.manifest.name);
      return nameCompare === 0
        ? left.manifest.version.localeCompare(right.manifest.version)
        : nameCompare;
    });

    return { packages, problems };
  }

  private toCatalog(
    packages: AvailableModPackage[],
    installedRecords: InstalledModManifestRecord[],
    problems: ModProblem[]
  ): AvailableModCatalog {
    const groups = categoryOrder.map((category) => {
      const mods = packages
        .filter((available) => available.category === category)
        .map((available) => this.toAvailableMod(available, installedRecords));

      return {
        category,
        title:
          packages.find((available) => available.category === category)?.title ??
          defaultTitles[category],
        mods
      };
    });

    const allMods = groups.flatMap((group) => group.mods);

    return AvailableModCatalogSchema.parse({
      generatedAt: new Date().toISOString(),
      groups,
      totals: {
        available: allMods.length,
        prototype: groups.find((group) => group.category === "prototype")?.mods
          .length ?? 0,
        release: groups.find((group) => group.category === "release")?.mods
          .length ?? 0,
        installed: allMods.filter((mod) => mod.installState === "installed")
          .length,
        problems: problems.length
      },
      problems
    });
  }

  private toAvailableMod(
    available: AvailableModPackage,
    installedRecords: InstalledModManifestRecord[]
  ): AvailableMod {
    const packageIdentityId = available.manifest.packageIdentity?.id ?? null;
    const exactRecord = installedRecords.find(
      (record) =>
        record.manifest.id === available.manifest.id &&
        record.manifest.version === available.manifest.version
    );
    const identityRecord = packageIdentityId
      ? installedRecords.find(
          (record) =>
            (record.mod.packageIdentityId ??
              record.manifest.packageIdentity?.id ??
              null) === packageIdentityId
        )
      : null;
    const installState =
      exactRecord?.mod.sha256 === available.sha256
        ? "installed"
        : identityRecord
          ? "sameIdentityInstalled"
          : exactRecord
            ? "duplicateDifferentHash"
            : "notInstalled";

    return {
      key: available.key,
      category: available.category,
      fileName: available.fileName,
      id: available.manifest.id,
      name: available.manifest.name,
      version: available.manifest.version,
      author: available.manifest.author,
      description: available.manifest.description.trim(),
      loader: available.manifest.loader,
      packageIdentityId,
      sha256: available.sha256,
      installScope: installScopeFor(available.manifest.id),
      installState,
      problems: []
    };
  }
}

function installScopeFor(modId: string): AvailableModInstallScope {
  return hostOnlyModIds.has(modId) ? "hostOnly" : "everyone";
}

function uniqueSourceDirectories(
  sources: AvailableModSourceDirectory[]
): AvailableModSourceDirectory[] {
  const seen = new Set<string>();
  const unique: AvailableModSourceDirectory[] = [];

  for (const source of sources) {
    const key = `${source.category}:${path.resolve(source.directory).toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(source);
  }

  return unique;
}

function toReadProblem(
  source: AvailableModSourceDirectory,
  fileName: string,
  error: unknown
): ModProblem {
  const detail =
    error instanceof ClawedModPackageError
      ? error.problems.map((problem) => problem.message).join("; ")
      : error instanceof Error
        ? error.message
        : String(error);

  return modProblem(
    "warning",
    "AVAILABLE_MOD_PACKAGE_INVALID",
    `${fileName} could not be listed in ${source.title}.`,
    detail
  );
}

async function isDirectory(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then((result) => result.isDirectory())
    .catch(() => false);
}
