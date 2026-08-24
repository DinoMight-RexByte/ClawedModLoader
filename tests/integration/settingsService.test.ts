import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { JsonSettingsService } from "../../src/main/services/settingsService";
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

describe("settings service", () => {
  it("defaults packaged runtime auto updates on for legacy settings", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-settings-"));
    await mkdir(tempRoot, { recursive: true });
    await writeFile(
      path.join(tempRoot, "settings.json"),
      `${JSON.stringify({ manualGameDirectory: "C:\\Games\\Clawed" })}\n`
    );

    const settings = await new JsonSettingsService(
      new FakeStorageService(createStorageLayout(tempRoot))
    ).getSettings();

    expect(settings).toEqual({
      manualGameDirectory: "C:\\Games\\Clawed",
      autoUpdatePackagedRuntime: true,
      autoValidatePackagedRuntime: false
    });
  });

  it("persists packaged runtime auto update preference", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-settings-"));
    const service = new JsonSettingsService(
      new FakeStorageService(createStorageLayout(tempRoot))
    );

    const settings = await service.setAutoUpdatePackagedRuntime(false);
    const raw = JSON.parse(
      await readFile(path.join(tempRoot, "settings.json"), "utf8")
    );

    expect(settings.autoUpdatePackagedRuntime).toBe(false);
    expect(raw.autoUpdatePackagedRuntime).toBe(false);
  });

  it("persists packaged runtime auto validation preference", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-settings-"));
    const service = new JsonSettingsService(
      new FakeStorageService(createStorageLayout(tempRoot))
    );

    const settings = await service.setAutoValidatePackagedRuntime(false);
    const raw = JSON.parse(
      await readFile(path.join(tempRoot, "settings.json"), "utf8")
    );

    expect(settings.autoValidatePackagedRuntime).toBe(false);
    expect(raw.autoValidatePackagedRuntime).toBe(false);
  });
});
