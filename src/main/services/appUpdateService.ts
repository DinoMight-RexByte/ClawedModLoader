import { app } from "electron";
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo
} from "electron-updater";

import {
  AppUpdateSnapshotSchema,
  type AppUpdateSnapshot,
  type ServiceStatus
} from "../../shared/contracts/app";
import type { AppUpdateServiceContract } from "../../shared/contracts/services";
import {
  NullLifecycleLogger,
  type LifecycleLogger
} from "./lifecycleLogger";

export interface AppUpdateProvider {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  allowPrerelease: boolean;
  fullChangelog: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): this;
  on(event: "update-available", listener: (info: UpdateInfo) => void): this;
  on(event: "update-not-available", listener: (info: UpdateInfo) => void): this;
  on(event: "download-progress", listener: (info: ProgressInfo) => void): this;
  on(
    event: "update-downloaded",
    listener: (event: UpdateDownloadedEvent) => void
  ): this;
  on(event: "error", listener: (error: Error, message?: string) => void): this;
}

type SnapshotListener = (snapshot: AppUpdateSnapshot) => void;
type Timer = ReturnType<typeof setTimeout> & { unref?: () => void };

export class ElectronAppUpdateService implements AppUpdateServiceContract {
  private snapshot: AppUpdateSnapshot;
  private readonly listeners = new Set<SnapshotListener>();
  private autoCheckTimeout: Timer | null = null;
  private autoCheckInterval: Timer | null = null;
  private started = false;

  constructor(
    private readonly options: {
      updater?: AppUpdateProvider;
      logger?: LifecycleLogger;
      isPackaged?: boolean;
      currentVersion?: string;
      autoCheckDelayMs?: number;
      autoCheckIntervalMs?: number;
    } = {}
  ) {
    this.snapshot = AppUpdateSnapshotSchema.parse({
      status: this.isPackaged ? "idle" : "unsupported",
      currentVersion: options.currentVersion ?? app.getVersion(),
      availableVersion: null,
      releaseName: null,
      releaseDate: null,
      message: this.isPackaged
        ? "Automatic app updates use GitHub Releases."
        : "Automatic app updates run only in the packaged app.",
      lastCheckedAt: null,
      downloadedAt: null,
      errorMessage: null,
      progress: null
    });

    if (this.isPackaged) {
      this.configureUpdater();
    }
  }

  getStatus(): ServiceStatus {
    return {
      id: "appUpdateService",
      label: "App Update Service",
      status: this.isPackaged ? "ready" : "blocked",
      detail: this.snapshot.message
    };
  }

  getSnapshot(): AppUpdateSnapshot {
    return AppUpdateSnapshotSchema.parse(this.snapshot);
  }

  async checkForUpdates(): Promise<AppUpdateSnapshot> {
    if (!this.isPackaged) {
      return this.getSnapshot();
    }

    if (
      this.snapshot.status === "checking" ||
      this.snapshot.status === "downloading" ||
      this.snapshot.status === "downloaded"
    ) {
      return this.getSnapshot();
    }

    this.setSnapshot({
      status: "checking",
      message: "Checking GitHub Releases for app updates.",
      errorMessage: null,
      lastCheckedAt: new Date().toISOString(),
      progress: null
    });

    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.recordError(error);
    }

    return this.getSnapshot();
  }

  installDownloadedUpdate(): AppUpdateSnapshot {
    if (this.snapshot.status !== "downloaded") {
      return this.setSnapshot({
        message: "No downloaded app update is ready to install.",
        errorMessage: null
      });
    }

    this.log("app_update_install_requested", "requested", {
      version: this.snapshot.availableVersion
    });
    this.updater.quitAndInstall(false, true);
    return this.getSnapshot();
  }

  startAutoChecks(): void {
    if (this.started || !this.isPackaged) {
      return;
    }

    this.started = true;
    this.autoCheckTimeout = setTimeout(() => {
      void this.checkForUpdates();
      this.autoCheckInterval = setInterval(
        () => void this.checkForUpdates(),
        this.options.autoCheckIntervalMs ?? 6 * 60 * 60 * 1000
      ) as Timer;
      this.autoCheckInterval.unref?.();
    }, this.options.autoCheckDelayMs ?? 10_000) as Timer;
    this.autoCheckTimeout.unref?.();
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private get updater(): AppUpdateProvider {
    return this.options.updater ?? autoUpdater;
  }

  private get logger(): LifecycleLogger {
    return this.options.logger ?? new NullLifecycleLogger();
  }

  private get isPackaged(): boolean {
    return this.options.isPackaged ?? app.isPackaged;
  }

  private configureUpdater(): void {
    const updater = this.updater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.fullChangelog = false;

    updater.on("checking-for-update", () => {
      this.setSnapshot({
        status: "checking",
        message: "Checking GitHub Releases for app updates.",
        errorMessage: null,
        lastCheckedAt: new Date().toISOString(),
        progress: null
      });
    });
    updater.on("update-available", (info) => {
      this.setUpdateInfo(info, "available", `Version ${info.version} is available.`);
      this.log("app_update_available", "ok", { version: info.version });
    });
    updater.on("update-not-available", (info) => {
      this.setUpdateInfo(info, "notAvailable", "Clawed Mod Manager is up to date.");
      this.log("app_update_not_available", "ok", { version: info.version });
    });
    updater.on("download-progress", (progress) => {
      this.setSnapshot({
        status: "downloading",
        message: `Downloading version ${
          this.snapshot.availableVersion ?? "update"
        }.`,
        errorMessage: null,
        progress: {
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond
        }
      });
    });
    updater.on("update-downloaded", (event) => {
      this.setUpdateInfo(
        event,
        "downloaded",
        `Version ${event.version} is ready to install.`,
        {
          downloadedAt: new Date().toISOString(),
          progress: null
        }
      );
      this.log("app_update_downloaded", "ok", { version: event.version });
    });
    updater.on("error", (error, message) => {
      this.recordError(message ? new Error(message) : error);
    });
  }

  private setUpdateInfo(
    info: UpdateInfo,
    status: AppUpdateSnapshot["status"],
    message: string,
    extra: Partial<AppUpdateSnapshot> = {}
  ): AppUpdateSnapshot {
    return this.setSnapshot({
      status,
      availableVersion: info.version,
      releaseName: info.releaseName ?? null,
      releaseDate: info.releaseDate ?? null,
      message,
      errorMessage: null,
      ...extra
    });
  }

  private recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.setSnapshot({
      status: "error",
      message: "The app update check failed.",
      errorMessage: message,
      progress: null
    });
    this.log("app_update_failed", "failed", {
      error: message
    });
  }

  private setSnapshot(
    patch: Partial<AppUpdateSnapshot>
  ): AppUpdateSnapshot {
    this.snapshot = AppUpdateSnapshotSchema.parse({
      ...this.snapshot,
      ...patch
    });
    for (const listener of this.listeners) {
      listener(this.getSnapshot());
    }
    return this.getSnapshot();
  }

  private log(
    action: string,
    result: "ok" | "blocked" | "failed" | "requested",
    details: Record<string, string | number | boolean | null>
  ): void {
    void this.logger
      .log({
        category: "APP",
        action,
        result,
        details
      })
      .catch(() => undefined);
  }
}
