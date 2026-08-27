import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import JSZip from "jszip";

import type { DeploymentAdapterDescriptor } from "../../shared/contracts/deployment";
import {
  DiagnosticReportSchema,
  DiagnosticsSummarySchema,
  LogBundlePlanSchema,
  LogBundleResultSchema,
  LogOpenResultSchema,
  type CreatorAssetRegistrySnapshot,
  type DiagnosticReport,
  type DiagnosticsSummary,
  type LogBundleCreateRequest,
  type LogBundlePlan,
  type LogBundleRequest,
  type LogBundleResult,
  type LogBundleSource,
  type LoadOrderProblem,
  type ManagerOwnedFile,
  type ModProblem,
  type PlaySnapshot,
  type RendererErrorReportRequest,
  type RendererErrorReportResult,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  DiagnosticsServiceContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import { ClawedGameAdapter } from "../adapters/clawed/clawedGameAdapter";
import {
  NullLifecycleLogger,
  type LifecycleLogger
} from "./lifecycleLogger";
import { extractUe4ssRuntimeConfigurations } from "./deploymentManifestCleanup";
import { modProblem } from "./packageProblems";
import { isPathInside } from "./packagePaths";
import { getUe4ssLogPath } from "./runtimeValidationProbe";
import type { MainServiceDependencies } from "./serviceRegistry";

export interface DiagnosticsServiceOptions {
  clawedLocalAppDataRoot?: string;
}

type LogBundleSourceDraft = Omit<LogBundleSource, "exists">;

export class LocalDiagnosticsService implements DiagnosticsServiceContract {
  constructor(
    private readonly dependencies: MainServiceDependencies,
    private readonly storageService: StorageServiceContract,
    private readonly adapters: DeploymentAdapterDescriptor[],
    private readonly gameAdapter: ClawedGameAdapter = new ClawedGameAdapter(),
    private readonly logger: LifecycleLogger = new NullLifecycleLogger(),
    private readonly options: DiagnosticsServiceOptions = {}
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "diagnosticsService",
      label: "Diagnostics Service",
      status: "ready",
      detail: "Reports current CMM service, runtime, deployment, and log state."
    };
  }

  async getPlaySnapshot(): Promise<PlaySnapshot> {
    const discovery = await this.dependencies.gameLocator.discover();
    const process = await this.dependencies.processSupervisor.getSnapshot(
      discovery.gameExecutable
    );
    const activeProfile = await this.dependencies.profileService.getActiveProfile();
    const [modLibrary, validation, deployment] = await Promise.all([
      this.dependencies.profileService.listInstalledModsForActiveProfile(),
      this.dependencies.loadOrderService.validateActiveOrder(),
      this.dependencies.deploymentService.getSnapshot(discovery)
    ]);
    const errorCount = validation.problems.filter(
      (problem) => problem.severity === "ERROR"
    ).length;
    const warningCount = validation.problems.filter(
      (problem) => problem.severity === "WARNING"
    ).length;

    return {
      activeProfile: {
        id: activeProfile.id,
        name: activeProfile.name
      },
      gameState:
        discovery.discoveryStatus === "READY"
          ? process.lifecycleState
          : "UNKNOWN",
      launchMode: this.dependencies.launchService.getCurrentLaunchMode(),
      enabledMods: Object.values(activeProfile.selectedMods).filter(
        (selection) => selection.enabled
      ).length,
      installedMods: modLibrary.totals.installed,
      profileValidity: validation.validity,
      deploymentState: deployment.state,
      runtime: deployment.runtime,
      conflicts: {
        count: errorCount + warningCount,
        severity:
          errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "none"
      },
      discovery,
      process,
      lastCommand: this.dependencies.launchService.getLastCommand()
    };
  }

  async getDiagnosticsSummary(): Promise<DiagnosticsSummary> {
    const discovery = await this.dependencies.gameLocator.discover();
    const process = await this.dependencies.processSupervisor.getSnapshot(
      discovery.gameExecutable
    );
    const activeProfile = await this.dependencies.profileService.getActiveProfile();
    const [
      modLibrary,
      validation,
      deployment,
      logs,
      creatorRegistry
    ] = await Promise.all([
      this.dependencies.profileService.listInstalledModsForActiveProfile(),
      this.dependencies.loadOrderService.validateActiveOrder(),
      this.dependencies.deploymentService.getSnapshot(discovery),
      this.getLogsSummary(),
      this.dependencies.assetRegistryService.getSnapshot().catch(() => null)
    ]);
    const gameFingerprint = await this.gameAdapter.getFingerprint(
      discovery,
      deployment.activeManifest?.gameFingerprint ?? null,
      { mode: "quick" }
    );
    const services = [
      this.dependencies.gameLocator.getStatus(),
      this.dependencies.processSupervisor.getStatus(),
      this.dependencies.launchService.getStatus(),
      this.dependencies.deploymentService.getStatus(),
      this.dependencies.packagedRuntimeValidationService.getStatus(),
      this.dependencies.runtimeManager.getStatus(),
      this.dependencies.availableModService.getStatus(),
      this.dependencies.modLibraryService.getStatus(),
      this.dependencies.externalImportService.getStatus(),
      this.dependencies.assetRegistryService.getStatus(),
      this.dependencies.profileService.getStatus(),
      this.dependencies.loadOrderService.getStatus(),
      this.dependencies.packageService.getStatus(),
      this.dependencies.exportImportService.getStatus(),
      this.dependencies.backupService.getStatus(),
      this.getStatus(),
      ...this.adapters.map((adapter) => ({
        id: adapter.id,
        label: adapter.label,
        status: adapter.status,
        detail: `${adapter.layer} adapter; release behavior is ${adapter.releaseValidation}.`
      }))
    ];

    return DiagnosticsSummarySchema.parse({
      generatedAt: new Date().toISOString(),
      storage: await this.storageService.getLayout(),
      discovery,
      process,
      gameFingerprint,
      runtime: deployment.runtime,
      activeProfile: {
        id: activeProfile.id,
        name: activeProfile.name
      },
      profileValidity: validation.validity,
      enabledModCount: modLibrary.totals.enabled,
      dependencyProblems: validation.problems.filter(isDependencyProblem),
      conflictProblems: validation.problems.filter(isConflictProblem),
      deployment,
      managerOwnedFiles: await managerOwnedFiles(deployment.activeManifest),
      lastLaunchMode: this.dependencies.launchService.getCurrentLaunchMode(),
      lastGameExit: await this.latestLogOccurrence("process_exited"),
      lastDeploymentProblem: firstProblem(deployment.problems),
      logs,
      modLibrary,
      creatorAssets: creatorDiagnosticsSummary(creatorRegistry, modLibrary),
      services,
      releaseValidation: {
        state: "UNVALIDATED",
        detail: "No Clawed release build has been inspected."
      }
    });
  }

  async getDiagnosticReport(): Promise<DiagnosticReport> {
    const summary = await this.getDiagnosticsSummary();
    return DiagnosticReportSchema.parse({
      generatedAt: summary.generatedAt,
      text: sanitizeDiagnosticText(formatDiagnosticReport(summary), summary)
    });
  }

  async getLatestErrorsReport(): Promise<DiagnosticReport> {
    const summary = await this.getDiagnosticsSummary();
    const text =
      summary.logs.latestErrors.length > 0
        ? summary.logs.latestErrors.join("\n")
        : "No recent failed or blocked lifecycle events.";
    return DiagnosticReportSchema.parse({
      generatedAt: summary.generatedAt,
      text: sanitizeDiagnosticText(text, summary)
    });
  }

  async getLogBundlePlan(request: LogBundleRequest): Promise<LogBundlePlan> {
    const context = await this.createLogBundleContext(request);
    return LogBundlePlanSchema.parse({
      generatedAt: context.generatedAt,
      mode: request.mode,
      fileName: context.fileName,
      steamBuildId: context.steamBuildId,
      sources: context.sources
    });
  }

  async createLogBundle(
    request: LogBundleCreateRequest
  ): Promise<LogBundleResult> {
    const context = await this.createLogBundleContext(request);
    const zip = new JSZip();
    const problems: ModProblem[] = [];
    const copiedFiles: LogBundleManifestFile[] = [];

    try {
      await this.addGeneratedBundleFiles(zip, context, request, copiedFiles);

      for (const source of context.sources.filter(
        (source) =>
          source.included &&
          source.exists &&
          source.scope !== "generated" &&
          source.scope !== "hardware"
      )) {
        await addPathToZip(zip, source, copiedFiles, problems);
      }

      if (request.includeHardware) {
        zip.file(
          "generated/hardware-specs.json",
          `${await collectHardwareSpecs()}\n`
        );
        copiedFiles.push({
          archivePath: "generated/hardware-specs.json",
          sourcePath: "Generated hardware summary",
          size: null
        });
      }

      zip.file(
        "bundle-manifest.json",
        `${JSON.stringify(
          {
            generatedAt: context.generatedAt,
            mode: request.mode,
            steamBuildId: context.steamBuildId,
            includedHardware: request.includeHardware,
            copiedFiles,
            sources: context.sources,
            problems
          },
          null,
          2
        )}\n`
      );
      copiedFiles.push({
        archivePath: "bundle-manifest.json",
        sourcePath: "Generated bundle inventory",
        size: null
      });

      const archive = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      });
      await mkdir(path.dirname(request.destinationPath), { recursive: true });
      await writeFile(request.destinationPath, archive);
      await this.logger.log({
        category: "APP",
        action: "log_bundle_created",
        result: "ok",
        message: `${request.mode} log bundle created.`,
        details: {
          mode: request.mode,
          includedHardware: request.includeHardware,
          fileCount: copiedFiles.length
        }
      });

      return LogBundleResultSchema.parse({
        status: "created",
        bundlePath: request.destinationPath,
        fileName: path.basename(request.destinationPath),
        steamBuildId: context.steamBuildId,
        fileCount: copiedFiles.length,
        bytesWritten: archive.byteLength,
        includedHardware: request.includeHardware,
        problems
      });
    } catch (error) {
      const problem = modProblem(
        "error",
        "LOG_BUNDLE_FAILED",
        "CMM could not create the log bundle.",
        error instanceof Error ? error.message : String(error)
      );
      await this.logger.log({
        category: "APP",
        action: "log_bundle_created",
        result: "failed",
        errorCode: problem.code,
        message: problem.message,
        details: {
          mode: request.mode,
          includedHardware: request.includeHardware
        }
      });

      return LogBundleResultSchema.parse({
        status: "failed",
        bundlePath: null,
        fileName: path.basename(request.destinationPath),
        steamBuildId: context.steamBuildId,
        fileCount: 0,
        bytesWritten: null,
        includedHardware: request.includeHardware,
        problems: [problem]
      });
    }
  }

  async recordRendererError(
    request: RendererErrorReportRequest
  ): Promise<RendererErrorReportResult> {
    await this.logger.log({
      category: "APP",
      action: "renderer_error",
      result: "failed",
      errorCode: "RENDERER_ERROR",
      message: request.message,
      details: rendererErrorDetails(request)
    });

    return {
      status: "logged"
    };
  }

  async openLogs() {
    const layout = await this.storageService.getLayout();
    const errorMessage = await shell.openPath(layout.directories.logs);
    return LogOpenResultSchema.parse({
      status: errorMessage ? "failed" : "ok",
      path: layout.directories.logs,
      problems: errorMessage
        ? [
            modProblem(
              "error",
              "OPEN_LOGS_FAILED",
              "CMM could not open the logs folder.",
              errorMessage
            )
          ]
        : []
    });
  }

  private async getLogsSummary() {
    const layout = await this.storageService.getLayout();
    const entries = await readLifecycleLogEntries(layout.directories.logs);
    const crashDumpsDirectory = path.join(
      layout.directories.logs,
      "crash-dumps"
    );
    const latestErrors = entries
      .filter((entry) => entry.result === "failed" || entry.result === "blocked")
      .slice(-20)
      .map((entry) => JSON.stringify(entry));

    return {
      logDirectory: layout.directories.logs,
      crashDumpsDirectory,
      crashDumpCount: await countCrashDumpFiles(crashDumpsDirectory),
      latestErrors
    };
  }

  private async latestLogOccurrence(action: string): Promise<string | null> {
    const layout = await this.storageService.getLayout();
    const entries = await readLifecycleLogEntries(layout.directories.logs);
    return (
      [...entries]
        .reverse()
        .find((entry) => entry.action === action)?.occurredAt ?? null
    );
  }

  private async createLogBundleContext(request: LogBundleRequest) {
    const [layout, discovery, deployment] = await Promise.all([
      this.storageService.getLayout(),
      this.dependencies.gameLocator.discover(),
      this.dependencies.deploymentService
        .getSnapshot()
        .catch(() => ({ activeManifest: null }))
    ]);
    const fingerprint = await this.gameAdapter.getFingerprint(discovery, null, {
      mode: "quick"
    });
    const generatedAt = new Date().toISOString();
    const steamBuildId = fingerprint.steamBuildId;
    const fileName = logBundleFileName(request.mode, steamBuildId, new Date());
    const sources = await this.logBundleSources(
      request,
      layout,
      discovery,
      deployment.activeManifest ?? null
    );

    return {
      generatedAt,
      steamBuildId,
      fileName,
      sources
    };
  }

  private async addGeneratedBundleFiles(
    zip: JSZip,
    context: Awaited<ReturnType<LocalDiagnosticsService["createLogBundleContext"]>>,
    request: LogBundleRequest,
    copiedFiles: LogBundleManifestFile[]
  ): Promise<void> {
    const diagnosticReport = await this.getDiagnosticReport();
    const readme = [
      "Clawed Log Bundle",
      "",
      `Mode: ${request.mode}`,
      `Steam build ID: ${context.steamBuildId ?? "unknown"}`,
      `Generated: ${context.generatedAt}`,
      `Hardware summary included: ${request.includeHardware ? "yes" : "no"}`,
      "",
      "CMM only read the source paths listed in bundle-manifest.json."
    ].join("\n");

    zip.file("generated/diagnostic-report.txt", `${diagnosticReport.text}\n`);
    zip.file("README.txt", `${readme}\n`);
    copiedFiles.push(
      {
        archivePath: "generated/diagnostic-report.txt",
        sourcePath: "Generated CMM diagnostic report",
        size: Buffer.byteLength(diagnosticReport.text)
      },
      {
        archivePath: "README.txt",
        sourcePath: "Generated bundle notes",
        size: Buffer.byteLength(readme)
      }
    );
  }

  private async logBundleSources(
    request: LogBundleRequest,
    layout: Awaited<ReturnType<StorageServiceContract["getLayout"]>>,
    discovery: DiagnosticsSummary["discovery"],
    activeManifest: DiagnosticsSummary["deployment"]["activeManifest"]
  ): Promise<LogBundleSource[]> {
    const savedRoot = clawedSavedRoot(this.options.clawedLocalAppDataRoot);
    const sources: LogBundleSourceDraft[] = [
      {
        label: "Generated diagnostic report",
        scope: "generated",
        sourcePath: "Generated by CMM",
        archivePath: "generated/diagnostic-report.txt",
        included: true
      },
      {
        label: "Generated bundle manifest",
        scope: "generated",
        sourcePath: "Generated by CMM",
        archivePath: "bundle-manifest.json",
        included: true
      },
      {
        label: "Clawed game config",
        scope: "vanilla",
        sourcePath: path.join(savedRoot, "Config"),
        archivePath: "clawed/Saved/Config",
        included: true,
        missingAction:
          "Launch Clawed once, open or confirm settings, close the game, then refresh."
      },
      {
        label: "Clawed game logs",
        scope: "vanilla",
        sourcePath: path.join(savedRoot, "Logs"),
        archivePath: "clawed/Saved/Logs",
        included: true,
        missingAction:
          "Launch Clawed once, let it reach the menu, close the game, then refresh."
      },
      {
        label: "Clawed crash reports",
        scope: "vanilla",
        sourcePath: path.join(savedRoot, "Crashes"),
        archivePath: "clawed/Saved/Crashes",
        included: true,
        missingAction:
          "No action is needed unless you are reporting a crash; Clawed creates this after a game crash."
      },
      {
        label: "Clawed save games",
        scope: "vanilla",
        sourcePath: path.join(savedRoot, "SaveGames"),
        archivePath: "clawed/Saved/SaveGames",
        included: true,
        missingAction:
          "Create or load a save in Clawed, wait for it to save, close the game, then refresh."
      },
      {
        label: "Steam app manifest",
        scope: "vanilla",
        sourcePath: discovery.appManifestPath ?? "Steam app manifest not found",
        archivePath: "steam/appmanifest_3394840.acf",
        included: Boolean(discovery.appManifestPath)
      },
      {
        label: "Hardware specs",
        scope: "hardware",
        sourcePath: "Generated only when consent is enabled",
        archivePath: "generated/hardware-specs.json",
        included: request.includeHardware
      }
    ];

    if (request.mode === "modded") {
      sources.push(
        {
          label: "CMM lifecycle logs and evidence",
          scope: "modded",
          sourcePath: layout.directories.logs,
          archivePath: "cmm/logs",
          included: true,
          missingAction: "Run any CMM action, then refresh."
        },
        {
          label: "CMM deployment manifests",
          scope: "modded",
          sourcePath: path.join(layout.directories.runtime, "deployments"),
          archivePath: "cmm/runtime/deployments",
          included: true,
          missingAction:
            "Use Launch Modded while Clawed is closed so CMM stages the active profile, then refresh."
        },
        {
          label: "CMM UE4SS runtime index",
          scope: "modded",
          sourcePath: path.join(
            layout.directories.runtime,
            "ue4ss",
            "ue4ss-runtime.json"
          ),
          archivePath: "cmm/runtime/ue4ss-runtime.json",
          included: true,
          missingAction:
            "Use Packaged Runtime or import a UE4SS runtime, then refresh."
        },
        {
          label: "CMM profiles",
          scope: "modded",
          sourcePath: layout.directories.profiles,
          archivePath: "cmm/profiles",
          included: true,
          missingAction:
            "Create or switch a profile in CMM, then refresh."
        },
        {
          label: "Clawed save backups",
          scope: "modded",
          sourcePath: path.join(savedRoot, "SaveBackups"),
          archivePath: "clawed/Saved/SaveBackups",
          included: true,
          missingAction:
            "Enable Save Backup Rotator, launch modded, let it create a backup, then refresh."
        },
        ...moddedRuntimeSources(discovery, activeManifest)
      );
    }

    const unique = dedupeSources(sources);
    return Promise.all(
      unique.map(async (source) => ({
        ...source,
        exists:
          source.scope === "generated" ||
          source.scope === "hardware" ||
          (source.included && (await pathExists(source.sourcePath)))
      }))
    );
  }
}

