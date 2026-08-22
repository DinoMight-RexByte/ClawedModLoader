import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import type {
  DiagnosticError,
  GameDiscoveryStatus,
  LogCategory,
  LaunchMode,
  LifecycleState
} from "../../shared/contracts/app";
import type { StorageServiceContract } from "../../shared/contracts/services";

export interface LifecycleLogEvent {
  category: DiagnosticError["category"] | LogCategory;
  action: string;
  result: "ok" | "blocked" | "failed" | "requested";
  discoveryStatus?: GameDiscoveryStatus;
  launchMode?: LaunchMode;
  lifecycleState?: LifecycleState;
  processId?: number;
  errorCode?: string;
  message?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface LifecycleLogger {
  log(event: LifecycleLogEvent): Promise<void>;
}

export class JsonlLifecycleLogger implements LifecycleLogger {
  constructor(private readonly storageService: StorageServiceContract) {}

  async log(event: LifecycleLogEvent): Promise<void> {
    const layout = await this.storageService.getLayout();
    await writeLifecycleLogEvent(layout.directories.logs, event);
  }
}

export class NullLifecycleLogger implements LifecycleLogger {
  async log(): Promise<void> {
    return Promise.resolve();
  }
}

function normalizeLogCategory(
  category: LifecycleLogEvent["category"]
): LogCategory {
  const serviceMap: Record<DiagnosticError["category"], LogCategory> = {
    gameLocator: "STEAM",
    processSupervisor: "PROCESS",
    launchService: "APP",
    settings: "APP",
    packageService: "PACKAGE",
    externalImportService: "PACKAGE",
    modLibraryService: "PACKAGE",
    profileService: "PROFILE",
    loadOrderService: "PROFILE",
    deploymentService: "DEPLOYMENT",
    runtimeManager: "RUNTIME",
    assetRegistryService: "PACKAGE",
    unrealMappingsService: "RUNTIME",
    security: "SECURITY"
  };

  return category in serviceMap
    ? serviceMap[category as DiagnosticError["category"]]
    : (category as LogCategory);
}

const lifecycleLogFileName = "lifecycle.jsonl";
const maxLifecycleLogBytes = 256 * 1024;
const retainedLifecycleLogFiles = 3;

export async function writeLifecycleLogEvent(
  logDirectory: string,
  event: LifecycleLogEvent
): Promise<void> {
  const logPath = path.join(logDirectory, lifecycleLogFileName);
  await mkdir(path.dirname(logPath), { recursive: true });
  await rotateLifecycleLogIfNeeded(logPath);
  await appendFile(logPath, `${JSON.stringify(toSafeLifecycleEvent(event))}\n`);
}

export function writeLifecycleLogEventSync(
  logDirectory: string,
  event: LifecycleLogEvent
): void {
  const logPath = path.join(logDirectory, lifecycleLogFileName);
  mkdirSync(path.dirname(logPath), { recursive: true });
  rotateLifecycleLogIfNeededSync(logPath);
  appendFileSync(logPath, `${JSON.stringify(toSafeLifecycleEvent(event))}\n`);
}

async function rotateLifecycleLogIfNeeded(logPath: string): Promise<void> {
  const size = await stat(logPath)
    .then((file) => file.size)
    .catch(() => 0);
  if (size < maxLifecycleLogBytes) {
    return;
  }

  await rm(`${logPath}.${retainedLifecycleLogFiles}`, { force: true }).catch(
    () => undefined
  );
  for (let index = retainedLifecycleLogFiles - 1; index >= 1; index -= 1) {
    await rename(`${logPath}.${index}`, `${logPath}.${index + 1}`).catch(
      () => undefined
    );
  }
  await rename(logPath, `${logPath}.1`).catch(() => undefined);
}

function rotateLifecycleLogIfNeededSync(logPath: string): void {
  const size = fileSizeSync(logPath);
  if (size < maxLifecycleLogBytes) {
    return;
  }

  rmSync(`${logPath}.${retainedLifecycleLogFiles}`, { force: true });
  for (let index = retainedLifecycleLogFiles - 1; index >= 1; index -= 1) {
    renameFileSync(`${logPath}.${index}`, `${logPath}.${index + 1}`);
  }
  renameFileSync(logPath, `${logPath}.1`);
}

function toSafeLifecycleEvent(event: LifecycleLogEvent) {
  return {
    ...event,
    category: normalizeLogCategory(event.category),
    occurredAt: new Date().toISOString()
  };
}

function fileSizeSync(logPath: string): number {
  try {
    return statSync(logPath).size;
  } catch {
    return 0;
  }
}

function renameFileSync(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    return;
  }
}
