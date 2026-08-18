import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { z } from "zod";

import {
  ClawedModManifestV1Schema,
  CreatorAssetMetadataV1Schema,
  ExternalModInspectionResultSchema,
  type ClawedModManifestV1,
  type CreatorAssetMetadataV1,
  type ExternalModFormat,
  type ExternalModInspectionRequest,
  type ExternalModInspectionResult,
  type ImportModPackageRequest,
  type ImportModPackageResult,
  type ModLoader,
  type ModProblem,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  ExternalImportServiceContract,
  ModLibraryServiceContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import {
  ClawedModPackageError,
  getOriginalZipEntryName,
  hashFileSha256,
  validateArchivePaths
} from "./clawedModPackageService";
import type { ClawedModPackageService } from "./clawedModPackageService";
import { modProblem } from "./packageProblems";

const GENERATED_EXTERNAL_VERSION = "0.0.0-external";
const ZIP_STABLE_DATE = new Date("2000-01-01T00:00:00.000Z");
const BLOCKED_EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".js"
]);
const UNSUPPORTED_ARCHIVE_EXTENSIONS = new Set([".rar", ".7z"]);
const RAW_IOSTORE_EXTENSIONS = new Set([".utoc", ".ucas"]);
const UNREAL_ASSET_EXTENSIONS = new Set([".pak", ".utoc", ".ucas"]);

const ThunderstoreManifestSchema = z
  .object({
    name: z.string().min(1),
    version_number: z.string().min(1),
    description: z.string().optional(),
    dependencies: z.array(z.string()).optional()
  })
  .passthrough();

type ThunderstoreManifest = z.infer<typeof ThunderstoreManifestSchema>;

interface ZipInspectionContext {
  zip: JSZip;
  entries: ZipEntryInfo[];
}

interface ZipEntryInfo {
  normalizedName: string;
  isDirectory: boolean;
  extension: string;
  entry: JSZip.JSZipObject;
}

interface ConversionPlan {
  format: ExternalModFormat;
  manifest: ClawedModManifestV1;
  addPayload(zip: JSZip): Promise<GeneratedPayloadChecksum[]>;
  addReadme?(zip: JSZip): Promise<void>;
  addIcon?(zip: JSZip): Promise<void>;
}

interface GeneratedPayloadChecksum {
  path: string;
  sha256: string;
}

