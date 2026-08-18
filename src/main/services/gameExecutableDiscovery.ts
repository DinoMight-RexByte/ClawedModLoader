import { readdir, stat } from "node:fs/promises";
import path from "node:path";

interface ExecutableCandidate {
  path: string;
  score: number;
}

const excludedExecutableNameParts = [
  "crashreport",
  "installer",
  "prereq",
  "redist",
  "steam"
];

function scoreExecutable(filePath: string): number | null {
  const fileName = path.basename(filePath).toLowerCase();

  if (!fileName.endsWith(".exe")) {
    return null;
  }

  if (excludedExecutableNameParts.some((part) => fileName.includes(part))) {
    return null;
  }

  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const inWin64Binaries = normalized.includes("/binaries/win64/");
  const isShipping = fileName.includes("shipping");

  if (inWin64Binaries && fileName.endsWith("-win64-shipping.exe")) {
    return 100;
  }

  if (inWin64Binaries && isShipping) {
    return 90;
  }

  if (normalized.includes("/binaries/") && isShipping) {
    return 70;
  }

  if (inWin64Binaries) {
    return 50;
  }

  return null;
}

async function collectExecutableCandidates(
  directory: string,
  depth: number,
  candidates: ExecutableCandidate[]
): Promise<void> {
  if (depth < 0) {
    return;
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await collectExecutableCandidates(entryPath, depth - 1, candidates);
        return;
      }

      if (!entry.isFile()) {
        return;
      }

      const score = scoreExecutable(entryPath);
      if (score !== null) {
        candidates.push({ path: entryPath, score });
      }
    })
  );
}

export async function findUnrealShippingExecutable(
  installDirectory: string
): Promise<string | null> {
  const installStat = await stat(installDirectory).catch(() => null);
  if (!installStat?.isDirectory()) {
    return null;
  }

  const candidates: ExecutableCandidate[] = [];
  await collectExecutableCandidates(installDirectory, 6, candidates);

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (left.path.length !== right.path.length) {
      return left.path.length - right.path.length;
    }

    return left.path.localeCompare(right.path);
  });

  return candidates[0]?.path ?? null;
}