interface LogBundleManifestFile {
  archivePath: string;
  sourcePath: string;
  size: number | null;
}

async function addPathToZip(
  zip: JSZip,
  source: LogBundleSource,
  copiedFiles: LogBundleManifestFile[],
  problems: ModProblem[]
): Promise<void> {
  const sourceInfo = await lstat(source.sourcePath).catch(() => null);
  if (!sourceInfo) {
    return;
  }
  if (sourceInfo.isSymbolicLink()) {
    problems.push(
      modProblem(
        "warning",
        "LOG_BUNDLE_SYMLINK_SKIPPED",
        "A linked file or folder was skipped.",
        source.sourcePath
      )
    );
    return;
  }
  if (sourceInfo.isDirectory()) {
    await addDirectoryToZip(
      zip,
      source.sourcePath,
      source.archivePath,
      copiedFiles,
      problems
    );
    return;
  }
  if (sourceInfo.isFile()) {
    await addFileToZip(
      zip,
      source.sourcePath,
      source.archivePath,
      copiedFiles,
      problems
    );
  }
}

async function addDirectoryToZip(
  zip: JSZip,
  root: string,
  archiveRoot: string,
  copiedFiles: LogBundleManifestFile[],
  problems: ModProblem[]
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const entryInfo = await lstat(entryPath).catch(() => null);
    if (!entryInfo || !isPathInside(root, entryPath)) {
      continue;
    }
    if (entryInfo.isSymbolicLink()) {
      problems.push(
        modProblem(
          "warning",
          "LOG_BUNDLE_SYMLINK_SKIPPED",
          "A linked file or folder was skipped.",
          entryPath
        )
      );
      continue;
    }
    const archivePath = safeArchivePath(
      path.join(archiveRoot, path.relative(root, entryPath))
    );
    if (entryInfo.isDirectory()) {
      await addDirectoryToZip(zip, entryPath, archivePath, copiedFiles, problems);
    } else if (entryInfo.isFile()) {
      await addFileToZip(zip, entryPath, archivePath, copiedFiles, problems);
    }
  }
}

