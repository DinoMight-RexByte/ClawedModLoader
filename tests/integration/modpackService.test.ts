import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

import { afterEach, describe, expect, it } from "vitest";

import {
  ClawedModPackageService,
  hashFileSha256
} from "../../src/main/services/clawedModPackageService";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import { LocalModpackService } from "../../src/main/services/modpackService";
import {
  LocalLoadOrderService,
  LocalProfileService
} from "../../src/main/services/profileService";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import type {
  AppStorageLayout,
  ClawedModManifestV1,
  ModpackLoadOrder,
  ModpackPackManifest
} from "../../src/shared/contracts/app";
import type { StorageServiceContract } from "../../src/shared/contracts/services";
import { createClawedModFixture } from "../helpers/clawedModFixture";

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

async function makeServices(): Promise<{
  root: string;
  modLibraryService: LocalModLibraryService;
  profileService: LocalProfileService;
  loadOrderService: LocalLoadOrderService;
  modpackService: LocalModpackService;
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-modpacks-"));
  const storageService = new FakeStorageService(createStorageLayout(tempRoot));
  const packageService = new ClawedModPackageService();
  const modLibraryService = new LocalModLibraryService(
    storageService,
    packageService
  );
  const profileService = new LocalProfileService(
    storageService,
    modLibraryService
  );
  const loadOrderService = new LocalLoadOrderService(profileService);

  return {
    root: tempRoot,
    modLibraryService,
    profileService,
    loadOrderService,
    modpackService: new LocalModpackService(
      storageService,
      modLibraryService,
      profileService,
      loadOrderService,
      packageService
    )
  };
}

async function importFixture(
  root: string,
  service: LocalModLibraryService,
  overrides: Partial<ClawedModManifestV1>,
  payloadText?: string
): Promise<string> {
  const fixture = await createClawedModFixture(
    path.join(
      root,
      "fixtures",
      `${overrides.id ?? "fixture"}-${overrides.version ?? "1.0.0"}.clawedmod`
    ),
    { manifest: overrides, payloadText }
  );
  const result = await service.importModPackage({
    packagePath: fixture.packagePath
  });
  expect(result.status).toBe("installed");
  return fixture.packagePath;
}

async function createManualModpack({
  outputPath,
  profileName,
  packagePath,
  manifest,
  unsafeEntry
}: {
  outputPath: string;
  profileName: string;
  packagePath: string;
  manifest: ClawedModManifestV1;
  unsafeEntry?: string;
}): Promise<void> {
  const sha256 = await hashFileSha256(packagePath);
  const packageFile = `packages/${manifest.id}.clawedmod`;
  const pack: ModpackPackManifest = {
    schemaVersion: 1,
    format: "clawedpack",
    exportType: "PORTABLE",
    name: profileName,
    exportedAt: "2026-08-11T00:00:00.000Z",
    packages: [
      {
        id: manifest.id,
        version: manifest.version,
        sha256,
        file: packageFile
      }
    ]
  };
  const loadOrder: ModpackLoadOrder = {
    schemaVersion: 1,
    profileName,
    selectedMods: {
      [manifest.id]: {
        modId: manifest.id,
        version: manifest.version,
        enabled: true,
        config: {}
      }
    },
    enabledModIds: [manifest.id],
    disabledModIds: [],
    orderedModIds: [manifest.id],
    preferredLaunchMode: "VANILLA"
  };
  const zip = new JSZip();
  zip.file("pack.json", JSON.stringify(pack, null, 2));
  zip.file("loadorder.json", JSON.stringify(loadOrder, null, 2));
  zip.file(packageFile, await readFile(packagePath));
  if (unsafeEntry) {
    zip.file(unsafeEntry, "bad");
  }

  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
}

