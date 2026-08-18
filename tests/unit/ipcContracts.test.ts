import { describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  CreatorMeshExportDialogRequestSchema,
  ExternalModInspectionResultSchema,
  LaunchCommandRequestSchema,
  PlaySnapshotSchema,
  RendererErrorReportRequestSchema,
  SetAutoUpdatePackagedRuntimeRequestSchema
} from "../../src/shared/contracts/app";

describe("IPC contracts", () => {
  it("accepts each launch command kind", () => {
    expect(
      LaunchCommandRequestSchema.parse({ kind: "launchModded" })
    ).toEqual({ kind: "launchModded" });
    expect(
      LaunchCommandRequestSchema.parse({ kind: "launchVanilla" })
    ).toEqual({ kind: "launchVanilla" });
    expect(LaunchCommandRequestSchema.parse({ kind: "restartGame" })).toEqual({
      kind: "restartGame"
    });
  });

  it("rejects unknown launch commands", () => {
    expect(() =>
      LaunchCommandRequestSchema.parse({ kind: "forceQuitGame" })
    ).toThrow();
  });

  it("defaults runtime auto update settings for legacy settings", () => {
    expect(AppSettingsSchema.parse({ manualGameDirectory: null })).toEqual({
      manualGameDirectory: null,
      autoUpdatePackagedRuntime: true
    });
    expect(
      SetAutoUpdatePackagedRuntimeRequestSchema.parse({ enabled: false })
    ).toEqual({ enabled: false });
  });

  it("validates renderer error diagnostics without accepting large payloads", () => {
    const parsed = RendererErrorReportRequestSchema.parse({
      source: "reactErrorBoundary",
      message: "View failed",
      errorName: "Error",
      stack: "Error: View failed",
      componentStack: "at ModsPage"
    });

    expect(parsed.source).toBe("reactErrorBoundary");
    expect(() =>
      RendererErrorReportRequestSchema.parse({
        source: "windowError",
        message: "x".repeat(501)
      })
    ).toThrow();
  });

  it("validates external mod inspection results", () => {
    const parsed = ExternalModInspectionResultSchema.parse({
      status: "recognized",
      format: "rawPak",
      support: "installable",
      loader: "pak",
      sourcePath: "C:\\Mods\\Example_P.pak",
      fileName: "Example_P.pak",
      sha256:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      detectedName: "Example P",
      detectedVersion: "0.0.0-external",
      entryCount: 1,
      problems: []
    });

    expect(parsed.format).toBe("rawPak");
  });

  it("keeps creator mesh export dialog requests narrow", () => {
    expect(
      CreatorMeshExportDialogRequestSchema.parse({
        assetId: "base:mesh",
        format: "glb"
      })
    ).toEqual({ assetId: "base:mesh", format: "glb" });
    expect(() =>
      CreatorMeshExportDialogRequestSchema.parse({
        assetId: "base:mesh",
        format: "glb",
        destinationPath: "C:\\Clawed\\Content\\mesh.glb"
      })
    ).toThrow();
  });

  it("validates the play page snapshot shape", () => {
    const parsed = PlaySnapshotSchema.parse({
      activeProfile: { id: "default", name: "Default" },
      gameState: "UNKNOWN",
      launchMode: "VANILLA",
      enabledMods: 0,
      profileValidity: "valid",
      deploymentState: "notDeployed",
      conflicts: { count: 0, severity: "none" },
      discovery: {
        appId: "3394840",
        steamPath: null,
        steamLibrary: null,
        steamLibraries: [],
        appManifestPath: null,
        gameInstallPath: null,
        gameExecutable: null,
        discoveryStatus: "STEAM_NOT_FOUND",
        source: "none",
        manualOverride: null,
        diagnosticErrors: [],
        discoveredAt: new Date().toISOString()
      },
      process: {
        lifecycleState: "STOPPED",
        processId: null,
        processName: null,
        startedAt: null,
        updatedAt: new Date().toISOString()
      },
      lastCommand: null
    });

    expect(parsed.enabledMods).toBe(0);
  });
});