async function addFileToZip(
  zip: JSZip,
  sourcePath: string,
  archivePath: string,
  copiedFiles: LogBundleManifestFile[],
  problems: ModProblem[]
): Promise<void> {
  try {
    const content = await readFile(sourcePath);
    const safePath = safeArchivePath(archivePath);
    zip.file(safePath, content);
    copiedFiles.push({
      archivePath: safePath,
      sourcePath,
      size: content.byteLength
    });
  } catch (error) {
    problems.push(
      modProblem(
        "warning",
        "LOG_BUNDLE_FILE_SKIPPED",
        "A file could not be copied into the log bundle.",
        `${sourcePath}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
}

function dedupeSources(
  sources: Array<Omit<LogBundleSource, "exists">>
): Array<Omit<LogBundleSource, "exists">> {
  const seen = new Set<string>();
  const deduped: Array<Omit<LogBundleSource, "exists">> = [];
  for (const source of sources) {
    const key = `${source.scope}:${source.sourcePath.toLowerCase()}:${source.archivePath.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(source);
    }
  }
  return deduped;
}

function moddedRuntimeSources(
  discovery: DiagnosticsSummary["discovery"],
  activeManifest: DiagnosticsSummary["deployment"]["activeManifest"]
): LogBundleSourceDraft[] {
  const gameInstallPath = discovery.gameInstallPath;
  const gameExecutable = discovery.gameExecutable;
  const candidates = new Set<string>();

  if (gameInstallPath && activeManifest) {
    for (const configuration of extractUe4ssRuntimeConfigurations(
      activeManifest.runtimeConfiguration
    )) {
      candidates.add(getUe4ssLogPath(gameInstallPath, configuration));
      addRuntimeConfigCandidates(candidates, gameInstallPath, configuration);
    }
    for (const file of activeManifest.runtimeGeneratedFiles) {
      if (path.basename(file.absolutePath).toLowerCase() === "ue4ss.log") {
        candidates.add(file.absolutePath);
      }
    }
    return [...candidates].map((sourcePath) =>
      createModdedRuntimeSource(gameInstallPath, sourcePath)
    );
  }

  if (gameInstallPath) {
    candidates.add(path.join(gameInstallPath, "UE4SS.log"));
  }

  if (gameExecutable) {
    const binaryDirectory = path.dirname(gameExecutable);
    candidates.add(path.join(binaryDirectory, "UE4SS.log"));
    candidates.add(path.join(binaryDirectory, "ue4ss", "UE4SS.log"));
    candidates.add(path.join(binaryDirectory, "Mods", "mods.txt"));
    candidates.add(path.join(binaryDirectory, "Mods", "cmm-profile.json"));
    candidates.add(path.join(binaryDirectory, "ue4ss", "Mods", "mods.txt"));
    candidates.add(
      path.join(binaryDirectory, "ue4ss", "Mods", "cmm-profile.json")
    );
  }

  return [...candidates].map((sourcePath) =>
    createModdedRuntimeSource(gameInstallPath, sourcePath)
  );
}

function createModdedRuntimeSource(
  gameInstallPath: string | null,
  sourcePath: string
): LogBundleSourceDraft {
  return {
    label: runtimeSourceLabel(sourcePath),
    scope: "modded",
    sourcePath,
    archivePath: archivePathForGameSource(gameInstallPath, sourcePath),
    included: true,
    missingAction: missingActionForRuntimeSource(sourcePath)
  };
}

function addRuntimeConfigCandidates(
  candidates: Set<string>,
  gameInstallPath: string,
  configuration: Record<string, unknown>
): void {
  const runtimeTarget =
    typeof configuration.runtimeTargetRelativePath === "string"
      ? configuration.runtimeTargetRelativePath
      : "";
  const runtimeMods =
    typeof configuration.runtimeModsRelativePath === "string"
      ? configuration.runtimeModsRelativePath
      : "Mods";
  const modsRoot = path.join(gameInstallPath, runtimeTarget, runtimeMods);
  candidates.add(path.join(modsRoot, "mods.txt"));
  candidates.add(path.join(modsRoot, "cmm-profile.json"));
}

function runtimeSourceLabel(sourcePath: string): string {
  const fileName = path.basename(sourcePath).toLowerCase();
  if (fileName === "ue4ss.log") {
    return "UE4SS runtime log";
  }
  if (fileName === "mods.txt") {
    return "UE4SS load order file";
  }
  if (fileName === "cmm-profile.json") {
    return "CMM deployed runtime profile";
  }
  return "Modded runtime file";
}

function missingActionForRuntimeSource(sourcePath: string): string {
  const fileName = path.basename(sourcePath).toLowerCase();
  if (fileName === "ue4ss.log") {
    return "Use Launch Modded, let Clawed reach the menu so UE4SS starts, close the game normally, then refresh.";
  }
  return "Use Launch Modded while Clawed is closed so CMM stages the active profile, then refresh.";
}

function archivePathForGameSource(
  gameInstallPath: string | null,
  sourcePath: string
): string {
  if (gameInstallPath && isPathInside(gameInstallPath, sourcePath)) {
    return safeArchivePath(
      path.join("modded-runtime", path.relative(gameInstallPath, sourcePath))
    );
  }
  return safeArchivePath(path.join("modded-runtime", path.basename(sourcePath)));
}

function logBundleFileName(
  mode: LogBundleRequest["mode"],
  steamBuildId: string | null,
  date: Date
): string {
  const modeLabel = mode === "modded" ? "Modded" : "Vanilla";
  const buildId = steamBuildId?.trim() || "unknown-build";
  const month = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec"
  ][date.getMonth()];
  return `${modeLabel}_ClawedLogs_${buildId}_${month}-${date.getDate()}-${date.getFullYear()}.zip`;
}

function clawedSavedRoot(localAppDataRoot?: string): string {
  return path.join(defaultLocalAppDataRoot(localAppDataRoot), "Clawed", "Saved");
}

function defaultLocalAppDataRoot(localAppDataRoot?: string): string {
  const configured = localAppDataRoot?.trim();
  if (configured && !configured.includes("\0")) {
    return configured;
  }
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    return localAppData;
  }
  const userProfile = process.env.USERPROFILE?.trim();
  return userProfile ? path.join(userProfile, "AppData", "Local") : "";
}

