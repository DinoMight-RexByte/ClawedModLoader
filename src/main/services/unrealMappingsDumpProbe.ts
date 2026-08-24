export const UNREAL_MAPPINGS_DUMP_MOD_ID = "CMMUnrealMappingsDump";

export function unrealMappingsDumpLua(): string {
  return [
    `local marker = "[${UNREAL_MAPPINGS_DUMP_MOD_ID}] "`,
    "local function cmm_log(message)",
    "    print(marker .. message)",
    "end",
    'cmm_log("Lua startup marker from Unreal mappings dump")',
    "ExecuteInGameThread(function()",
    '    cmm_log("DumpUSMAP requested")',
    "    local ok, err = pcall(function() DumpUSMAP() end)",
    '    cmm_log("DumpUSMAP completed: " .. tostring(ok) .. " " .. tostring(err))',
    "end)"
  ].join("\n");
}

export function unrealMappingsDumpMarkers(): string[] {
  return [
    `Starting Lua mod '${UNREAL_MAPPINGS_DUMP_MOD_ID}'`,
    `[${UNREAL_MAPPINGS_DUMP_MOD_ID}] Lua startup marker from Unreal mappings dump`,
    `[${UNREAL_MAPPINGS_DUMP_MOD_ID}] DumpUSMAP requested`
  ];
}
