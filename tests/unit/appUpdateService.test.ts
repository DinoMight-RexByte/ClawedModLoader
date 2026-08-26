import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from "electron-updater";

import {
  ElectronAppUpdateService,
  type AppUpdateProvider
} from "../../src/main/services/appUpdateService";
import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  fullChangelog = true;
  checks = 0;
  installArgs: [boolean | undefined, boolean | undefined] | null = null;

  async checkForUpdates(): Promise<null> {
    this.checks += 1;
    this.emit("checking-for-update");
    return null;
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installArgs = [isSilent, isForceRunAfter];
  }

  emitAvailable(info: UpdateInfo): void {
    this.emit("update-available", info);
  }

  emitUnavailable(info: UpdateInfo): void {
    this.emit("update-not-available", info);
  }

  emitProgress(info: ProgressInfo): void {
    this.emit("download-progress", info);
  }

  emitDownloaded(event: UpdateDownloadedEvent): void {
    this.emit("update-downloaded", event);
  }

  emitFailure(error: Error): void {
    this.emit("error", error);
  }
}

describe("ElectronAppUpdateService", () => {
  it("reports app updates as unsupported outside packaged builds", async () => {
    const updater = new FakeUpdater();
    const service = createService(updater, false);

    expect(service.getSnapshot()).toMatchObject({
      status: "unsupported",
      currentVersion: "0.1.0"
    });
    expect(await service.checkForUpdates()).toMatchObject({
      status: "unsupported"
    });
    expect(updater.checks).toBe(0);
  });

  it("tracks update availability, progress, download, and install", async () => {
    const updater = new FakeUpdater();
    const service = createService(updater, true);
    const states: string[] = [];
    service.onSnapshot((snapshot) => states.push(snapshot.status));

    await service.checkForUpdates();
    updater.emitAvailable(updateInfo("0.2.0"));
    updater.emitProgress({
      percent: 50,
      delta: 5,
      transferred: 5,
      total: 10,
      bytesPerSecond: 100
    });
    updater.emitDownloaded({
      ...updateInfo("0.2.0"),
      downloadedFile: "C:\\CMM\\Update.exe"
    });
    service.installDownloadedUpdate();

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.checks).toBe(1);
    expect(service.getSnapshot()).toMatchObject({
      status: "downloaded",
      availableVersion: "0.2.0",
      progress: null
    });
    expect(updater.installArgs).toEqual([false, true]);
    expect(states).toContain("checking");
    expect(states).toContain("available");
    expect(states).toContain("downloading");
    expect(states).toContain("downloaded");
  });

  it("records update errors as safe snapshots", async () => {
    const updater = new FakeUpdater();
    const service = createService(updater, true);

    updater.emitFailure(new Error("network unavailable"));

    expect(service.getSnapshot()).toMatchObject({
      status: "error",
      errorMessage: "network unavailable"
    });
  });
});

function createService(
  updater: FakeUpdater,
  isPackaged: boolean
): ElectronAppUpdateService {
  return new ElectronAppUpdateService({
    updater: updater as unknown as AppUpdateProvider,
    isPackaged,
    currentVersion: "0.1.0",
    logger: new NullLifecycleLogger()
  });
}

function updateInfo(version: string): UpdateInfo {
  return {
    version,
    files: [
      {
        url: `Clawed-Mod-Manager-${version}-win-x64.exe`,
        sha512: "sha512"
      }
    ],
    path: `Clawed-Mod-Manager-${version}-win-x64.exe`,
    sha512: "sha512",
    releaseName: version,
    releaseDate: new Date().toISOString()
  };
}
