import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupAppStorageArtifacts,
  cleanupObsoleteUe4ssRuntimeInstalls
} from "../../src/main/services/storageCleanupService";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import type { AppStorageLayout } from "../../src/shared/contracts/app";
import type { StorageServiceContract } from "../../src/shared/contracts/services";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

async function makeStorage(): Promise<{
  layout: AppStorageLayout;
  storageService: FakeStorageService;
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-cleanup-"));
  const layout = createStorageLayout(tempRoot);
  return {
    layout,
    storageService: new FakeStorageService(layout)
  };
}

async function exists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function makeDirectory(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
  await writeFile(path.join(targetPath, "marker.txt"), "owned");
}

async function agePath(targetPath: string, now: Date, ageMs: number): Promise<void> {
  const oldDate = new Date(now.getTime() - ageMs);
  await utimes(targetPath, oldDate, oldDate);
}

async function writeRuntimeIndex({
  layout,
  installPath,
  evidencePath = null
}: {
  layout: AppStorageLayout;
  installPath: string;
  evidencePath?: string | null;
}): Promise<void> {
  const runtimeRoot = path.join(layout.directories.runtime, "ue4ss");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "ue4ss-runtime.json"),
    `${JSON.stringify(
      {
        version: path.basename(installPath),
        installPath,
        importedAt: "2026-08-24T12:00:00.000Z",
        sourceSha256: "a".repeat(64),
        source: "bundled",
        releaseValidation: evidencePath ? "VALIDATED" : "UNVALIDATED",
        validation: evidencePath
          ? {
              status: "VALIDATED",
              validatedAt: "2026-08-24T12:00:00.000Z",
              steamBuildId: "24782175",
              fingerprintSha256: "f".repeat(64),
              evidencePath,
              markerModId: "CMMPackagedRuntimeValidation",
              sourceSha256: "a".repeat(64)
            }
          : undefined
      },
      null,
      2
    )}\n`
  );
}

describe("storage cleanup service", () => {
  it("removes stale known staging artifacts without deleting recent or unknown folders", async () => {
    const { layout, storageService } = await makeStorage();
    const now = new Date("2026-08-24T12:00:00.000Z");
    const staleStaging = path.join(layout.directories.staging, "import-old");
    const recentStaging = path.join(layout.directories.staging, "deployment-recent");
    const unknownStaging = path.join(layout.directories.staging, "manual-notes");

    await makeDirectory(staleStaging);
    await makeDirectory(recentStaging);
    await makeDirectory(unknownStaging);
    await agePath(staleStaging, now, 2 * 24 * 60 * 60 * 1000);
    await agePath(unknownStaging, now, 2 * 24 * 60 * 60 * 1000);

    const result = await cleanupAppStorageArtifacts(storageService, undefined, {
      now,
      staleStagingAgeMs: 24 * 60 * 60 * 1000,
      obsoleteRuntimeAgeMs: Number.POSITIVE_INFINITY,
      runtimeValidationEvidenceAgeMs: Number.POSITIVE_INFINITY
    });

    expect(await exists(staleStaging)).toBe(false);
    expect(await exists(recentStaging)).toBe(true);
    expect(await exists(unknownStaging)).toBe(true);
    expect(result.removedPaths).toContain(path.normalize("staging/import-old"));
    expect(result.problems).toEqual([]);
  });

  it("removes obsolete UE4SS runtime installs and preserves the active install", async () => {
    const { layout } = await makeStorage();
    const now = new Date("2026-08-24T12:00:00.000Z");
    const runtimeRoot = path.join(layout.directories.runtime, "ue4ss");
    const activeRuntime = path.join(runtimeRoot, "active-runtime");
    const oldRuntime = path.join(runtimeRoot, "old-runtime");

    await makeDirectory(activeRuntime);
    await makeDirectory(oldRuntime);
    await agePath(oldRuntime, now, 60_000);
    await writeRuntimeIndex({ layout, installPath: activeRuntime });

    const result = await cleanupObsoleteUe4ssRuntimeInstalls(
      layout,
      activeRuntime,
      {
        now,
        obsoleteRuntimeAgeMs: 0
      }
    );

    expect(await exists(activeRuntime)).toBe(true);
    expect(await exists(oldRuntime)).toBe(false);
    expect(await exists(path.join(runtimeRoot, "ue4ss-runtime.json"))).toBe(true);
    expect(result.removedPaths).toContain(
      path.normalize("runtime/ue4ss/old-runtime")
    );
    expect(result.problems).toEqual([]);
  });

  it("prunes unreferenced old runtime validation evidence and keeps current evidence", async () => {
    const { layout, storageService } = await makeStorage();
    const now = new Date("2026-08-24T12:00:00.000Z");
    const activeRuntime = path.join(
      layout.directories.runtime,
      "ue4ss",
      "active-runtime"
    );
    const currentEvidence = path.join(
      layout.directories.logs,
      "runtime-validation",
      "current"
    );
    const oldEvidence = path.join(
      layout.directories.logs,
      "runtime-validation",
      "old"
    );

    await makeDirectory(activeRuntime);
    await makeDirectory(currentEvidence);
    await makeDirectory(oldEvidence);
    await agePath(currentEvidence, now, 60_000);
    await agePath(oldEvidence, now, 60_000);
    await writeRuntimeIndex({
      layout,
      installPath: activeRuntime,
      evidencePath: currentEvidence
    });

    const result = await cleanupAppStorageArtifacts(storageService, undefined, {
      now,
      staleStagingAgeMs: Number.POSITIVE_INFINITY,
      obsoleteRuntimeAgeMs: Number.POSITIVE_INFINITY,
      runtimeValidationEvidenceAgeMs: 0
    });

    expect(await exists(currentEvidence)).toBe(true);
    expect(await exists(oldEvidence)).toBe(false);
    expect(result.removedPaths).toContain(
      path.normalize("logs/runtime-validation/old")
    );
    expect(result.problems).toEqual([]);
  });
});