export class LocalExternalModImportService
  implements ExternalImportServiceContract
{
  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly packageService: ClawedModPackageService,
    private readonly modLibraryService: ModLibraryServiceContract
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "externalImportService",
      label: "External Import Service",
      status: "ready",
      detail:
        "Classifies common community mod files and converts safe layouts into canonical .clawedmod packages."
    };
  }

  async inspectExternalModPackage(
    request: ExternalModInspectionRequest
  ): Promise<ExternalModInspectionResult> {
    const packagePath = request.packagePath;
    const fileName = path.basename(packagePath);
    const extension = path.extname(fileName).toLowerCase();
    const hashResult = await this.tryHashSource(packagePath);

    if (hashResult.problem) {
      return this.result({
        status: "invalid",
        format: "unsupportedArchive",
        support: "unsupported",
        loader: null,
        sourcePath: packagePath,
        fileName,
        sha256: null,
        detectedName: null,
        detectedVersion: null,
        entryCount: 0,
        problems: [hashResult.problem]
      });
    }

    if (extension === ".clawedmod") {
      return this.inspectCanonicalPackage(packagePath, fileName, hashResult.sha256);
    }

    if (extension === ".pak") {
      return this.result({
        status: "recognized",
        format: "rawPak",
        support: "installable",
        loader: "pak",
        sourcePath: packagePath,
        fileName,
        sha256: hashResult.sha256,
        detectedName: displayNameFromFileName(fileName),
        detectedVersion: GENERATED_EXTERNAL_VERSION,
        entryCount: 1,
        problems: [
          modProblem(
            "warning",
            "EXTERNAL_PACKAGE_WRAPPED",
            "This raw Pak file will be wrapped as a generated .clawedmod package before installation."
          )
        ]
      });
    }

    if (RAW_IOSTORE_EXTENSIONS.has(extension)) {
      return this.result({
        status: "recognized",
        format: "rawIoStore",
        support: "inspectOnly",
        loader: "pak",
        sourcePath: packagePath,
        fileName,
        sha256: hashResult.sha256,
        detectedName: displayNameFromFileName(fileName),
        detectedVersion: null,
        entryCount: 1,
        problems: [
          modProblem(
            "warning",
            "IOSTORE_PAIR_IMPORT_UNSUPPORTED",
            "CMM recognized this Unreal IoStore sidecar file, but V1 import requires explicit paired-container handling before installation."
          )
        ]
      });
    }

    if (UNSUPPORTED_ARCHIVE_EXTENSIONS.has(extension)) {
      return this.result({
        status: "unsupported",
        format: "unsupportedArchive",
        support: "unsupported",
        loader: null,
        sourcePath: packagePath,
        fileName,
        sha256: hashResult.sha256,
        detectedName: displayNameFromFileName(fileName),
        detectedVersion: null,
        entryCount: 0,
        problems: [
          modProblem(
            "warning",
            "UNSUPPORTED_ARCHIVE_CONTAINER",
            "CMM recognized this archive type, but V1 does not install .rar or .7z files until a safe extractor is added."
          )
        ]
      });
    }

    if (BLOCKED_EXECUTABLE_EXTENSIONS.has(extension)) {
      return this.result({
        status: "unsupported",
        format: "blockedExecutable",
        support: "blocked",
        loader: null,
        sourcePath: packagePath,
        fileName,
        sha256: hashResult.sha256,
        detectedName: displayNameFromFileName(fileName),
        detectedVersion: null,
        entryCount: 0,
        problems: [
          modProblem(
            "error",
            "EXTERNAL_EXECUTABLE_BLOCKED",
            "CMM does not import executable installers or scripts as mods."
          )
        ]
      });
    }

    if (extension === ".zip") {
      return this.inspectZipPackage(packagePath, fileName, hashResult.sha256);
    }

    return this.result({
      status: "unsupported",
      format: "unsupportedArchive",
      support: "unsupported",
      loader: null,
      sourcePath: packagePath,
      fileName,
      sha256: hashResult.sha256,
      detectedName: displayNameFromFileName(fileName),
      detectedVersion: null,
      entryCount: 0,
      problems: [
        modProblem(
          "warning",
          "UNSUPPORTED_MOD_FILE",
          "CMM does not know how to import this file type yet."
        )
      ]
    });
  }

  async importExternalModPackage(
    request: ImportModPackageRequest
  ): Promise<ImportModPackageResult> {
    const inspection = await this.inspectExternalModPackage({
      packagePath: request.packagePath
    });

    if (inspection.format === "clawedmod" && inspection.support === "installable") {
      if (path.extname(request.packagePath).toLowerCase() === ".clawedmod") {
        return this.withInspectionProblems(
          await this.modLibraryService.importModPackage(request),
          inspection
        );
      }

      return this.importGeneratedPackage(
        inspection,
        async (outputPath) => {
          const bytes = await readFile(request.packagePath);
          await writeFile(outputPath, bytes);
        }
      );
    }

    if (inspection.support !== "installable") {
      return {
        status: "failed",
        mod: null,
        problems: inspection.problems.length
          ? inspection.problems
          : [
              modProblem(
                "warning",
                "EXTERNAL_IMPORT_UNSUPPORTED",
                "CMM recognized this file but cannot install it yet."
              )
            ]
      };
    }

    const conversionPlan = await this.createConversionPlan(inspection);
    if (!conversionPlan) {
      return {
        status: "failed",
        mod: null,
        problems: [
          ...inspection.problems,
          modProblem(
            "error",
            "EXTERNAL_IMPORT_PLAN_MISSING",
            "CMM could not create a safe conversion plan for this package."
          )
        ]
      };
    }

    return this.importGeneratedPackage(inspection, async (outputPath) => {
      await this.writeGeneratedClawedMod(outputPath, conversionPlan, inspection);
    });
  }

  private async inspectCanonicalPackage(
    packagePath: string,
    fileName: string,
    sha256: string
  ): Promise<ExternalModInspectionResult> {
    try {
      const parsed = await this.packageService.parsePackage(packagePath);
      return this.result({
        status: "recognized",
        format: "clawedmod",
        support: "installable",
        loader: parsed.manifest.loader,
        sourcePath: packagePath,
        fileName,
        sha256,
        detectedName: parsed.manifest.name,
        detectedVersion: parsed.manifest.version,
        entryCount: Object.keys(parsed.zip.files).length,
        problems: []
      });
    } catch (error) {
      return this.result({
        status: "invalid",
        format: "clawedmod",
        support: "unsupported",
        loader: null,
        sourcePath: packagePath,
        fileName,
        sha256,
        detectedName: null,
        detectedVersion: null,
        entryCount: 0,
        problems:
          error instanceof ClawedModPackageError
            ? error.problems
            : [
                modProblem(
                  "error",
                  "PACKAGE_INSPECTION_FAILED",
                  "CMM could not inspect this .clawedmod package.",
                  error instanceof Error ? error.message : String(error)
                )
              ]
      });
    }
  }

  private async inspectZipPackage(
    packagePath: string,
    fileName: string,
    sha256: string
  ): Promise<ExternalModInspectionResult> {
    const context = await this.readZipContext(packagePath);
    if ("problems" in context) {
      return this.result({
        status: "invalid",
        format: "genericZip",
        support: "unsupported",
        loader: null,
        sourcePath: packagePath,
        fileName,
        sha256,
        detectedName: displayNameFromFileName(fileName),
        detectedVersion: null,
        entryCount: 0,
        problems: context.problems
      });
    }

    const cmmManifest = await this.readCmmManifest(context.zip);
    if (cmmManifest && hasPayload(context.entries)) {
      return this.result({
        status: "recognized",
        format: "clawedmod",
        support: "installable",
        loader: cmmManifest.loader,
        sourcePath: packagePath,
        fileName,
        sha256,
        detectedName: cmmManifest.name,
        detectedVersion: cmmManifest.version,
        entryCount: context.entries.length,
        problems: [
          modProblem(
            "warning",
            "ZIP_CONTAINS_CLAWEDMOD",
            "This ZIP has a .clawedmod package layout and will be installed through the canonical importer."
          )
        ]
      });
    }

    if (hasFomodLayout(context.entries)) {
      return this.result({
        status: "recognized",
        format: "fomod",
        support: "inspectOnly",
        loader: null,
        sourcePath: packagePath,
        fileName,
        sha256,
        detectedName: displayNameFromFileName(fileName),
        detectedVersion: null,
        entryCount: context.entries.length,
        problems: [
          modProblem(
            "warning",
            "FOMOD_INSTALLER_UNSUPPORTED",
            "CMM recognized a FOMOD installer, but V1 does not execute installer scripts or conditional install logic."
          )
        ]
      });
    }

    const thunderstore = await this.readThunderstoreManifest(context.zip);
    const payload = classifyZipPayload(context.entries);
    const ioStoreOnly = hasIoStoreOnly(payload.assetEntries);
    if (thunderstore && payload.loader) {
      if (ioStoreOnly) {
        return this.result({
          status: "recognized",
          format: "thunderstore",
          support: "inspectOnly",
          loader: "pak",
          sourcePath: packagePath,
          fileName,
          sha256,
          detectedName: thunderstore.name,
          detectedVersion: thunderstore.version_number,
          entryCount: context.entries.length,
          problems: [
            modProblem(
              "warning",
              "IOSTORE_PAIR_IMPORT_UNSUPPORTED",
              "CMM recognized Unreal IoStore files, but V1 import requires explicit paired-container handling before installation."
            )
          ]
        });
      }

      return this.result({
        status: "recognized",
        format: "thunderstore",
        support: "installable",
        loader: payload.loader,
        sourcePath: packagePath,
        fileName,
        sha256,
        detectedName: thunderstore.name,
        detectedVersion: thunderstore.version_number,
        entryCount: context.entries.length,
        problems: thunderstore.dependencies?.length
          ? [
              modProblem(
                "warning",
                "THUNDERSTORE_DEPENDENCIES_NOT_CONVERTED",
                "Thunderstore dependency metadata was found but cannot be mapped to CMM mod IDs automatically yet.",
                thunderstore.dependencies.join(", ")
              )
            ]
          : []
      });
    }

    if (payload.loader === "pak") {
      if (ioStoreOnly) {
        return this.result({
          status: "recognized",
          format: "rawIoStore",
          support: "inspectOnly",
          loader: "pak",
          sourcePath: packagePath,
          fileName,
          sha256,
          detectedName: displayNameFromFileName(fileName),
          detectedVersion: null,
          entryCount: context.entries.length,
          problems: [
            modProblem(
              "warning",
              "IOSTORE_PAIR_IMPORT_UNSUPPORTED",
              "CMM recognized Unreal IoStore files, but V1 import requires explicit paired-container handling before installation."
            )
          ]
        });
      }

      return this.result({
        status: "recognized",
        format: "genericZip",
        support: "installable",
        loader: "pak",
        sourcePath: packagePath,
        fileName,
        sha256,
        detectedName: displayNameFromFileName(fileName),
        detectedVersion: GENERATED_EXTERNAL_VERSION,
        entryCount: context.entries.length,
        problems: [
          modProblem(
            "warning",
            "GENERIC_ZIP_WRAPPED",
            "This ZIP contains recognizable Unreal Pak payloads and will be wrapped as a generated .clawedmod package."
          )
        ]
      });
    }

    if (payload.loader === "ue4ss") {
      return this.result({
        status: "recognized",
        format: "ue4ssArchive",
        support: "installable",
        loader: "ue4ss",
        sourcePath: packagePath,
        fileName,
        sha256,
        detectedName: displayNameFromFileName(fileName),
        detectedVersion: GENERATED_EXTERNAL_VERSION,
        entryCount: context.entries.length,
        problems: [
          modProblem(
            "warning",
            "UE4SS_ARCHIVE_WRAPPED",
            "This ZIP contains a recognizable UE4SS-style payload and will be wrapped as a generated .clawedmod package."
          )
        ]
      });
    }

    return this.result({
      status: "unsupported",
      format: thunderstore ? "thunderstore" : "genericZip",
      support: "unsupported",
      loader: null,
      sourcePath: packagePath,
      fileName,
      sha256,
      detectedName: thunderstore?.name ?? displayNameFromFileName(fileName),
      detectedVersion: thunderstore?.version_number ?? null,
      entryCount: context.entries.length,
      problems: [
        modProblem(
          "warning",
          "ZIP_PAYLOAD_NOT_RECOGNIZED",
          "CMM could not find a supported Clawed, Unreal Pak, or UE4SS payload in this ZIP."
        )
      ]
    });
  }

  private async createConversionPlan(
    inspection: ExternalModInspectionResult
  ): Promise<ConversionPlan | null> {
    if (inspection.format === "rawPak") {
      return this.rawPakPlan(inspection);
    }

    if (
      inspection.format === "thunderstore" ||
      inspection.format === "genericZip" ||
      inspection.format === "ue4ssArchive"
    ) {
      return this.zipConversionPlan(inspection);
    }

    return null;
  }

  private rawPakPlan(inspection: ExternalModInspectionResult): ConversionPlan {
    const sourceName = inspection.fileName;
    const baseManifest = this.createGeneratedManifest({
      prefix: "external",
      sourceName,
      name: inspection.detectedName ?? displayNameFromFileName(sourceName),
      version: inspection.detectedVersion ?? GENERATED_EXTERNAL_VERSION,
      loader: "pak"
    });
    const payloadPath = `payload/Content/Paks/${sourceName}`;
    const manifest = withGeneratedCreatorAssets(baseManifest, {
      format: "rawPak",
      sourceName,
      sourceSha256: inspection.sha256,
      payloadPaths: [payloadPath]
    });

    return {
      format: "rawPak",
      manifest,
      addPayload: async (zip) => {
        const bytes = await readFile(inspection.sourcePath);
        zip.file(
          payloadPath,
          bytes,
          stableZipOptions()
        );
        return [{ path: payloadPath, sha256: hashBufferSha256(bytes) }];
      }
    };
  }

  private async zipConversionPlan(
    inspection: ExternalModInspectionResult
  ): Promise<ConversionPlan | null> {
    const context = await this.readZipContext(inspection.sourcePath);
    if ("problems" in context) {
      return null;
    }

    const thunderstore =
      inspection.format === "thunderstore"
        ? await this.readThunderstoreManifest(context.zip)
        : null;
    const payload = classifyZipPayload(context.entries);
    const loader = inspection.loader ?? payload.loader;
    if (!loader) {
      return null;
    }

    const prefix = inspection.format === "thunderstore" ? "thunderstore" : "external";
    const baseManifest = this.createGeneratedManifest({
      prefix,
      sourceName: thunderstore?.name ?? inspection.fileName,
      name:
        thunderstore?.name ??
        inspection.detectedName ??
        displayNameFromFileName(inspection.fileName),
      version:
        thunderstore?.version_number ??
        inspection.detectedVersion ??
        GENERATED_EXTERNAL_VERSION,
      loader
    });
    const payloadPaths = mappedPayloadPaths(context.entries, loader, baseManifest.id);
    const manifest = withGeneratedCreatorAssets(baseManifest, {
      format: inspection.format,
      sourceName: inspection.fileName,
      sourceSha256: inspection.sha256,
      payloadPaths
    });

    return {
      format: inspection.format,
      manifest,
      addPayload: async (zip) => {
        return addZipPayloadEntries(zip, context.entries, loader, manifest.id);
      },
      addReadme: async (zip) => {
        const readme = context.zip.file(/^readme(\.md|\.txt)?$/i)[0];
        if (readme) {
          zip.file("README.md", await readme.async("nodebuffer"), stableZipOptions());
        }
      },
      addIcon: async (zip) => {
        const icon = context.zip.file(/^icon\.png$/i)[0];
        if (icon) {
          zip.file("icon.png", await icon.async("nodebuffer"), stableZipOptions());
        }
      }
    };
  }

  private async writeGeneratedClawedMod(
    outputPath: string,
    plan: ConversionPlan,
    inspection: ExternalModInspectionResult
  ): Promise<void> {
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      `${JSON.stringify(plan.manifest, null, 2)}\n`,
      stableZipOptions()
    );
    const payloadChecksums = await plan.addPayload(zip);
    await plan.addReadme?.(zip);
    await plan.addIcon?.(zip);
    zip.file(
      "checksums.json",
      `${JSON.stringify(
        {
          schemaVersion: 1,
          source: {
            format: plan.format,
            fileName: inspection.fileName,
            sha256: inspection.sha256
          },
          files: payloadChecksums
        },
        null,
        2
      )}\n`,
      stableZipOptions()
    );

    if (!zip.file(/^payload\/.+/).length) {
      throw new Error("Generated package did not contain payload files.");
    }

    await writeFile(
      outputPath,
      await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE"
      })
    );
  }

  private async importGeneratedPackage(
    inspection: ExternalModInspectionResult,
    writePackage: (outputPath: string) => Promise<void>
  ): Promise<ImportModPackageResult> {
    const layout = await this.storageService.getLayout();
    const stagingPath = path.join(
      layout.directories.staging,
      `external-import-${Date.now()}-${randomUUID()}`
    );
    const packageName = `${safeFileStem(
      inspection.detectedName ?? inspection.fileName
    )}.clawedmod`;
    const outputPath = path.join(stagingPath, packageName);

    try {
      await mkdir(stagingPath, { recursive: true });
      await writePackage(outputPath);
      return this.withInspectionProblems(
        await this.modLibraryService.importModPackage({
          packagePath: outputPath
        }),
        inspection
      );
    } catch (error) {
      return {
        status: "failed",
        mod: null,
        problems: [
          ...inspection.problems,
          modProblem(
            "error",
            "EXTERNAL_IMPORT_FAILED",
            "CMM could not convert this mod into a safe .clawedmod package.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      };
    } finally {
      await rm(stagingPath, { recursive: true, force: true });
    }
  }

  private withInspectionProblems(
    result: ImportModPackageResult,
    inspection: ExternalModInspectionResult
  ): ImportModPackageResult {
    const warningProblems = inspection.problems.filter(
      (problem) => problem.severity !== "error"
    );

    return {
      ...result,
      problems: [...result.problems, ...warningProblems]
    };
  }

  private async readZipContext(
    packagePath: string
  ): Promise<ZipInspectionContext | { problems: ModProblem[] }> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await readFile(packagePath));
    } catch (error) {
      return {
        problems: [
          modProblem(
            "error",
            "MALFORMED_ZIP",
            "This mod archive is not a readable ZIP file.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      };
    }

    const pathProblems = validateArchivePaths(zip);
    if (pathProblems.length > 0) {
      return { problems: pathProblems };
    }

    return {
      zip,
      entries: Object.values(zip.files).map((entry) => {
        const originalName = getOriginalZipEntryName(entry);
        return {
          normalizedName: normalizeZipPath(originalName),
          isDirectory: entry.dir,
          extension: path.extname(originalName).toLowerCase(),
          entry
        };
      })
    };
  }

  private async readCmmManifest(zip: JSZip): Promise<ClawedModManifestV1 | null> {
    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) {
      return null;
    }

    try {
      return ClawedModManifestV1Schema.parse(
        JSON.parse(await manifestEntry.async("string"))
      );
    } catch {
      return null;
    }
  }

  private async readThunderstoreManifest(
    zip: JSZip
  ): Promise<ThunderstoreManifest | null> {
    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) {
      return null;
    }

    try {
      return ThunderstoreManifestSchema.parse(
        JSON.parse(await manifestEntry.async("string"))
      );
    } catch {
      return null;
    }
  }

  private createGeneratedManifest({
    prefix,
    sourceName,
    name,
    version,
    loader
  }: {
    prefix: string;
    sourceName: string;
    name: string;
    version: string;
    loader: ModLoader;
  }): ClawedModManifestV1 {
    return ClawedModManifestV1Schema.parse({
      schemaVersion: 1,
      id:
        loader === "ue4ss"
          ? safeUe4ssModId(prefix, sourceName)
          : `${prefix}.${safeId(sourceName)}`,
      name: name.trim() || "Imported Mod",
      version: version.trim() || GENERATED_EXTERNAL_VERSION,
      author: "Unknown",
      description:
        "Generated by CMM from an external mod package. Review compatibility before modded launch.",
      game: "clawed",
      loader,
      dependencies: [],
      conflicts: [],
      loadAfter: [],
      loadBefore: []
    });
  }

  private result(
    result: ExternalModInspectionResult
  ): ExternalModInspectionResult {
    return ExternalModInspectionResultSchema.parse(result);
  }

  private async tryHashSource(packagePath: string): Promise<
    | { sha256: string; problem?: never }
    | { sha256?: never; problem: ModProblem }
  > {
    try {
      return { sha256: await hashFileSha256(packagePath) };
    } catch (error) {
      return {
        problem: modProblem(
          "error",
          "SOURCE_FILE_READ_FAILED",
          "CMM could not read the selected mod file.",
          error instanceof Error ? error.message : String(error)
        )
      };
    }
  }
}