describe("local modpack service", () => {
  it("round-trips a profile with exact packages, enabled states, and load order", async () => {
    const {
      root,
      modLibraryService,
      profileService,
      modpackService
    } = await makeServices();

    await importFixture(root, modLibraryService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    await importFixture(root, modLibraryService, {
      id: "character",
      name: "Character",
      version: "2.0.0",
      dependencies: [{ id: "core" }]
    });
    await importFixture(root, modLibraryService, {
      id: "cosmetic",
      name: "Cosmetic",
      version: "3.0.0"
    });

    const createdProfile = await profileService.createProfile({
      name: "Profile A"
    });
    const profileAId = createdProfile.activeProfile.id;
    await profileService.setModEnabled({
      id: "core",
      version: "1.0.0",
      enabled: true
    });
    await profileService.setModEnabled({
      id: "character",
      version: "2.0.0",
      enabled: true
    });
    await profileService.setModEnabled({
      id: "cosmetic",
      version: "3.0.0",
      enabled: true
    });
    await profileService.setModEnabled({
      id: "cosmetic",
      version: "3.0.0",
      enabled: false
    });
    await profileService.moveModInActiveOrder({
      modId: "character",
      direction: "top"
    });

    const exportPath = path.join(root, "Profile A.clawedpack");
    const exported = await modpackService.exportCurrentProfile({
      destinationPath: exportPath
    });
    expect(exported.status).toBe("exported");

    const inspected = await modpackService.inspectModpack({
      modpackPath: exportPath
    });
    expect(inspected.status).toBe("ok");

    await profileService.deleteProfile({ id: profileAId });
    await modLibraryService.uninstallMod({ id: "core", version: "1.0.0" });
    await modLibraryService.uninstallMod({
      id: "character",
      version: "2.0.0"
    });
    await modLibraryService.uninstallMod({
      id: "cosmetic",
      version: "3.0.0"
    });

    const imported = await modpackService.importModpack({
      modpackPath: exportPath
    });
    expect(imported.status).toBe("imported");
    expect(imported.installedPackageCount).toBe(3);

    const comparison = await modpackService.compareCurrentProfileToModpack({
      modpackPath: exportPath
    });
    expect(comparison.status).toBe("MATCH");
    expect(comparison.orderStatus).toBe("MATCH");
    expect(comparison.items).toHaveLength(3);
    expect(
      comparison.items.every(
        (item) => item.status === "MATCH" && item.enabledMatches === true
      )
    ).toBe(true);

    const importedProfile = await profileService.getActiveProfile();
    expect(Object.keys(importedProfile.selectedMods)).toEqual([
      "core",
      "character",
      "cosmetic"
    ]);
    expect(importedProfile.selectedMods.core).toMatchObject({
      version: "1.0.0",
      enabled: true
    });
    expect(importedProfile.selectedMods.character).toMatchObject({
      version: "2.0.0",
      enabled: true
    });
    expect(importedProfile.selectedMods.cosmetic).toMatchObject({
      version: "3.0.0",
      enabled: false
    });
    expect(importedProfile.orderedModIds).toEqual([
      "character",
      "core",
      "cosmetic"
    ]);

    const installedRecords =
      await modLibraryService.listInstalledModManifests();
    const installedHashes = Object.fromEntries(
      installedRecords.map((record) => [record.mod.id, record.mod.sha256])
    );
    const expectedHashes = Object.fromEntries(
      inspected.pack?.packages.map((record) => [record.id, record.sha256]) ?? []
    );
    expect(installedHashes).toEqual(expectedHashes);
  });

  it("rejects malformed modpack archives", async () => {
    const { root, modpackService } = await makeServices();
    const modpackPath = path.join(root, "malformed.clawedpack");
    await writeFile(modpackPath, "not a zip");

    const inspected = await modpackService.inspectModpack({ modpackPath });

    expect(inspected.status).toBe("invalid");
    expect(inspected.problems[0].code).toBe("MODPACK_READ_FAILED");
  });

  it("rejects hostile modpack archive paths", async () => {
    const { root, modLibraryService, modpackService } = await makeServices();
    const packagePath = await importFixture(root, modLibraryService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    const manifest = (await modLibraryService.listInstalledModManifests())[0]
      .manifest;
    const modpackPath = path.join(root, "hostile.clawedpack");
    await createManualModpack({
      outputPath: modpackPath,
      profileName: "Hostile",
      packagePath,
      manifest,
      unsafeEntry: "../evil.txt"
    });

    const inspected = await modpackService.inspectModpack({ modpackPath });

    expect(inspected.status).toBe("invalid");
    expect(inspected.problems[0].code).toBe("UNSAFE_ARCHIVE_PATH");
  });

  it("blocks same-version package collisions with different hashes", async () => {
    const { root, modLibraryService, modpackService } = await makeServices();
    await importFixture(
      root,
      modLibraryService,
      {
        id: "core",
        name: "Core",
        version: "1.0.0"
      },
      "local bytes"
    );
    const differentPackage = await createClawedModFixture(
      path.join(root, "fixtures", "core-different.clawedmod"),
      {
        manifest: {
          id: "core",
          name: "Core",
          version: "1.0.0"
        },
        payloadText: "friend bytes"
      }
    );
    const modpackPath = path.join(root, "collision.clawedpack");
    await createManualModpack({
      outputPath: modpackPath,
      profileName: "Friend Pack",
      packagePath: differentPackage.packagePath,
      manifest: differentPackage.manifest
    });

    const inspected = await modpackService.inspectModpack({ modpackPath });
    expect(inspected.status).toBe("ok");
    expect(inspected.packages[0].status).toBe("hashMismatch");

    const imported = await modpackService.importModpack({ modpackPath });

    expect(imported.status).toBe("blocked");
    expect(imported.problems[0].code).toBe("LOCAL_PACKAGE_HASH_COLLISION");
  });

  it("updates imported modpack history when missing packages are accepted", async () => {
    const { root, modLibraryService, modpackService } = await makeServices();
    const packagePath = await importFixture(root, modLibraryService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    const manifest = (await modLibraryService.listInstalledModManifests())[0]
      .manifest;
    const modpackPath = path.join(root, "friend.clawedpack");
    await createManualModpack({
      outputPath: modpackPath,
      profileName: "Friend Pack",
      packagePath,
      manifest
    });
    await modLibraryService.uninstallMod({ id: "core", version: "1.0.0" });
    const imported = await modpackService.importModpack({ modpackPath });
    expect(imported.status).toBe("imported");

    await modLibraryService.uninstallMod({ id: "core", version: "1.0.0" });

    const history = await modpackService.listRecentModpacks();
    expect(history.entries[0]).toMatchObject({
      kind: "import",
      packageCount: 1,
      missingPackages: [{ id: "core", version: "1.0.0" }]
    });

    const accepted = await modpackService.acceptMissingModpackReferences();

    expect(accepted).toMatchObject({
      status: "ok",
      entriesUpdated: 1,
      removedPackageCount: 1
    });
    expect(accepted.history.entries[0]).toMatchObject({
      status: "updated",
      packageCount: 0,
      trackedPackages: [],
      missingPackages: []
    });
  });
});
