import crypto from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";
import {
  currentClawedSteamBuildId,
  generatedCreatorSupportMetadata,
  generatedPackageIdentity,
  generatedSupportedSteamBuilds
} from "./clawedBuildMetadata.mjs";

const modId = "SaveBackupRotator";
const modName = "Save Backup Rotator";
const version = "0.1.0-prototype.20260824";
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "Save backup package generated against the currently detected Clawed build; save-hook behavior has not been live validated.";
const releaseRoot = path.resolve("release");
const outputRoot = path.resolve(
  process.env.CMM_SAVE_BACKUP_OUTPUT_DIR ??
    path.join(releaseRoot, "prototype-mods")
);
const payloadPath = `payload/Mods/${modId}/Scripts/main.lua`;
const lua = String.raw`local marker = "[SaveBackupRotator] "
local version = "0.1.0-prototype.20260824"
local backup_delay_ms = 1500
local max_snapshots = 3
local chunk_size = 131072
local manifest_name = "backup-manifest.tsv"
local backup_root_name = "SaveBackups"
local pending = false
local pending_reason = "startup"
local serial = 0

local function log(event, value)
    print(marker .. event .. "|" .. tostring(value))
end

local function unwrap(value)
    if value == nil then return nil end
    local ok_get, getter = pcall(function() return value.get end)
    if ok_get and getter ~= nil then
        local ok, unwrapped = pcall(function() return value:get() end)
        if ok then return unwrapped end
    end
    return value
end

local function text_value(value)
    value = unwrap(value)
    if value == nil then return nil end
    local value_type = type(value)
    if value_type == "string" or value_type == "number" or value_type == "boolean" then return tostring(value) end
    local ok_string, string_value = pcall(function() return value:ToString() end)
    if ok_string and string_value ~= nil then return tostring(string_value) end
    local ok_name, full_name = pcall(function() return value:GetFullName() end)
    if ok_name and full_name ~= nil then return tostring(full_name) end
    return tostring(value)
end

local function join_path(left, right)
    left = tostring(left or "")
    right = tostring(right or "")
    if left == "" then return right end
    if string.sub(left, -1) == "\\" or string.sub(left, -1) == "/" then return left .. right end
    return left .. "\\" .. right
end

local function safe_name(value)
    value = tostring(value or "")
    if value == "" then return nil end
    if string.find(value, "[/\\:\r\n\t\"<>|]") ~= nil then return nil end
    if value == "." or value == ".." then return nil end
    return value
end

local function cmd_quote(value)
    value = tostring(value or "")
    if value == "" then return nil end
    if string.find(value, "[\"\r\n%%]") ~= nil then return nil end
    return '"' .. value .. '"'
end

local function mkdir(path_value)
    if type(os.execute) ~= "function" then return false, "os_execute_missing" end
    local quoted = cmd_quote(path_value)
    if quoted == nil then return false, "unsafe_path" end
    local ok, _, code = os.execute("mkdir " .. quoted .. " >nul 2>nul")
    if ok == true or ok == 0 or code == 0 then return true, "ok" end
    return false, "mkdir_failed"
end

local function directory_writable(path_value)
    local test_path = join_path(path_value, ".cmm-save-backup-test-" .. tostring(os.time()) .. "-" .. tostring(serial) .. ".tmp")
    local file = io.open(test_path, "wb")
    if file == nil then return false end
    file:write("ok")
    file:close()
    os.remove(test_path)
    return true
end

local function ensure_directory(path_value)
    mkdir(path_value)
    if directory_writable(path_value) then return true end
    return false
end

local function list_files(directory)
    if type(io.popen) ~= "function" then return nil, "io_popen_missing" end
    local quoted = cmd_quote(directory)
    if quoted == nil then return nil, "unsafe_path" end
    local pipe = io.popen("dir /b /a-d " .. quoted .. " 2>nul", "r")
    if pipe == nil then return nil, "dir_failed" end
    local files = {}
    for line in pipe:lines() do
        local name = safe_name(line)
        if name ~= nil then table.insert(files, name) end
    end
    pipe:close()
    table.sort(files)
    return files, nil
end

local function copy_file(source, target)
    local input = io.open(source, "rb")
    if input == nil then return false, "open_source_failed" end
    local output = io.open(target, "wb")
    if output == nil then
        input:close()
        return false, "open_target_failed"
    end
    while true do
        local chunk = input:read(chunk_size)
        if chunk == nil then break end
        output:write(chunk)
    end
    input:close()
    output:close()
    return true, "ok"
end

local function read_manifest(path_value)
    local entries = {}
    local file = io.open(path_value, "rb")
    if file == nil then return entries end
    for line in file:lines() do
        local fields = {}
        for field in string.gmatch(line, "([^\t]+)") do
            table.insert(fields, field)
        end
        if #fields >= 2 then
            local entry = { directory = fields[1], files = {} }
            for index = 2, #fields do
                local name = safe_name(fields[index])
                if name ~= nil then table.insert(entry.files, name) end
            end
            if #entry.files > 0 then table.insert(entries, entry) end
        end
    end
    file:close()
    return entries
end

local function write_manifest(path_value, entries)
    local temp_path = path_value .. ".tmp"
    local file = io.open(temp_path, "wb")
    if file == nil then return false end
    for _, entry in ipairs(entries) do
        file:write(entry.directory)
        for _, name in ipairs(entry.files) do
            file:write("\t")
            file:write(name)
        end
        file:write("\n")
    end
    file:close()
    os.remove(path_value)
    os.rename(temp_path, path_value)
    return true
end

local function prune_entry(entry)
    local removed = 0
    for _, name in ipairs(entry.files) do
        if os.remove(join_path(entry.directory, name)) then removed = removed + 1 end
    end
    os.remove(entry.directory)
    return removed
end

local function local_app_data()
    local value = os.getenv("LOCALAPPDATA")
    if value ~= nil and value ~= "" then return value end
    local profile = os.getenv("USERPROFILE")
    if profile ~= nil and profile ~= "" then return join_path(join_path(profile, "AppData"), "Local") end
    return nil
end

local function save_candidates()
    local root = local_app_data()
    if root == nil then return {} end
    local saved_root = join_path(join_path(root, "Clawed"), "Saved")
    return {
        { save_dir = join_path(saved_root, "SaveGames"), backup_dir = join_path(saved_root, backup_root_name) },
        { save_dir = join_path(saved_root, "Savegames"), backup_dir = join_path(saved_root, backup_root_name) },
        { save_dir = join_path(saved_root, "SaveGame"), backup_dir = join_path(saved_root, backup_root_name) },
        { save_dir = join_path(saved_root, "Savegame"), backup_dir = join_path(saved_root, backup_root_name) }
    }
end

local function find_save_set()
    local first = nil
    local last_error = "not_found"
    for _, candidate in ipairs(save_candidates()) do
        if first == nil then first = candidate end
        local files, err = list_files(candidate.save_dir)
        if files ~= nil and #files > 0 then return candidate.save_dir, candidate.backup_dir, files, nil end
        if err ~= nil then last_error = err end
    end
    if first ~= nil then return first.save_dir, first.backup_dir, {}, last_error end
    return nil, nil, {}, "local_app_data_missing"
end

local function snapshot_name()
    serial = serial + 1
    return "backup-" .. os.date("%Y%m%d-%H%M%S") .. "-" .. string.format("%03d", serial)
end

local function run_backup(reason)
    local save_dir, backup_dir, files, err = find_save_set()
    if save_dir == nil or backup_dir == nil then
        log("backup_skipped", tostring(reason) .. "|reason=" .. tostring(err))
        return
    end
    if #files == 0 then
        log("backup_skipped", tostring(reason) .. "|reason=no_save_files")
        return
    end
    if not ensure_directory(backup_dir) then
        log("backup_failed", tostring(reason) .. "|reason=backup_folder_unwritable")
        return
    end
    local name = snapshot_name()
    local snapshot_dir = join_path(backup_dir, name)
    if not ensure_directory(snapshot_dir) then
        log("backup_failed", tostring(reason) .. "|reason=snapshot_folder_unwritable|snapshot=" .. name)
        return
    end
    local copied = {}
    local failed = 0
    for _, file_name in ipairs(files) do
        local ok, copy_err = copy_file(join_path(save_dir, file_name), join_path(snapshot_dir, file_name))
        if ok then
            table.insert(copied, file_name)
        else
            failed = failed + 1
            log("copy_failed", tostring(reason) .. "|file=" .. tostring(file_name) .. "|reason=" .. tostring(copy_err))
        end
    end
    if #copied == 0 then
        os.remove(snapshot_dir)
        log("backup_failed", tostring(reason) .. "|reason=no_files_copied|failed=" .. tostring(failed))
        return
    end
    local manifest_path = join_path(backup_dir, manifest_name)
    local entries = read_manifest(manifest_path)
    table.insert(entries, { directory = snapshot_dir, files = copied })
    local pruned = 0
    while #entries > max_snapshots do
        pruned = pruned + prune_entry(table.remove(entries, 1))
    end
    local manifest_ok = write_manifest(manifest_path, entries)
    log("backup_created", tostring(reason) .. "|snapshot=" .. name .. "|files=" .. tostring(#copied) .. "|failed=" .. tostring(failed) .. "|retained=" .. tostring(#entries) .. "|pruned=" .. tostring(pruned) .. "|manifest=" .. tostring(manifest_ok))
end

local function flush_backup()
    local reason = pending_reason
    pending = false
    pending_reason = "idle"
    local ok, err = pcall(function() run_backup(reason) end)
    if not ok then log("error", tostring(reason) .. "|" .. tostring(err)) end
end

local function queue_backup(reason)
    pending_reason = tostring(reason or "save")
    if pending then
        log("trigger_debounced", pending_reason)
        return
    end
    pending = true
    log("trigger", pending_reason)
    if type(ExecuteWithDelay) == "function" then
        ExecuteWithDelay(backup_delay_ms, flush_backup)
    else
        flush_backup()
    end
end

local function hook_callback(label)
    return function(...)
        queue_backup(label)
    end
end

local registered = {}

local function register_hook(label, hook_name, script_post)
    if registered[label] then return end
    if type(RegisterHook) ~= "function" then
        log("hook_register", label .. "|false|RegisterHook_missing")
        return
    end
    local ok, pre_id, post_id
    if script_post then
        ok, pre_id, post_id = pcall(function() return RegisterHook(hook_name, function() end, hook_callback(label)) end)
    else
        ok, pre_id, post_id = pcall(function() return RegisterHook(hook_name, hook_callback(label)) end)
    end
    if ok then registered[label] = true end
    log("hook_register", label .. "|" .. tostring(ok) .. "|" .. tostring(pre_id) .. "|" .. tostring(post_id))
end

local function register_hooks()
    register_hook("Engine_SaveGameToSlot", "/Script/Engine.GameplayStatics:SaveGameToSlot", true)
    register_hook("Engine_AsyncSaveGameToSlot", "/Script/Engine.AsyncActionHandleSaveGame:AsyncSaveGameToSlot", true)
    register_hook("EMS_SaveCustom", "/Script/EasyMultiSave.EMSFunctionLibrary:SaveCustom", true)
    register_hook("EMS_AsyncSaveActors", "/Script/EasyMultiSave.EMSAsyncSaveGame:AsyncSaveActors", true)
    register_hook("BP_SaveGameManager_SaveGame", "/Game/MenuSystemPro/Blueprints/SaveGame/BP_SaveGameManager.BP_SaveGameManager_C:SaveGame", false)
    register_hook("BP_SaveGameInstanceActor_SaveGame", "/Game/MenuSystemPro/Blueprints/SaveGame/BP_SaveGameInstanceActor.BP_SaveGameInstanceActor_C:SaveGame", false)
    register_hook("BP_SaveGameInstanceActor_OnSaveGameActors", "/Game/MenuSystemPro/Blueprints/SaveGame/BP_SaveGameInstanceActor.BP_SaveGameInstanceActor_C:OnSaveGameActors", false)
end

local function register_console()
    if type(RegisterConsoleCommandHandler) ~= "function" then
        log("console_command", "cmm_backup_saves|api_missing")
        return
    end
    local ok, err = pcall(function()
        RegisterConsoleCommandHandler("cmm_backup_saves", function()
            queue_backup("console")
            return true
        end)
    end)
    log("console_command", "cmm_backup_saves|registered=" .. tostring(ok) .. "|" .. tostring(err))
end

log("startup", "version=" .. version .. "|delay_ms=" .. tostring(backup_delay_ms) .. "|max_snapshots=" .. tostring(max_snapshots))
register_hooks()
register_console()
if type(ExecuteWithDelay) == "function" then
    ExecuteWithDelay(8000, register_hooks)
end
`;
const readme = [
  `# ${modName}`,
  "",
  "Prototype UE4SS package that listens for Clawed save events and copies the current save files into a rotating backup folder.",
  "",
  "Behavior:",
  "",
  "- Hooks Unreal `GameplayStatics:SaveGameToSlot`, `AsyncActionHandleSaveGame:AsyncSaveGameToSlot`, Easy Multi Save `SaveCustom`/`AsyncSaveActors`, and Clawed save Blueprint entry points when they are present.",
  "- Debounces clustered save hooks and waits 1.5 seconds before copying so the game's save write can settle.",
  "- Copies regular files from `%LOCALAPPDATA%\\Clawed\\Saved\\SaveGames` into `%LOCALAPPDATA%\\Clawed\\Saved\\SaveBackups\\backup-YYYYMMDD-HHMMSS-NNN`.",
  "- Keeps the latest three backup snapshots and prunes only files listed in its own `SaveBackups\\backup-manifest.tsv`.",
  "- Does not delete, rename, overwrite, or edit files in the active `SaveGames` folder.",
  "- Registers `cmm_backup_saves` as a manual console command when UE4SS exposes console command handlers.",
  "- Requires the standard UE4SS Windows Lua `io`, `os`, and `io.popen` libraries for directory creation/listing and file copying.",
  "",
  "Expected UE4SS markers include:",
  "",
  "- `[SaveBackupRotator] startup|...`",
  "- `[SaveBackupRotator] hook_register|...`",
  "- `[SaveBackupRotator] trigger|...`",
  "- `[SaveBackupRotator] trigger_debounced|...`",
  "- `[SaveBackupRotator] backup_created|...`",
  "- `[SaveBackupRotator] backup_skipped|...`",
  "- `[SaveBackupRotator] backup_failed|...`",
  "- `[SaveBackupRotator] copy_failed|...`",
  "",
  "Safety boundaries:",
  "",
  "- Packaged only as a normal `.clawedmod` with `loader: \"ue4ss\"`.",
  "- Does not mutate save contents, inventory, score, quests, world items, player state, or multiplayer authority.",
  "- Does not patch Steam, EOS, executable files, anti-cheat, game DLLs, cooked Blueprint assets, GameMode assets, or PlayerController assets.",
  "- Does not remove original game saves; retention applies only to package-created backup snapshots.",
  "- Runtime hook behavior remains unvalidated until tested in a real Clawed session with the matching UE4SS runtime."
].join("\n");
const manifest = {
  schemaVersion: 1,
  id: modId,
  name: modName,
  version,
  author: "Clawed Mod Manager",
  description:
    "UE4SS save-event backup prototype that copies Clawed save files into a separate three-snapshot rotating backup folder.",
  game: "clawed",
  loader: "ue4ss",
  dependencies: [],
  conflicts: [],
  loadAfter: [],
  loadBefore: [],
  packageIdentity: generatedPackageIdentity(modId),
  creatorAssets: generatedCreatorSupportMetadata({
    modId,
    modName,
    version,
    payloadPath,
    buildId: steamBuildId,
    buildNotes: steamBuildNotes,
    tags: ["ue4ss_runtime", "lua", "save_backup"]
  })
};

