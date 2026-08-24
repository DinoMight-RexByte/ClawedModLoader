import { app, BrowserWindow, Menu, shell } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
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

const rendererDevServerUrl = process.env.VITE_DEV_SERVER_URL;
const appExitShutdownTimeoutMs = 30_000;
const appExitShutdownPollMs = 250;

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
      preload: path.join(__dirname, "../preload/index.cjs"),
      sandbox: true
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  registerWindowCrashDiagnostics(window, logger);
  registerUserCloseShutdown(window, processSupervisor, logger);

  if (rendererDevServerUrl) {
    void window.loadURL(rendererDevServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
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
  registerIpcHandlers(services);
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
