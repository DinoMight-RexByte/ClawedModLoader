import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GameDiscovery } from "../../src/shared/contracts/app";
import type {
  DeploymentServiceContract,
  GameLocatorContract,
  StorageServiceContract
} from "../../src/shared/contracts/services";
import { LocalUnrealMappingsService } from "../../src/main/services/unrealMappingsService";
import type { LifecycleLogger } from "../../src/main/services/lifecycleLogger";
import type { ProcessPlatform } from "../../src/main/services/processPlatform";
import type { WindowsProcessSupervisor } from "../../src/main/services/processSupervisor";

describe("LocalUnrealMappingsService", () => {
  let tempRoot: string | null = null;

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("normalizes UE4SS generated usmap filenames to Mappings.usmap", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-usmap-"));
    const binaryDirectory = path.join(tempRoot, "Clawed", "Binaries", "Win64");
    const ue4ssDirectory = path.join(binaryDirectory, "ue4ss");
    await mkdir(ue4ssDirectory, { recursive: true });
    const generatedPath = path.join(
      ue4ssDirectory,
      "Clawed-5.5.4-40574608+++UE5+Release-5.5-1c1a1497.usmap"
    );
    await writeFile(generatedPath, "generated mappings");

    const discovery: GameDiscovery = {
      appId: "3394840",
      steamPath: null,
      steamLibrary: null,
      steamLibraries: [],
      appManifestPath: null,
      gameInstallPath: tempRoot,
      gameExecutable: path.join(binaryDirectory, "Clawed-Win64-Shipping.exe"),
      source: "manual",
      manualOverride: tempRoot,
      diagnosticErrors: [],
      discoveredAt: new Date().toISOString(),
      discoveryStatus: "READY"
    };

    const service = new LocalUnrealMappingsService(
      fakeStorageService(),
      fakeGameLocator(discovery),
      fakeDeploymentService(),
      fakeProcessSupervisor(),
      fakePlatform(),
      fakeLogger()
    );

    const result = await service.generateMappings();
    const stablePath = path.join(binaryDirectory, "Mappings.usmap");

    expect(result.status).toBe("ready");
    expect(result.mappingsPath).toBe(stablePath);
    await expect(readFile(stablePath, "utf8")).resolves.toBe(
      "generated mappings"
    );
  });
});

function fakeStorageService(): StorageServiceContract {
  return {
    async getLayout() {
      throw new Error("storage layout should not be used");
    }
  };
}

function fakeGameLocator(discovery: GameDiscovery): GameLocatorContract {
  return {
    getStatus: () => ({
      id: "gameLocator",
      label: "Game Locator",
      status: "ready",
      detail: "ready"
    }),
    discover: async () => discovery,
    rescan: async () => discovery,
    getExecutablePath: async () => discovery.gameExecutable
  };
}

function fakeDeploymentService(): DeploymentServiceContract {
  return {
    getStatus: () => ({
      id: "deploymentService",
      label: "Deployment Service",
      status: "ready",
      detail: "ready"
    }),
    getSnapshot: async () => {
      throw new Error("deployment snapshot should not be used");
    },
    prepareModdedDeployment: async () => {
      throw new Error("modded deployment should not be used");
    },
    prepareRuntimeValidationDeployment: async () => {
      throw new Error("runtime validation deployment should not be used");
    },
    prepareUnrealMappingsDumpDeployment: async () => {
      throw new Error("mappings deployment should not be used");
    },
    prepareVanillaDeployment: async () => {
      throw new Error("vanilla deployment should not be used");
    }
  };
}

function fakeProcessSupervisor(): WindowsProcessSupervisor {
  return {
    findGameProcess: async () => null
  } as unknown as WindowsProcessSupervisor;
}

function fakePlatform(): ProcessPlatform {
  return {
    listProcesses: async () => [],
    launchSteamApp: async () => {},
    findProcessByExecutable: async () => null,
    requestGracefulClose: async () => true,
    isProcessRunning: async () => false,
    forceTerminate: async () => false
  };
}

function fakeLogger(): LifecycleLogger {
  return {
    log: async () => {}
  } as unknown as LifecycleLogger;
}
