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

const modId = "CoopCapacity8";
const modName = "Co-op Capacity 8";
const version = "0.1.0-prototype.20260822";
const targetCapacity = 8;
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "Generated against current package metadata; no live eight-client validation has been performed.";
const releaseRoot = path.resolve("release");
const outputRoot = path.resolve(
  process.env.CMM_COOP_CAPACITY8_OUTPUT_DIR ?? path.join(releaseRoot, "prototype-mods")
);
const payloadPath = `payload/Mods/${modId}/Scripts/main.lua`;
const lua = String.raw`local marker = "[CoopCapacity8] "
local target_capacity = 8
local unpack_fn = table.unpack or unpack
local last_apply_summary = "not_applied"
local capacity_props = {
    "MaxPlayerCount",
    "MaxPlayerCountValue",
    "MaxPlayers",
    "MaximumPlayers",
    "MaxPlayerNum",
    "MaxNumPlayers",
    "MaxPlayerSlots",
    "PlayerLimit",
    "PlayersLimit",
    "MaxPartySize",
    "PartySize",
    "SessionMaxPlayers",
    "MaxSessionPlayers",
    "LobbyMaxPlayers",
    "MaxLobbyPlayers",
    "NumPublicConnections",
    "NumberOfPublicConnections",
    "PublicConnections",
    "MaxPublicConnections",
    "MaxConnections",
    "ConnectionLimit",
    "Capacity",
    "Slots",
    "PlayerSlots"
}
local slider_props = {
    "MaxPlayerCountSlider",
    "MaxPlayersSlider",
    "PlayerCountSlider",
    "PlayerCapacitySlider",
    "MaxPlayerCountSpinBox",
    "MaxPlayersSpinBox",
    "PlayerCountSpinBox"
}
local setter_names = {
    "SetMaxPlayers",
    "SetMaxPlayerCount",
    "SetMaximumPlayers",
    "SetMaxNumPlayers",
    "SetMaxPublicConnections",
    "SetNumPublicConnections",
    "SetPlayerLimit",
    "SetMaxPartySize",
    "SetCapacity"
}
local slider_setters = {
    "SetMaxValue",
    "SetMaxSliderValue",
    "SetValue"
}

local function log(event, value)
    print(marker .. tostring(event) .. "|" .. tostring(value))
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

local function is_valid(object)
    object = unwrap(object)
    if object == nil then return false end
    local ok, valid = pcall(function() return object:IsValid() end)
    return ok and valid == true
end

local function full_name(object)
    object = unwrap(object)
    if object == nil then return "<nil>" end
    local ok, value = pcall(function() return object:GetFullName() end)
    if ok then return tostring(value) end
    return "<full-name-error:" .. tostring(value) .. ">"
end

local function class_name(object)
    object = unwrap(object)
    if object == nil then return "<nil>" end
    local ok, value = pcall(function() return object:GetClass() end)
    if ok and value ~= nil then return full_name(value) end
    return "<class-error:" .. tostring(value) .. ">"
end

local function text(value)
    value = unwrap(value)
    if value == nil then return "<nil>" end
    local value_type = type(value)
    if value_type == "string" or value_type == "number" or value_type == "boolean" then return tostring(value) end
    return full_name(value)
end

local function get_prop(object, name)
    object = unwrap(object)
    if not is_valid(object) then return nil end
    local ok, value = pcall(function() return object[name] end)
    if ok then return unwrap(value) end
    return nil
end

local function set_existing_prop(object, name, value)
    object = unwrap(object)
    if not is_valid(object) then return false, "invalid_object" end
    local ok_existing, existing = pcall(function() return object[name] end)
    if not ok_existing then return false, "read_failed:" .. tostring(existing) end
    if unwrap(existing) == nil then return false, "missing_or_nil" end
    local ok, err = pcall(function() object[name] = value end)
    if ok then return true, "from=" .. text(existing) end
    return false, "write_failed:" .. tostring(err)
end

local function call_method(object, name, ...)
    object = unwrap(object)
    if not is_valid(object) then return false, "invalid_object" end
    local args = { ... }
    local ok_fn, fn = pcall(function() return object[name] end)
    if not ok_fn or fn == nil then return false, "missing" end
    local ok, result = pcall(function() return fn(object, unpack_fn(args)) end)
    if ok then return true, text(result) end
    return false, tostring(result)
end

local function find_all(class_name_value)
    if type(FindAllOf) ~= "function" then return {} end
    local ok, result = pcall(function() return FindAllOf(class_name_value) end)
    if ok and result ~= nil then return result end
    return {}
end

local function find_first(class_name_value)
    if type(FindFirstOf) ~= "function" then return nil end
    local ok, result = pcall(function() return FindFirstOf(class_name_value) end)
    if ok then return unwrap(result) end
    return nil
end

local function apply_slider(slider, source, label)
    slider = unwrap(slider)
    if not is_valid(slider) then return 0 end
    local changed = 0
    for _, method_name in ipairs(slider_setters) do
        local ok, detail = call_method(slider, method_name, target_capacity)
        log("slider_method", tostring(source) .. "|label=" .. tostring(label) .. "|method=" .. method_name .. "|ok=" .. tostring(ok) .. "|detail=" .. tostring(detail) .. "|object=" .. full_name(slider))
        if ok then changed = changed + 1 end
    end
    for _, prop_name in ipairs({ "MaxValue", "MaxSliderValue", "Value" }) do
        local ok, detail = set_existing_prop(slider, prop_name, target_capacity)
        log("slider_property", tostring(source) .. "|label=" .. tostring(label) .. "|property=" .. prop_name .. "|ok=" .. tostring(ok) .. "|detail=" .. tostring(detail) .. "|object=" .. full_name(slider))
        if ok then changed = changed + 1 end
    end
    return changed
end

local function apply_object(object, source)
    object = unwrap(object)
    if not is_valid(object) then return 0 end
    local changed = 0
    log("object_scan", tostring(source) .. "|object=" .. full_name(object) .. "|class=" .. class_name(object))
    for _, prop_name in ipairs(capacity_props) do
        local ok, detail = set_existing_prop(object, prop_name, target_capacity)
        if ok then changed = changed + 1 end
        log("capacity_property", tostring(source) .. "|property=" .. prop_name .. "|ok=" .. tostring(ok) .. "|detail=" .. tostring(detail) .. "|object=" .. full_name(object))
    end
    for _, method_name in ipairs(setter_names) do
        local ok, detail = call_method(object, method_name, target_capacity)
        if ok then changed = changed + 1 end
        log("capacity_method", tostring(source) .. "|method=" .. method_name .. "|ok=" .. tostring(ok) .. "|detail=" .. tostring(detail) .. "|object=" .. full_name(object))
    end
    for _, slider_name in ipairs(slider_props) do
        local slider = get_prop(object, slider_name)
        if is_valid(slider) then
            changed = changed + apply_slider(slider, source, slider_name)
        else
            log("slider_missing", tostring(source) .. "|property=" .. slider_name .. "|object=" .. full_name(object))
        end
    end
    return changed
end

local function scan_class(source, class_name_value)
    local changed = 0
    local count = 0
    for _, object in pairs(find_all(class_name_value)) do
        if is_valid(object) then
            count = count + 1
            if count <= 16 then changed = changed + apply_object(object, tostring(source) .. "|class=" .. class_name_value .. "|idx=" .. tostring(count)) end
        end
    end
    log("class_scan", tostring(source) .. "|class=" .. class_name_value .. "|count=" .. tostring(count) .. "|changed=" .. tostring(changed))
    return changed, count
end

local function apply_capacity(source, ...)
    local total_changed = 0
    local scanned = 0
    local explicit_args = { ... }
    local game_instance = find_first("BP_MenuSystemGameInstance_FDG_C") or find_first("GameInstance")
    if is_valid(game_instance) then
        total_changed = total_changed + apply_object(game_instance, tostring(source) .. "|game_instance")
        scanned = scanned + 1
    end
    for _, class_name_value in ipairs({ "WBP_HostMultiplayer_C", "WBP_HostMultiplayerMenu_C", "GameSession", "GameModeBase" }) do
        local changed, count = scan_class(source, class_name_value)
        total_changed = total_changed + changed
        scanned = scanned + count
    end
    for i = 1, #explicit_args do
        local value = unwrap(explicit_args[i])
        if is_valid(value) then
            total_changed = total_changed + apply_object(value, tostring(source) .. "|arg=" .. tostring(i))
            scanned = scanned + 1
        else
            log("arg_scan", tostring(source) .. "|idx=" .. tostring(i) .. "|value=" .. text(value))
        end
    end
    last_apply_summary = "source=" .. tostring(source) .. "|target_capacity=" .. tostring(target_capacity) .. "|objects_scanned=" .. tostring(scanned) .. "|changes=" .. tostring(total_changed)
    log("capacity_apply", last_apply_summary)
    return total_changed
end

local function register_hook(label, hook_name, callback)
    if type(RegisterHook) ~= "function" then
        log("hook_register", label .. "|false|RegisterHook missing")
        return
    end
    local ok, err = pcall(function() RegisterHook(hook_name, callback) end)
    log("hook_register", label .. "|" .. tostring(ok) .. "|" .. tostring(err))
end

local function console_reply(ar, line)
    print(marker .. line)
    if type(ar) == "userdata" and ar:type() == "FOutputDevice" then ar:Log(line) end
end

local function register_command(name, fn)
    if type(RegisterConsoleCommandHandler) ~= "function" then
        log("console_command", name .. "|api_missing")
        return
    end
    local ok, err = pcall(function()
        RegisterConsoleCommandHandler(name, function(full_command, parameters, ar)
            local ok_call, result = pcall(function() return fn(full_command, parameters, ar) end)
            if not ok_call then
                console_reply(ar, name .. "|failed|" .. tostring(result))
                return true
            end
            return result ~= false
        end)
    end)
    log("console_command", name .. "|registered=" .. tostring(ok) .. "|" .. tostring(err))
end

register_command("cmm_coop_capacity8", function(full_command, parameters, ar)
    local changes = apply_capacity("console", full_command, parameters)
    console_reply(ar, "cmm_coop_capacity8|target_capacity=" .. tostring(target_capacity) .. "|changes=" .. tostring(changes))
    return true
end)

register_command("cmm_coop_capacity8_status", function(full_command, parameters, ar)
    console_reply(ar, "cmm_coop_capacity8_status|" .. last_apply_summary)
    return true
end)

local gi_class = "/Game/MenuSystemPro/Blueprints/GameFramework/BP_MenuSystemGameInstance_FDG.BP_MenuSystemGameInstance_FDG_C"
local host_widget = "/Game/MenuSystemPro/Blueprints/Widgets/WBP_HostMultiplayer.WBP_HostMultiplayer_C"
register_hook("GI_CreateFriendsSession", gi_class .. ":Create  Friends Session", function(self, ...) apply_capacity("GI_CreateFriendsSession", self, ...) end)
register_hook("GI_LoadSessionLevel", gi_class .. ":Load Session Level", function(self, ...) apply_capacity("GI_LoadSessionLevel", self, ...) end)
register_hook("WBP_Host_LoadSessionLevel", host_widget .. ":Load Session Level", function(self, ...) apply_capacity("WBP_Host_LoadSessionLevel", self, ...) end)

apply_capacity("startup")
log("startup", "version=0.1.0-prototype.20260822|target_capacity=" .. tostring(target_capacity))`;
const readme = [
  "# Co-op Capacity 8",
  "",
  "Prototype UE4SS Lua package that attempts to raise Clawed host/session player capacity to 8.",
  "",
  "What it does:",
  "",
  "- Targets the observed multiplayer flow around `BP_MenuSystemGameInstance_FDG`, `WBP_HostMultiplayer`, `GameSession`, and `GameModeBase`.",
  "- Before host/session creation and host-level travel, writes known max-player, public-connection, party-size, slot, and capacity fields to `8` when those fields exist.",
  "- Raises the observed `MaxPlayerCountSlider` and adjacent player-count slider/spinbox objects to `8` when they exist.",
  "- Logs every property, method, slider, and object scan to `UE4SS.log` with `[CoopCapacity8]` markers.",
  "- Provides `cmm_coop_capacity8` to reapply the capacity patch manually and `cmm_coop_capacity8_status` to print the last apply summary.",
  "",
  "Expected support markers:",
  "",
  "- `[CoopCapacity8] startup|...`",
  "- `[CoopCapacity8] hook_register|...`",
  "- `[CoopCapacity8] capacity_apply|...`",
  "- `[CoopCapacity8] object_scan|...`",
  "- `[CoopCapacity8] capacity_property|...`",
  "- `[CoopCapacity8] slider_method|...`",
  "- `[CoopCapacity8] class_scan|...`",
  "",
  "Collection path:",
  "",
  "- Primary: `Clawed\\Binaries\\Win64\\ue4ss\\UE4SS.log`",
  "",
  "Safety boundaries:",
  "",
  "- Packaged only as a normal `.clawedmod` with `loader: \"ue4ss\"`.",
  "- Does not patch Steam, EOS, executable files, anti-cheat, game DLLs, OnlineSubsystem binaries, cooked Blueprint assets, GameMode assets, or PlayerController assets.",
  "- Does not replace Unreal NetDriver, session transport, replication, save, inventory, or world-item authority.",
  "- Does not force-close Clawed or mutate save data.",
  "- Eight-player behavior remains unvalidated until a live host plus seven-client session proves discovery, join, travel, spawn, replication, save/load, and disconnect/reconnect behavior."
].join("\n");
const manifest = {
  schemaVersion: 1,
  id: modId,
  name: modName,
  version,
  author: "Clawed Mod Manager",
  description:
    "Prototype UE4SS package that attempts to raise Clawed co-op host/session player capacity to 8.",
  game: "clawed",
  loader: "ue4ss",
  dependencies: [],
  conflicts: [],
  loadAfter: [],
  loadBefore: ["CoopSessionGuard"],
  packageIdentity: generatedPackageIdentity(modId),
  creatorAssets: generatedCreatorSupportMetadata({
    modId,
    modName,
    version,
    payloadPath,
    buildId: steamBuildId,
    buildNotes: steamBuildNotes,
    tags: ["ue4ss_runtime", "lua", "coop_capacity", "eight_player"]
  })
};

const packagePaths = [];
packagePaths.push(await writePackage(outputRoot));
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const unpackedOutputRoot = path.resolve(
  process.env.CMM_COOP_CAPACITY8_UNPACKED_OUTPUT_DIR ??
    path.join(unpackedRoot, "prototype-mods")
);
if (await exists(unpackedRoot)) {
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
    targetCapacity,
    supportedSteamBuilds: generatedSupportedSteamBuilds(
      steamBuildId,
      steamBuildNotes
    ),
    runtimeClaims: [
      "UE4SS Lua package structure only",
      "Attempts to raise host/session-facing co-op capacity fields to 8",
      "Runs before observed Create Friends Session and Load Session Level calls",
      "No executable, Steam, EOS, anti-cheat, game DLL, cooked asset, NetDriver, GameMode asset, or PlayerController asset patching",
      "Eight-player host/client behavior unvalidated"
    ],
    consoleCommands: ["cmm_coop_capacity8", "cmm_coop_capacity8_status"],
    logMarkers: [
      "[CoopCapacity8] capacity_apply|...",
      "[CoopCapacity8] capacity_property|...",
      "[CoopCapacity8] slider_method|...",
      "[CoopCapacity8] class_scan|..."
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
