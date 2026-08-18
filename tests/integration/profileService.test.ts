import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
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
  ClawedModManifestV1
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
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-profiles-"));
  const storageService = new FakeStorageService(createStorageLayout(tempRoot));
  const modLibraryService = new LocalModLibraryService(
    storageService,
    new ClawedModPackageService()
  );
  const profileService = new LocalProfileService(
    storageService,
    modLibraryService
  );

  return {
    root: tempRoot,
    modLibraryService,
    profileService,
    loadOrderService: new LocalLoadOrderService(profileService)
  };
}

async function importFixture(
  root: string,
  service: LocalModLibraryService,
  overrides: Partial<ClawedModManifestV1>
): Promise<void> {
  const fixture = await createClawedModFixture(
    path.join(root, "fixtures", `${overrides.id}.clawedmod`),
    { manifest: overrides }
  );
  const result = await service.importModPackage({
    packagePath: fixture.packagePath
  });
  expect(result.status).toBe("installed");
}

describe("local profile service", () => {
  it("creates the default profile automatically", async () => {
    const { profileService } = await makeServices();

    const snapshot = await profileService.listProfiles();

    expect(snapshot.profiles).toHaveLength(1);
    expect(snapshot.profiles[0]).toMatchObject({
      id: "default",
      name: "Default",
      isActive: true
    });
    await expect(profileService.getActiveProfileName()).resolves.toBe("Default");
  });

  it("creates, renames, switches, duplicates, and protects the final profile", async () => {
    const { profileService } = await makeServices();

    const created = await profileService.createProfile({ name: "Raid Night" });
    const createdProfileId = created.activeProfile.id;
    expect(created.activeProfile.name).toBe("Raid Night");

    const renamed = await profileService.renameProfile({
      id: createdProfileId,
      name: "Co-op Night"
    });
    expect(renamed.activeProfile.name).toBe("Co-op Night");

    const switched = await profileService.switchProfile({ id: "default" });
    expect(switched.activeProfile.id).toBe("default");

    const duplicated = await profileService.duplicateProfile({
      id: createdProfileId,
      name: "Co-op Copy"
    });
    expect(duplicated.activeProfile.name).toBe("Co-op Copy");
    expect((await profileService.listProfiles()).profiles).toHaveLength(3);

    await profileService.deleteProfile({ id: createdProfileId });
    await profileService.deleteProfile({ id: duplicated.activeProfile.id });
    const blocked = await profileService.deleteProfile({ id: "default" });

    expect(blocked.status).toBe("blocked");
    expect(blocked.problems[0].code).toBe("FINAL_PROFILE_DELETE_BLOCKED");
  });

  it("stores enabled state and load order per profile without changing the library", async () => {
    const { root, modLibraryService, profileService } = await makeServices();
    await importFixture(root, modLibraryService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    await importFixture(root, modLibraryService, {
      id: "character",
      name: "Character",
      version: "1.0.0"
    });

    await profileService.setModEnabled({
      id: "core",
      version: "1.0.0",
      enabled: true
    });
    await profileService.setModEnabled({
      id: "character",
      version: "1.0.0",
      enabled: true
    });
    await profileService.moveModInActiveOrder({
      modId: "character",
      direction: "top"
    });
    const defaultOrder =
      (await profileService.getLoadOrderSnapshot()).validation.orderedModIds;

    const secondProfile = await profileService.createProfile({
      name: "Vanilla-ish"
    });
    expect((await profileService.countEnabledMods())).toBe(0);
    expect((await modLibraryService.listInstalledMods()).totals.installed).toBe(
      2
    );

    await profileService.switchProfile({ id: "default" });
    expect((await profileService.countEnabledMods())).toBe(2);
    expect(defaultOrder).toEqual(["character", "core"]);
    expect(secondProfile.activeProfile.name).toBe("Vanilla-ish");
  });

  it("persists profiles across service instances", async () => {
    const { root, modLibraryService, profileService } = await makeServices();
    await importFixture(root, modLibraryService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    await profileService.setModEnabled({
      id: "core",
      version: "1.0.0",
      enabled: true
    });

    const storageService = new FakeStorageService(createStorageLayout(root));
    const nextLibrary = new LocalModLibraryService(
      storageService,
      new ClawedModPackageService()
    );
    const nextProfileService = new LocalProfileService(
      storageService,
      nextLibrary
    );

    expect((await nextProfileService.countEnabledMods())).toBe(1);
    expect(
      (await nextProfileService.getLoadOrderSnapshot()).validation.orderedModIds
    ).toEqual(["core"]);
  });

  it("ignores abandoned temporary profile writes when the store is intact", async () => {
    const { root, profileService } = await makeServices();
    await profileService.createProfile({ name: "Stable" });
    const storePath = path.join(root, "profiles", "profiles.json");
    const expectedStore = await readFile(storePath, "utf8");

    await writeFile(
      path.join(root, "profiles", ".profiles.json.abandoned.tmp"),
      "{ invalid"
    );

    const storageService = new FakeStorageService(createStorageLayout(root));
    const nextProfileService = new LocalProfileService(
      storageService,
      new LocalModLibraryService(storageService, new ClawedModPackageService())
    );

    expect((await nextProfileService.listProfiles()).profiles).toHaveLength(2);
    await expect(readFile(storePath, "utf8")).resolves.toBe(expectedStore);
  });

  it("validates active load order through the load-order service", async () => {
    const { root, modLibraryService, profileService, loadOrderService } =
      await makeServices();
    await importFixture(root, modLibraryService, {
      id: "child",
      name: "Child",
      version: "1.0.0",
      dependencies: [{ id: "core" }]
    });
    await profileService.setModEnabled({
      id: "child",
      version: "1.0.0",
      enabled: true
    });

    const validation = await loadOrderService.validateActiveOrder();

    expect(validation.validity).toBe("invalid");
    expect(validation.problems[0]).toMatchObject({
      code: "MISSING_DEPENDENCY",
      severity: "ERROR"
    });
  });

  it("reports and accepts missing profile mods after library removal", async () => {
    const { root, modLibraryService, profileService } = await makeServices();
    await importFixture(root, modLibraryService, {
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    await importFixture(root, modLibraryService, {
      id: "character",
      name: "Character",
      version: "1.0.0"
    });
    await profileService.setModEnabled({
      id: "core",
      version: "1.0.0",
      enabled: true
    });
    await profileService.setModEnabled({
      id: "character",
      version: "1.0.0",
      enabled: true
    });
    await profileService.moveModInActiveOrder({
      modId: "character",
      direction: "top"
    });
    await modLibraryService.uninstallMod({
      id: "character",
      version: "1.0.0"
    });

    const missing = await profileService.getMissingModReferences();

    expect(missing.totalMissing).toBe(1);
    expect(missing.profiles[0]).toMatchObject({
      profileName: "Default",
      missingMods: [{ id: "character", version: "1.0.0", enabled: true }]
    });

    const accepted = await profileService.acceptMissingModReferences();
    const profile = await profileService.getActiveProfile();

    expect(accepted).toMatchObject({
      status: "ok",
      profilesUpdated: 1,
      removedModCount: 1
    });
    expect(Object.keys(profile.selectedMods)).toEqual(["core"]);
    expect(profile.orderedModIds).toEqual(["core"]);
    expect((await profileService.getMissingModReferences()).totalMissing).toBe(0);
  });
});
