import {
  CLAWED_STEAM_APP_ID,
  type GameDiscovery,
  type LaunchCommandKind,
  type LaunchCommandRequest,
  type LaunchCommandResult,
  type LaunchMode,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  DeploymentServiceContract,
  GameLocatorContract,
  LaunchServiceContract
} from "../../shared/contracts/services";
import type { LifecycleLogger } from "./lifecycleLogger";
import type { ProcessPlatform } from "./processPlatform";
import type { WindowsProcessSupervisor } from "./processSupervisor";

export interface LaunchServiceOptions {
  launchDetectTimeoutMs?: number;
  gracefulShutdownTimeoutMs?: number;
  forceShutdownTimeoutMs?: number;
  pollIntervalMs?: number;
}

const forceCloseWarning =
  "Clawed isn't responding. Forcing it closed may interrupt a save operation.";

export class SteamLaunchService implements LaunchServiceContract {
  private operationInFlight = false;
  private currentLaunchMode: LaunchMode = "VANILLA";
  private lastCommand: LaunchCommandResult | null = null;
  private readonly launchDetectTimeoutMs: number;
  private readonly gracefulShutdownTimeoutMs: number;
  private readonly forceShutdownTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly gameLocator: GameLocatorContract,
    private readonly processSupervisor: WindowsProcessSupervisor,
    private readonly platform: ProcessPlatform,
    private readonly logger: LifecycleLogger,
    options?: LaunchServiceOptions,
    private readonly deploymentService?: DeploymentServiceContract
  ) {
    this.launchDetectTimeoutMs = options?.launchDetectTimeoutMs ?? 5_000;
    this.gracefulShutdownTimeoutMs =
      options?.gracefulShutdownTimeoutMs ?? 15_000;
    this.forceShutdownTimeoutMs = options?.forceShutdownTimeoutMs ?? 5_000;
    this.pollIntervalMs = options?.pollIntervalMs ?? 250;
  }

  getStatus(): ServiceStatus {
    return {
      id: "launchService",
      label: "Launch Service",
      status: "ready",
      detail: "Launches Clawed through Steam and coordinates safe restart."
    };
  }

  getCurrentLaunchMode(): LaunchMode {
    return this.currentLaunchMode;
  }

  getLastCommand(): LaunchCommandResult | null {
    return this.lastCommand;
  }

  async runLaunchCommand(
    request: LaunchCommandRequest
  ): Promise<LaunchCommandResult> {
    if (this.operationInFlight) {
      return this.remember({
        kind: request.kind,
        launchMode: this.currentLaunchMode,
        lifecycleState: this.processSupervisor.snapshot().lifecycleState,
        status: "blocked",
        title: "Another game action is already running",
        message: "Wait for the current launch or restart operation to finish.",
        occurredAt: new Date().toISOString()
      });
    }

    this.operationInFlight = true;
    try {
      const result =
        request.kind === "launchModded"
          ? await this.launch("MODDED", request.kind)
          : request.kind === "launchVanilla"
            ? await this.launch("VANILLA", request.kind)
            : await this.restart(request.forceCloseConfirmed === true);

      return this.remember(result);
    } finally {
      this.operationInFlight = false;
    }
  }

  private async launch(
    launchMode: LaunchMode,
    kind: LaunchCommandKind
  ): Promise<LaunchCommandResult> {
    const discovery = await this.gameLocator.rescan();
    const blocked = this.blockIfNotReady(discovery, kind, launchMode);
    if (blocked) {
      return blocked;
    }
    const gameExecutable = discovery.gameExecutable;
    if (!gameExecutable) {
      return this.blockIfNotReady(discovery, kind, launchMode) as LaunchCommandResult;
    }

    this.currentLaunchMode = launchMode;
    const existingProcess = await this.processSupervisor.findGameProcess(
      gameExecutable
    );

    if (existingProcess) {
      await this.processSupervisor.getSnapshot(discovery.gameExecutable);
      return {
        kind,
        launchMode,
        lifecycleState: "RUNNING",
        status: "blocked",
        title: "Clawed is already running",
        message: "CMM will not start a duplicate game process.",
        occurredAt: new Date().toISOString()
      };
    }

    const deployment = await this.prepareDeployment(discovery, launchMode);
    if (deployment) {
      return {
        kind,
        launchMode,
        lifecycleState: this.processSupervisor.snapshot().lifecycleState,
        status: "blocked",
        title:
          launchMode === "MODDED"
            ? "Modded deployment is not ready"
            : "Vanilla state is not ready",
        message:
          deployment.problems[0]?.message ??
          "CMM could not prepare the requested launch state.",
        nextStep: deployment.problems[0]?.technicalDetail,
        occurredAt: new Date().toISOString()
      };
    }

    this.processSupervisor.markStarting();
    await this.logger.log({
      category: "launchService",
      action: "steam_launch_requested",
      result: "requested",
      discoveryStatus: discovery.discoveryStatus,
      launchMode,
      lifecycleState: "STARTING"
    });

    await this.platform.launchSteamApp(CLAWED_STEAM_APP_ID);
    const detectedProcess = await this.processSupervisor.waitForRunning(
      gameExecutable,
      this.launchDetectTimeoutMs,
      this.pollIntervalMs
    );

    if (detectedProcess) {
      return {
        kind,
        launchMode,
        lifecycleState: "RUNNING",
        status: "completed",
        title: "Clawed is running",
        message: `Launched ${launchMode.toLowerCase()} through Steam.`,
        occurredAt: new Date().toISOString()
      };
    }

    return {
      kind,
      launchMode,
      lifecycleState: "STARTING",
      status: "accepted",
      title: "Launch requested through Steam",
      message:
        "Steam accepted the launch request, but CMM has not detected the game process yet.",
      nextStep: "If Clawed does not open, check Steam and Diagnostics.",
      occurredAt: new Date().toISOString()
    };
  }

  private async restart(
    forceCloseConfirmed: boolean
  ): Promise<LaunchCommandResult> {
    const discovery = await this.gameLocator.rescan();
    const blocked = this.blockIfNotReady(
      discovery,
      "restartGame",
      this.currentLaunchMode
    );
    if (blocked) {
      return blocked;
    }
    const gameExecutable = discovery.gameExecutable;
    if (!gameExecutable) {
      return this.blockIfNotReady(
        discovery,
        "restartGame",
        this.currentLaunchMode
      ) as LaunchCommandResult;
    }

    const processInfo = await this.processSupervisor.findGameProcess(
      gameExecutable
    );

    if (!processInfo) {
      this.processSupervisor.markStopped();
      return this.launch(this.currentLaunchMode, "restartGame");
    }

    if (!forceCloseConfirmed) {
      await this.processSupervisor.requestGracefulShutdown(processInfo.processId);
      const exited = await this.processSupervisor.waitForExit(
        processInfo.processId,
        this.gracefulShutdownTimeoutMs,
        this.pollIntervalMs
      );

      if (exited) {
        return this.launch(this.currentLaunchMode, "restartGame");
      }

      return {
        kind: "restartGame",
        launchMode: this.currentLaunchMode,
        lifecycleState: "RUNNING",
        status: "needsConfirmation",
        title: "Clawed did not close",
        message: forceCloseWarning,
        nextStep: "Cancel or explicitly choose Force Close & Restart.",
        requiresForceCloseConfirmation: true,
        occurredAt: new Date().toISOString()
      };
    }

    await this.processSupervisor.forceTerminate(processInfo.processId);
    const exited = await this.processSupervisor.waitForExit(
      processInfo.processId,
      this.forceShutdownTimeoutMs,
      this.pollIntervalMs
    );

    if (!exited) {
      return {
        kind: "restartGame",
        launchMode: this.currentLaunchMode,
        lifecycleState: "RUNNING",
        status: "blocked",
        title: "Clawed is still running",
        message:
          "CMM requested force close, but the game process is still present.",
        nextStep: "Close Clawed manually before trying again.",
        occurredAt: new Date().toISOString()
      };
    }

    return this.launch(this.currentLaunchMode, "restartGame");
  }

  private blockIfNotReady(
    discovery: GameDiscovery,
    kind: LaunchCommandKind,
    launchMode: LaunchMode
  ): LaunchCommandResult | null {
    if (discovery.discoveryStatus === "READY" && discovery.gameExecutable) {
      return null;
    }

    return {
      kind,
      launchMode,
      lifecycleState: this.processSupervisor.snapshot().lifecycleState,
      status: "blocked",
      title: "Clawed is not ready to launch",
      message: `Discovery status is ${discovery.discoveryStatus}.`,
      nextStep: "Open Settings, rescan, or choose the Clawed installation folder.",
      occurredAt: new Date().toISOString()
    };
  }

  private async prepareDeployment(
    discovery: GameDiscovery,
    launchMode: LaunchMode
  ): Promise<Awaited<
    ReturnType<DeploymentServiceContract["prepareModdedDeployment"]>
  > | null> {
    if (!this.deploymentService) {
      return null;
    }

    const result =
      launchMode === "MODDED"
        ? await this.deploymentService.prepareModdedDeployment(discovery)
        : await this.deploymentService.prepareVanillaDeployment(discovery);

    return result.status === "ok" ? null : result;
  }

  private remember(result: LaunchCommandResult): LaunchCommandResult {
    this.lastCommand = result;
    return result;
  }
}
