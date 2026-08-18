import { app, BrowserWindow, crashReporter, type WebContents } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  writeLifecycleLogEventSync,
  type LifecycleLogger
} from "./lifecycleLogger";

const cleanExitReasons = new Set(["clean-exit"]);

export function startLocalCrashReporter(): string {
  const logDirectory = path.join(app.getPath("userData"), "logs");
  const crashDumpsDirectory = path.join(logDirectory, "crash-dumps");
  mkdirSync(crashDumpsDirectory, { recursive: true });
  app.setPath("crashDumps", crashDumpsDirectory);
  crashReporter.start({
    productName: "Clawed Mod Manager",
    uploadToServer: false,
    compress: false,
    globalExtra: {
      cmmCrashUpload: "disabled"
    }
  });
  crashReporter.setUploadToServer(false);
  return crashDumpsDirectory;
}

export function registerAppCrashDiagnostics(
  logger: LifecycleLogger,
  crashDumpsDirectory: string
): void {
  const logDirectory = path.dirname(crashDumpsDirectory);

  void logger.log({
    category: "APP",
    action: "crash_reporter_started",
    result: "ok",
    message: "Local crash dumps are enabled. Uploads are disabled.",
    details: {
      uploadToServer: false,
      crashDumps: "logs/crash-dumps"
    }
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    const result = cleanExitReasons.has(details.reason) ? "ok" : "failed";
    void logger.log({
      category: "APP",
      action: "renderer_process_gone",
      result,
      errorCode: details.reason,
      processId: webContents.getOSProcessId(),
      message: `Renderer process ended: ${details.reason}.`,
      details: {
        windowId: BrowserWindow.fromWebContents(webContents)?.id ?? null,
        exitCode: details.exitCode,
        reason: details.reason
      }
    });
  });

  app.on("child-process-gone", (_event, details) => {
    const result = cleanExitReasons.has(details.reason) ? "ok" : "failed";
    void logger.log({
      category: "PROCESS",
      action: "electron_child_process_gone",
      result,
      errorCode: details.reason,
      message: `${details.type} process ended: ${details.reason}.`,
      details: {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName ?? null,
        name: details.name ?? null
      }
    });
  });

  process.on("unhandledRejection", (reason) => {
    void logger.log({
      category: "APP",
      action: "main_unhandled_rejection",
      result: "failed",
      errorCode: "UNHANDLED_REJECTION",
      message: errorMessage(reason),
      details: errorDetails(reason)
    });
  });

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    try {
      writeLifecycleLogEventSync(logDirectory, {
        category: "APP",
        action: "main_uncaught_exception",
        result: "failed",
        errorCode: "UNCAUGHT_EXCEPTION",
        message: error.message,
        details: {
          origin,
          name: error.name,
          stack: error.stack ?? null
        }
      });
    } catch {
      return;
    }
  });
}

export function registerWindowCrashDiagnostics(
  window: BrowserWindow,
  logger: LifecycleLogger
): void {
  const { webContents } = window;

  webContents.on("preload-error", (_event, _preloadPath, error) => {
    void logger.log({
      category: "APP",
      action: "renderer_preload_error",
      result: "failed",
      errorCode: error.name,
      message: error.message,
      details: {
        windowId: window.id,
        stack: error.stack ?? null
      }
    });
  });

  webContents.on("did-fail-load", logRendererLoadFailure(webContents, logger));

  webContents.on("unresponsive", () => {
    void logger.log({
      category: "APP",
      action: "renderer_unresponsive",
      result: "blocked",
      message: "Renderer became unresponsive.",
      processId: webContents.getOSProcessId(),
      details: {
        windowId: window.id
      }
    });
  });

  webContents.on("responsive", () => {
    void logger.log({
      category: "APP",
      action: "renderer_responsive",
      result: "ok",
      message: "Renderer became responsive.",
      processId: webContents.getOSProcessId(),
      details: {
        windowId: window.id
      }
    });
  });
}

function logRendererLoadFailure(
  webContents: WebContents,
  logger: LifecycleLogger
) {
  return (
    _event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    _validatedURL: string,
    isMainFrame: boolean,
    frameProcessId: number,
    frameRoutingId: number
  ): void => {
    if (!isMainFrame) {
      return;
    }

    void logger.log({
      category: "APP",
      action: "renderer_load_failed",
      result: "failed",
      errorCode: String(errorCode),
      message: errorDescription,
      processId: webContents.getOSProcessId(),
      details: {
        frameProcessId,
        frameRoutingId,
        isMainFrame
      }
    });
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown process error.";
}

function errorDetails(error: unknown): Record<string, string | null> {
  if (error instanceof Error) {
    return {
      name: error.name,
      stack: error.stack ?? null
    };
  }
  return {
    name: typeof error,
    stack: null
  };
}
