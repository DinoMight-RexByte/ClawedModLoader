import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalRuntimeManager,
  type LocalRuntimeManagerOptions
} from "../../src/main/services/runtimeManager";
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

async function makeRuntimeManager(
  bundledRuntimePath?: string
): Promise<{
  root: string;
  manager: LocalRuntimeManager;
  userDataRoot: string;
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-runtime-"));
  const userDataRoot = path.join(tempRoot, "user-data");
  const storageService = new FakeStorageService(
    createStorageLayout(userDataRoot)
  );
  const manager = new LocalRuntimeManager(storageService, undefined, {
    bundledUe4ssRuntimePath: bundledRuntimePath,
    bundledUe4ssVersion: "ue4ss-test-bundled"
  });

  return { root: tempRoot, manager, userDataRoot };
}

async function makeRuntimeManagerWithBundle(
  options: Partial<LocalRuntimeManagerOptions> = {}
): Promise<{
  root: string;
  manager: LocalRuntimeManager;
  userDataRoot: string;
  bundleRoot: string;
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-runtime-"));
  const bundleRoot = path.join(
    tempRoot,
    "app-resources",
    "runtime",
    "ue4ss",
    "default"
  );
  await createModernRuntimeRoot(bundleRoot);
  const userDataRoot = path.join(tempRoot, "user-data");
  const storageService = new FakeStorageService(
    createStorageLayout(userDataRoot)
  );
  const manager = new LocalRuntimeManager(storageService, undefined, {
    bundledUe4ssRuntimePath: bundleRoot,
    bundledUe4ssVersion: "ue4ss-test-bundled",
    ...options
  });

  return { root: tempRoot, manager, userDataRoot, bundleRoot };
}

async function createModernRuntimeRoot(runtimeRoot: string): Promise<void> {
  await mkdir(path.join(runtimeRoot, "Mods"), { recursive: true });
  await writeFile(path.join(runtimeRoot, "UE4SS.dll"), "fake ue4ss dll");
  await writeFile(path.join(runtimeRoot, "dwmapi.dll"), "fake proxy dll");
  await writeFile(
    path.join(runtimeRoot, "UE4SS-settings.ini"),
    "[UE4SS]\n"
  );
  await writeFile(path.join(runtimeRoot, "Mods", "main.lua"), "return true");
}

async function createLegacyRuntimeZip(outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const zip = new JSZip();
  zip.file("UE4SS/xinput1_3.dll", "fake runtime dll");
  zip.file("UE4SS/UE4SS-settings.ini", "[UE4SS]\n");
  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
  return outputPath;
}

async function createModernRuntimeZip(outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const zip = new JSZip();
  zip.file("UE4SS_v3.0.1/UE4SS.dll", "fake ue4ss dll");
  zip.file("UE4SS_v3.0.1/dwmapi.dll", "fake proxy dll");
  zip.file("UE4SS_v3.0.1/UE4SS-settings.ini", "[UE4SS]\n");
  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
  return outputPath;
}

async function createNestedRuntimeZip(outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const zip = new JSZip();
  zip.file("dwmapi.dll", "fake proxy dll");
  zip.file("ue4ss/UE4SS.dll", "fake nested ue4ss dll");
  zip.file("ue4ss/UE4SS-settings.ini", "[UE4SS]\n");
  zip.file("ue4ss/Mods/mods.txt", "Keybinds : 1\n");
  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
  return outputPath;
}

async function exists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