async function addZipPayloadEntries(
  outputZip: JSZip,
  entries: ZipEntryInfo[],
  loader: ModLoader,
  manifestId: string
): Promise<GeneratedPayloadChecksum[]> {
  const payloadEntries = entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      entry,
      targetPath: mapExternalEntryToPayloadPath(entry, loader, manifestId)
    }))
    .filter(
      (mapped): mapped is { entry: ZipEntryInfo; targetPath: string } =>
        mapped.targetPath !== null
    );
  const checksums: GeneratedPayloadChecksum[] = [];

  for (const mapped of payloadEntries) {
    const bytes = await mapped.entry.entry.async("nodebuffer");
    const payloadPath = `payload/${mapped.targetPath}`;
    outputZip.file(payloadPath, bytes, stableZipOptions());
    checksums.push({
      path: payloadPath,
      sha256: hashBufferSha256(bytes)
    });
  }

  return checksums;
}

function mappedPayloadPaths(
  entries: ZipEntryInfo[],
  loader: ModLoader,
  manifestId: string
): string[] {
  return entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => mapExternalEntryToPayloadPath(entry, loader, manifestId))
    .filter((targetPath): targetPath is string => targetPath !== null)
    .map((targetPath) => `payload/${targetPath}`);
}

function withGeneratedCreatorAssets(
  manifest: ClawedModManifestV1,
  options: {
    format: ExternalModFormat;
    sourceName: string;
    sourceSha256: string | null;
    payloadPaths: string[];
  }
): ClawedModManifestV1 {
  return ClawedModManifestV1Schema.parse({
    ...manifest,
    creatorAssets: generatedCreatorAssets(manifest, options)
  });
}

