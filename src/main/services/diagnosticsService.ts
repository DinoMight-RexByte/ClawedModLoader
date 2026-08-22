import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";

import type { DeploymentAdapterDescriptor } from "../../shared/contracts/deployment";
import {
  DiagnosticReportSchema,
  DiagnosticsSummarySchema,
  LogOpenResultSchema,
  type CreatorAssetRegistrySnapshot,
  type DiagnosticReport,
  type DiagnosticsSummary,
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
import { modProblem } from "./packageProblems";
import type { MainServiceDependencies } from "./serviceRegistry";

export class LocalDiagnosticsService implements DiagnosticsServiceContract {
  constructor(
    private readonly dependencies: MainServiceDependencies,
    private readonly storageService: StorageServiceContract,
    private readonly adapters: DeploymentAdapterDescriptor[],
    private readonly gameAdapter: ClawedGameAdapter = new ClawedGameAdapter(),
    private readonly logger: LifecycleLogger = new NullLifecycleLogger()
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
      this.dependencies.deploymentService.getSnapshot()
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
      enabledMods: modLibrary.totals.enabled,
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
      this.dependencies.deploymentService.getSnapshot(),
      this.getLogsSummary(),
      this.dependencies.assetRegistryService.getSnapshot().catch(() => null)
    ]);
    const gameFingerprint = await this.gameAdapter.getFingerprint(
      discovery,
      deployment.activeManifest?.gameFingerprint ?? null,
      { mode: "quick" }
    );
    const runtime = await this.dependencies.runtimeManager.getRuntimeSnapshot(
      gameFingerprint.steamBuildId,
      gameFingerprint.fingerprintSha256
    );
    const services = [
      this.dependencies.gameLocator.getStatus(),
      this.dependencies.processSupervisor.getStatus(),
      this.dependencies.launchService.getStatus(),
      this.dependencies.deploymentService.getStatus(),
      this.dependencies.packagedRuntimeValidationService.getStatus(),
      this.dependencies.runtimeManager.getStatus(),
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
      runtime,
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
