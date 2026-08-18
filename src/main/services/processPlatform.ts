import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { shell } from "electron";

const execFileAsync = promisify(execFile);

export interface GameProcessInfo {
  processId: number;
  name: string;
  executablePath: string | null;
  commandLine: string | null;
}

export interface ProcessPlatform {
  listProcesses(): Promise<GameProcessInfo[]>;
  findProcessByExecutable(gameExecutable: string): Promise<GameProcessInfo | null>;
  isProcessRunning(processId: number): Promise<boolean>;
  requestGracefulClose(processId: number): Promise<boolean>;
  forceTerminate(processId: number): Promise<boolean>;
  launchSteamApp(appId: string): Promise<void>;
}

interface RawWindowsProcess {
  ProcessId?: number;
  Name?: string;
  ExecutablePath?: string;
  CommandLine?: string;
}

function toProcessInfo(raw: RawWindowsProcess): GameProcessInfo | null {
  if (!raw.ProcessId || !raw.Name) {
    return null;
  }

  return {
    processId: raw.ProcessId,
    name: raw.Name,
    executablePath: raw.ExecutablePath ? path.normalize(raw.ExecutablePath) : null,
    commandLine: raw.CommandLine ?? null
  };
}

export class WindowsProcessPlatform implements ProcessPlatform {
  async findProcessByExecutable(
    gameExecutable: string
  ): Promise<GameProcessInfo | null> {
    if (process.platform !== "win32") {
      return null;
    }

    const executableName = path.basename(gameExecutable);
    const script = `
Get-CimInstance Win32_Process -Filter "Name = '${wmiString(executableName)}'" |
  Select-Object ProcessId,Name,ExecutablePath,CommandLine |
  ConvertTo-Json -Compress
`;

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { maxBuffer: 1024 * 1024, windowsHide: true }
    );
    const trimmed = stdout.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = JSON.parse(trimmed) as RawWindowsProcess[] | RawWindowsProcess;
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    return rows.map(toProcessInfo).find(
      (processInfo): processInfo is GameProcessInfo =>
        processInfo !== null && processMatchesExecutable(processInfo, gameExecutable)
    ) ?? null;
  }

  async isProcessRunning(processId: number): Promise<boolean> {
    try {
      process.kill(processId, 0);
      return true;
    } catch (error) {
      return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        String((error as { code?: unknown }).code) === "EPERM"
      );
    }
  }

  async listProcesses(): Promise<GameProcessInfo[]> {
    if (process.platform !== "win32") {
      return [];
    }

    const script = `
Get-CimInstance Win32_Process |
  Select-Object ProcessId,Name,ExecutablePath,CommandLine |
  ConvertTo-Json -Compress
`;

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { maxBuffer: 10 * 1024 * 1024, windowsHide: true }
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }

    const parsed = JSON.parse(trimmed) as RawWindowsProcess[] | RawWindowsProcess;
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    return rows
      .map(toProcessInfo)
      .filter((processInfo): processInfo is GameProcessInfo => processInfo !== null);
  }

  async requestGracefulClose(processId: number): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }

    const script = `
$signature = @"
using System;
using System.Runtime.InteropServices;
public class CmmWindowTools {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessage(IntPtr hWnd, UInt32 Msg, IntPtr wParam, IntPtr lParam);
}
"@
Add-Type $signature -ErrorAction SilentlyContinue
$targetPid = ${processId}
$wmClose = 0x0010
$closed = 0
$callback = [CmmWindowTools+EnumWindowsProc]{
  param([IntPtr] $hWnd, [IntPtr] $lParam)
  [uint32] $windowPid = 0
  [CmmWindowTools]::GetWindowThreadProcessId($hWnd, [ref] $windowPid) | Out-Null
  if ($windowPid -eq $targetPid -and [CmmWindowTools]::IsWindowVisible($hWnd)) {
    [CmmWindowTools]::SendMessage($hWnd, $wmClose, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    $script:closed += 1
  }
  return $true
}
[CmmWindowTools]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$closed
`;

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );

    return Number.parseInt(stdout.trim(), 10) > 0;
  }

  async forceTerminate(processId: number): Promise<boolean> {
    if (process.platform !== "win32") {
      return false;
    }

    await execFileAsync("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
      windowsHide: true
    });
    return true;
  }

  async launchSteamApp(appId: string): Promise<void> {
    await shell.openExternal(`steam://run/${appId}`);
  }
}

function processMatchesExecutable(
  processInfo: GameProcessInfo,
  gameExecutable: string
): boolean {
  if (processInfo.name.toLowerCase() === "steam.exe") {
    return false;
  }

  const executableName = path.basename(gameExecutable).toLowerCase();
  const normalizedGameExecutable = normalizeForCompare(gameExecutable);

  if (
    processInfo.executablePath &&
    normalizeForCompare(processInfo.executablePath) === normalizedGameExecutable
  ) {
    return true;
  }

  if (processInfo.name.toLowerCase() === executableName) {
    return true;
  }

  return (
    processInfo.commandLine?.toLowerCase().includes(executableName) ?? false
  );
}

function normalizeForCompare(targetPath: string): string {
  return path.normalize(targetPath).toLowerCase();
}

function wmiString(value: string): string {
  return value.replaceAll("'", "''");
}
