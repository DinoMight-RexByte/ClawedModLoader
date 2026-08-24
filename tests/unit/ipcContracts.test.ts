import { describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  CreatorMappingsDumpProgressSchema,
  CreatorMappingsDumpResultSchema,
  CreatorMeshExportDialogRequestSchema,
  ExternalModInspectionResultSchema,
  ImportModPackageRequestSchema,
  ImportModPackageResultSchema,
  LaunchCommandResultSchema,
  LaunchCommandRequestSchema,
  PlaySnapshotSchema,
  RecordUe4ssRuntimeValidationRequestSchema,
  RendererErrorReportRequestSchema,
  SetAutoValidatePackagedRuntimeRequestSchema,
  SetAutoUpdatePackagedRuntimeRequestSchema,
  ValidatePackagedRuntimeResultSchema
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
    expect(
      LaunchCommandRequestSchema.parse({
        kind: "launchModded",
        runtimeValidationConfirmed: true,
        alwaysValidateRuntime: true
      })
    ).toEqual({
      kind: "launchModded",
      runtimeValidationConfirmed: true,
      alwaysValidateRuntime: true
    });
    expect(
      LaunchCommandResultSchema.parse({
        kind: "launchModded",
        launchMode: "MODDED",
        status: "blocked",
        title: "Runtime validation failed",
        message: "Validation did not complete.",
        canOpenRuntimeValidationFlow: true,
        occurredAt: new Date().toISOString()
      })
    ).toMatchObject({ canOpenRuntimeValidationFlow: true });
  });

  it("rejects unknown launch commands", () => {
    expect(() =>
      LaunchCommandRequestSchema.parse({ kind: "forceQuitGame" })
    ).toThrow();
  });

  it("defaults runtime auto update settings for legacy settings", () => {
    expect(AppSettingsSchema.parse({ manualGameDirectory: null })).toEqual({
      manualGameDirectory: null,
      autoUpdatePackagedRuntime: true,
      autoValidatePackagedRuntime: false
    });
    expect(
      SetAutoUpdatePackagedRuntimeRequestSchema.parse({ enabled: false })
    ).toEqual({ enabled: false });
    expect(
      SetAutoValidatePackagedRuntimeRequestSchema.parse({ enabled: false })
    ).toEqual({ enabled: false });
  });

  it("requires scoped runtime validation evidence", () => {
    expect(
      RecordUe4ssRuntimeValidationRequestSchema.parse({
        status: "VALIDATED",
        steamBuildId: "24742251",
        fingerprintSha256: null,
        evidencePath: "C:\\CMM\\validation",
        markerModId: "CMMUserRuntimeValidation"
      })
    ).toMatchObject({
      status: "VALIDATED",
      steamBuildId: "24742251"
    });
    expect(() =>
      RecordUe4ssRuntimeValidationRequestSchema.parse({
        status: "VALIDATED",
        steamBuildId: null,
        fingerprintSha256: null,
        evidencePath: null,
        markerModId: "CMMUserRuntimeValidation"
      })
    ).toThrow();
  });

  it("validates packaged runtime validation results", () => {
    expect(
      ValidatePackagedRuntimeResultSchema.parse({
        status: "validated",
        evidencePath: "C:\\CMM\\logs\\runtime-validation\\run",
        recording: null,
        problems: []
      })
    ).toMatchObject({ status: "validated" });
    expect(
      ValidatePackagedRuntimeResultSchema.parse({
        status: "cancelled",
        evidencePath: "C:\\CMM\\logs\\runtime-validation\\cancelled",
        recording: null,
        problems: []
      })
    ).toMatchObject({ status: "cancelled" });
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

  it("validates identity replacement import requests and results", () => {
    expect(
      ImportModPackageRequestSchema.parse({
        packagePath: "C:\\Mods\\Renamed.clawedmod",
        replacement: {
          action: "replaceMatchingIdentity",
          packageIdentityId: "cmm:generated:Renamed"
        }
      })
    ).toMatchObject({
      replacement: { packageIdentityId: "cmm:generated:Renamed" }
    });

    expect(
      ImportModPackageResultSchema.parse({
        status: "needsReplacementConfirmation",
        mod: null,
        packageIdentityId: "cmm:generated:Renamed",
        replacementCandidates: [],
        problems: []
      })
    ).toMatchObject({ status: "needsReplacementConfirmation" });
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

  it("validates creator mappings dump results", () => {
    expect(
      CreatorMappingsDumpResultSchema.parse({
        status: "generated",
        mappingsPath: "C:\\Clawed\\Mappings.usmap",
        evidencePath: "C:\\CMM\\logs\\unreal-mappings\\run",
        problems: []
      })
    ).toMatchObject({ status: "generated" });
  });

  it("validates creator mappings progress updates", () => {
    expect(
      CreatorMappingsDumpProgressSchema.parse({
        stage: "waitingForMappings",
        status: "running",
        message: "Waiting for UE4SS to write Mappings.usmap.",
        detail: "Timeout: 180 seconds.",
        mappingsPath: null,
        evidencePath: "C:\\CMM\\logs\\unreal-mappings\\run"
      })
    ).toMatchObject({ stage: "waitingForMappings", status: "running" });
  });

  it("validates the play page snapshot shape", () => {
    const parsed = PlaySnapshotSchema.parse({
      activeProfile: { id: "default", name: "Default" },
      gameState: "UNKNOWN",
      launchMode: "VANILLA",
      enabledMods: 0,
      profileValidity: "valid",
      deploymentState: "notDeployed",
      runtime: {
        ue4ss: null,
        status: "missing",
        problems: []
      },
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