async function collectHardwareSpecs(): Promise<string> {
  const base = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    totalMemoryBytes: os.totalmem(),
    cpuModel: os.cpus()[0]?.model ?? null,
    logicalCpuCount: os.cpus().length
  };
  const windows = process.platform === "win32"
    ? await collectWindowsHardwareSpecs().catch((error) => ({
        error: error instanceof Error ? error.message : String(error)
      }))
    : null;

  return JSON.stringify(
    {
      note:
        "Generated only after the user enabled hardware-spec consent in CMM Log Bundler.",
      base,
      windows
    },
    null,
    2
  );
}

function collectWindowsHardwareSpecs(): Promise<unknown> {
  const command = [
    "$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber",
    "$cpu = Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed",
    "$gpu = Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM",
    "[PSCustomObject]@{OperatingSystem=$os;Processor=$cpu;VideoController=$gpu} | ConvertTo-Json -Depth 5 -Compress"
  ].join("; ");

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command
      ],
      {
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ raw: stdout.trim() });
        }
      }
    );
  });
}

function safeArchivePath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");
}

function isDependencyProblem(problem: LoadOrderProblem): boolean {
  return (
    problem.code.includes("DEPENDENCY") ||
    problem.code === "INVALID_SELECTED_VERSION"
  );
}

