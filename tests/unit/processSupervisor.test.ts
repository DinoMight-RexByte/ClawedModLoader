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
