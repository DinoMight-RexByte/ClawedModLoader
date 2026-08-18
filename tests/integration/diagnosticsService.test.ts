import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClawedGameAdapter } from "../../src/main/adapters/clawed/clawedGameAdapter";
import { UE4SSDeploymentAdapter } from "../../src/main/adapters/ue4ss/ue4ssDeploymentAdapter";
import { LocalAssetRegistryService } from "../../src/main/services/assetRegistryService";
import { LocalBackupService } from "../../src/main/services/backupService";
import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalDeploymentService } from "../../src/main/services/deploymentService";
import { LocalDiagnosticsService } from "../../src/main/services/diagnosticsService";
import { LocalExternalModImportService } from "../../src/main/services/externalModImportService";
import { JsonlLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import type { MainServiceDependencies } from "../../src/main/services/serviceRegistry";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import {
  LocalLoadOrderService,
  LocalProfileService
} from "../../src/main/services/profileService";
import { LocalRuntimeManager } from "../../src/main/services/runtimeManager";
import { JsonSettingsService } from "../../src/main/services/settingsService";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import {
  CLAWED_STEAM_APP_ID,
  type AppStorageLayout,
  type GameDiscovery,
  type GameProcessSnapshot,
  type LaunchCommandRequest,
  type LaunchCommandResult,
  type LaunchMode,
  type ServiceStatus
} from "../../src/shared/contracts/app";
import type {
  GameLocatorContract,
  LaunchServiceContract,
  ProcessSupervisorContract,
  StorageServiceContract
} from "../../src/shared/contracts/services";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

class FakeGameLocator implements GameLocatorContract {
  constructor(private readonly discovery: GameDiscovery) {}

  getStatus(): ServiceStatus {
    return {
      id: "gameLocator",
      label: "Game Locator",
      status: "ready",
      detail: "fake"
    };
  }

  async discover(): Promise<GameDiscovery> {
    return this.discovery;
  }

  async rescan(): Promise<GameDiscovery> {
    return this.discovery;
  }

  async getExecutablePath(): Promise<string | null> {
    return this.discovery.gameExecutable;
  }
}

class FakeProcessSupervisor implements ProcessSupervisorContract {
  getStatus(): ServiceStatus {
    return {
      id: "processSupervisor",
      label: "Process Supervisor",
      status: "ready",
      detail: "fake"
    };
  }

  async getSnapshot(): Promise<GameProcessSnapshot> {
    return {
      lifecycleState: "STOPPED",
      processId: null,
      processName: null,
      startedAt: null,
      updatedAt: new Date().toISOString()
    };
  }

  async isGameRunning(): Promise<boolean> {
    return false;
  }
}

class FakeLaunchService implements LaunchServiceContract {
  getStatus(): ServiceStatus {
    return {
      id: "launchService",
      label: "Launch Service",
      status: "ready",
      detail: "fake"
    };
  }

  getCurrentLaunchMode(): LaunchMode {
    return "VANILLA";
  }

  getLastCommand(): LaunchCommandResult | null {
    return null;
  }

  async runLaunchCommand(
    request: LaunchCommandRequest
  ): Promise<LaunchCommandResult> {
    return {
      kind: request.kind,
      launchMode: "VANILLA",
      lifecycleState: "STOPPED",
      status: "blocked",
      title: "fake",
      message: "fake",
      occurredAt: new Date().toISOString()
    };
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("diagnostics service", () => {
  it("sanitizes personal paths in diagnostic reports", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-diagnostics-"));
    const storageService = new FakeStorageService(createStorageLayout(tempRoot));
    const logger = new JsonlLifecycleLogger(storageService);
    const packageService = new ClawedModPackageService();
    const modLibraryService = new LocalModLibraryService(
      storageService,
      packageService
    );
    const externalImportService = new LocalExternalModImportService(
      storageService,
      packageService,
      modLibraryService
    );
    const profileService = new LocalProfileService(
      storageService,
      modLibraryService
    );
    const loadOrderService = new LocalLoadOrderService(profileService);
    const runtimeManager = new LocalRuntimeManager(storageService, logger);
    const settingsService = new JsonSettingsService(storageService);
    const gameAdapter = new ClawedGameAdapter();
    const deploymentService = new LocalDeploymentService(
      storageService,
      modLibraryService,
      profileService,
      loadOrderService,
      runtimeManager,
      new UE4SSDeploymentAdapter(),
      logger,
      { settingsService },
      gameAdapter
    );
    const backupService = new LocalBackupService(storageService, logger);
    const gameInstallPath = path.join(tempRoot, "fake-game");
    const gameExecutable = path.join(gameInstallPath, "ClawedFake.exe");
    await mkdir(gameInstallPath, { recursive: true });
    await writeFile(gameExecutable, "fake executable");
    await logger.log({
      category: "APP",
      action: "fake_failure",
      result: "failed",
      message: "C:\\Users\\ExampleUser\\Secret\\private.txt"
    });
    const discovery: GameDiscovery = {
      appId: CLAWED_STEAM_APP_ID,
      steamPath: "C:\\Users\\ExampleUser\\Steam",
      steamLibrary: tempRoot,
      steamLibraries: [{ path: tempRoot, appManifestPath: null }],
      appManifestPath: null,
      gameInstallPath,
      gameExecutable,
      discoveryStatus: "READY",
      source: "manual",
      manualOverride: gameInstallPath,
      diagnosticErrors: [],
      discoveredAt: new Date().toISOString()
    };
    const dependencies = {
      gameLocator: new FakeGameLocator(discovery),
      processSupervisor: new FakeProcessSupervisor(),
      launchService: new FakeLaunchService(),
      deploymentService,
      runtimeManager,
      modLibraryService,
      externalImportService,
      assetRegistryService: new LocalAssetRegistryService(
        modLibraryService,
        profileService,
        loadOrderService,
        deploymentService,
        { mapRoot: path.join(tempRoot, "missing-map") }
      ),
      profileService,
      loadOrderService,
      packageService,
      exportImportService: {
        getStatus: () => ({
          id: "exportImportService",
          label: "Export Import Service",
          status: "ready" as const,
          detail: "fake"
        }),
        exportCurrentProfile: async () => {
          throw new Error("not used");
        },
        inspectModpack: async () => {
          throw new Error("not used");
        },
        importModpack: async () => {
          throw new Error("not used");
        },
        compareCurrentProfileToModpack: async () => {
          throw new Error("not used");
        },
        listRecentModpacks: async () => ({ entries: [] }),
        acceptMissingModpackReferences: async () => ({
          status: "ok" as const,
          entriesUpdated: 0,
          removedPackageCount: 0,
          history: { entries: [] },
          problems: []
        })
      },
      backupService
    } satisfies MainServiceDependencies;
    const diagnostics = new LocalDiagnosticsService(
      dependencies,
      storageService,
      [gameAdapter.descriptor],
      gameAdapter,
      logger
    );

    const report = await diagnostics.getDiagnosticReport();

    expect(report.text).not.toContain("ExampleUser");
    expect(report.text).not.toContain(tempRoot);
    expect(report.text).toContain("<CLAWED_EXECUTABLE>");
    expect(report.text).toContain("%USERPROFILE%");

    await mkdir(path.join(tempRoot, "logs", "crash-dumps", "pending"), {
      recursive: true
    });
    await writeFile(
      path.join(tempRoot, "logs", "crash-dumps", "pending", "renderer.dmp"),
      "fake dump"
    );
    await diagnostics.recordRendererError({
      source: "reactErrorBoundary",
      message: "C:\\Users\\ExampleUser\\Secret\\view failed",
      errorName: "Error",
      stack: "Error: C:\\Users\\ExampleUser\\Secret\\renderer.js",
      componentStack: "at ModsPage"
    });

    const latest = await diagnostics.getLatestErrorsReport();
    const summary = await diagnostics.getDiagnosticsSummary();

    expect(latest.text).not.toContain("ExampleUser");
    expect(latest.text).toContain("%USERPROFILE%");
    expect(summary.logs.crashDumpCount).toBe(1);
    expect(summary.logs.crashDumpsDirectory).toBe(
      path.join(tempRoot, "logs", "crash-dumps")
    );
  });
});