function isConflictProblem(problem: LoadOrderProblem): boolean {
  return problem.code.includes("CONFLICT");
}

function firstProblem(problems: ModProblem[]): ModProblem | null {
  return (
    problems.find((problem) => problem.severity === "error") ??
    problems.find((problem) => problem.severity === "warning") ??
    null
  );
}

async function managerOwnedFiles(
  manifest: DiagnosticsSummary["deployment"]["activeManifest"]
): Promise<ManagerOwnedFile[]> {
  if (!manifest) {
    return [];
  }

  const records = [...manifest.filesCreated, ...manifest.filesModified];
  return Promise.all(
    records.map(async (file) => ({
      relativePath: file.relativePath,
      action: file.action,
      sha256: file.sha256,
      exists: await pathExists(file.absolutePath)
    }))
  );
}

interface RawLifecycleLogEntry {
  category?: string;
  action?: string;
  result?: string;
  occurredAt?: string;
  [key: string]: unknown;
}

async function readLifecycleLogEntries(
  logDirectory: string
): Promise<RawLifecycleLogEntry[]> {
  const logPaths = [
    "lifecycle.jsonl.3",
    "lifecycle.jsonl.2",
    "lifecycle.jsonl.1",
    "lifecycle.jsonl"
  ].map((fileName) => path.join(logDirectory, fileName));
  const entries: RawLifecycleLogEntry[] = [];

  for (const logPath of logPaths) {
    const content = await readFile(logPath, "utf8").catch(() => "");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as RawLifecycleLogEntry;
        entries.push(entry);
      } catch {
        entries.push({
          category: "APP",
          action: "unreadable_log_line",
          result: "failed",
          occurredAt: new Date().toISOString()
        });
      }
    }
  }

  return entries;
}

