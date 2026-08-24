import path from "node:path";

export const PACKAGED_RUNTIME_VALIDATION_MOD_ID =
  "CMMPackagedRuntimeValidation";

export function packagedRuntimeValidationLua(): string {
  return [
    `local marker = "[${PACKAGED_RUNTIME_VALIDATION_MOD_ID}] "`,
    "local function cmm_log(message)",
    "    print(marker .. message)",
    "end",
    'cmm_log("Lua startup marker from packaged UE4SS runtime validation")',
    "ExecuteInGameThread(function()",
    '    cmm_log("ExecuteInGameThread callback marker")',
    '    local engine = FindFirstOf("GameEngine")',
    '    cmm_log("FindFirstOf(GameEngine) completed: " .. tostring(engine ~= nil))',
    "end)"
  ].join("\n");
}

export function packagedRuntimeValidationMarkers(): string[] {
  return [
    `Starting Lua mod '${PACKAGED_RUNTIME_VALIDATION_MOD_ID}'`,
    `[${PACKAGED_RUNTIME_VALIDATION_MOD_ID}] Lua startup marker from packaged UE4SS runtime validation`,
    `[${PACKAGED_RUNTIME_VALIDATION_MOD_ID}] ExecuteInGameThread callback marker`,
    `[${PACKAGED_RUNTIME_VALIDATION_MOD_ID}] FindFirstOf(GameEngine) completed: true`
  ];
}

export function getUe4ssLogPath(
  gameInstallPath: string,
  configuration: Record<string, unknown>
): string {
  const runtimeModsRelativePath =
    typeof configuration.runtimeModsRelativePath === "string"
      ? path.normalize(configuration.runtimeModsRelativePath)
      : "Mods";
  const runtimeTargetRelativePath =
    typeof configuration.runtimeTargetRelativePath === "string"
      ? path.normalize(configuration.runtimeTargetRelativePath)
      : "";
  const runtimeSubdirectory = path.dirname(runtimeModsRelativePath);
  const logRelativePath =
    runtimeSubdirectory === "."
      ? "UE4SS.log"
      : path.join(runtimeSubdirectory, "UE4SS.log");

  return path.join(gameInstallPath, runtimeTargetRelativePath, logRelativePath);
}