function generatedCreatorAssets(
  manifest: ClawedModManifestV1,
  {
    format,
    sourceName,
    sourceSha256,
    payloadPaths
  }: {
    format: ExternalModFormat;
    sourceName: string;
    sourceSha256: string | null;
    payloadPaths: string[];
  }
): CreatorAssetMetadataV1 {
  const sourceHashes = sourceSha256
    ? [
        {
          algorithm: "sha256" as const,
          scope: "source" as const,
          path: sourceName,
          sha256: sourceSha256
        }
      ]
    : [];
  const affectedAssets = payloadPaths.map((payloadPath, index) => ({
    id: `payload-${index + 1}`,
    assetClass: manifest.loader === "pak" ? "CookedUnrealAsset" : "SupportFile",
    virtualPath: generatedPayloadVirtualPath(manifest, payloadPath),
    payloadPath,
    source: "external" as const,
    role:
      manifest.loader === "pak"
        ? ("replacement" as const)
        : ("support" as const),
    tags:
      manifest.loader === "pak"
        ? ["cooked_unreal_container"]
        : ["ue4ss_runtime"]
  }));

  return CreatorAssetMetadataV1Schema.parse({
    schemaVersion: 1,
    affectedAssets,
    replacements:
      manifest.loader === "pak"
        ? affectedAssets.map((asset) => ({
            replacementAssetId: asset.id,
            replacementVirtualPath: asset.virtualPath,
            payloadPaths: [asset.payloadPath],
            deploymentRoute: "inspect-only",
            validationState: "untested"
          }))
        : [],
    cookTarget:
      manifest.loader === "pak"
        ? {
            unrealVersion: "unknown",
            platform: "Windows",
            containerFormat: containerFormatForPayloads(payloadPaths),
            requiresAssetRegistry: payloadPaths.some((payloadPath) =>
              /(^|\/)AssetRegistry\.bin$/i.test(payloadPath)
            )
          }
        : undefined,
    supportedSteamBuilds: [],
    previewAssets: [],
    importProvenance: [
      {
        sourceKind: sourceKindForFormat(format),
        sourceName,
        sourceSha256: sourceSha256 ?? undefined,
        sourceHashes,
        toolName: "CMM ExternalImportService",
        toolVersion: "1",
        rights: "unknown"
      }
    ],
    assetDependencies: [],
    exportEligibility: {
      state: "unknown",
      allowedOutputs: ["assetIndex", "conflictReport", "validationReport"],
      containsBaseGameContent: false,
      requiresUserOwnedSource: true,
      reason:
        "Generated external import metadata does not prove user-owned reusable source rights."
    }
  });
}