function formatDiagnosticReport(summary: DiagnosticsSummary): string {
  const dependencyCount = summary.dependencyProblems.length;
  const conflictCount = summary.conflictProblems.length;
  const ownedFileCount = summary.managerOwnedFiles.length;

  return [
    "Clawed Mod Manager Diagnostic Report",
    `Generated: ${summary.generatedAt}`,
    "",
    `Steam detected: ${summary.discovery.steamPath ? "yes" : "no"}`,
    `Clawed detected: ${summary.discovery.gameInstallPath ? "yes" : "no"}`,
    `Discovery status: ${summary.discovery.discoveryStatus}`,
    `Game executable: ${summary.discovery.gameExecutable ?? "not detected"}`,
    `Game fingerprint status: ${summary.gameFingerprint.status}`,
    `Game fingerprint: ${summary.gameFingerprint.fingerprintSha256 ?? "unknown"}`,
    `Steam build ID: ${summary.gameFingerprint.steamBuildId ?? "unknown"}`,
    `Running state: ${summary.process.lifecycleState}`,
    "",
    `Runtime installed: ${summary.runtime.ue4ss ? "yes" : "no"}`,
    `Runtime state: ${summary.runtime.status}`,
    `Runtime source: ${
      summary.runtime.ue4ss?.source === "bundled"
        ? "packaged"
        : summary.runtime.ue4ss
          ? "user"
          : "none"
    }`,
    `Runtime validation: ${summary.runtime.ue4ss?.releaseValidation ?? "none"}`,
    `Runtime validated build: ${
      summary.runtime.ue4ss?.validation?.steamBuildId ?? "none"
    }`,
    `Runtime validation evidence: ${
      summary.runtime.ue4ss?.validation?.evidencePath ?? "none"
    }`,
    `Active profile: ${summary.activeProfile.name}`,
    `Profile validity: ${summary.profileValidity}`,
    `Enabled mods: ${summary.enabledModCount}`,
    `Dependency problems: ${dependencyCount}`,
    `Conflict problems: ${conflictCount}`,
    "",
    `Creator metadata packages: ${summary.creatorAssets.packagesWithMetadata}`,
    `Creator metadata missing: ${summary.creatorAssets.packagesMissingMetadata}`,
    `Creator affected assets: ${summary.creatorAssets.affectedAssets}`,
    `Creator replacements: ${summary.creatorAssets.replacements}`,
    `Creator checksum records: ${summary.creatorAssets.checksumRecords}`,
    `Creator active conflict targets: ${summary.creatorAssets.activeConflictTargets}`,
    `Creator active winners: ${summary.creatorAssets.activeWinners}`,
    `Creator load-order effects: ${summary.creatorAssets.loadOrderEffectProblems}`,
    `Creator stale profile references: ${summary.creatorAssets.staleProfileReferences}`,
    "",
    `Deployment state: ${summary.deployment.state}`,
    `Manager-owned files: ${ownedFileCount}`,
    `Last launch mode: ${summary.lastLaunchMode}`,
    `Last game exit: ${summary.lastGameExit ?? "unknown"}`,
    `Last deployment problem: ${
      summary.lastDeploymentProblem?.message ?? "none"
    }`,
    "",
    `Log folder: ${summary.logs.logDirectory}`,
    `Crash dump folder: ${summary.logs.crashDumpsDirectory}`,
    `Crash dump files: ${summary.logs.crashDumpCount}`,
    "",
    "Recent errors:",
    ...(summary.logs.latestErrors.length > 0
      ? summary.logs.latestErrors
      : ["none"])
  ].join("\n");
}

