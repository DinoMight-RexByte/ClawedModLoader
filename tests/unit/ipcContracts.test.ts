import { describe, expect, it } from "vitest";

import {
  AppSettingsSchema,
  AppUpdateSnapshotSchema,
  AvailableModCatalogSchema,
  CreatorMappingsDumpProgressSchema,
  CreatorMappingsDumpResultSchema,
  CreatorMeshExportDialogRequestSchema,
  ExternalModInspectionResultSchema,
  ImportModPackageRequestSchema,
  ImportModPackageResultSchema,
  InstallAvailableModRequestSchema,
  InstallAvailableModResultSchema,
  LaunchCommandResultSchema,
  LaunchCommandRequestSchema,
  LogBundlePlanSchema,
  LogBundleRequestSchema,
  LogBundleResultSchema,
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

  it("validates app update snapshots", () => {
    expect(
      AppUpdateSnapshotSchema.parse({
        status: "downloaded",
        currentVersion: "0.1.0",
        availableVersion: "0.1.1",
        releaseName: "0.1.1",
        releaseDate: new Date().toISOString(),
        message: "Version 0.1.1 is ready to install.",
        lastCheckedAt: new Date().toISOString(),
        downloadedAt: new Date().toISOString(),
        errorMessage: null,
        progress: null
      })
    ).toMatchObject({
      status: "downloaded",
      availableVersion: "0.1.1"
    });

    expect(() =>
      AppUpdateSnapshotSchema.parse({
        status: "downloading",
        currentVersion: "0.1.0",
        availableVersion: "0.1.1",
        releaseName: null,
        releaseDate: null,
        message: "Downloading version 0.1.1.",
        lastCheckedAt: null,
        downloadedAt: null,
        errorMessage: null,
        progress: {
          percent: 101,
          transferred: 1,
          total: 1,
          bytesPerSecond: 1
        }
      })
    ).toThrow();
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

  it("validates log bundle requests and results", () => {
    expect(
      LogBundleRequestSchema.parse({
        mode: "modded",
        includeHardware: true
      })
    ).toEqual({
      mode: "modded",
      includeHardware: true
    });
    expect(() =>
      LogBundleRequestSchema.parse({
        mode: "profile",
        includeHardware: true
      })
    ).toThrow();
    expect(
      LogBundlePlanSchema.parse({
        generatedAt: new Date().toISOString(),
        mode: "vanilla",
        fileName: "Vanilla_ClawedLogs_24962487_aug-27-2026.zip",
        steamBuildId: "24962487",
        sources: [
          {
            label: "Clawed save games",
            scope: "vanilla",
            sourcePath: "C:\\Users\\Tester\\AppData\\Local\\Clawed\\Saved\\SaveGames",
            archivePath: "clawed/Saved/SaveGames",
            exists: true,
            included: true
          }
        ]
      }).fileName
    ).toContain("ClawedLogs");
    expect(
      LogBundleResultSchema.parse({
        status: "created",
        bundlePath: "C:\\Bundles\\Vanilla_ClawedLogs_24962487_aug-27-2026.zip",
        fileName: "Vanilla_ClawedLogs_24962487_aug-27-2026.zip",
        steamBuildId: "24962487",
        fileCount: 3,
        bytesWritten: 1024,
        includedHardware: false,
        problems: []
      })
    ).toMatchObject({ status: "created", fileCount: 3 });
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

  it("validates available mod catalog install requests and results", () => {
    const catalog = {
      generatedAt: new Date().toISOString(),
      groups: [
        {
          category: "release",
          title: "Official Release Mods",
          mods: [
            {
              key: "release:ModsActiveTitleLogo.clawedmod",
              category: "release",
              fileName: "ModsActiveTitleLogo.clawedmod",
              id: "ModsActiveTitleLogo",
              name: "Mods Active Title Logo",
              version: "20260826T120000",
              author: "CMM Fixtures",
              description: "Shows a title-screen marker when mods are active.",
              loader: "pak",
              packageIdentityId: "cmm:generated:ModsActiveTitleLogo",
              sha256:
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              installScope: "everyone",
              installState: "notInstalled",
              problems: []
            }
          ]
        },
        {
          category: "prototype",
          title: "Prototype Mods",
          mods: []
        }
      ],
      totals: {
        available: 1,
        prototype: 0,
        release: 1,
        installed: 0,
        problems: 0
      },
      problems: []
    };

    expect(AvailableModCatalogSchema.parse(catalog).groups[0].mods[0]).toMatchObject(
      {
        installScope: "everyone",
        installState: "notInstalled"
      }
    );
    expect(
      InstallAvailableModRequestSchema.parse({
        key: "release:ModsActiveTitleLogo.clawedmod",
        replacement: {
          action: "replaceMatchingIdentity",
          packageIdentityId: "cmm:generated:ModsActiveTitleLogo"
        }
      })
    ).toMatchObject({
      replacement: { packageIdentityId: "cmm:generated:ModsActiveTitleLogo" }
    });
    expect(
      InstallAvailableModResultSchema.parse({
        result: {
          status: "failed",
          mod: null,
          problems: []
        },
        catalog
      })
    ).toMatchObject({ result: { status: "failed" } });
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
