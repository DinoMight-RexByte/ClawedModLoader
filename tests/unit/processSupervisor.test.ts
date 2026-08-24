import { describe, expect, it } from "vitest";

import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import type {
  GameProcessInfo,
  ProcessPlatform
} from "../../src/main/services/processPlatform";
import { WindowsProcessSupervisor } from "../../src/main/services/processSupervisor";

class FakeProcessPlatform implements ProcessPlatform {
  launchRequests = 0;
  gracefulRequests = 0;
  forceRequests = 0;
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
  }
}

const executablePath = "D:\\SteamLibrary\\steamapps\\common\\Clawed\\Clawed\\Binaries\\Win64\\AnyName-Win64-Shipping.exe";

function gameProcess(processId = 42): GameProcessInfo {
  return {
    processId,
    name: "AnyName-Win64-Shipping.exe",
    executablePath,
    commandLine: `"${executablePath}"`
  };
}

describe("process supervisor", () => {
  it("tracks actual game process state transitions", async () => {
    const platform = new FakeProcessPlatform([gameProcess()]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );

    expect((await supervisor.getSnapshot(executablePath)).lifecycleState).toBe(
      "RUNNING"
    );

    platform.processes = [];
    expect((await supervisor.getSnapshot(executablePath)).lifecycleState).toBe(
      "STOPPED"
    );
  });

  it("handles graceful shutdown success", async () => {
    const platform = new FakeProcessPlatform([gameProcess()]);
    platform.requestGracefulClose = async () => {
      platform.gracefulRequests += 1;
      platform.processes = [];
      return true;
    };
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );

    await supervisor.getSnapshot(executablePath);
    await supervisor.requestGracefulShutdown(42);

    expect(await supervisor.waitForExit(42, 2, 0)).toBe(true);
    expect(supervisor.snapshot().lifecycleState).toBe("STOPPED");
    expect(platform.gracefulRequests).toBe(1);
    expect(platform.runningChecks).toBe(1);
    expect(platform.listProcessCalls).toBe(0);
  });

  it("does not force close after graceful shutdown timeout", async () => {
    const platform = new FakeProcessPlatform([gameProcess()]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );

    await supervisor.getSnapshot(executablePath);
    await supervisor.requestGracefulShutdown(42);

    expect(await supervisor.waitForExit(42, 2, 0)).toBe(false);
    expect(supervisor.snapshot().lifecycleState).toBe("RUNNING");
    expect(platform.forceRequests).toBe(0);
  });

  it("skips app-exit shutdown for observed processes not launched by CMM", async () => {
    const platform = new FakeProcessPlatform([gameProcess()]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );

    await supervisor.getSnapshot(executablePath);
    const result = await supervisor.shutdownAppExitManagedProcess(2, 0);

    expect(result.status).toBe("skipped");
    expect(platform.gracefulRequests).toBe(0);
    expect(platform.forceRequests).toBe(0);
    expect(platform.processes).toHaveLength(1);
  });

  it("closes app-exit managed processes gracefully when the app closes", async () => {
    const platform = new FakeProcessPlatform([gameProcess()]);
    platform.requestGracefulClose = async () => {
      platform.gracefulRequests += 1;
      platform.processes = [];
      return true;
    };
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      {
        delay: async () =>
          new Promise((resolve) => {
            setTimeout(resolve, 0);
          })
      }
    );

    supervisor.markAppExitManagedLaunch(executablePath);
    await supervisor.waitForRunning(executablePath, 2, 0, {
      appExitManaged: true
    });
    const result = await supervisor.shutdownAppExitManagedProcess(30_000, 250);

    expect(result.status).toBe("closed");
    expect(result.gracefulCloseRequested).toBe(true);
    expect(result.forceTerminateRequested).toBe(false);
    expect(platform.gracefulRequests).toBe(1);
    expect(platform.forceRequests).toBe(0);
    expect(supervisor.snapshot().lifecycleState).toBe("STOPPED");
  });

  it("does not app-exit shutdown a different process after the managed process exits", async () => {
    const platform = new FakeProcessPlatform([gameProcess(42)]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );

    supervisor.markAppExitManagedLaunch(executablePath);
    await supervisor.waitForRunning(executablePath, 2, 0, {
      appExitManaged: true
    });
    platform.processes = [gameProcess(84)];
    const result = await supervisor.shutdownAppExitManagedProcess(2, 0);

    expect(result.status).toBe("skipped");
    expect(platform.gracefulRequests).toBe(0);
    expect(platform.forceRequests).toBe(0);
    expect(platform.processes[0]?.processId).toBe(84);
  });

  it("force terminates app-exit managed processes after the shutdown deadline", async () => {
    const platform = new FakeProcessPlatform([gameProcess()]);
    platform.requestGracefulClose = async () => {
      platform.gracefulRequests += 1;
      return new Promise<boolean>(() => undefined);
    };
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );

    supervisor.markAppExitManagedLaunch(executablePath);
    await supervisor.waitForRunning(executablePath, 2, 0, {
      appExitManaged: true
    });
    const result = await supervisor.shutdownAppExitManagedProcess(2, 0);

    expect(result.status).toBe("terminated");
    expect(result.timedOut).toBe(true);
    expect(result.forceTerminateRequested).toBe(true);
    expect(platform.gracefulRequests).toBe(1);
    expect(platform.forceRequests).toBe(1);
    expect(platform.processes).toHaveLength(0);
  });

  it("supports explicit force termination after confirmation", async () => {
    const platform = new FakeProcessPlatform([gameProcess()]);
    const supervisor = new WindowsProcessSupervisor(
      platform,
      new NullLifecycleLogger(),
      { delay: async () => undefined }
    );

    await supervisor.getSnapshot(executablePath);
    expect(await supervisor.forceTerminate(42)).toBe(true);
    expect(await supervisor.waitForExit(42, 2, 0)).toBe(true);
    expect(platform.forceRequests).toBe(1);
  });
});
