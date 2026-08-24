import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  BackupRestoreResultSchema,
  DeploymentManifestSchema,
  type BackupRestoreResult,
  type DeploymentManifest,
  type ModProblem,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  BackupServiceContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import { hashFileSha256 } from "./clawedModPackageService";
import { cleanupManifestGeneratedArtifacts } from "./deploymentManifestCleanup";
import { rmWithRetry } from "./fileRemoval";
import type { LifecycleLogger } from "./lifecycleLogger";
import { modProblem } from "./packageProblems";
import { isPathInside } from "./packagePaths";
import { atomicWriteJson } from "./profileService";

export class LocalBackupService implements BackupServiceContract {
  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly logger?: LifecycleLogger
  ) {}

  getStatus(): ServiceStatus {
    return {
      id: "backupService",
      label: "Backup Service",
      status: "ready",
      detail: "Counts backups referenced by deployment manifests."
    };
  }

  async countTrackedBackups(): Promise<number> {
    const manifests = await this.readDeploymentManifests();
    return new Set(
      manifests.flatMap((manifest) =>
        manifest.backups.map((backup) => backup.backupPath)
      )
    ).size;
  }

  async restoreCmmChanges(): Promise<BackupRestoreResult> {
    const manifest = await this.readCurrentManifest();
    if (!manifest) {
      return BackupRestoreResultSchema.parse({
        status: "ok",
        restoredFiles: [],
        removedFiles: [],
        problems: [
          modProblem(
            "info",
            "NO_ACTIVE_DEPLOYMENT",
            "There are no active CMM deployment changes to restore."
          )
        ]
      });
    }

    const restoredFiles: string[] = [];
    const removedFiles: string[] = [];
    const problems: ModProblem[] = [];

    for (const file of [...manifest.filesCreated].reverse()) {
      if (!isPathInside(manifest.gameInstallPath, file.absolutePath)) {
        problems.push(
          modProblem(
            "error",
            "OWNED_FILE_OUTSIDE_GAME",
            `CMM blocked removal of ${file.relativePath} because it is outside the game installation.`
          )
        );
        continue;
      }

      const currentHash = (await pathExists(file.absolutePath))
        ? await hashFileSha256(file.absolutePath)
        : null;
      if (currentHash && file.sha256 && currentHash !== file.sha256) {
        problems.push(
          modProblem(
            "warning",
            "OWNED_FILE_CHANGED",
            `${file.relativePath} changed after CMM deployed it, so it was preserved.`
          )
        );
        continue;
      }

      await rmWithRetry(file.absolutePath, { force: true });
      removedFiles.push(file.relativePath);
    }

    for (const backup of [...manifest.backups].reverse()) {
      if (!isPathInside(manifest.gameInstallPath, backup.originalPath)) {
        problems.push(
          modProblem(
            "error",
            "BACKUP_TARGET_OUTSIDE_GAME",
            `CMM blocked restore of ${backup.relativePath} because the target is outside the game installation.`
          )
        );
        continue;
      }

      const deployedRecord = manifest.filesModified.find(
        (file) => file.relativePath === backup.relativePath
      );
      const currentHash = (await pathExists(backup.originalPath))
        ? await hashFileSha256(backup.originalPath)
        : null;
      if (
        currentHash &&
        deployedRecord?.sha256 &&
        currentHash !== deployedRecord.sha256
      ) {
        problems.push(
          modProblem(
            "warning",
            "MODIFIED_FILE_CHANGED",
            `${backup.relativePath} changed after CMM deployed it, so the backup was not restored over it.`
          )
        );
        continue;
      }

      if ((await hashFileSha256(backup.backupPath)) !== backup.sha256) {
        problems.push(
          modProblem(
            "error",
            "BACKUP_HASH_MISMATCH",
            `${backup.relativePath} backup bytes no longer match the deployment record.`
          )
        );
        continue;
      }

      await mkdir(path.dirname(backup.originalPath), { recursive: true });
      await copyFile(backup.backupPath, backup.originalPath);
      restoredFiles.push(backup.relativePath);
    }

    const cleanup = await cleanupManifestGeneratedArtifacts(manifest);
    removedFiles.push(...cleanup.removedRuntimeGeneratedFiles);
    problems.push(...cleanup.problems);

    if (problems.length > 0) {
      const status = problems.some((problem) => problem.severity === "error")
        ? "failed"
        : "blocked";
      await this.logger?.log({
        category: "DEPLOYMENT",
        action: "restore_cmm_changes",
        result: status === "failed" ? "failed" : "blocked"
      });
      return BackupRestoreResultSchema.parse({
        status,
        restoredFiles,
        removedFiles,
        problems
      });
    }

    await this.markManifestRolledBack(manifest);
    await rm(await this.getCurrentManifestPath(), { force: true });
    await this.logger?.log({
      category: "DEPLOYMENT",
      action: "restore_cmm_changes",
      result: problems.length > 0 ? "blocked" : "ok"
    });

    return BackupRestoreResultSchema.parse({
      status: "ok",
      restoredFiles,
      removedFiles,
      problems
    });
  }

  private async readDeploymentManifests(): Promise<DeploymentManifest[]> {
    const layout = await this.storageService.getLayout();
    const deploymentsRoot = path.join(layout.directories.runtime, "deployments");
    const manifests: DeploymentManifest[] = [];

    const currentManifest = await readManifest(
      path.join(deploymentsRoot, "current-deployment.json")
    );
    if (currentManifest) {
      manifests.push(currentManifest);
    }

    const entries = await readdir(deploymentsRoot, { withFileTypes: true }).catch(
      () => []
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifest = await readManifest(
        path.join(deploymentsRoot, entry.name, "manifest.json")
      );
      if (manifest) {
        manifests.push(manifest);
      }
    }

    return manifests;
  }

  private async readCurrentManifest(): Promise<DeploymentManifest | null> {
    return readManifest(await this.getCurrentManifestPath());
  }

  private async getCurrentManifestPath(): Promise<string> {
    const layout = await this.storageService.getLayout();
    return path.join(
      layout.directories.runtime,
      "deployments",
      "current-deployment.json"
    );
  }

  private async markManifestRolledBack(
    manifest: DeploymentManifest
  ): Promise<void> {
    const updatedManifest = DeploymentManifestSchema.parse({
      ...manifest,
      lastVerifiedState: "rolledBack"
    });
    const layout = await this.storageService.getLayout();
    await atomicWriteJson(
      path.join(
        layout.directories.runtime,
        "deployments",
        manifest.id,
        "manifest.json"
      ),
      updatedManifest
    );
  }
}

async function readManifest(
  manifestPath: string
): Promise<DeploymentManifest | null> {
  try {
    return DeploymentManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8"))
    );
  } catch {
    return null;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}
