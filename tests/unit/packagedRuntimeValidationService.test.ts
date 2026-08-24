import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  classifyPackagedRuntimeValidationFailure,
  PackagedRuntimeValidationService
} from "../../src/main/services/packagedRuntimeValidationService";
import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import { WindowsProcessSupervisor } from "../../src/main/services/processSupervisor";
import { packagedRuntimeValidationMarkers } from "../../src/main/services/runtimeValidationProbe";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import type { GameProcessInfo, ProcessPlatform } from "../../src/main/services/processPlatform";
import type {
  AppStorageLayout,
  GameDiscovery
} from "../../src/shared/contracts/app";
import type {
  DeploymentServiceContract,
  RuntimeManagerContract,
  StorageServiceContract
} from "../../src/shared/contracts/services";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

class FakeProcessPlatform implements ProcessPlatform {
  launchRequests = 0;
  gracefulCloseRequests = 0;
  private running = false;

  async listProcesses(): Promise<GameProcessInfo[]> {
    return this.running ? [gameProcess()] : [];
  }

  async findProcessByExecutable(): Promise<GameProcessInfo | null> {
    return this.running ? gameProcess() : null;
  }

  async isProcessRunning(): Promise<boolean> {
    return this.running;
  }

  async requestGracefulClose(): Promise<boolean> {
    this.gracefulCloseRequests += 1;
    this.running = false;
    return true;
  }

  async forceTerminate(): Promise<boolean> {
    this.running = false;
    return true;
  }

  async launchSteamApp(): Promise<void> {
    this.launchRequests += 1;
    this.running = true;
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("packaged runtime validation service", () => {
  it("classifies UE4SS pattern-scan timeout as incompatible evidence", () => {
    const result = classifyPackagedRuntimeValidationFailure({
      logText: [
        "[2026-08-22 20:02:43] UE4SS - v3.0.1 Beta #0 - Git SHA #d935b5b",
        "[2026-08-22 20:02:43] [PS] Found EngineVersion: 5.5",
        "[2026-08-22 20:02:43] [PS] Failed to find GUObjectArray: expected at least one value",
        "[2026-08-22 20:02:43] [PS] Failed to find FText::FText(FString&&): expected at least one value",
        "[2026-08-22 20:03:14] Fatal Error: PS scan timed out"
      ].join("\n"),
      errorMessage:
        "Timed out waiting for packaged runtime validation markers in C:\\Game\\UE4SS.log.",
      logPath: "C:\\Game\\UE4SS.log",
      evidencePath: "C:\\CMM\\logs\\runtime-validation\\2026-08-22T20-02-39-123Z",
      markers: packagedRuntimeValidationMarkers()
    });

    expect(result.recordAsIncompatible).toBe(true);
    expect(result.code).toBe("UE4SS_BUNDLED_RUNTIME_PATTERN_SCAN_FAILED");
    expect(result.details).toContain("GUObjectArray");
    expect(result.details).toContain("FText::FText(FString&&)");
    expect(result.details).toContain("Evidence: C:\\CMM\\logs\\runtime-validation\\2026-08-22T20-02-39-123Z");
  });

  it("keeps generic marker timeouts unrecorded as runtime incompatibility", () => {
    const result = classifyPackagedRuntimeValidationFailure({
      logText: [
        "[2026-08-22 20:02:43] UE4SS - v3.0.1 Beta #0",
        "[2026-08-22 20:02:43] Starting mods (from mods.txt load order)..."
      ].join("\n"),
      errorMessage:
        "Timed out waiting for packaged runtime validation markers in C:\\Game\\UE4SS.log.",
      logPath: "C:\\Game\\UE4SS.log",
      evidencePath: "C:\\CMM\\logs\\runtime-validation\\run",
      markers: packagedRuntimeValidationMarkers()
    });

    expect(result.recordAsIncompatible).toBe(false);
    expect(result.code).toBe("UE4SS_BUNDLED_RUNTIME_MARKER_TIMEOUT");
    expect(result.details).toContain("Evidence: C:\\CMM\\logs\\runtime-validation\\run");
  });

  it("cancels active validation without recording compatibility evidence", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-runtime-cancel-"));
    const discovery = liveDiscovery(tempRoot);
    const platform = new FakeProcessPlatform();
    const processSupervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    let vanillaRestores = 0;
    let records = 0;
    let serviceRef: PackagedRuntimeValidationService | null = null;
    let cancelRequested = false;
    const service = new PackagedRuntimeValidationService(
      new FakeStorageService(createStorageLayout(tempRoot)),
      {
        getStatus: () => ({
          id: "deploymentService",
          label: "Deployment Service",
          status: "ready",
          detail: "fake"
        }),
        getSnapshot: async () => {
          throw new Error("not used");
        },
        prepareModdedDeployment: async () => {
          throw new Error("not used");
        },
        prepareRuntimeValidationDeployment: async () => ({
          status: "ok",
          state: "runtimeUnvalidated",
          manifest: validationManifest(discovery),
          problems: []
        }),
        prepareUnrealMappingsDumpDeployment: async () => {
          throw new Error("not used");
        },
        prepareVanillaDeployment: async () => {
          vanillaRestores += 1;
          return {
            status: "ok",
            state: "vanillaReady",
            manifest: null,
            problems: []
          };
        }
      } as unknown as DeploymentServiceContract,
      {
        getStatus: () => ({
          id: "runtimeManager",
          label: "Runtime Manager",
          status: "ready",
          detail: "fake"
        }),
        getRuntimeSnapshot: async () => {
          throw new Error("not used");
        },
        ensureBundledUe4ssRuntime: async () => null,
        installBundledUe4ssRuntime: async () => {
          throw new Error("not used");
        },
        importUe4ssRuntime: async () => {
          throw new Error("not used");
        },
        recordUe4ssRuntimeValidation: async () => {
          throw new Error("not used");
        },
        recordBundledUe4ssRuntimeValidation: async () => {
          records += 1;
          throw new Error("cancelled validation should not record evidence");
        }
      } as unknown as RuntimeManagerContract,
      processSupervisor,
      platform,
      new NullLifecycleLogger(),
      {
        markerTimeoutMs: 50,
        closeTimeoutMs: 5,
        launchDetectTimeoutMs: 5,
        pollIntervalMs: 0,
        delay: async () => {
          if (!cancelRequested) {
            cancelRequested = true;
            await serviceRef?.cancel();
          }
        }
      }
    );
    serviceRef = service;

    const result = await service.validate(discovery);
    const cancellationEvidence = await readFile(
      path.join(
        result.evidencePath!,
        "runtime-validation-cancelled.json"
      ),
      "utf8"
    );

    expect(result.status).toBe("cancelled");
    expect(result.problems[0].code).toBe("RUNTIME_VALIDATION_CANCELLED");
    expect(platform.launchRequests).toBe(1);
    expect(platform.gracefulCloseRequests).toBe(1);
    expect(vanillaRestores).toBe(1);
    expect(records).toBe(0);
    expect(cancellationEvidence).toContain("RUNTIME_VALIDATION_CANCELLED");
  });

  it("reports cancel as blocked when validation is not running", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-runtime-cancel-"));
    const platform = new FakeProcessPlatform();
    const service = new PackagedRuntimeValidationService(
      new FakeStorageService(createStorageLayout(tempRoot)),
      {} as DeploymentServiceContract,
      {} as RuntimeManagerContract,
      new WindowsProcessSupervisor(platform, new NullLifecycleLogger(), {
        delay: async () => undefined
      }),
      platform,
      new NullLifecycleLogger()
    );

    const result = await service.cancel();

    expect(result.status).toBe("blocked");
    expect(result.problems[0].code).toBe("RUNTIME_VALIDATION_NOT_RUNNING");
  });
});

