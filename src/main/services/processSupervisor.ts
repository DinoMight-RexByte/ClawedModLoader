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

export interface AppExitProcessShutdownResult {
  status: "skipped" | "closed" | "terminated" | "failed";
  processId: number | null;
  gracefulCloseRequested: boolean;
  forceTerminateRequested: boolean;
  timedOut: boolean;
}

interface WaitForRunningOptions {
  appExitManaged?: boolean;
}

export class WindowsProcessSupervisor implements ProcessSupervisorContract {
  private lifecycleState: LifecycleState = "STOPPED";
  private trackedProcessId: number | null = null;
  private trackedProcessName: string | null = null;
  private appExitManagedExecutable: string | null = null;
  private appExitManagedProcessId: number | null = null;
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

  markAppExitManagedLaunch(gameExecutable: string): void {
    this.appExitManagedExecutable = gameExecutable;
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
    intervalMs: number,
    options?: WaitForRunningOptions
  ): Promise<GameProcessInfo | null> {
    const attempts = this.getAttemptCount(timeoutMs, intervalMs);

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const processInfo = await this.findGameProcess(gameExecutable);
      if (processInfo) {
        this.trackProcess(processInfo);
        if (options?.appExitManaged) {
          this.trackAppExitManagedProcess(processInfo, gameExecutable);
        }
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

  async shutdownAppExitManagedProcess(
    timeoutMs = 30_000,
    intervalMs = 250
  ): Promise<AppExitProcessShutdownResult> {
    const processInfo = await this.resolveAppExitManagedProcess();
    if (!processInfo) {
      this.clearAppExitManagedProcess();
      return {
        status: "skipped",
        processId: null,
        gracefulCloseRequested: false,
        forceTerminateRequested: false,
        timedOut: false
      };
    }

    const processId = processInfo.processId;
    const deadline = Date.now() + Math.max(1, timeoutMs);
    this.trackProcess(processInfo);
    this.trackAppExitManagedProcess(
      processInfo,
      this.appExitManagedExecutable ?? processInfo.executablePath ?? ""
    );
    this.markStopping();

    const graceful = await this.requestAppExitGracefulClose(
      processId,
      deadline
    );
    const closed = graceful.timedOut
      ? await this.recordAppExitProcessExited(processId)
      : await this.waitForExitBeforeDeadline(processId, deadline, intervalMs);
    if (closed) {
      this.clearAppExitManagedProcess();
      return {
        status: "closed",
        processId,
        gracefulCloseRequested: graceful.requested,
        forceTerminateRequested: false,
        timedOut: graceful.timedOut
      };
    }

    await this.logger.log({
      category: "processSupervisor",
      action: "app_exit_shutdown_timeout",
      result: "blocked",
      lifecycleState: this.lifecycleState,
      processId
    });

    const forceTerminateRequested = await this.requestAppExitForceTerminate(
      processId
    );
    if (forceTerminateRequested) {
      this.clearTrackedProcess("STOPPED");
      this.clearAppExitManagedProcess();
      return {
        status: "terminated",
        processId,
        gracefulCloseRequested: graceful.requested,
        forceTerminateRequested,
        timedOut: true
      };
    }

    this.lifecycleState = "RUNNING";
    return {
      status: "failed",
      processId,
      gracefulCloseRequested: graceful.requested,
      forceTerminateRequested,
      timedOut: true
    };
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

  private trackAppExitManagedProcess(
    processInfo: GameProcessInfo,
    gameExecutable: string
  ): void {
    this.appExitManagedProcessId = processInfo.processId;
    this.appExitManagedExecutable =
      gameExecutable || processInfo.executablePath || this.appExitManagedExecutable;
  }

  private clearTrackedProcess(nextState: LifecycleState): void {
    if (
      this.trackedProcessId !== null &&
      this.trackedProcessId === this.appExitManagedProcessId
    ) {
      this.clearAppExitManagedProcess();
    }
    this.lifecycleState = nextState;
    this.trackedProcessId = null;
    this.trackedProcessName = null;
    this.startedAt = null;
  }

  private clearAppExitManagedProcess(): void {
    this.appExitManagedExecutable = null;
    this.appExitManagedProcessId = null;
  }

  private async resolveAppExitManagedProcess(): Promise<GameProcessInfo | null> {
    if (this.appExitManagedProcessId !== null) {
      if (this.appExitManagedExecutable) {
        const processInfo = await this.findGameProcess(
          this.appExitManagedExecutable
        );
        if (processInfo?.processId === this.appExitManagedProcessId) {
          return processInfo;
        }
        this.clearAppExitManagedProcess();
        return null;
      }

      if (await this.platform.isProcessRunning(this.appExitManagedProcessId)) {
        return {
          processId: this.appExitManagedProcessId,
          name: this.trackedProcessName ?? "Clawed",
          executablePath: null,
          commandLine: null
        };
      }
      this.clearAppExitManagedProcess();
      return null;
    }

    if (!this.appExitManagedExecutable) {
      return null;
    }

    const processInfo = await this.findGameProcess(this.appExitManagedExecutable);
    if (processInfo) {
      this.trackAppExitManagedProcess(processInfo, this.appExitManagedExecutable);
    }
    return processInfo;
  }

  private async requestAppExitGracefulClose(
    processId: number,
    deadline: number
  ): Promise<{ requested: boolean; timedOut: boolean }> {
    const timeoutMs = Math.max(1, deadline - Date.now());
    const request = this.platform.requestGracefulClose(processId, {
      timeoutMs
    });
    const result = await Promise.race([
      request
        .then((requested) => ({ requested, timedOut: false }))
        .catch(() => ({ requested: false, timedOut: false })),
      this.delay(timeoutMs).then(() => ({
        requested: false,
        timedOut: true
      }))
    ]);

    await this.logger.log({
      category: "processSupervisor",
      action: "app_exit_graceful_close_requested",
      result: result.requested ? "requested" : "blocked",
      lifecycleState: this.lifecycleState,
      processId
    });

    return result;
  }

  private async waitForExitBeforeDeadline(
    processId: number,
    deadline: number,
    intervalMs: number
  ): Promise<boolean> {
    while (Date.now() <= deadline) {
      if (await this.recordAppExitProcessExited(processId)) {
        return true;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return false;
      }
      await this.delay(Math.min(Math.max(1, intervalMs), remainingMs));
    }

    return false;
  }

  private async recordAppExitProcessExited(
    processId: number
  ): Promise<boolean> {
    if (await this.platform.isProcessRunning(processId)) {
      return false;
    }

    this.clearTrackedProcess("STOPPED");
    await this.logger.log({
      category: "processSupervisor",
      action: "app_exit_process_exited",
      result: "ok",
      lifecycleState: this.lifecycleState,
      processId
    });
    return true;
  }

  private async requestAppExitForceTerminate(
    processId: number
  ): Promise<boolean> {
    const terminated = await this.platform.forceTerminate(processId).catch(
      () => false
    );
    await this.logger.log({
      category: "processSupervisor",
      action: "app_exit_force_terminate_requested",
      result: terminated ? "requested" : "failed",
      lifecycleState: this.lifecycleState,
      processId
    });
    return terminated;
  }
}
