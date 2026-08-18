import type {
  GameProcessSnapshot,
  LifecycleState,
  ServiceStatus
} from "../../shared/contracts/app";
import type { ProcessSupervisorContract } from "../../shared/contracts/services";
import type { LifecycleLogger } from "./lifecycleLogger";
import type { GameProcessInfo, ProcessPlatform } from "./processPlatform";

export interface ProcessSupervisorOptions {
  delay?: (milliseconds: number) => Promise<void>;
}

export class WindowsProcessSupervisor implements ProcessSupervisorContract {
  private lifecycleState: LifecycleState = "STOPPED";
  private trackedProcessId: number | null = null;
  private trackedProcessName: string | null = null;
  private startedAt: string | null = null;
  private readonly delay: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly platform: ProcessPlatform,
    private readonly logger: LifecycleLogger,
    options?: ProcessSupervisorOptions
  ) {
    this.delay =
      options?.delay ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
  }

  getStatus(): ServiceStatus {
    return {
      id: "processSupervisor",
      label: "Process Supervisor",
      status: "ready",
      detail: "Tracks the actual Clawed process by discovered executable."
    };
  }

  async getSnapshot(gameExecutable: string | null): Promise<GameProcessSnapshot> {
    const processInfo = gameExecutable
      ? await this.findGameProcess(gameExecutable)
      : null;

    if (processInfo) {
      this.trackProcess(processInfo);
      this.lifecycleState = "RUNNING";
    } else if (this.lifecycleState !== "STARTING") {
      this.clearTrackedProcess("STOPPED");
    }

    return this.snapshot();
  }

  async isGameRunning(): Promise<boolean> {
    return this.lifecycleState === "RUNNING";
  }

  markStarting(): void {
    this.lifecycleState = "STARTING";
  }

  markStopping(): void {
    this.lifecycleState = "STOPPING";
  }

  markStopped(): void {
    this.clearTrackedProcess("STOPPED");
  }

  async findGameProcess(
    gameExecutable: string
  ): Promise<GameProcessInfo | null> {
    return this.platform.findProcessByExecutable(gameExecutable);
  }

  async waitForRunning(
    gameExecutable: string,
    timeoutMs: number,
    intervalMs: number
  ): Promise<GameProcessInfo | null> {
    const attempts = this.getAttemptCount(timeoutMs, intervalMs);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const processInfo = await this.findGameProcess(gameExecutable);
      if (processInfo) {
        this.trackProcess(processInfo);
        this.lifecycleState = "RUNNING";
        await this.logger.log({
          category: "processSupervisor",
          action: "process_detected",
          result: "ok",
          lifecycleState: this.lifecycleState,
          processId: processInfo.processId
        });
        return processInfo;
      }

      if (attempt < attempts - 1) {
        await this.delay(intervalMs);
      }
    }

    return null;
  }

  async requestGracefulShutdown(processId: number): Promise<boolean> {
    this.markStopping();
    const requested = await this.platform.requestGracefulClose(processId);
    await this.logger.log({
      category: "processSupervisor",
      action: "graceful_close_requested",
      result: requested ? "requested" : "blocked",
      lifecycleState: this.lifecycleState,
      processId
    });
    return requested;
  }

  async waitForExit(
    processId: number,
    timeoutMs: number,
    intervalMs: number
  ): Promise<boolean> {
    const attempts = this.getAttemptCount(timeoutMs, intervalMs);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const isStillRunning = await this.platform.isProcessRunning(processId);

      if (!isStillRunning) {
        this.clearTrackedProcess("STOPPED");
        await this.logger.log({
          category: "processSupervisor",
          action: "process_exited",
          result: "ok",
          lifecycleState: this.lifecycleState,
          processId
        });
        return true;
      }

      if (attempt < attempts - 1) {
        await this.delay(intervalMs);
      }
    }

    this.lifecycleState = "RUNNING";
    await this.logger.log({
      category: "processSupervisor",
      action: "process_exit_timeout",
      result: "blocked",
      lifecycleState: this.lifecycleState,
      processId
    });
    return false;
  }

  async forceTerminate(processId: number): Promise<boolean> {
    this.markStopping();
    const terminated = await this.platform.forceTerminate(processId);
    await this.logger.log({
      category: "processSupervisor",
      action: "force_terminate_requested",
      result: terminated ? "requested" : "failed",
      lifecycleState: this.lifecycleState,
      processId
    });
    return terminated;
  }

  snapshot(): GameProcessSnapshot {
    return {
      lifecycleState: this.lifecycleState,
      processId: this.trackedProcessId,
      processName: this.trackedProcessName,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString()
    };
  }

  private getAttemptCount(timeoutMs: number, intervalMs: number): number {
    if (intervalMs <= 0) {
      return Math.max(1, timeoutMs);
    }

    return Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1);
  }

  private trackProcess(processInfo: GameProcessInfo): void {
    this.trackedProcessId = processInfo.processId;
    this.trackedProcessName = processInfo.name;
    this.startedAt ??= new Date().toISOString();
  }

  private clearTrackedProcess(nextState: LifecycleState): void {
    this.lifecycleState = nextState;
    this.trackedProcessId = null;
    this.trackedProcessName = null;
    this.startedAt = null;
  }
}