function generatedPayloadVirtualPath(
  manifest: ClawedModManifestV1,
  payloadPath: string
): string {
  return `/Packages/${manifest.id}/${manifest.version}/${payloadPath
    .replaceAll("\\", "/")
    .replace(/^payload\//, "")}`;
}

function sourceKindForFormat(
  format: ExternalModFormat
):
  | "clawedmod"
  | "rawPak"
  | "rawIoStore"
  | "zip"
  | "creatorSource"
  | "generated"
  | "manual" {
  if (format === "rawPak") {
    return "rawPak";
  }
  if (format === "rawIoStore") {
    return "rawIoStore";
  }
  if (format === "clawedmod") {
    return "clawedmod";
  }
  return "zip";
}

function containerFormatForPayloads(
  payloadPaths: string[]
): "pak" | "iostore" | "pak+iostore" | "none" | "unknown" {
  const extensions = new Set(
    payloadPaths.map((payloadPath) =>
      path.posix.extname(payloadPath).toLowerCase()
    )
  );
  const hasPak = extensions.has(".pak");
  const hasIoStore = extensions.has(".utoc") || extensions.has(".ucas");
  if (hasPak && hasIoStore) {
    return "pak+iostore";
  }
  if (hasPak) {
    return "pak";
  }
  if (hasIoStore) {
    return "iostore";
  }
  return payloadPaths.length ? "unknown" : "none";
}

function hashBufferSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mapExternalEntryToPayloadPath(
  entry: ZipEntryInfo,
  loader: ModLoader,
  manifestId: string
): string | null {
  const normalizedName = entry.normalizedName;
  if (isKnownMetadataEntry(normalizedName)) {
    return null;
  }

  if (loader === "pak") {
    if (!UNREAL_ASSET_EXTENSIONS.has(entry.extension)) {
      return null;
    }

    const segments = normalizedName.split("/");
    const contentIndex = findContentPaksIndex(segments);
    if (contentIndex >= 0) {
      return segments.slice(contentIndex).join("/");
    }

    const paksIndex = segments.findIndex(
      (segment) => segment.toLowerCase() === "paks"
    );
    if (paksIndex >= 0) {
      return segments.slice(paksIndex).join("/");
    }

    return `Content/Paks/${path.posix.basename(normalizedName)}`;
  }

  if (loader === "ue4ss") {
    const segments = normalizedName.split("/");
    const lowerSegments = segments.map((segment) => segment.toLowerCase());
    if (lowerSegments[0] === "mods" && segments.length > 2) {
      return ["Mods", manifestId, ...segments.slice(2)].join("/");
    }

    if (lowerSegments[0] === "scripts" && segments.length > 1) {
      return ["Mods", manifestId, ...segments].join("/");
    }

    if (entry.extension === ".lua") {
      return `Mods/${manifestId}/Scripts/${path.posix.basename(normalizedName)}`;
    }
  }

  return null;
}