function gameProcess(): GameProcessInfo {
  return {
    processId: 42,
    name: "Clawed-Win64-Shipping.exe",
    executablePath: "C:\\Clawed\\Clawed-Win64-Shipping.exe",
    commandLine: null
  };
}

function liveDiscovery(root: string): GameDiscovery {
  const gameInstallPath = path.join(root, "Clawed");
  return {
    appId: "3394840",
    steamPath: path.join(root, "Steam"),
    steamLibrary: root,
    steamLibraries: [{ path: root, appManifestPath: null }],
    appManifestPath: null,
    gameInstallPath,
    gameExecutable: path.join(gameInstallPath, "Clawed-Win64-Shipping.exe"),
    discoveryStatus: "READY",
    source: "manual",
    manualOverride: gameInstallPath,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}

function validationManifest(discovery: GameDiscovery) {
  return {
    schemaVersion: 1,
    transactionId: "runtime-validation-test",
    profileId: "cmm-runtime-validation",
    profileName: "Runtime Validation",
    createdAt: new Date().toISOString(),
    gameInstallPath: discovery.gameInstallPath!,
    gameExecutable: discovery.gameExecutable!,
    gameFingerprint: {
      status: "UNKNOWN_BUILD",
      generatedAt: new Date().toISOString(),
      gameInstallPath: discovery.gameInstallPath,
      executablePath: discovery.gameExecutable,
      executableSha256: "a".repeat(64),
      steamBuildId: "24782175",
      appManifestPath: null,
      appManifestSha256: null,
      contentFiles: [],
      fingerprintSha256: "b".repeat(64),
      releaseValidation: "UNVALIDATED",
      problems: []
    },
    runtimeConfiguration: {
      type: "ue4ss",
      releaseValidation: "UNVALIDATED",
      runtimeTargetRelativePath: "",
      runtimeModsRelativePath: "Mods",
      logicalOrder: ["CMMPackagedRuntimeValidation"]
    },
    sourcePackages: [],
    filesCreated: [],
    filesModified: [],
    backups: [],
    directoriesCreated: [],
    runtimeGeneratedFiles: [],
    lastVerifiedState: "applied"
  };
}
