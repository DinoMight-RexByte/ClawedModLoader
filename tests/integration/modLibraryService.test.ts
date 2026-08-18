import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import type { FolderOpener } from "../../src/main/services/modLibraryService";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import type {
  AppStorageLayout,
  ClawedModManifestV1
} from "../../src/shared/contracts/app";
import type { StorageServiceContract } from "../../src/shared/contracts/services";
import {
  createClawedModFixture,
  createExampleClawedModFixtures
} from "../helpers/clawedModFixture";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

class FakeFolderOpener implements FolderOpener {
  openedPath: string | null = null;

  async openFolder(folderPath: string): Promise<string> {
    this.openedPath = folderPath;
    return "";
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

async function makeLibrary(): Promise<{
  root: string;
  service: LocalModLibraryService;
  opener: FakeFolderOpener;
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-library-"));
  const opener = new FakeFolderOpener();
  const service = new LocalModLibraryService(
    new FakeStorageService(createStorageLayout(tempRoot)),
    new ClawedModPackageService(),
    opener
  );

  return {
    root: tempRoot,
    service,
    opener
  };
}

async function fixture(
  root: string,
  name: string,
  manifest?: Partial<ClawedModManifestV1>,
  payloadText?: string
): Promise<string> {
  const result = await createClawedModFixture(path.join(root, name), {
    manifest,
    payloadText
  });
  return result.packagePath;
}

async function exists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

describe("local mod library service", () => {
  it("imports valid archives and exposes installed versions", async () => {
    const { root, service, opener } = await makeLibrary();
    const packagePath = await fixture(root, "core.clawedmod");

    const result = await service.importModPackage({ packagePath });
    const snapshot = await service.listInstalledMods();

    expect(result.status).toBe("installed");
    expect(snapshot.totals.installed).toBe(1);
    expect(snapshot.mods[0].name).toBe("Core Framework");
    expect(snapshot.mods[0].enabled).toBe(false);
    expect(snapshot.mods[0].hasReadme).toBe(true);

    await expect(
      service.inspectManifest({ id: "core-framework", version: "1.0.0" })
    ).resolves.toMatchObject({
      manifest: expect.objectContaining({ id: "core-framework" })
    });
    await expect(
      service.readReadme({ id: "core-framework", version: "1.0.0" })
    ).resolves.toMatchObject({
      content: expect.stringContaining("Core Framework")
    });

    await service.openModFolder({ id: "core-framework", version: "1.0.0" });
    expect(opener.openedPath).toContain("core-framework");
  });

  it("treats same-version same-hash duplicates as already installed", async () => {
    const { root, service } = await makeLibrary();
    const packagePath = await fixture(root, "core.clawedmod");
    await service.importModPackage({ packagePath });

    const duplicate = await service.importModPackage({ packagePath });

    expect(duplicate.status).toBe("alreadyInstalled");
    expect((await service.listInstalledMods()).totals.installed).toBe(1);
  });

  it("blocks same-version different-hash duplicates", async () => {
    const { root, service } = await makeLibrary();
    const firstPackage = await fixture(root, "core-a.clawedmod");
    const secondPackage = await fixture(
      root,
      "core-b.clawedmod",
      undefined,
      "different bytes"
    );
    await service.importModPackage({ packagePath: firstPackage });

    const duplicate = await service.importModPackage({
      packagePath: secondPackage
    });

    expect(duplicate.status).toBe("duplicateDifferentHash");
    expect(duplicate.problems[0].code).toBe("DUPLICATE_VERSION_DIFFERENT_HASH");
    expect((await service.listInstalledMods()).totals.installed).toBe(1);
  });

  it("safely uninstalls only the canonical library package", async () => {
    const { root, service } = await makeLibrary();
    const sentinelPath = path.join(root, "do-not-touch.txt");
    await writeFile(sentinelPath, "keep");
    const packagePath = await fixture(root, "core.clawedmod");
    await service.importModPackage({ packagePath });
    const installedPath = (await service.listInstalledMods()).mods[0].installPath;

    const result = await service.uninstallMod({
      id: "core-framework",
      version: "1.0.0"
    });

    expect(result.status).toBe("ok");
    expect(await exists(installedPath)).toBe(false);
    expect(await exists(sentinelPath)).toBe(true);
  });

  it("generates developer example fixture packages", async () => {
    const { root } = await makeLibrary();
    const outputPaths = await createExampleClawedModFixtures(
      path.join(root, "fixtures")
    );

    expect(outputPaths).toHaveLength(5);
    expect(outputPaths.map((outputPath) => path.basename(outputPath))).toEqual([
      "core-framework.clawedmod",
      "character-framework.clawedmod",
      "female-character-a.clawedmod",
      "female-character-b.clawedmod",
      "male-character.clawedmod"
    ]);
  });
});
