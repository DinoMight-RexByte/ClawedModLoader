import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalAvailableModService } from "../../src/main/services/availableModService";
import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import type { AppStorageLayout } from "../../src/shared/contracts/app";
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

async function makeService(): Promise<{
  releaseDir: string;
  prototypeDir: string;
  service: LocalAvailableModService;
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-available-mods-"));
  const packageService = new ClawedModPackageService();
  const modLibraryService = new LocalModLibraryService(
    new FakeStorageService(createStorageLayout(path.join(tempRoot, "storage"))),
    packageService
  );
  const releaseDir = path.join(tempRoot, "official-launch-mods");
  const prototypeDir = path.join(tempRoot, "prototype-mods");
  await mkdir(releaseDir, { recursive: true });
  await mkdir(prototypeDir, { recursive: true });

  return {
    releaseDir,
    prototypeDir,
    service: new LocalAvailableModService(packageService, modLibraryService, [
      {
        category: "release",
        title: "Official Release Mods",
        directory: releaseDir
      },
      {
        category: "prototype",
        title: "Prototype Mods",
        directory: prototypeDir
      }
    ])
  };
}

describe("available mod service", () => {
  it("lists bundled release and prototype packages with install scope", async () => {
    const { releaseDir, prototypeDir, service } = await makeService();
    await createClawedModFixture(
      path.join(releaseDir, "ModsActiveTitleLogo.clawedmod"),
      {
        manifest: {
          id: "ModsActiveTitleLogo",
          name: "Mods Active Title Logo",
          version: "20260826T120000",
          author: "CMM Test",
          description: "Shows a title-screen marker when mods are active.",
          loader: "pak",
          packageIdentity: {
            schemaVersion: 1,
            id: "cmm:generated:ModsActiveTitleLogo",
            source: "cmmGenerated"
          }
        }
      }
    );
    await createClawedModFixture(
      path.join(prototypeDir, "CoopCapacity8.clawedmod"),
      {
        manifest: {
          id: "CoopCapacity8",
          name: "Co-op Capacity 8",
          version: "20260826T120000",
          author: "CMM Test",
          description: "Raises the host-side co-op session capacity.",
          loader: "ue4ss",
          packageIdentity: {
            schemaVersion: 1,
            id: "cmm:generated:CoopCapacity8",
            source: "cmmGenerated"
          }
        }
      }
    );

    const catalog = await service.listAvailableMods();
    const releaseMod = catalog.groups
      .find((group) => group.category === "release")
      ?.mods.find((mod) => mod.id === "ModsActiveTitleLogo");
    const prototypeMod = catalog.groups
      .find((group) => group.category === "prototype")
      ?.mods.find((mod) => mod.id === "CoopCapacity8");

    expect(catalog.totals).toMatchObject({
      available: 2,
      release: 1,
      prototype: 1,
      installed: 0
    });
    expect(releaseMod).toMatchObject({
      description: "Shows a title-screen marker when mods are active.",
      installScope: "everyone",
      installState: "notInstalled"
    });
    expect(prototypeMod).toMatchObject({
      description: "Raises the host-side co-op session capacity.",
      installScope: "hostOnly",
      installState: "notInstalled"
    });

    const installResult = await service.installAvailableMod({
      key: releaseMod?.key ?? ""
    });
    const refreshedReleaseMod = installResult.catalog.groups
      .find((group) => group.category === "release")
      ?.mods.find((mod) => mod.id === "ModsActiveTitleLogo");

    expect(installResult.result.status).toBe("installed");
    expect(refreshedReleaseMod?.installState).toBe("installed");
    expect(installResult.catalog.totals.installed).toBe(1);
  });

  it("returns a failed import result for a missing catalog key", async () => {
    const { service } = await makeService();

    const result = await service.installAvailableMod({
      key: "release:missing.clawedmod"
    });

    expect(result.result.status).toBe("failed");
    expect(result.result.problems[0]?.code).toBe("AVAILABLE_MOD_NOT_FOUND");
  });
});