const packagePaths = [];
packagePaths.push(await writePackage(outputRoot));
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const unpackedOutputRoot = path.resolve(
  process.env.CMM_SAVE_BACKUP_UNPACKED_OUTPUT_DIR ??
    path.join(unpackedRoot, "prototype-mods")
);
if (process.env.CMM_SAVE_BACKUP_SKIP_UNPACKED !== "1" && await exists(unpackedRoot)) {
  packagePaths.push(await writePackage(unpackedOutputRoot));
}

for (const packagePath of packagePaths) {
  process.stdout.write(`${packagePath}\n`);
}

async function writePackage(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const zip = new JSZip();
  const checksums = {
    schemaVersion: 1,
    files: [
      {
        path: payloadPath,
        sha256: sha256Text(lua)
      },
      {
        path: "README.md",
        sha256: sha256Text(`${readme}\n`)
      }
    ]
  };
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  zip.file(payloadPath, lua);
  zip.file("README.md", `${readme}\n`);
  zip.file("checksums.json", `${JSON.stringify(checksums, null, 2)}\n`);
  const packagePath = path.join(outputDirectory, `${modId}.clawedmod`);
  await writeFile(packagePath, await zip.generateAsync({ type: "nodebuffer" }));
  await writeFile(path.join(outputDirectory, `${modId}.README.md`), `${readme}\n`);
  const summary = {
    result: "GENERATED",
    modId,
    modName,
    version,
    loader: "ue4ss",
    packagePath,
    packageSha256: await sha256File(packagePath),
    payloadPath,
    supportedSteamBuilds: generatedSupportedSteamBuilds(
      steamBuildId,
      steamBuildNotes
    ),
    backupBehavior: [
      "triggered by save-related UE4SS hooks",
      "copies current SaveGames files to Saved\\SaveBackups snapshots",
      "autonames snapshots as backup-YYYYMMDD-HHMMSS-NNN",
      "retains three package-created backup snapshots",
      "does not delete or mutate active SaveGames files"
    ],
    safetyBoundaries: [
      "normal .clawedmod UE4SS package only",
      "no save content mutation",
      "no Steam/EOS/executable/anti-cheat/game DLL/cooked Blueprint asset patching",
      "runtime save-hook behavior unvalidated"
    ],
    consoleCommands: ["cmm_backup_saves"],
    logMarkers: [
      "[SaveBackupRotator] trigger|...",
      "[SaveBackupRotator] backup_created|...",
      "[SaveBackupRotator] backup_skipped|...",
      "[SaveBackupRotator] backup_failed|..."
    ],
    packageEntries: [
      "manifest.json",
      payloadPath,
      "README.md",
      "checksums.json"
    ]
  };
  await writeFile(
    path.join(outputDirectory, `${modId}.summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  return packagePath;
}

async function exists(targetPath) {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function sha256File(targetPath) {
  return crypto.createHash("sha256").update(await readFile(targetPath)).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