function creatorDiagnosticsSummary(
  registry: CreatorAssetRegistrySnapshot | null,
  modLibrary: DiagnosticsSummary["modLibrary"]
): DiagnosticsSummary["creatorAssets"] {
  if (!registry) {
    return {
      packagesWithMetadata: 0,
      packagesMissingMetadata: modLibrary.totals.installed,
      affectedAssets: 0,
      replacements: 0,
      packagePayloadEntries: 0,
      checksumRecords: 0,
      activeConflictTargets: 0,
      activeWinners: 0,
      loadOrderEffectProblems: 0,
      staleProfileReferences: 0
    };
  }

  return {
    packagesWithMetadata: registry.totals.creatorMetadataPackages,
    packagesMissingMetadata: Math.max(
      0,
      registry.totals.installedPackages -
        registry.totals.creatorMetadataPackages
    ),
    affectedAssets: registry.totals.affectedAssets,
    replacements: registry.totals.replacements,
    packagePayloadEntries: registry.totals.packagePayloadEntries,
    checksumRecords: registry.totals.checksumRecords,
    activeConflictTargets: registry.totals.activeConflictTargets,
    activeWinners: registry.totals.activeWinners,
    loadOrderEffectProblems: registry.totals.loadOrderEffectProblems,
    staleProfileReferences: registry.totals.staleProfileReferences
  };
}

