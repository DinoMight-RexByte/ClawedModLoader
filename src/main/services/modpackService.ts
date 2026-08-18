import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { ZodError } from "zod";

import {
  AcceptMissingModpackHistoryResultSchema,
  ModpackCompareResultSchema,
  ModpackExportResultSchema,
  ModpackHistorySnapshotSchema,
  ModpackImportResultSchema,
  ModpackInspectResultSchema,
  ModpackLoadOrderSchema,
  ModpackPackManifestSchema,
  type AcceptMissingModpackHistoryResult,
  type InstalledModManifestRecord,
  type LoadOrderProblem,
  type ModProblem,
  type ModpackCompareRequest,
  type ModpackCompareResult,
  type ModpackCompareStatus,
  type ModpackComparisonItem,
  type ModpackExportRequest,
  type ModpackExportResult,
  type ModpackHistoryEntry,
  type ModpackHistorySnapshot,
  type ModpackImportRequest,
  type ModpackImportResult,
  type ModpackInspectRequest,
  type ModpackInspectResult,
  type ModpackLoadOrder,
  type ModpackPackageInspection,
  type ModpackPackageRecord,
  type ModpackPackManifest,
  type ModReference,
  type Profile,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  ExportImportServiceContract,
  LoadOrderServiceContract,
  ModLibraryServiceContract,
  ProfileServiceContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import {
  ClawedModPackageError,
  assertSafeArchiveEntryName,
  getOriginalZipEntryName,
  hashBufferSha256,
  validateArchivePaths
} from "./clawedModPackageService";
import type { ClawedModPackageService } from "./clawedModPackageService";
import { modProblem } from "./packageProblems";
import { normalizeOrderedModIds } from "./profileOrder";
import { atomicWriteJson } from "./profileService";

const HISTORY_FILE = "modpack-history.json";

export class LocalModpackService implements ExportImportServiceContract {
  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly modLibraryService: ModLibraryServiceContract,
    private readonly profileService: ProfileServiceContract,
    private readonly loadOrderService: LoadOrderServiceContract,
    private readonly packageService: ClawedModPackageService
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "exportImportService",
      label: "Export/Import Service",
      status: "ready",
      detail: "Exports, imports, and compares portable .clawedpack archives."
    };
  }

  async exportCurrentProfile(
    request: ModpackExportRequest
  ): Promise<ModpackExportResult> {
    const destinationPath = ensureClawedpackExtension(request.destinationPath);
    const [profile, records, validation] = await Promise.all([
      this.profileService.getActiveProfile(),
      this.modLibraryService.listInstalledModManifests(),
      this.loadOrderService.validateActiveOrder()
    ]);
    const recordsByKey = mapInstalledRecordsByKey(records);
    const packageRecords: ModpackPackageRecord[] = [];
    const selectedRecords: InstalledModManifestRecord[] = [];
    const problems: ModProblem[] = validation.problems.map(
      loadOrderProblemToModProblem
    );
    const selectedModIds = Object.keys(profile.selectedMods);
    const orderedModIds = normalizeOrderedModIds(
      selectedModIds,
      profile.orderedModIds
    );

    for (const modId of orderedModIds) {
      const selection = profile.selectedMods[modId];
      const record = recordsByKey.get(packageKey(modId, selection.version));

      if (!record) {
        problems.push(
          modProblem(
            "error",
            "EXPORT_PACKAGE_MISSING",
            `${modId} ${selection.version} is selected, but its package is missing from the local library.`
          )
        );
        continue;
      }

      if (record.manifest.loader === "unknown") {
        problems.push(
          modProblem(
            "warning",
            "UNKNOWN_LOADER",
            `${record.manifest.name} uses an unknown loader and may not deploy on another machine.`
          )
        );
      }

      selectedRecords.push(record);
      packageRecords.push({
        id: record.manifest.id,
        version: record.manifest.version,
        sha256: record.mod.sha256,
        file: `packages/${createPackageFileName(record)}`
      });
    }

    if (problems.some((problem) => problem.severity === "error")) {
      return ModpackExportResultSchema.parse({
        status: "blocked",
        modpackPath: null,
        packageCount: 0,
        validation,
        problems
      });
    }

    try {
      const zip = new JSZip();
      const pack = createPackManifest(profile, packageRecords);
      const loadOrder = createLoadOrder(profile, orderedModIds);

      zip.file("pack.json", `${JSON.stringify(pack, null, 2)}\n`);
      zip.file("loadorder.json", `${JSON.stringify(loadOrder, null, 2)}\n`);
      zip.folder("packages");

      for (let index = 0; index < selectedRecords.length; index += 1) {
        const record = selectedRecords[index];
        const packageRecord = packageRecords[index];
        const packageBytes = await readFile(record.mod.packagePath);
        const actualSha256 = hashBufferSha256(packageBytes);

        if (actualSha256 !== packageRecord.sha256.toLowerCase()) {
          return ModpackExportResultSchema.parse({
            status: "blocked",
            modpackPath: null,
            packageCount: 0,
            validation,
            problems: [
              ...problems,
              modProblem(
                "error",
                "PACKAGE_HASH_CHANGED",
                `${record.manifest.name} no longer matches its recorded SHA-256 hash.`,
                `Expected ${packageRecord.sha256}; found ${actualSha256}.`
              )
            ]
          });
        }

        zip.file(packageRecord.file, packageBytes);
      }

      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(
        destinationPath,
        await zip.generateAsync({ type: "nodebuffer" })
      );
      await this.recordHistory({
        kind: "export",
        status: "exported",
        fileName: path.basename(destinationPath),
        profileName: profile.name,
        packageCount: packageRecords.length,
        trackedPackages: packageRecords.map(toModReference)
      });

      return ModpackExportResultSchema.parse({
        status: "exported",
        modpackPath: destinationPath,
        packageCount: packageRecords.length,
        validation,
        problems
      });
    } catch (error) {
      return ModpackExportResultSchema.parse({
        status: "failed",
        modpackPath: null,
        packageCount: 0,
        validation,
        problems: [
          ...problems,
          modProblem(
            "error",
            "MODPACK_EXPORT_FAILED",
            "CMM could not write the modpack archive.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    }
  }

  async inspectModpack(
    request: ModpackInspectRequest
  ): Promise<ModpackInspectResult> {
    if (path.extname(request.modpackPath).toLowerCase() !== ".clawedpack") {
      return invalidInspect(request.modpackPath, [
        modProblem(
          "error",
          "INVALID_EXTENSION",
          "This file is not a .clawedpack modpack.",
          request.modpackPath
        )
      ]);
    }

    const archive = await this.readModpackArchive(request.modpackPath);
    if (!archive) {
      return invalidInspect(request.modpackPath, [
        modProblem(
          "error",
          "MODPACK_READ_FAILED",
          "CMM could not read the selected modpack."
        )
      ]);
    }

    const { zip } = archive;
    const pathProblems = validateArchivePaths(zip);
    if (pathProblems.length > 0) {
      return invalidInspect(request.modpackPath, pathProblems);
    }

    const [packResult, loadOrderResult] = await Promise.all([
      readJsonZipEntry(zip, "pack.json", ModpackPackManifestSchema),
      readJsonZipEntry(zip, "loadorder.json", ModpackLoadOrderSchema)
    ]);
    const problems = [...packResult.problems, ...loadOrderResult.problems];
    const pack = packResult.value;
    const loadOrder = loadOrderResult.value;

    if (!pack || !loadOrder) {
      return invalidInspect(request.modpackPath, problems);
    }

    const consistencyProblems = validatePackConsistency(pack, loadOrder);
    const packageInspections = await this.inspectEmbeddedPackages(
      request.modpackPath,
      zip,
      pack
    );
    const allProblems = [
      ...problems,
      ...consistencyProblems,
      ...packageInspections.flatMap((inspection) => inspection.problems)
    ];

    return ModpackInspectResultSchema.parse({
      status: allProblems.some((problem) => problem.severity === "error")
        ? "invalid"
        : "ok",
      modpackPath: request.modpackPath,
      pack,
      loadOrder,
      summary: createSummary(loadOrder, pack.packages.length),
      packages: packageInspections,
      problems: allProblems
    });
  }

  async importModpack(
    request: ModpackImportRequest
  ): Promise<ModpackImportResult> {
    const inspect = await this.inspectModpack({
      modpackPath: request.modpackPath
    });

    if (inspect.status !== "ok" || !inspect.pack || !inspect.loadOrder) {
      return ModpackImportResultSchema.parse({
        status: "blocked",
        inspect,
        profile: null,
        validation: null,
        installedPackageCount: 0,
        reusedPackageCount: 0,
        problems: inspect.problems
      });
    }

    const collisionProblems = inspect.packages
      .filter((inspection) => inspection.status === "hashMismatch")
      .flatMap((inspection) => inspection.problems);

    if (collisionProblems.length > 0) {
      return ModpackImportResultSchema.parse({
        status: "blocked",
        inspect,
        profile: null,
        validation: null,
        installedPackageCount: 0,
        reusedPackageCount: 0,
        problems: collisionProblems
      });
    }

    const archive = await this.readModpackArchive(request.modpackPath);
    if (!archive) {
      return ModpackImportResultSchema.parse({
        status: "failed",
        inspect,
        profile: null,
        validation: null,
        installedPackageCount: 0,
        reusedPackageCount: 0,
        problems: [
          modProblem(
            "error",
            "MODPACK_READ_FAILED",
            "CMM could not read the selected modpack."
          )
        ]
      });
    }

    const stagedPackages = await this.writeEmbeddedPackagesToStaging(
      archive.zip,
      inspect.pack
    );
    let installedPackageCount = 0;
    let reusedPackageCount = 0;

    try {
      for (const packageInspection of inspect.packages) {
        if (packageInspection.status === "installed") {
          reusedPackageCount += 1;
          continue;
        }

        const stagedPackagePath = stagedPackages.packageFiles.get(
          packageKey(packageInspection.id, packageInspection.version)
        );
        if (!stagedPackagePath) {
          throw new Error(
            `Embedded package was not staged: ${packageInspection.id}`
          );
        }

        const result = await this.modLibraryService.importModPackage({
          packagePath: stagedPackagePath
        });

        if (result.status === "installed") {
          installedPackageCount += 1;
          continue;
        }

        if (result.status === "alreadyInstalled") {
          reusedPackageCount += 1;
          continue;
        }

        return ModpackImportResultSchema.parse({
          status: result.status === "duplicateDifferentHash" ? "blocked" : "failed",
          inspect,
          profile: null,
          validation: null,
          installedPackageCount,
          reusedPackageCount,
          problems: result.problems
        });
      }

      const profileResult = await this.profileService.createProfileFromState({
        name: inspect.loadOrder.profileName,
        selectedMods: inspect.loadOrder.selectedMods,
        orderedModIds: inspect.loadOrder.orderedModIds,
        preferredLaunchMode: inspect.loadOrder.preferredLaunchMode
      });
      const validation = (await this.loadOrderService.getSnapshot()).validation;
      await this.recordHistory({
        kind: "import",
        status: "imported",
        fileName: path.basename(request.modpackPath),
        profileId: profileResult.activeProfile.id,
        profileName: profileResult.activeProfile.name,
        packageCount: Object.keys(inspect.loadOrder.selectedMods).length,
        trackedPackages: Object.values(inspect.loadOrder.selectedMods).map(
          (selection) => ({
            id: selection.modId,
            version: selection.version
          })
        )
      });

      return ModpackImportResultSchema.parse({
        status: "imported",
        inspect,
        profile: profileResult.activeProfile,
        validation,
        installedPackageCount,
        reusedPackageCount,
        problems: validation.problems.map(loadOrderProblemToModProblem)
      });
    } catch (error) {
      return ModpackImportResultSchema.parse({
        status: "failed",
        inspect,
        profile: null,
        validation: null,
        installedPackageCount,
        reusedPackageCount,
        problems: [
          modProblem(
            "error",
            "MODPACK_IMPORT_FAILED",
            "CMM could not import the modpack.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    } finally {
      await rm(stagedPackages.stagingPath, {
        recursive: true,
        force: true
      }).catch(() => undefined);
    }
  }

  async compareCurrentProfileToModpack(
    request: ModpackCompareRequest
  ): Promise<ModpackCompareResult> {
    const inspect = await this.inspectModpack({
      modpackPath: request.modpackPath
    });

    if (inspect.status !== "ok" || !inspect.pack || !inspect.loadOrder) {
      return ModpackCompareResultSchema.parse({
        status: "FAILED",
        modpackPath: request.modpackPath,
        profileName: "Unknown",
        orderStatus: "ORDER MISMATCH",
        items: [],
        copyableReport: createFailedCompareReport(inspect.problems),
        problems: inspect.problems
      });
    }

    const [profile, records] = await Promise.all([
      this.profileService.getActiveProfile(),
      this.modLibraryService.listInstalledModManifests()
    ]);
    const recordsByKey = mapInstalledRecordsByKey(records);
    const packageRecordsById = new Map(
      inspect.pack.packages.map((record) => [record.id, record])
    );
    const items: ModpackComparisonItem[] = Object.values(
      inspect.loadOrder.selectedMods
    ).map(
      (expectedSelection) => {
        const actualSelection =
          profile.selectedMods[expectedSelection.modId] ?? null;
        const expectedPackageRecord = packageRecordsById.get(
          expectedSelection.modId
        );
        const actualRecord = actualSelection
          ? recordsByKey.get(
              packageKey(expectedSelection.modId, actualSelection.version)
            )
          : null;
        const status = getComparisonStatus({
          expectedVersion: expectedSelection.version,
          expectedSha256: expectedPackageRecord?.sha256 ?? null,
          actualVersion: actualSelection?.version ?? null,
          actualSha256: actualRecord?.mod.sha256 ?? null
        });

        return {
          id: expectedSelection.modId,
          status,
          expectedVersion: expectedSelection.version,
          actualVersion: actualSelection?.version ?? null,
          expectedSha256: expectedPackageRecord?.sha256 ?? null,
          actualSha256: actualRecord?.mod.sha256 ?? null,
          expectedEnabled: expectedSelection.enabled,
          actualEnabled: actualSelection?.enabled ?? null,
          enabledMatches: actualSelection
            ? actualSelection.enabled === expectedSelection.enabled
            : false
        };
      }
    );

    for (const actualSelection of Object.values(profile.selectedMods)) {
      if (inspect.loadOrder.selectedMods[actualSelection.modId]) {
        continue;
      }

      const actualRecord = recordsByKey.get(
        packageKey(actualSelection.modId, actualSelection.version)
      );
      items.push({
        id: actualSelection.modId,
        status: "EXTRA",
        expectedVersion: null,
        actualVersion: actualSelection.version,
        expectedSha256: null,
        actualSha256: actualRecord?.mod.sha256 ?? null,
        expectedEnabled: null,
        actualEnabled: actualSelection.enabled,
        enabledMatches: null
      });
    }

    const expectedOrder = normalizeOrderedModIds(
      Object.keys(inspect.loadOrder.selectedMods),
      inspect.loadOrder.orderedModIds
    );
    const actualOrder = normalizeOrderedModIds(
      Object.keys(profile.selectedMods),
      profile.orderedModIds
    );
    const orderStatus: ModpackCompareStatus = arraysEqual(
      expectedOrder,
      actualOrder
    )
      ? "MATCH"
      : "ORDER MISMATCH";
    const matches =
      orderStatus === "MATCH" &&
      items.every(
        (item) => item.status === "MATCH" && item.enabledMatches !== false
      );

    return ModpackCompareResultSchema.parse({
      status: matches ? "MATCH" : "DIFFERENT",
      modpackPath: request.modpackPath,
      profileName: profile.name,
      orderStatus,
      items,
      copyableReport: createCompareReport({
        status: matches ? "MATCH" : "DIFFERENT",
        profile,
        loadOrder: inspect.loadOrder,
        orderStatus,
        expectedOrder,
        actualOrder,
        items
      }),
      problems: []
    });
  }

  async listRecentModpacks(): Promise<ModpackHistorySnapshot> {
    return ModpackHistorySnapshotSchema.parse({
      entries: await this.withMissingHistory(await this.readHistory())
    });
  }

  async acceptMissingModpackReferences(): Promise<AcceptMissingModpackHistoryResult> {
    const entries = await this.withMissingHistory(await this.readHistory());
    const acceptedMissingAt = new Date().toISOString();
    let entriesUpdated = 0;
    let removedPackageCount = 0;
    const nextEntries = entries.map((entry) => {
      if (entry.missingPackages.length === 0) {
        return entry;
      }

      const missingKeys = new Set(
        entry.missingPackages.map((missingPackage) =>
          packageKey(missingPackage.id, missingPackage.version)
        )
      );
      const trackedPackages = entry.trackedPackages.filter(
        (trackedPackage) =>
          !missingKeys.has(packageKey(trackedPackage.id, trackedPackage.version))
      );
      entriesUpdated += 1;
      removedPackageCount += entry.missingPackages.length;

      return {
        ...entry,
        status: entry.status === "imported" ? "updated" : entry.status,
        packageCount: trackedPackages.length,
        trackedPackages,
        missingPackages: [],
        acceptedMissingAt
      };
    });

    await atomicWriteJson(await this.getHistoryPath(), { entries: nextEntries });
    return AcceptMissingModpackHistoryResultSchema.parse({
      status: "ok",
      entriesUpdated,
      removedPackageCount,
      history: {
        entries: await this.withMissingHistory(nextEntries)
      },
      problems: []
    });
  }

  private async inspectEmbeddedPackages(
    modpackPath: string,
    zip: JSZip,
    pack: ModpackPackManifest
  ): Promise<ModpackPackageInspection[]> {
    const records = await this.modLibraryService.listInstalledModManifests();
    const recordsByKey = mapInstalledRecordsByKey(records);
    const layout = await this.storageService.getLayout();
    const stagingPath = path.join(
      layout.directories.staging,
      `inspect-modpack-${Date.now()}-${randomUUID()}`
    );
    await mkdir(stagingPath, { recursive: true });

    try {
      const inspections: ModpackPackageInspection[] = [];
      for (const packageRecord of pack.packages) {
        inspections.push(
          await this.inspectEmbeddedPackage({
            modpackPath,
            zip,
            stagingPath,
            packageRecord,
            localRecord: recordsByKey.get(
              packageKey(packageRecord.id, packageRecord.version)
            )
          })
        );
      }
      return inspections;
    } finally {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }

  private async inspectEmbeddedPackage({
    zip,
    stagingPath,
    packageRecord,
    localRecord
  }: {
    modpackPath: string;
    zip: JSZip;
    stagingPath: string;
    packageRecord: ModpackPackageRecord;
    localRecord: InstalledModManifestRecord | undefined;
  }): Promise<ModpackPackageInspection> {
    const problems: ModProblem[] = [];
    const normalizedPackagePath = validatePackageRecordFile(packageRecord.file);
    const entry = normalizedPackagePath
      ? findZipEntry(zip, normalizedPackagePath)
      : null;

    if (!normalizedPackagePath || !entry) {
      problems.push(
        modProblem(
          "error",
          "MODPACK_PACKAGE_MISSING",
          `${packageRecord.file} is missing from the modpack.`
        )
      );
      return createPackageInspection(packageRecord, "invalid", null, problems);
    }

    const packageBytes = await entry.async("nodebuffer");
    const actualSha256 = hashBufferSha256(packageBytes);
    if (actualSha256 !== packageRecord.sha256.toLowerCase()) {
      problems.push(
        modProblem(
          "error",
          "MODPACK_PACKAGE_HASH_MISMATCH",
          `${packageRecord.id} ${packageRecord.version} does not match the hash recorded in pack.json.`,
          `Expected ${packageRecord.sha256}; found ${actualSha256}.`
        )
      );
    }

    const stagedPackagePath = path.join(
      stagingPath,
      createStagedPackageFileName(packageRecord)
    );
    await writeFile(stagedPackagePath, packageBytes);

    try {
      const parsedPackage = await this.packageService.parsePackage(
        stagedPackagePath
      );
      if (
        parsedPackage.manifest.id !== packageRecord.id ||
        parsedPackage.manifest.version !== packageRecord.version
      ) {
        problems.push(
          modProblem(
            "error",
            "MODPACK_PACKAGE_IDENTITY_MISMATCH",
            `${packageRecord.file} does not contain the package ID and version recorded in pack.json.`,
            `pack.json: ${packageRecord.id}@${packageRecord.version}; manifest.json: ${parsedPackage.manifest.id}@${parsedPackage.manifest.version}`
          )
        );
      }

      if (localRecord && localRecord.mod.sha256 !== packageRecord.sha256) {
        problems.push(
          modProblem(
            "warning",
            "LOCAL_PACKAGE_HASH_COLLISION",
            `${packageRecord.id} ${packageRecord.version} is installed locally, but the bytes differ from the modpack.`,
            `Local SHA-256: ${localRecord.mod.sha256}; modpack SHA-256: ${packageRecord.sha256}`
          )
        );
      }

      return createPackageInspection(
        packageRecord,
        problems.some((problem) => problem.severity === "error")
          ? "invalid"
          : localRecord && localRecord.mod.sha256 !== packageRecord.sha256
            ? "hashMismatch"
            : localRecord
              ? "installed"
              : "missing",
        {
          name: parsedPackage.manifest.name,
          loader: parsedPackage.manifest.loader
        },
        problems
      );
    } catch (error) {
      problems.push(
        ...(error instanceof ClawedModPackageError
          ? error.problems
          : [
              modProblem(
                "error",
                "EMBEDDED_PACKAGE_INVALID",
                `${packageRecord.file} is not a valid .clawedmod package.`,
                error instanceof Error ? error.message : String(error)
              )
            ])
      );
      return createPackageInspection(packageRecord, "invalid", null, problems);
    }
  }

  private async writeEmbeddedPackagesToStaging(
    zip: JSZip,
    pack: ModpackPackManifest
  ): Promise<{ stagingPath: string; packageFiles: Map<string, string> }> {
    const layout = await this.storageService.getLayout();
    const stagingPath = path.join(
      layout.directories.staging,
      `import-modpack-${Date.now()}-${randomUUID()}`
    );
    await mkdir(stagingPath, { recursive: true });
    const packageFiles = new Map<string, string>();

    for (const packageRecord of pack.packages) {
      const normalizedPackagePath = validatePackageRecordFile(
        packageRecord.file
      );
      if (!normalizedPackagePath) {
        continue;
      }

      const entry = findZipEntry(zip, normalizedPackagePath);
      if (!entry) {
        continue;
      }

      const stagedPackagePath = path.join(
        stagingPath,
        createStagedPackageFileName(packageRecord)
      );
      await writeFile(stagedPackagePath, await entry.async("nodebuffer"));
      packageFiles.set(
        packageKey(packageRecord.id, packageRecord.version),
        stagedPackagePath
      );
    }

    return { stagingPath, packageFiles };
  }

  private async readModpackArchive(
    modpackPath: string
  ): Promise<{ zip: JSZip } | null> {
    try {
      return {
        zip: await JSZip.loadAsync(await readFile(modpackPath))
      };
    } catch {
      return null;
    }
  }

  private async recordHistory(
    entry: Omit<ModpackHistoryEntry, "id" | "occurredAt" | "missingPackages"> & {
      missingPackages?: ModReference[];
    }
  ): Promise<void> {
    const entries = [
      {
        ...entry,
        id: randomUUID(),
        occurredAt: new Date().toISOString()
      },
      ...(await this.readHistory())
    ].slice(0, 10);

    await atomicWriteJson(await this.getHistoryPath(), { entries });
  }

  private async readHistory(): Promise<ModpackHistoryEntry[]> {
    try {
      const rawHistory = JSON.parse(await readFile(await this.getHistoryPath(), "utf8"));
      return ModpackHistorySnapshotSchema.parse(rawHistory).entries;
    } catch {
      return [];
    }
  }

  private async withMissingHistory(
    entries: ModpackHistoryEntry[]
  ): Promise<ModpackHistoryEntry[]> {
    const records = await this.modLibraryService.listInstalledModManifests();
    const installedKeys = new Set(
      records.map((record) =>
        packageKey(record.manifest.id, record.manifest.version)
      )
    );

    return entries.map((entry) => {
      const missingPackages = entry.trackedPackages.filter(
        (trackedPackage) =>
          !installedKeys.has(packageKey(trackedPackage.id, trackedPackage.version))
      );

      return {
        ...entry,
        missingPackages
      };
    });
  }

  private async getHistoryPath(): Promise<string> {
    const layout = await this.storageService.getLayout();
    return path.join(layout.directories.runtime, HISTORY_FILE);
  }
}

async function readJsonZipEntry<T>(
  zip: JSZip,
  entryName: string,
  schema: { parse(value: unknown): T }
): Promise<{ value: T | null; problems: ModProblem[] }> {
  const entry = zip.file(entryName);
  if (!entry) {
    return {
      value: null,
      problems: [
        modProblem(
          "error",
          `${entryName.toUpperCase().replaceAll(".", "_")}_MISSING`,
          `The modpack is missing ${entryName}.`
        )
      ]
    };
  }

  try {
    return {
      value: schema.parse(JSON.parse(await entry.async("string"))),
      problems: []
    };
  } catch (error) {
    return {
      value: null,
      problems: [
        modProblem(
          "error",
          `${entryName.toUpperCase().replaceAll(".", "_")}_INVALID`,
          `${entryName} does not match the .clawedpack V1 schema.`,
          formatSchemaError(error)
        )
      ]
    };
  }
}

function createPackManifest(
  profile: Profile,
  packages: ModpackPackageRecord[]
): ModpackPackManifest {
  return ModpackPackManifestSchema.parse({
    schemaVersion: 1,
    format: "clawedpack",
    exportType: "PORTABLE",
    name: profile.name,
    exportedAt: new Date().toISOString(),
    packages
  });
}

function createLoadOrder(
  profile: Profile,
  orderedModIds: string[]
): ModpackLoadOrder {
  const selectedMods = profile.selectedMods;
  return ModpackLoadOrderSchema.parse({
    schemaVersion: 1,
    profileName: profile.name,
    selectedMods,
    enabledModIds: Object.values(selectedMods)
      .filter((selection) => selection.enabled)
      .map((selection) => selection.modId),
    disabledModIds: Object.values(selectedMods)
      .filter((selection) => !selection.enabled)
      .map((selection) => selection.modId),
    orderedModIds,
    preferredLaunchMode: profile.preferredLaunchMode
  });
}

function createSummary(
  loadOrder: ModpackLoadOrder,
  packageCount: number
) {
  return {
    profileName: loadOrder.profileName,
    packageCount,
    enabledCount: loadOrder.enabledModIds.length,
    disabledCount: loadOrder.disabledModIds.length,
    orderedModIds: loadOrder.orderedModIds
  };
}

function validatePackConsistency(
  pack: ModpackPackManifest,
  loadOrder: ModpackLoadOrder
): ModProblem[] {
  const problems: ModProblem[] = [];
  const packageKeys = new Set<string>();

  for (const packageRecord of pack.packages) {
    const key = packageKey(packageRecord.id, packageRecord.version);
    if (packageKeys.has(key)) {
      problems.push(
        modProblem(
          "error",
          "MODPACK_DUPLICATE_PACKAGE",
          `${packageRecord.id} ${packageRecord.version} appears more than once in pack.json.`
        )
      );
    }
    packageKeys.add(key);
  }

  for (const selection of Object.values(loadOrder.selectedMods)) {
    if (!packageKeys.has(packageKey(selection.modId, selection.version))) {
      problems.push(
        modProblem(
          "error",
          "MODPACK_SELECTED_PACKAGE_MISSING",
          `${selection.modId} ${selection.version} is selected in loadorder.json but missing from pack.json.`
        )
      );
    }
  }

  const selectedIds = new Set(Object.keys(loadOrder.selectedMods));
  for (const packageRecord of pack.packages) {
    if (!selectedIds.has(packageRecord.id)) {
      problems.push(
        modProblem(
          "warning",
          "MODPACK_EXTRA_PACKAGE",
          `${packageRecord.id} ${packageRecord.version} is included but not selected by the profile.`
        )
      );
    }
  }

  return problems;
}

function createPackageInspection(
  record: ModpackPackageRecord,
  status: ModpackPackageInspection["status"],
  metadata: { name: string; loader: ModpackPackageInspection["loader"] } | null,
  problems: ModProblem[]
): ModpackPackageInspection {
  return {
    id: record.id,
    version: record.version,
    sha256: record.sha256,
    file: record.file,
    name: metadata?.name ?? null,
    loader: metadata?.loader ?? null,
    status,
    problems
  };
}

function invalidInspect(
  modpackPath: string,
  problems: ModProblem[]
): ModpackInspectResult {
  return ModpackInspectResultSchema.parse({
    status: "invalid",
    modpackPath,
    pack: null,
    loadOrder: null,
    summary: null,
    packages: [],
    problems
  });
}

function validatePackageRecordFile(packageFile: string): string | null {
  try {
    assertSafeArchiveEntryName(packageFile);
  } catch {
    return null;
  }

  const normalizedPackagePath = packageFile.replaceAll("\\", "/");
  if (
    !normalizedPackagePath.startsWith("packages/") ||
    normalizedPackagePath.endsWith("/") ||
    path.posix.extname(normalizedPackagePath).toLowerCase() !== ".clawedmod"
  ) {
    return null;
  }

  return normalizedPackagePath;
}

function findZipEntry(
  zip: JSZip,
  normalizedEntryName: string
): JSZip.JSZipObject | null {
  return (
    Object.values(zip.files).find(
      (entry) =>
        !entry.dir &&
        getOriginalZipEntryName(entry).replaceAll("\\", "/") ===
          normalizedEntryName
    ) ?? null
  );
}

function createPackageFileName(record: InstalledModManifestRecord): string {
  return `${encodeURIComponent(record.manifest.id)}-${encodeURIComponent(
    record.manifest.version
  )}.clawedmod`;
}

function createStagedPackageFileName(record: ModpackPackageRecord): string {
  return `${encodeURIComponent(record.id)}-${encodeURIComponent(
    record.version
  )}.clawedmod`;
}

function ensureClawedpackExtension(destinationPath: string): string {
  return path.extname(destinationPath).toLowerCase() === ".clawedpack"
    ? destinationPath
    : `${destinationPath}.clawedpack`;
}

function mapInstalledRecordsByKey(
  records: InstalledModManifestRecord[]
): Map<string, InstalledModManifestRecord> {
  return new Map(
    records.map((record) => [
      packageKey(record.manifest.id, record.manifest.version),
      record
    ])
  );
}

function packageKey(id: string, version: string): string {
  return `${id}\0${version}`;
}

function toModReference(record: ModpackPackageRecord): ModReference {
  return {
    id: record.id,
    version: record.version
  };
}

function getComparisonStatus({
  expectedVersion,
  expectedSha256,
  actualVersion,
  actualSha256
}: {
  expectedVersion: string;
  expectedSha256: string | null;
  actualVersion: string | null;
  actualSha256: string | null;
}): ModpackCompareStatus {
  if (!actualVersion) {
    return "MISSING";
  }
  if (actualVersion !== expectedVersion) {
    return "VERSION MISMATCH";
  }
  if (!actualSha256 || !expectedSha256) {
    return "MISSING";
  }
  if (actualSha256 !== expectedSha256) {
    return "HASH MISMATCH";
  }
  return "MATCH";
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createCompareReport({
  status,
  profile,
  loadOrder,
  orderStatus,
  expectedOrder,
  actualOrder,
  items
}: {
  status: "MATCH" | "DIFFERENT";
  profile: Profile;
  loadOrder: ModpackLoadOrder;
  orderStatus: ModpackCompareStatus;
  expectedOrder: string[];
  actualOrder: string[];
  items: Array<{
    id: string;
    status: ModpackCompareStatus;
    expectedVersion: string | null;
    actualVersion: string | null;
    expectedSha256: string | null;
    actualSha256: string | null;
    expectedEnabled: boolean | null;
    actualEnabled: boolean | null;
    enabledMatches: boolean | null;
  }>;
}): string {
  const lines = [
    "CMM Modpack Compare",
    `Result: ${status}`,
    `Current profile: ${profile.name}`,
    `Modpack profile: ${loadOrder.profileName}`,
    `Order: ${orderStatus}`
  ];

  if (orderStatus !== "MATCH") {
    lines.push(`Expected order: ${expectedOrder.join(", ")}`);
    lines.push(`Current order: ${actualOrder.join(", ")}`);
  }

  for (const item of items) {
    lines.push(
      `${item.status}: ${item.id} expected=${item.expectedVersion ?? "none"} current=${item.actualVersion ?? "none"}`
    );
    if (item.enabledMatches === false) {
      lines.push(
        `ENABLED STATE MISMATCH: ${item.id} expected=${formatEnabled(item.expectedEnabled)} current=${formatEnabled(item.actualEnabled)}`
      );
    }
    if (item.status === "HASH MISMATCH") {
      lines.push(
        `HASH: ${item.id} expected=${item.expectedSha256 ?? "none"} current=${item.actualSha256 ?? "none"}`
      );
    }
  }

  return lines.join("\n");
}

function createFailedCompareReport(problems: ModProblem[]): string {
  return [
    "CMM Modpack Compare",
    "Result: FAILED",
    ...problems.map((problem) => `${problem.code}: ${problem.message}`)
  ].join("\n");
}

function formatEnabled(value: boolean | null): string {
  if (value === null) {
    return "none";
  }
  return value ? "enabled" : "disabled";
}

function loadOrderProblemToModProblem(problem: LoadOrderProblem): ModProblem {
  return {
    severity: problem.severity === "ERROR" ? "error" : "warning",
    code: problem.code,
    message: problem.message,
    technicalDetail: problem.technicalDetail
  };
}

function formatSchemaError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
  }

  return error instanceof Error ? error.message : String(error);
}
