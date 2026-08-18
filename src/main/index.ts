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
import { createMainServices } from "./services/serviceRegistry";
import { getAllowedUserDataOverride } from "./services/storageService";

const rendererDevServerUrl = process.env.VITE_DEV_SERVER_URL;

applyUserDataOverride();
const crashDumpsDirectory = startLocalCrashReporter();

function createMainWindow(logger: JsonlLifecycleLogger): BrowserWindow {
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

  if (rendererDevServerUrl) {
    void window.loadURL(rendererDevServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  return window;
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
  registerIpcHandlers(services);
  createMainWindow(logger);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(logger);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
