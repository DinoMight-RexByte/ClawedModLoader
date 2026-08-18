import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SteamPathCandidate {
  path: string;
  source: "environment" | "registry" | "commonPath";
}

export interface SteamPathProvider {
  findSteamPaths(): Promise<SteamPathCandidate[]>;
}

async function directoryExists(directory: string): Promise<boolean> {
  return access(directory)
    .then(() => true)
    .catch(() => false);
}

function uniqueCandidates(candidates: SteamPathCandidate[]): SteamPathCandidate[] {
  const seen = new Set<string>();
  const unique: SteamPathCandidate[] = [];

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate.path).toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(candidate);
  }

  return unique;
}

export class WindowsSteamPathProvider implements SteamPathProvider {
  async findSteamPaths(): Promise<SteamPathCandidate[]> {
    const candidates = [
      ...this.getEnvironmentCandidates(),
      ...(await this.getRegistryCandidates()),
      ...this.getCommonPathCandidates()
    ];

    const existingCandidates = await Promise.all(
      candidates.map(async (candidate) =>
        (await directoryExists(candidate.path)) ? candidate : null
      )
    );

    return uniqueCandidates(
      existingCandidates.filter(
        (candidate): candidate is SteamPathCandidate => candidate !== null
      )
    );
  }

  private getEnvironmentCandidates(): SteamPathCandidate[] {
    const steamPath = process.env.STEAM_PATH ?? process.env.STEAM_DIR;

    return steamPath
      ? [
          {
            path: steamPath,
            source: "environment"
          }
        ]
      : [];
  }

  private getCommonPathCandidates(): SteamPathCandidate[] {
    const candidates = [
      process.env.ProgramFiles
        ? path.join(process.env.ProgramFiles, "Steam")
        : null,
      process.env["ProgramFiles(x86)"]
        ? path.join(process.env["ProgramFiles(x86)"], "Steam")
        : null,
      path.join(os.homedir(), "AppData", "Local", "Steam")
    ];

    return candidates
      .filter((candidate): candidate is string => candidate !== null)
      .map((candidate) => ({
        path: candidate,
        source: "commonPath"
      }));
  }

  private async getRegistryCandidates(): Promise<SteamPathCandidate[]> {
    if (process.platform !== "win32") {
      return [];
    }

    const script = `
$paths = @(
  'HKCU:\\Software\\Valve\\Steam',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
  'HKLM:\\SOFTWARE\\Valve\\Steam'
)
$values = foreach ($path in $paths) {
  $item = Get-ItemProperty -Path $path -ErrorAction SilentlyContinue
  if ($null -ne $item) {
    if ($item.SteamPath) { $item.SteamPath }
    if ($item.InstallPath) { $item.InstallPath }
  }
}
$values | Where-Object { $_ } | Select-Object -Unique
`;

    try {
      const { stdout } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", script],
        { windowsHide: true }
      );

      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((candidate) => ({
          path: candidate,
          source: "registry" as const
        }));
    } catch {
      return [];
    }
  }
}
