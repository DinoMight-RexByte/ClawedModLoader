import { describe, expect, it } from "vitest";

import type {
  AppSettings,
  DeploymentOperationResult,
  DeploymentSnapshot,
  GameDiscovery,
  ModProblem
} from "../../src/shared/contracts/app";
import type {
  DeploymentServiceContract,
  GameLocatorContract,
  SettingsServiceContract
} from "../../src/shared/contracts/services";
import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import { SteamLaunchService } from "../../src/main/services/launchService";
import type {
  PackagedRuntimeValidationResult,
  PackagedRuntimeValidationService
} from "../../src/main/services/packagedRuntimeValidationService";
import type {
  GameProcessInfo,
  ProcessPlatform
} from "../../src/main/services/processPlatform";
import { WindowsProcessSupervisor } from "../../src/main/services/processSupervisor";

const executablePath = "D:\\SteamLibrary\\steamapps\\common\\Clawed\\Game\\Binaries\\Win64\\Release-Win64-Shipping.exe";

function readyDiscovery(): GameDiscovery {
  return {
    appId: "3394840",
    steamPath: "C:\\Program Files (x86)\\Steam",
    steamLibrary: "D:\\SteamLibrary",
    steamLibraries: [
      {
        path: "D:\\SteamLibrary",
        appManifestPath: "D:\\SteamLibrary\\steamapps\\appmanifest_3394840.acf"
      }
    ],
    appManifestPath: "D:\\SteamLibrary\\steamapps\\appmanifest_3394840.acf",
    gameInstallPath: "D:\\SteamLibrary\\steamapps\\common\\Clawed",
    gameExecutable: executablePath,
    discoveryStatus: "READY",
    source: "steam",
    manualOverride: null,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}

class FakeGameLocator implements GameLocatorContract {
  constructor(private readonly discovery: GameDiscovery) {}

  getStatus() {
    return {
      id: "gameLocator",
      label: "Game Locator",
      status: "ready" as const,
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

class FakeProcessPlatform implements ProcessPlatform {
  launchRequests = 0;
  gracefulRequests = 0;
  forceRequests = 0;
  nextProcessId = 101;
  listProcessCalls = 0;
  findProcessCalls = 0;
  runningChecks = 0;

  constructor(public processes: GameProcessInfo[]) {}

  async listProcesses(): Promise<GameProcessInfo[]> {
    this.listProcessCalls += 1;
    return this.processes;
  }

  async findProcessByExecutable(): Promise<GameProcessInfo | null> {
    this.findProcessCalls += 1;
    return this.processes[0] ?? null;
  }

  async isProcessRunning(processId: number): Promise<boolean> {
    this.runningChecks += 1;
    return this.processes.some(
      (processInfo) => processInfo.processId === processId
    );
  }

  async requestGracefulClose(): Promise<boolean> {
    this.gracefulRequests += 1;
    return true;
  }

  async forceTerminate(processId: number): Promise<boolean> {
    this.forceRequests += 1;
    this.processes = this.processes.filter(
      (processInfo) => processInfo.processId !== processId
    );
    return true;
  }

  async launchSteamApp(): Promise<void> {
    this.launchRequests += 1;
    this.processes = [
      {
        processId: this.nextProcessId,
        name: "Release-Win64-Shipping.exe",
        executablePath,
        commandLine: `"${executablePath}"`
      }
    ];
  }
}

class FakeDeploymentService implements DeploymentServiceContract {
  moddedCalls = 0;
  vanillaCalls = 0;

  constructor(
    private readonly moddedResult: DeploymentOperationResult = okDeployment(
      "runtimeUnvalidated"
    ),
    private readonly vanillaResult: DeploymentOperationResult = okDeployment(
      "vanillaReady"
    )
  ) {}

  getStatus() {
    return {
      id: "deploymentService",
      label: "Deployment Service",
      status: "ready" as const,
      detail: "fake"
    };
  }

  async getSnapshot(): Promise<DeploymentSnapshot> {
    return {
      state: "deploymentRequired",
      activeManifest: null,
      runtime: { ue4ss: null, status: "missing", problems: [] },
      problems: []
    };
  }

  async prepareModdedDeployment(): Promise<DeploymentOperationResult> {
    this.moddedCalls += 1;
    return this.moddedResult;
  }

  async prepareRuntimeValidationDeployment(): Promise<DeploymentOperationResult> {
    return okDeployment("runtimeUnvalidated");
  }

  async prepareUnrealMappingsDumpDeployment(): Promise<DeploymentOperationResult> {
    return okDeployment("runtimeUnvalidated");
  }

  async prepareVanillaDeployment(): Promise<DeploymentOperationResult> {
    this.vanillaCalls += 1;
    return this.vanillaResult;
  }
}

class FakeSettingsService implements SettingsServiceContract {
  constructor(
    private settings: AppSettings = {
      manualGameDirectory: null,
      autoUpdatePackagedRuntime: true,
      autoValidatePackagedRuntime: false
    }
  ) {}

  async getSettings(): Promise<AppSettings> {
    return this.settings;
  }

  async setManualGameDirectory(
    gameDirectory: string | null
  ): Promise<AppSettings> {
    this.settings = { ...this.settings, manualGameDirectory: gameDirectory };
    return this.settings;
  }

  async setAutoUpdatePackagedRuntime(
    enabled: boolean
  ): Promise<AppSettings> {
    this.settings = { ...this.settings, autoUpdatePackagedRuntime: enabled };
    return this.settings;
  }

  async setAutoValidatePackagedRuntime(
    enabled: boolean
  ): Promise<AppSettings> {
    this.settings = { ...this.settings, autoValidatePackagedRuntime: enabled };
    return this.settings;
  }
}

class FakePackagedRuntimeValidationService {
  calls = 0;

  constructor(private readonly result: PackagedRuntimeValidationResult) {}

  async validate(): Promise<PackagedRuntimeValidationResult> {
    this.calls += 1;
    return this.result;
  }
}

function gameProcess(processId = 42): GameProcessInfo {
  return {
    processId,
    name: "Release-Win64-Shipping.exe",
    executablePath,
    commandLine: `"${executablePath}"`
  };
}

function okDeployment(
  state: DeploymentOperationResult["state"],
  problems: ModProblem[] = []
): DeploymentOperationResult {
  return {
    status: "ok",
    state,
    manifest: null,
    problems
  };
}

function packagedRuntimeBuildProblem(): ModProblem {
  return {
    severity: "warning",
    code: "UE4SS_BUNDLED_RUNTIME_BUILD_UNVALIDATED",
    message: "The packaged runtime has not been validated for this build."
  };
}

function packagedRuntimeValidationError(): ModProblem {
  return {
    severity: "error",
    code: "UE4SS_BUNDLED_RUNTIME_INCOMPATIBLE",
    message: "The packaged runtime did not pass validation for this build."
  };
}

function blockedDeployment(): DeploymentOperationResult {
  return {
    status: "blocked",
    state: "deploymentError",
    manifest: null,
    problems: [
      {
        severity: "error",
        code: "DEPLOYMENT_BLOCKED",
        message: "Deployment was blocked for this test."
      }
    ]
  };
}

describe("launch service", () => {
  it("launches stopped game through Steam", async () => {
    const platform = new FakeProcessPlatform([]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      { launchDetectTimeoutMs: 2, pollIntervalMs: 0 }
    );

    const result = await service.runLaunchCommand({ kind: "launchVanilla" });

    expect(result.status).toBe("completed");
    expect(result.launchMode).toBe("VANILLA");
    expect(platform.launchRequests).toBe(1);
    expect(platform.findProcessCalls).toBeGreaterThan(0);
    expect(platform.listProcessCalls).toBe(0);
  });

  it("prepares modded deployment before launching through Steam", async () => {
    const platform = new FakeProcessPlatform([]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const deploymentService = new FakeDeploymentService();
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      { launchDetectTimeoutMs: 2, pollIntervalMs: 0 },
      deploymentService
    );

    const result = await service.runLaunchCommand({ kind: "launchModded" });

    expect(result.status).toBe("completed");
    expect(result.launchMode).toBe("MODDED");
    expect(deploymentService.moddedCalls).toBe(1);
    expect(deploymentService.vanillaCalls).toBe(0);
    expect(platform.launchRequests).toBe(1);
    expect(platform.listProcessCalls).toBe(0);
  });

  it("launches with an unvalidated packaged runtime without prompting", async () => {
    const platform = new FakeProcessPlatform([]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const deploymentService = new FakeDeploymentService(
      okDeployment("runtimeUnvalidated", [packagedRuntimeBuildProblem()])
    );
    const validationService = new FakePackagedRuntimeValidationService({
      status: "validated",
      evidencePath: "C:\\CMM\\logs\\runtime-validation\\run",
      recording: null,
      problems: []
    });
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      { launchDetectTimeoutMs: 2, pollIntervalMs: 0 },
      deploymentService,
      new FakeSettingsService(),
      validationService as unknown as PackagedRuntimeValidationService
    );

    const result = await service.runLaunchCommand({ kind: "launchModded" });

    expect(result.status).toBe("completed");
    expect(deploymentService.moddedCalls).toBe(1);
    expect(validationService.calls).toBe(0);
    expect(platform.launchRequests).toBe(1);
  });

  it("does not auto-validate a successful unvalidated packaged deployment", async () => {
    const platform = new FakeProcessPlatform([]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const deploymentService = new FakeDeploymentService(
      okDeployment("runtimeUnvalidated", [packagedRuntimeBuildProblem()])
    );
    const validationService = new FakePackagedRuntimeValidationService({
      status: "validated",
      evidencePath: "C:\\CMM\\logs\\runtime-validation\\run",
      recording: null,
      problems: []
    });
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      { launchDetectTimeoutMs: 2, pollIntervalMs: 0 },
      deploymentService,
      new FakeSettingsService({
        manualGameDirectory: null,
        autoUpdatePackagedRuntime: true,
        autoValidatePackagedRuntime: true
      }),
      validationService as unknown as PackagedRuntimeValidationService
    );

    const result = await service.runLaunchCommand({ kind: "launchModded" });

    expect(result.status).toBe("completed");
    expect(deploymentService.moddedCalls).toBe(1);
    expect(validationService.calls).toBe(0);
    expect(platform.launchRequests).toBe(1);
  });

  it("remembers automatic packaged runtime validation from an error action", async () => {
    const platform = new FakeProcessPlatform([]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const deploymentService = new FakeDeploymentService(
      {
        status: "blocked",
        state: "runtimeIncompatible",
        manifest: null,
        problems: [packagedRuntimeValidationError()]
      }
    );
    const validationService = new FakePackagedRuntimeValidationService({
      status: "validated",
      evidencePath: "C:\\CMM\\logs\\runtime-validation\\run",
      recording: null,
      problems: []
    });
    const settingsService = new FakeSettingsService();
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      { launchDetectTimeoutMs: 2, pollIntervalMs: 0 },
      deploymentService,
      settingsService,
      validationService as unknown as PackagedRuntimeValidationService
    );

    const result = await service.runLaunchCommand({
      kind: "launchModded",
      runtimeValidationConfirmed: true,
      alwaysValidateRuntime: true
    });

    expect(result.status).toBe("blocked");
    expect((await settingsService.getSettings()).autoValidatePackagedRuntime).toBe(
      true
    );
  });

  it("surfaces validation flow access on packaged runtime validation errors", async () => {
    const platform = new FakeProcessPlatform([]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const deploymentService = new FakeDeploymentService({
      status: "blocked",
      state: "runtimeIncompatible",
      manifest: null,
      problems: [packagedRuntimeValidationError()]
    });
    const validationService = new FakePackagedRuntimeValidationService({
      status: "validated",
      evidencePath: "C:\\CMM\\logs\\runtime-validation\\run",
      recording: null,
      problems: []
    });
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      { launchDetectTimeoutMs: 2, pollIntervalMs: 0 },
      deploymentService,
      new FakeSettingsService(),
      validationService as unknown as PackagedRuntimeValidationService
    );

    const result = await service.runLaunchCommand({ kind: "launchModded" });

    expect(result.status).toBe("blocked");
    expect(result.canOpenRuntimeValidationFlow).toBe(true);
    expect(validationService.calls).toBe(0);
    expect(platform.launchRequests).toBe(0);
  });

  it("runs validation from a packaged runtime validation error action", async () => {
    const platform = new FakeProcessPlatform([]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const deploymentService = new FakeDeploymentService({
      status: "blocked",
      state: "runtimeIncompatible",
      manifest: null,
      problems: [packagedRuntimeValidationError()]
    });
    const validationService = new FakePackagedRuntimeValidationService({
      status: "validated",
      evidencePath: "C:\\CMM\\logs\\runtime-validation\\run",
      recording: null,
      problems: []
    });
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      { launchDetectTimeoutMs: 2, pollIntervalMs: 0 },
      deploymentService,
      new FakeSettingsService(),
      validationService as unknown as PackagedRuntimeValidationService
    );

    const result = await service.runLaunchCommand({
      kind: "launchModded",
      runtimeValidationConfirmed: true
    });

    expect(result.status).toBe("blocked");
    expect(result.canOpenRuntimeValidationFlow).toBe(true);
    expect(deploymentService.moddedCalls).toBe(2);
    expect(validationService.calls).toBe(1);
    expect(platform.launchRequests).toBe(0);
  });

  it("blocks vanilla launch when vanilla restoration is not safe", async () => {
    const platform = new FakeProcessPlatform([]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const deploymentService = new FakeDeploymentService(
      okDeployment("runtimeUnvalidated"),
      blockedDeployment()
    );
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      { launchDetectTimeoutMs: 2, pollIntervalMs: 0 },
      deploymentService
    );

    const result = await service.runLaunchCommand({ kind: "launchVanilla" });

    expect(result.status).toBe("blocked");
    expect(deploymentService.vanillaCalls).toBe(1);
    expect(platform.launchRequests).toBe(0);
  });

  it("requires explicit confirmation before force-close restart", async () => {
    const platform = new FakeProcessPlatform([gameProcess()]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );
    const service = new SteamLaunchService(
      new FakeGameLocator(readyDiscovery()),
      supervisor,
      platform,
      new NullLifecycleLogger(),
      {
        gracefulShutdownTimeoutMs: 2,
        forceShutdownTimeoutMs: 2,
        launchDetectTimeoutMs: 2,
        pollIntervalMs: 0
      }
    );

    const firstResult = await service.runLaunchCommand({ kind: "restartGame" });

    expect(firstResult.status).toBe("needsConfirmation");
    expect(firstResult.requiresForceCloseConfirmation).toBe(true);
    expect(platform.forceRequests).toBe(0);
    expect(platform.launchRequests).toBe(0);

    const secondResult = await service.runLaunchCommand({
      kind: "restartGame",
      forceCloseConfirmed: true
    });

    expect(secondResult.status).toBe("completed");
    expect(platform.forceRequests).toBe(1);
    expect(platform.launchRequests).toBe(1);
  });
});