function classifyZipPayload(entries: ZipEntryInfo[]): {
  loader: ModLoader | null;
  assetEntries: ZipEntryInfo[];
} {
  const fileEntries = entries.filter((entry) => !entry.isDirectory);
  const assetEntries = fileEntries.filter((entry) =>
    UNREAL_ASSET_EXTENSIONS.has(entry.extension)
  );

  if (assetEntries.length > 0) {
    return {
      loader: "pak",
      assetEntries
    };
  }

  if (
    fileEntries.some((entry) => {
      const normalizedName = entry.normalizedName.toLowerCase();
      return (
        normalizedName.startsWith("mods/") ||
        normalizedName.startsWith("scripts/") ||
        normalizedName.endsWith(".lua")
      );
    })
  ) {
    return {
      loader: "ue4ss",
      assetEntries: []
    };
  }

  return {
    loader: null,
    assetEntries: []
  };
}

function hasIoStoreOnly(assetEntries: ZipEntryInfo[]): boolean {
  return (
    assetEntries.some((entry) => entry.extension !== ".pak") &&
    !assetEntries.some((entry) => entry.extension === ".pak")
  );
}

function hasPayload(entries: ZipEntryInfo[]): boolean {
  return entries.some((entry) => entry.normalizedName.startsWith("payload/"));
}

