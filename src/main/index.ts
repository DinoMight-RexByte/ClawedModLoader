import { app, BrowserWindow, Menu, shell } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { CreatorViewportWindowService } from "./services/creatorViewportWindowService";
import {
  registerAppCrashDiagnostics,
  registerWindowCrashDiagnostics,
  startLocalCrashReporter
} from "./services/crashDiagnostics";
import { JsonlLifecycleLogger } from "./services/lifecycleLogger";
import type { WindowsProcessSupervisor } from "./services/processSupervisor";
import { createMainServices } from "./services/serviceRegistry";
import { cleanupAppStorageArtifacts } from "./services/storageCleanupService";
import { getAllowedUserDataOverride } from "./services/storageService";
import type { CreatorViewportWindowEvent } from "../shared/contracts/app";
import { IPC_CHANNELS } from "../shared/contracts/ipc";

const rendererDevServerUrl = process.env.VITE_DEV_SERVER_URL;
const appExitShutdownTimeoutMs = 30_000;
const appExitShutdownPollMs = 250;
const preloadPath = path.join(__dirname, "../preload/index.cjs");

applyUserDataOverride();
const crashDumpsDirectory = startLocalCrashReporter();

function createMainWindow(
  logger: JsonlLifecycleLogger,
  processSupervisor: WindowsProcessSupervisor
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 750,
    minWidth: 960,
    minHeight: 640,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: "Clawed Mod Manager",
    autoHideMenuBar: true,
    backgroundColor: "#111318",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: true
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  denyWindowOpen(window);
  registerWindowCrashDiagnostics(window, logger);
  registerUserCloseShutdown(window, processSupervisor, logger);

  void loadRenderer(window);

  return window;
}

function createCreatorViewportWindowService(
  logger: JsonlLifecycleLogger
): CreatorViewportWindowService {
  return new CreatorViewportWindowService({
    createWindow: () => {
      const window = new BrowserWindow({
        width: 1080,
        height: 780,
        minWidth: 760,
        minHeight: 560,
        resizable: true,
        maximizable: true,
        fullscreenable: true,
        title: "Clawed Model Viewport",
        autoHideMenuBar: true,
        backgroundColor: "#111318",
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: preloadPath,
          sandbox: true
        }
      });
      window.once("ready-to-show", () => {
        window.show();
      });
      denyWindowOpen(window);
      registerWindowCrashDiagnostics(window, logger);
      return {
        close: () => window.close(),
        focus: () => window.focus(),
        isDestroyed: () => window.isDestroyed(),
        load: () => loadRenderer(window, { creatorViewport: "popout" }),
        onClosed: (callback) => {
          window.once("closed", callback);
        }
      };
    },
    emitEvent: (event: CreatorViewportWindowEvent) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.creatorViewportWindowEvent, event);
        }
      });
    }
  });
}

function denyWindowOpen(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

async function loadRenderer(
  window: BrowserWindow,
  query: Record<string, string> = {}
): Promise<void> {
  if (rendererDevServerUrl) {
    const url = new URL(rendererDevServerUrl);
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(path.join(__dirname, "../renderer/index.html"), {
    query
  });
}

function registerUserCloseShutdown(
  window: BrowserWindow,
  processSupervisor: WindowsProcessSupervisor,
  logger: JsonlLifecycleLogger
): void {
  let shutdownStarted = false;
  let shutdownComplete = false;

  window.on("close", (event) => {
    if (shutdownComplete || process.platform === "darwin") {
      return;
    }

    event.preventDefault();
    window.hide();
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    void processSupervisor
      .shutdownAppExitManagedProcess(
        appExitShutdownTimeoutMs,
        appExitShutdownPollMs
      )
      .catch((error) =>
        logger.log({
          category: "processSupervisor",
          action: "app_exit_shutdown_failed",
          result: "failed",
          message: error instanceof Error ? error.message : String(error)
        })
      )
      .finally(() => {
        shutdownComplete = true;
        window.close();
      });
  });
}

function applyUserDataOverride(): void {
  const override = getAllowedUserDataOverride();

  if (!override) {
    return;
  }

  mkdirSync(override, { recursive: true });
  app.setPath("userData", override);
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const services = createMainServices();
  const logger = new JsonlLifecycleLogger(services.storageService);
  registerAppCrashDiagnostics(logger, crashDumpsDirectory);
  await services.storageService.getLayout();
  if ((await services.settingsService.getSettings()).autoUpdatePackagedRuntime) {
    await services.runtimeManager.ensureBundledUe4ssRuntime();
  }
  await cleanupAppStorageArtifacts(services.storageService, logger);
  const creatorViewportWindowService =
    createCreatorViewportWindowService(logger);
  registerIpcHandlers({ ...services, creatorViewportWindowService });
  createMainWindow(logger, services.processSupervisor as WindowsProcessSupervisor);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(
        logger,
        services.processSupervisor as WindowsProcessSupervisor
      );
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