function rendererErrorDetails(
  request: RendererErrorReportRequest
): Record<string, string | null> {
  return {
    source: request.source,
    errorName: request.errorName ?? null,
    stack: request.stack ?? null,
    componentStack: request.componentStack ?? null
  };
}

async function countCrashDumpFiles(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      count += await countCrashDumpFiles(entryPath);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dmp")) {
      count += 1;
    }
  }
  return count;
}

function sanitizeDiagnosticText(
  text: string,
  summary: DiagnosticsSummary
): string {
  const replacements = new Map<string, string>();
  replacements.set(summary.storage.root, "<CMM_USER_DATA>");
  for (const [name, directory] of Object.entries(summary.storage.directories)) {
    replacements.set(directory, `<CMM_${name.toUpperCase()}>`);
  }
  if (summary.discovery.steamPath) {
    replacements.set(summary.discovery.steamPath, "<STEAM>");
  }
  if (summary.discovery.gameInstallPath) {
    replacements.set(summary.discovery.gameInstallPath, "<CLAWED_INSTALL>");
  }
  if (summary.discovery.gameExecutable) {
    replacements.set(summary.discovery.gameExecutable, "<CLAWED_EXECUTABLE>");
  }

  let sanitized = text;
  for (const [rawPath, replacement] of [...replacements].sort(
    (left, right) => right[0].length - left[0].length
  )) {
    sanitized = sanitized.split(rawPath).join(replacement);
  }

  return sanitized
    .replace(/[A-Za-z]:\\\\Users\\\\[^"\r\n]+/g, "%USERPROFILE%")
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n"]+/g, "%USERPROFILE%");
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}