describe("runtime manager", () => {
  it("installs a packaged UE4SS runtime into userData", async () => {
    const { manager, userDataRoot } = await makeRuntimeManagerWithBundle();

    const result = await manager.installBundledUe4ssRuntime();
    const snapshot = await manager.getRuntimeSnapshot();

    expect(result.status).toBe("imported");
    expect(result.runtime?.source).toBe("bundled");
    expect(result.runtime?.installPath).toContain(
      path.join(userDataRoot, "runtime", "ue4ss")
    );
    expect(result.runtime?.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      readFile(path.join(result.runtime!.installPath, "UE4SS.dll"), "utf8")
    ).resolves.toBe("fake ue4ss dll");
    expect(snapshot.status).toBe("unvalidated");
  });

  it("does not replace a user-selected runtime during startup auto-configuration", async () => {
    const { root, manager } = await makeRuntimeManagerWithBundle();
    const manualZip = await createLegacyRuntimeZip(
      path.join(root, "UE4SS-manual.zip")
    );
    const imported = await manager.importUe4ssRuntime({
      sourcePath: manualZip
    });

    const ensured = await manager.ensureBundledUe4ssRuntime();
    const snapshot = await manager.getRuntimeSnapshot();

    expect(imported.status).toBe("imported");
    expect(ensured?.status).toBe("alreadyInstalled");
    expect(snapshot.ue4ss?.source).toBe("user");
    expect(snapshot.ue4ss?.installPath).toBe(imported.runtime?.installPath);
  });

  it("replaces a stale packaged runtime during startup auto-configuration", async () => {
    const { root, manager, bundleRoot } = await makeRuntimeManagerWithBundle({
      bundledUe4ssVersion: "old-packaged-runtime",
      bundledUe4ssCompatibility: {
        status: "incompatible",
        message: "Old packaged runtime is incompatible."
      }
    });
    const oldInstall = await manager.installBundledUe4ssRuntime();
    const storageService = new FakeStorageService(
      createStorageLayout(path.join(root, "user-data"))
    );
    const upgradedManager = new LocalRuntimeManager(storageService, undefined, {
      bundledUe4ssRuntimePath: bundleRoot,
      bundledUe4ssVersion: "current-packaged-runtime",
      bundledUe4ssCompatibility: {
        status: "validated",
        message: "Current packaged runtime is validated."
      }
    });

    const ensured = await upgradedManager.ensureBundledUe4ssRuntime();
    const snapshot = await upgradedManager.getRuntimeSnapshot();

    expect(oldInstall.runtime?.version).toBe("old-packaged-runtime");
    expect(ensured?.status).toBe("imported");
    expect(ensured?.runtime?.version).toBe("current-packaged-runtime");
    expect(snapshot.status).toBe("configured");
  });

  it("allows an explicit switch from a user-selected runtime to the packaged runtime", async () => {
    const { root, manager } = await makeRuntimeManagerWithBundle();
    const manualZip = await createLegacyRuntimeZip(
      path.join(root, "UE4SS-manual.zip")
    );
    const imported = await manager.importUe4ssRuntime({
      sourcePath: manualZip
    });

    const bundled = await manager.installBundledUe4ssRuntime();
    const snapshot = await manager.getRuntimeSnapshot();

    expect(imported.runtime?.source).toBe("user");
    expect(bundled.status).toBe("imported");
    expect(snapshot.ue4ss?.source).toBe("bundled");
    expect(snapshot.ue4ss?.installPath).not.toBe(imported.runtime?.installPath);
  });

  it("marks a release-failed packaged runtime as incompatible", async () => {
    const { manager } = await makeRuntimeManagerWithBundle({
      bundledUe4ssCompatibility: {
        status: "incompatible",
        message:
          "Packaged UE4SS v3.0.1 fails pattern scanning before Lua mods start."
      }
    });

    const result = await manager.installBundledUe4ssRuntime();
    const snapshot = await manager.getRuntimeSnapshot();

    expect(result.status).toBe("imported");
    expect(result.problems[0]).toMatchObject({
      severity: "error",
      code: "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE"
    });
    expect(snapshot.status).toBe("incompatible");
    expect(snapshot.problems[0].code).toBe(
      "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE"
    );
  });

  it("marks a release-validated packaged runtime as configured", async () => {
    const { manager } = await makeRuntimeManagerWithBundle({
      bundledUe4ssCompatibility: {
        status: "validated",
        message: "Packaged UE4SS loads a minimal Lua mod in Clawed."
      }
    });

    const result = await manager.installBundledUe4ssRuntime();
    const snapshot = await manager.getRuntimeSnapshot();

    expect(result.status).toBe("imported");
    expect(result.runtime?.releaseValidation).toBe("VALIDATED");
    expect(result.problems).toEqual([]);
    expect(snapshot.status).toBe("configured");
  });

  it("marks a packaged runtime unvalidated for a new Steam build", async () => {
    const { manager } = await makeRuntimeManagerWithBundle({
      bundledUe4ssCompatibility: {
        status: "validated",
        message: "Packaged UE4SS loads a minimal Lua mod in Clawed.",
        validatedSteamBuildIds: ["24742251"]
      }
    });

    const result = await manager.installBundledUe4ssRuntime();
    const currentSnapshot = await manager.getRuntimeSnapshot("24742251");
    const newBuildSnapshot = await manager.getRuntimeSnapshot("99999999");

    expect(result.status).toBe("imported");
    expect(currentSnapshot.status).toBe("configured");
    expect(newBuildSnapshot.status).toBe("unvalidated");
    expect(newBuildSnapshot.ue4ss?.releaseValidation).toBe("UNVALIDATED");
    expect(newBuildSnapshot.problems[0].code).toBe(
      "UE4SS_BUNDLED_RUNTIME_BUILD_UNVALIDATED"
    );
  });

  it("reports an unavailable packaged runtime without installing placeholders", async () => {
    const { manager, userDataRoot } = await makeRuntimeManager(
      path.join(os.tmpdir(), "cmm-missing-bundled-runtime")
    );

    const result = await manager.installBundledUe4ssRuntime();
    const snapshot = await manager.getRuntimeSnapshot();

    expect(result.status).toBe("failed");
    expect(result.problems[0].code).toBe("UE4SS_BUNDLED_RUNTIME_UNAVAILABLE");
    expect(snapshot.status).toBe("missing");
    expect(
      await exists(
        path.join(userDataRoot, "runtime", "ue4ss", "ue4ss-test-bundled")
      )
    ).toBe(false);
  });

  it("accepts the modern UE4SS ZIP runtime root layout", async () => {
    const { root, manager } = await makeRuntimeManager();
    const runtimeZip = await createModernRuntimeZip(
      path.join(root, "UE4SS_v3.0.1.zip")
    );

    const result = await manager.importUe4ssRuntime({
      sourcePath: runtimeZip
    });
    const snapshot = await manager.getRuntimeSnapshot();

    expect(result.status).toBe("imported");
    expect(result.runtime?.source).toBe("user");
    expect(snapshot.status).toBe("unvalidated");
    await expect(
      readFile(path.join(result.runtime!.installPath, "dwmapi.dll"), "utf8")
    ).resolves.toBe("fake proxy dll");
  });

  it("accepts the official nested UE4SS ZIP runtime layout", async () => {
    const { root, manager } = await makeRuntimeManager();
    const runtimeZip = await createNestedRuntimeZip(
      path.join(root, "UE4SS_experimental.zip")
    );

    const result = await manager.importUe4ssRuntime({
      sourcePath: runtimeZip
    });
    const snapshot = await manager.getRuntimeSnapshot();

    expect(result.status).toBe("imported");
    expect(snapshot.status).toBe("unvalidated");
    await expect(
      readFile(path.join(result.runtime!.installPath, "dwmapi.dll"), "utf8")
    ).resolves.toBe("fake proxy dll");
    await expect(
      readFile(
        path.join(result.runtime!.installPath, "ue4ss", "UE4SS.dll"),
        "utf8"
      )
    ).resolves.toBe("fake nested ue4ss dll");
  });
});
