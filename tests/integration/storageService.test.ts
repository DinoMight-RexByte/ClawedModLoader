import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("storage service", () => {
  it("derives CMM user data directories from one app data root", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-storage-"));
    const layout = createStorageLayout(tempRoot);

    expect(layout.directories.libraryMods).toBe(
      path.join(tempRoot, "library", "mods")
    );
    expect(layout.directories.profiles).toBe(path.join(tempRoot, "profiles"));
    expect(layout.directories.staging).toBe(path.join(tempRoot, "staging"));
    expect(layout.directories.runtime).toBe(path.join(tempRoot, "runtime"));
    expect(layout.directories.backups).toBe(path.join(tempRoot, "backups"));
    expect(layout.directories.logs).toBe(path.join(tempRoot, "logs"));
  });

  it("creates every conceptual storage directory", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-storage-"));
    const layout = await ensureStorageLayout(createStorageLayout(tempRoot));

    await Promise.all(
      Object.values(layout.directories).map(async (directory) => {
        const directoryStat = await stat(directory);
        expect(directoryStat.isDirectory()).toBe(true);
      })
    );
  });
});