function hasFomodLayout(entries: ZipEntryInfo[]): boolean {
  return entries.some((entry) => {
    const normalizedName = entry.normalizedName.toLowerCase();
    return (
      normalizedName === "fomod/info.xml" ||
      normalizedName === "fomod/moduleconfig.xml" ||
      normalizedName.startsWith("fomod/")
    );
  });
}

function isKnownMetadataEntry(normalizedName: string): boolean {
  const lower = normalizedName.toLowerCase();
  return (
    lower === "manifest.json" ||
    lower === "readme.md" ||
    lower === "readme.txt" ||
    lower === "icon.png" ||
    lower === "changelog.md" ||
    lower.startsWith("fomod/")
  );
}

function findContentPaksIndex(segments: string[]): number {
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (
      segments[index].toLowerCase() === "content" &&
      segments[index + 1].toLowerCase() === "paks"
    ) {
      return index;
    }
  }

  return -1;
}

function stableZipOptions(): JSZip.JSZipFileOptions {
  return {
    date: ZIP_STABLE_DATE
  };
}

function normalizeZipPath(entryName: string): string {
  return entryName.replaceAll("\\", "/").replace(/^\/+/, "");
}

function displayNameFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const spaced = stem.replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced || "Imported Mod";
}

function safeUe4ssModId(prefix: string, sourceName: string): string {
  const stem = sourceName.replace(/\.[^.]+$/, "");
  const safePrefix = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safeStem = stem
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  const modId = [safePrefix || "external", safeStem || "imported_mod"]
    .join("_")
    .replace(/_+/g, "_");

  return modId.slice(0, 96);
}

function safeId(sourceName: string): string {
  const stem = sourceName.replace(/\.[^.]+$/, "");
  const safe = stem
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return safe || "imported-mod";
}

function safeFileStem(value: string): string {
  const safe = Array.from(value.trim().replace(/\.[^.]+$/, ""))
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character)
        ? "-"
        : character
    )
    .join("")
    .replace(/-+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return safe || "imported-mod";
}
