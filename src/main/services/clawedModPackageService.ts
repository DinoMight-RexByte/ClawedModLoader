import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { ZodError } from "zod";

import {
  ClawedModManifestV1Schema,
  type ClawedModManifestV1,
  type ModProblem,
  type ServiceStatus
} from "../../shared/contracts/app";
import type { PackageServiceContract } from "../../shared/contracts/services";
import { modProblem } from "./packageProblems";
import { isPathInside } from "./packagePaths";

export interface ParsedClawedModPackage {
  packagePath: string;
  sha256: string;
  manifest: ClawedModManifestV1;
  zip: JSZip;
  hasIcon: boolean;
  hasReadme: boolean;
  hasChecksums: boolean;
}

export class ClawedModPackageError extends Error {
  constructor(public readonly problems: ModProblem[]) {
    super(problems[0]?.message ?? "The mod package is invalid.");
  }
}

interface ZipObjectWithOriginalName extends JSZip.JSZipObject {
  unsafeOriginalName?: string;
}

export class ClawedModPackageService implements PackageServiceContract {
  getStatus(): ServiceStatus {
    return {
      id: "packageService",
      label: "Package Service",
      status: "ready",
      detail: "Validates .clawedmod archives, manifests, hashes, and safe extraction paths."
    };
  }

  async isImportAvailable(): Promise<boolean> {
    return true;
  }

  async parsePackage(packagePath: string): Promise<ParsedClawedModPackage> {
    if (path.extname(packagePath).toLowerCase() !== ".clawedmod") {
      throw new ClawedModPackageError([
        modProblem(
          "error",
          "INVALID_EXTENSION",
          "This file is not a .clawedmod package.",
          packagePath
        )
      ]);
    }

    const [archiveBytes, sha256] = await Promise.all([
      readFile(packagePath).catch((error: unknown) => {
        throw new ClawedModPackageError([
          modProblem(
            "error",
            "PACKAGE_READ_FAILED",
            "CMM could not read the selected mod package.",
            error instanceof Error ? error.message : String(error)
          )
        ]);
      }),
      hashFileSha256(packagePath)
    ]);

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(archiveBytes);
    } catch (error) {
      throw new ClawedModPackageError([
        modProblem(
          "error",
          "MALFORMED_ZIP",
          "The mod package is not a readable ZIP archive.",
          error instanceof Error ? error.message : String(error)
        )
      ]);
    }

    const pathProblems = validateArchivePaths(zip);
    if (pathProblems.length > 0) {
      throw new ClawedModPackageError(pathProblems);
    }

    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) {
      throw new ClawedModPackageError([
        modProblem(
          "error",
          "MANIFEST_MISSING",
          "The mod package is missing manifest.json."
        )
      ]);
    }

    if (!this.hasPayload(zip)) {
      throw new ClawedModPackageError([
        modProblem(
          "error",
          "PAYLOAD_MISSING",
          "The mod package is missing the required payload folder."
        )
      ]);
    }

    const manifest = await this.readManifest(manifestEntry);

    return {
      packagePath,
      sha256,
      manifest,
      zip,
      hasIcon: zip.file("icon.png") !== null,
      hasReadme: zip.file("README.md") !== null,
      hasChecksums: zip.file("checksums.json") !== null
    };
  }

  async extractPackage(
    parsedPackage: ParsedClawedModPackage,
    destination: string
  ): Promise<void> {
    await mkdir(destination, { recursive: true });

    for (const entry of Object.values(parsedPackage.zip.files)) {
      const entryName = getOriginalZipEntryName(entry);
      assertSafeArchiveEntryName(entryName);
      const destinationPath = resolveSafeArchiveEntryDestination(
        destination,
        entryName
      );

      if (entry.dir) {
        await mkdir(destinationPath, { recursive: true });
        continue;
      }

      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, await entry.async("nodebuffer"));
    }
  }

  private async readManifest(
    manifestEntry: JSZip.JSZipObject
  ): Promise<ClawedModManifestV1> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(await manifestEntry.async("string"));
    } catch (error) {
      throw new ClawedModPackageError([
        modProblem(
          "error",
          "MANIFEST_JSON_INVALID",
          "manifest.json is not valid JSON.",
          error instanceof Error ? error.message : String(error)
        )
      ]);
    }

    try {
      return ClawedModManifestV1Schema.parse(parsedJson);
    } catch (error) {
      const detail =
        error instanceof ZodError
          ? error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; ")
          : String(error);

      throw new ClawedModPackageError([
        modProblem(
          "error",
          "MANIFEST_SCHEMA_INVALID",
          "manifest.json does not match the .clawedmod manifest format.",
          detail
        )
      ]);
    }
  }

  private hasPayload(zip: JSZip): boolean {
    return Object.values(zip.files).some((entry) => {
      const entryName = getOriginalZipEntryName(entry).replaceAll("\\", "/");
      return entryName === "payload/" || entryName.startsWith("payload/");
    });
  }
}

export async function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function hashBufferSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function getOriginalZipEntryName(entry: JSZip.JSZipObject): string {
  return (entry as ZipObjectWithOriginalName).unsafeOriginalName ?? entry.name;
}

export function validateArchivePaths(zip: JSZip): ModProblem[] {
  return Object.values(zip.files)
    .map((entry) => {
      const entryName = getOriginalZipEntryName(entry);
      try {
        assertSafeArchiveEntryName(entryName);
        return null;
      } catch (error) {
        return modProblem(
          "error",
          "UNSAFE_ARCHIVE_PATH",
          "The archive contains an unsafe file path.",
          error instanceof Error ? error.message : String(error)
        );
      }
    })
    .filter((problem): problem is ModProblem => problem !== null);
}

export function assertSafeArchiveEntryName(entryName: string): void {
  if (entryName.includes("\0")) {
    throw new Error(`Archive entry contains a null byte: ${entryName}`);
  }

  const normalizedName = entryName.replaceAll("\\", "/");
  if (
    normalizedName.startsWith("/") ||
    normalizedName.startsWith("//") ||
    /^[A-Za-z]:\//.test(normalizedName) ||
    path.win32.isAbsolute(entryName) ||
    path.posix.isAbsolute(entryName)
  ) {
    throw new Error(`Archive entry is absolute: ${entryName}`);
  }

  const trimmed = normalizedName.replace(/\/+$/, "");
  const segments = trimmed.split("/");
  if (
    trimmed.length === 0 ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw new Error(`Archive entry traverses outside the package: ${entryName}`);
  }
}

export function resolveSafeArchiveEntryDestination(
  destination: string,
  entryName: string
): string {
  const destinationPath = path.resolve(
    destination,
    ...entryName.replaceAll("\\", "/").split("/")
  );

  if (!isPathInside(destination, destinationPath)) {
    throw new Error(`Archive entry escapes destination: ${entryName}`);
  }

  return destinationPath;
}
