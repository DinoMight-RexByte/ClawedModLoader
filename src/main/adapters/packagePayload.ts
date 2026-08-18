import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import type { InstalledModManifestRecord } from "../../shared/contracts/app";
import type { PlannedDeploymentFile } from "../../shared/contracts/deployment";
import { hashFileSha256 } from "../services/clawedModPackageService";
import { isPathInside } from "../services/packagePaths";

export interface PayloadFile {
  absolutePath: string;
  payloadRelativePath: string;
}

export async function listModPayloadFiles(
  record: InstalledModManifestRecord
): Promise<PayloadFile[]> {
  const payloadRoot = path.join(record.mod.installPath, "payload");
  const files = await listFilesRecursive(payloadRoot);
  return files.map((absolutePath) => ({
    absolutePath,
    payloadRelativePath: path.relative(payloadRoot, absolutePath)
  }));
}

export async function stagePayloadFile({
  sourcePath,
  stagedGameRoot,
  targetRelativePath
}: {
  sourcePath: string;
  stagedGameRoot: string;
  targetRelativePath: string;
}): Promise<PlannedDeploymentFile> {
  const stagedPath = path.join(stagedGameRoot, targetRelativePath);
  await mkdir(path.dirname(stagedPath), { recursive: true });
  await copyFile(sourcePath, stagedPath);

  return {
    sourcePath: stagedPath,
    targetRelativePath,
    sha256: await hashFileSha256(stagedPath)
  };
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const entryInfo = await lstat(entryPath);
    if (!isPathInside(root, entryPath) || entryInfo.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}
