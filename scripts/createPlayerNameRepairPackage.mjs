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

const modId = "PlayerNamesFix";
const modName = "Player Names Fix";
const version = "0.1.1-prototype.20260824";
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "PlayerState name repair package generated against the currently detected Clawed build with local host controller name fallback; death and host-client runtime behavior have not been live validated.";
const releaseRoot = path.resolve("release");
const outputRoot = path.resolve(
  process.env.CMM_PLAYER_NAME_REPAIR_OUTPUT_DIR ??
    path.join(releaseRoot, "prototype-mods")
);
const payloadPath = `payload/Mods/${modId}/Scripts/main.lua`;
const lua = String.raw`local marker = "[PlayerNamesFix] "
local version = "0.1.1-prototype.20260824"
local ok_helpers, UEHelpers = pcall(require, "UEHelpers")
local scan_interval_ms = 1000
local max_states_per_scan = 64
local cached_names = {}
local local_name_cache = nil
local missing_source_logged = {}
local unpack_fn = table.unpack or unpack

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

local function is_valid(object)
    object = unwrap(object)
    if object == nil then return false end
    local ok, valid = pcall(function() return object:IsValid() end)
    if not ok or valid ~= true then return false end
    if EInternalObjectFlags ~= nil and EInternalObjectFlags.PendingKill ~= nil then
        local ok_pending, pending = pcall(function() return object:HasAnyInternalFlags(EInternalObjectFlags.PendingKill) end)
        if ok_pending and pending == true then return false end
    end
    return true
end

local function full_name(object)
    object = unwrap(object)
    if object == nil then return "<nil>" end
    local ok, value = pcall(function() return object:GetFullName() end)
    if ok then return tostring(value) end
    return "<full-name-error:" .. tostring(value) .. ">"
end

local function call_method(object, name, ...)
    object = unwrap(object)
    if object == nil then return false, nil end
    local args = { ... }
    local ok_fn, fn = pcall(function() return object[name] end)
    if not ok_fn or fn == nil then return false, nil end
    return pcall(function() return fn(object, unpack_fn(args)) end)
end

local function get_prop(object, name)
    object = unwrap(object)
    if not is_valid(object) then return nil end
    local ok, value = pcall(function() return object[name] end)
    if ok then return unwrap(value) end
    return nil
end

local function set_prop(object, name, value)
    object = unwrap(object)
    if not is_valid(object) then return false, nil end
    local ok, err = pcall(function() object[name] = value end)
    return ok, err
end

local function text_value(value)
    value = unwrap(value)
    if value == nil then return nil end
    local value_type = type(value)
    if value_type == "string" or value_type == "number" or value_type == "boolean" then return tostring(value) end
    local ok_string, string_value = call_method(value, "ToString")
    if ok_string and string_value ~= nil then return tostring(string_value) end
    if is_valid(value) then return full_name(value) end
    return tostring(value)
end

local function trim(value)
    value = tostring(value or "")
    return (value:gsub("^%s+", ""):gsub("%s+$", ""))
end

local function normalized_name(value)
    local text = string.lower(trim(value))
    text = text:gsub("^%((.*)%)$", "%1")
    text = text:gsub("%s+", " ")
    return text
end

local function is_placeholder(value)
    local text = normalized_name(value)
    return text == "" or text == "player name"
end

local function usable_name(value)
    local text = trim(text_value(value) or "")
    if is_placeholder(text) then return nil end
    if #text > 64 then return nil end
    if text == "nil" or text == "None" or text == "Invalid" then return nil end
    if string.find(text, "/Script/", 1, true) ~= nil then return nil end
    if string.find(text, "Transient.", 1, true) ~= nil then return nil end
    return text
end

local function add_key(keys, value, prefix)
    local text = trim(text_value(value) or "")
    if text == "" or text == "nil" or text == "<nil>" then return end
    table.insert(keys, prefix .. ":" .. text)
end

local function state_keys(state)
    local keys = {}
    add_key(keys, state, "object")
    add_key(keys, get_prop(state, "UniqueId"), "unique")
    add_key(keys, get_prop(state, "BP_UniqueNetId"), "unique")
    add_key(keys, get_prop(state, "UniqueNetId"), "unique")
    add_key(keys, get_prop(state, "SavedNetworkAddress"), "address")
    add_key(keys, get_prop(state, "PlayerId"), "player_id")
    local ok, unique = call_method(state, "GetUniqueId")
    if ok then add_key(keys, unique, "unique") end
    return keys
end

local function remember_name(state, name, source)
    name = usable_name(name)
    if name == nil or not is_valid(state) then return false end
    local keys = state_keys(state)
    if #keys == 0 then return false end
    for _, key in ipairs(keys) do
        cached_names[key] = name
    end
    log("cache", tostring(source) .. "|keys=" .. tostring(#keys) .. "|name_len=" .. tostring(#name))
    return true
end

local function remember_local_name(name, source)
    name = usable_name(name)
    if name == nil then return false end
    local changed = local_name_cache ~= name
    local_name_cache = name
    cached_names["local:player"] = name
    if changed then log("local_cache", tostring(source) .. "|name_len=" .. tostring(#name)) end
    return true
end

local function cached_name(state)
    for _, key in ipairs(state_keys(state)) do
        local name = usable_name(cached_names[key])
        if name ~= nil then return name, key end
    end
    return nil, nil
end

local function same_object(left, right)
    return is_valid(left) and is_valid(right) and full_name(left) == full_name(right)
end

local function state_identity_values(state)
    local values = {}
    for _, prop in ipairs({ "UniqueId", "BP_UniqueNetId", "UniqueNetId", "SavedNetworkAddress", "PlayerId" }) do
        local text = trim(text_value(get_prop(state, prop)) or "")
        if text ~= "" and text ~= "nil" and text ~= "<nil>" then table.insert(values, prop .. ":" .. text) end
    end
    local ok, unique = call_method(state, "GetUniqueId")
    local text = ok and trim(text_value(unique) or "") or ""
    if text ~= "" and text ~= "nil" and text ~= "<nil>" then table.insert(values, "GetUniqueId:" .. text) end
    return values
end

local function same_state_identity(left, right)
    if same_object(left, right) then return true end
    if not is_valid(left) or not is_valid(right) then return false end
    local left_values = state_identity_values(left)
    local right_values = state_identity_values(right)
    for _, left_value in ipairs(left_values) do
        for _, right_value in ipairs(right_values) do
            if left_value == right_value then return true end
        end
    end
    return false
end

local function find_all(class_name)
    if type(FindAllOf) ~= "function" then return {} end
    local ok, objects = pcall(function() return FindAllOf(class_name) end)
    if ok and objects ~= nil then return objects end
    return {}
end

local function find_first(class_name)
    if type(FindFirstOf) ~= "function" then return nil end
    local ok, object = pcall(function() return FindFirstOf(class_name) end)
    if ok and is_valid(object) then return object end
    return nil
end

local function add_state(states, seen, state)
    state = unwrap(state)
    if not is_valid(state) then return end
    local key = full_name(state)
    if seen[key] == true then return end
    seen[key] = true
    table.insert(states, state)
end

local function add_array_states(states, seen, array)
    array = unwrap(array)
    if array == nil then return end
    local ok_len, len = pcall(function() return #array end)
    if ok_len and type(len) == "number" then
        for index = 1, math.min(len, max_states_per_scan) do
            local ok, value = pcall(function() return array[index] end)
            if ok then add_state(states, seen, value) end
        end
    end
    local ok_num, num = pcall(function() return array:GetArrayNum() end)
    if ok_num and type(num) == "number" then
        for index = 1, math.min(num, max_states_per_scan) do
            local ok, value = pcall(function() return array[index] end)
            if ok then add_state(states, seen, value) end
        end
    end
    pcall(function()
        array:ForEach(function(_, value)
            if #states < max_states_per_scan then add_state(states, seen, value) end
        end)
    end)
end

local function collect_player_states()
    local states = {}
    local seen = {}
    for _, game_state_class in ipairs({ "BP_Gamestate_FRG_C", "GameState", "GameStateBase" }) do
        local game_state = find_first(game_state_class)
        if is_valid(game_state) then add_array_states(states, seen, get_prop(game_state, "PlayerArray")) end
    end
    for _, state_class in ipairs({ "PlayerState_FDG_C", "PlayerState" }) do
        for _, state in pairs(find_all(state_class)) do
            add_state(states, seen, state)
            if #states >= max_states_per_scan then return states end
        end
    end
    return states
end

local function collect_controllers()
    local controllers = {}
    local seen = {}
    for _, controller_class in ipairs({ "BP_MenuSystemPlayerController_C", "PlayerController" }) do
        for _, controller in pairs(find_all(controller_class)) do
            if is_valid(controller) then
                local key = full_name(controller)
                if seen[key] ~= true then
                    seen[key] = true
                    table.insert(controllers, controller)
                end
            end
        end
    end
    return controllers
end

local function is_local_controller(controller)
    local ok, value = call_method(controller, "IsLocalController")
    return ok and value == true
end

local function object_player_state(object)
    local state = get_prop(object, "PlayerState")
    if is_valid(state) then return state end
    for _, method in ipairs({ "GetPlayerState", "K2_GetPlayerState" }) do
        local ok, value = call_method(object, method)
        if ok and is_valid(value) then return value end
    end
    return nil
end

local function controller_pawn(controller)
    for _, method in ipairs({ "GetPawn", "K2_GetPawn" }) do
        local ok, value = call_method(controller, method)
        if ok and is_valid(value) then return value end
    end
    for _, prop in ipairs({ "Pawn", "AcknowledgedPawn" }) do
        local value = get_prop(controller, prop)
        if is_valid(value) then return value end
    end
    return nil
end

local function controller_player_state(controller)
    local state = object_player_state(controller)
    if is_valid(state) then return state end
    return object_player_state(controller_pawn(controller))
end

local function local_controller()
    if ok_helpers and UEHelpers ~= nil and type(UEHelpers.GetPlayerController) == "function" then
        local ok, controller = pcall(function() return UEHelpers.GetPlayerController() end)
        if ok and is_valid(controller) then return controller end
    end
    local first = nil
    local count = 0
    for _, controller in ipairs(collect_controllers()) do
        count = count + 1
        if first == nil and is_valid(controller) then first = controller end
        if is_local_controller(controller) then return controller end
    end
    if count == 1 then return first end
    return nil
end

local function controller_for_state(state)
    local local_candidate = nil
    for _, controller in ipairs(collect_controllers()) do
        if same_state_identity(controller_player_state(controller), state) then return controller end
        if is_local_controller(controller) then local_candidate = controller end
    end
    if same_state_identity(controller_player_state(local_candidate), state) then return local_candidate end
    return nil
end

local function is_local_player_state(state, controller)
    if is_valid(controller) and is_local_controller(controller) then return true end
    local local_controller_value = local_controller()
    if same_state_identity(controller_player_state(local_controller_value), state) then return true end
    if same_object(get_prop(state, "Owner"), local_controller_value) then return true end
    local ok_owner, owner = call_method(state, "GetOwner")
    return ok_owner and same_object(owner, local_controller_value)
end

local function read_state_name(state)
    local first_value = nil
    local first_source = "missing"
    for _, method in ipairs({ "GetPlayerName", "GetPlayerNameCustom", "GetHumanReadableName" }) do
        local ok, value = call_method(state, method)
        local text = text_value(value)
        if ok and text ~= nil then
            local name = usable_name(text)
            if name ~= nil then
                remember_name(state, name, method)
                return name, method
            end
            if first_value == nil then
                first_value = text
                first_source = method
            end
        end
    end
    for _, prop in ipairs({ "PlayerNamePrivate", "PlayerName", "PlayerDisplayName", "DisplayName", "SteamName", "Username", "Name" }) do
        local text = text_value(get_prop(state, prop))
        if text ~= nil then
            local name = usable_name(text)
            if name ~= nil then
                remember_name(state, name, prop)
                return name, prop
            end
            if first_value == nil then
                first_value = text
                first_source = prop
            end
        end
    end
    return first_value, first_source
end

local function static_find(path_value)
    if type(StaticFindObject) ~= "function" then return nil end
    local ok, object = pcall(function() return StaticFindObject(path_value) end)
    if ok and is_valid(object) then return object end
    return nil
end

local function controller_local_player(controller)
    for _, method in ipairs({ "GetLocalPlayer", "GetPlayer" }) do
        local ok, value = call_method(controller, method)
        if ok and is_valid(value) then return value end
    end
    for _, prop in ipairs({ "LocalPlayer", "Player" }) do
        local value = get_prop(controller, prop)
        if is_valid(value) then return value end
    end
    return nil
end

local function try_object_names(objects, methods, props, source)
    for _, object in ipairs(objects) do
        for _, method in ipairs(methods) do
            local ok, value = call_method(object, method)
            local name = ok and usable_name(value) or nil
            if name ~= nil then return name, source .. ":" .. method end
        end
        for _, prop in ipairs(props) do
            local name = usable_name(get_prop(object, prop))
            if name ~= nil then return name, source .. ":" .. prop end
        end
    end
    return nil, nil
end

local function local_online_name(state, controller)
    if not is_valid(controller) then controller = local_controller() end
    local local_player = controller_local_player(controller)
    local objects = {}
    if is_valid(state) then table.insert(objects, state) end
    if is_valid(controller) then table.insert(objects, controller) end
    if is_valid(local_player) then table.insert(objects, local_player) end
    local name, source = try_object_names(
        objects,
        { "GetSteamName", "GetPlatformUserName", "GetPlayerNickname", "GetDisplayName", "GetPlayerName", "GetNickname", "GetUsername", "GetUserName" },
        { "SteamName", "PlatformUserName", "PlayerNickname", "PlayerName", "PlayerDisplayName", "DisplayName", "Username", "UserName" },
        "local_object"
    )
    if name ~= nil then
        remember_local_name(name, source)
        if is_valid(state) then remember_name(state, name, source) end
        return name, source
    end
    local world = find_first("World")
    local libraries = {
        "/Script/AdvancedSteamSessions.Default__AdvancedSteamFriendsLibrary",
        "/Script/AdvancedSessions.Default__AdvancedFriendsLibrary",
        "/Script/AdvancedSessions.Default__AdvancedSessionsLibrary",
        "/Script/Engine.Default__GameplayStatics"
    }
    local methods = {
        "GetSteamPersonaName",
        "Get Steam Persona Name",
        "GetPlayerNickname",
        "Get Player Nickname",
        "GetPlayerName",
        "Get Player Name",
        "GetDisplayName",
        "Get Display Name"
    }
    for _, library_path in ipairs(libraries) do
        local library = static_find(library_path)
        if library ~= nil then
            for _, method in ipairs(methods) do
                local arg_sets = { {} }
                if is_valid(controller) then
                    table.insert(arg_sets, { controller })
                    if world ~= nil then table.insert(arg_sets, { world, controller }) end
                end
                if is_valid(local_player) then
                    table.insert(arg_sets, { local_player })
                    if world ~= nil then table.insert(arg_sets, { world, local_player }) end
                end
                for _, args in ipairs(arg_sets) do
                    local ok, value = call_method(library, method, unpack_fn(args))
                    name = ok and usable_name(value) or nil
                    if name ~= nil then
                        source = "local_library:" .. library_path .. ":" .. method
                        remember_local_name(name, source)
                        if is_valid(state) then remember_name(state, name, source) end
                        return name, source
                    end
                end
            end
        end
    end
    name = usable_name(local_name_cache)
    if name ~= nil then return name, "local_cache" end
    return nil, "local_unavailable"
end

local function online_name_for_state(state)
    local controller = controller_for_state(state)
    local local_state = is_local_player_state(state, controller)
    if local_state and not is_valid(controller) then controller = local_controller() end
    local unique = get_prop(state, "UniqueId") or get_prop(state, "BP_UniqueNetId") or get_prop(state, "UniqueNetId")
    local ok_unique, method_unique = call_method(state, "GetUniqueId")
    if unique == nil and ok_unique then unique = method_unique end
    local world = find_first("World")
    local libraries = {
        "/Script/AdvancedSteamSessions.Default__AdvancedSteamFriendsLibrary",
        "/Script/AdvancedSessions.Default__AdvancedFriendsLibrary",
        "/Script/AdvancedSessions.Default__AdvancedSessionsLibrary",
        "/Script/Engine.Default__GameplayStatics"
    }
    local methods = {
        "GetSteamPersonaName",
        "Get Steam Persona Name",
        "GetSteamFriendPersonaName",
        "Get Steam Friend Persona Name",
        "GetPlayerNickname",
        "Get Player Nickname",
        "GetPlayerName",
        "Get Player Name",
        "GetDisplayName",
        "Get Display Name"
    }
    for _, library_path in ipairs(libraries) do
        local library = static_find(library_path)
        if library ~= nil then
            for _, method in ipairs(methods) do
                local arg_sets = {}
                if unique ~= nil then
                    table.insert(arg_sets, { unique })
                    if world ~= nil then table.insert(arg_sets, { world, unique }) end
                end
                if is_valid(controller) then
                    table.insert(arg_sets, { controller })
                    if world ~= nil then table.insert(arg_sets, { world, controller }) end
                end
                if local_state then table.insert(arg_sets, {}) end
                for _, args in ipairs(arg_sets) do
                    local ok, value = call_method(library, method, unpack_fn(args))
                    local name = ok and usable_name(value) or nil
                    if name ~= nil then
                        remember_name(state, name, library_path .. ":" .. method)
                        return name, library_path .. ":" .. method
                    end
                end
            end
        end
    end
    for _, method in ipairs({ "GetSteamName", "GetPlatformUserName", "GetPlayerNickname", "GetDisplayName" }) do
        for _, object in ipairs({ state, controller }) do
            local ok, value = call_method(object, method)
            local name = ok and usable_name(value) or nil
            if name ~= nil then
                remember_name(state, name, method)
                if local_state then remember_local_name(name, method) end
                return name, method
            end
        end
    end
    if local_state then return local_online_name(state, controller) end
    return nil, "online_unavailable"
end

local function replicate_if_authority(state)
    local ok_authority, authority = call_method(state, "HasAuthority")
    if ok_authority and authority == true then
        call_method(state, "ForceNetUpdate")
        return "authority"
    end
    return "local_copy"
end

local function apply_name(state, name, reason, source)
    name = usable_name(name)
    if name == nil or not is_valid(state) then return false end
    local method_used = nil
    for _, method in ipairs({ "SetPlayerName", "SetPlayerNameInternal" }) do
        local ok, result = call_method(state, method, name)
        if ok and result ~= false then
            method_used = method
            break
        end
    end
    if method_used == nil then
        for _, prop in ipairs({ "PlayerNamePrivate", "PlayerName", "PlayerDisplayName", "DisplayName" }) do
            local ok = set_prop(state, prop, name)
            if ok then
                method_used = prop
                break
            end
        end
    end
    if method_used == nil then
        log("repair_failed", tostring(reason) .. "|source=" .. tostring(source) .. "|state=" .. full_name(state))
        return false
    end
    call_method(state, "OnRep_PlayerName")
    local replication = replicate_if_authority(state)
    remember_name(state, name, "repair")
    log("repair", tostring(reason) .. "|source=" .. tostring(source) .. "|method=" .. method_used .. "|replication=" .. replication .. "|name_len=" .. tostring(#name))
    return true
end

local function repair_state(state, reason)
    if not is_valid(state) then return false end
    local current, current_source = read_state_name(state)
    if not is_placeholder(current) then return false end
    local replacement, source = cached_name(state)
    if replacement == nil then replacement, source = online_name_for_state(state) end
    if replacement == nil then
        local key = state_keys(state)[1] or full_name(state)
        if missing_source_logged[key] ~= true then
            missing_source_logged[key] = true
            log("repair_wait", tostring(reason) .. "|current_source=" .. tostring(current_source) .. "|state=" .. full_name(state))
        end
        return false
    end
    return apply_name(state, replacement, reason, source)
end

local scan_count = 0

local function scan(reason)
    scan_count = scan_count + 1
    local repaired = 0
    local local_pc = local_controller()
    if is_valid(local_pc) then local_online_name(nil, local_pc) end
    local states = collect_player_states()
    for _, state in ipairs(states) do
        if repair_state(state, reason) then repaired = repaired + 1 end
    end
    if repaired > 0 or scan_count <= 3 then
        log("scan", tostring(reason) .. "|states=" .. tostring(#states) .. "|repaired=" .. tostring(repaired))
    end
end

local function schedule_scan()
    if type(ExecuteWithDelay) ~= "function" then
        log("schedule", "stopped|ExecuteWithDelay_missing")
        return
    end
    ExecuteWithDelay(scan_interval_ms, function()
        local runner = function()
            local ok, err = pcall(function() scan("interval") end)
            if not ok then log("error", tostring(err)) end
            schedule_scan()
        end
        if type(ExecuteInGameThread) == "function" then ExecuteInGameThread(runner) else runner() end
    end)
end

local function register_hook(label, hook_name, callback)
    if type(RegisterHook) ~= "function" then
        log("hook_register", label .. "|false|RegisterHook_missing")
        return
    end
    local ok, err = pcall(function() RegisterHook(hook_name, callback) end)
    log("hook_register", label .. "|" .. tostring(ok) .. "|" .. tostring(err))
end

local function handle_controller_name_hook(label, self, new_name)
    local controller = unwrap(self)
    local name = usable_name(new_name)
    if name == nil then return end
    local state = controller_player_state(controller)
    if is_local_controller(controller) then remember_local_name(name, label) end
    if is_valid(state) then
        remember_name(state, name, label)
        repair_state(state, label)
    end
end

register_hook("PlayerState_SetPlayerName", "/Script/Engine.PlayerState:SetPlayerName", function(self, new_name)
    local state = unwrap(self)
    local name = usable_name(new_name)
    if name ~= nil then remember_name(state, name, "SetPlayerName_hook") end
    repair_state(state, "SetPlayerName_hook")
end)

register_hook("PlayerState_OnRep_PlayerName", "/Script/Engine.PlayerState:OnRep_PlayerName", function(self)
    repair_state(unwrap(self), "OnRep_PlayerName")
end)

register_hook("PlayerController_ServerChangeName", "/Script/Engine.PlayerController:ServerChangeName", function(self, new_name)
    handle_controller_name_hook("ServerChangeName_hook", self, new_name)
end)

register_hook("PlayerController_ClientSetName", "/Script/Engine.PlayerController:ClientSetName", function(self, new_name)
    handle_controller_name_hook("ClientSetName_hook", self, new_name)
end)

if type(NotifyOnNewObject) == "function" then
    local ok, err = pcall(function()
        NotifyOnNewObject("/Script/Engine.PlayerState", function(object)
            repair_state(unwrap(object), "new_player_state")
        end)
    end)
    log("hook_register", "NotifyPlayerState|" .. tostring(ok) .. "|" .. tostring(err))
else
    log("hook_register", "NotifyPlayerState|false|NotifyOnNewObject_missing")
end

if type(RegisterConsoleCommandHandler) == "function" then
    local ok, err = pcall(function()
        RegisterConsoleCommandHandler("cmm_repair_names", function()
            scan("console")
            return true
        end)
    end)
    log("console_command", "cmm_repair_names|registered=" .. tostring(ok) .. "|" .. tostring(err))
else
    log("console_command", "cmm_repair_names|api_missing")
end

log("startup", "version=" .. version .. "|interval_ms=" .. tostring(scan_interval_ms))
local starter = function()
    scan("startup")
    schedule_scan()
end
if type(ExecuteInGameThread) == "function" then ExecuteInGameThread(starter) else starter() end
`;
const readme = [
  `# ${modName}`,
  "",
  "Prototype UE4SS package that repairs Clawed PlayerState display names when they become empty or the default `(Player Name)` text.",
  "",
  "Behavior:",
  "",
  "- Scans bounded PlayerState sources once per second: `GameState.PlayerArray`, `PlayerState_FDG_C`, and base `PlayerState` instances.",
  "- Caches real non-placeholder names as soon as the game exposes them through PlayerState methods or fields.",
  "- When a PlayerState name is empty, `Player Name`, or `(Player Name)`, restores the cached name for the same PlayerState identity.",
  "- Attempts in-process Unreal/AdvancedSessions/AdvancedSteamSessions display-name functions when present.",
  "- For the local host player, also resolves names through the local PlayerController, LocalPlayer, and no-argument persona-name functions.",
  "- Repairs through `SetPlayerName` first, then `SetPlayerNameInternal`, then PlayerState name fields as fallback.",
  "- Calls `OnRep_PlayerName` after a local repair and `ForceNetUpdate` only when the PlayerState reports authority.",
  "- Exposes `cmm_repair_names` as a manual UE console command when console command handlers are available.",
  "",
  "Expected UE4SS markers include:",
  "",
  "- `[PlayerNamesFix] startup|...`",
  "- `[PlayerNamesFix] hook_register|...`",
  "- `[PlayerNamesFix] cache|...`",
  "- `[PlayerNamesFix] local_cache|...`",
  "- `[PlayerNamesFix] repair|...`",
  "- `[PlayerNamesFix] repair_wait|...`",
  "- `[PlayerNamesFix] scan|...`",
  "",
  "Safety boundaries:",
  "",
  "- Packaged only as a normal `.clawedmod` with `loader: \"ue4ss\"`.",
  "- Does not read Steam account files, Steam config, saves, logs, or local user directories.",
  "- Does not patch Steam, EOS, executable files, anti-cheat, game DLLs, OnlineSubsystem binaries, cooked Blueprint assets, GameMode assets, or PlayerController assets.",
  "- Does not overwrite custom non-placeholder names.",
  "- Does not create a native replicated function, spoof networking identity, or bypass server authority.",
  "- Does not mutate saves, inventory, score, movement, collision, pawn transforms, or world items.",
  "",
  "Validation boundary:",
  "",
  "- Package structure and CMM deployment can be verified without launching Clawed.",
  "- The local host fallback is packaged but death-time repair, Steam-name resolution, and host/client replication behavior remain unvalidated until tested in a real Clawed session with the matching UE4SS runtime."
].join("\n");
const manifest = {
  schemaVersion: 1,
  id: modId,
  name: modName,
  version,
  author: "Clawed Mod Manager",
  description:
    "UE4SS PlayerState display-name repair prototype that restores cached Steam-sourced names when Clawed resets names to empty or Player Name.",
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
    tags: [
      "ue4ss_runtime",
      "lua",
      "player_name_repair",
      "multiplayer_infrastructure"
    ]
  })
};

const packagePaths = [];
packagePaths.push(await writePackage(outputRoot));
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const unpackedOutputRoot = path.resolve(
  process.env.CMM_PLAYER_NAME_REPAIR_UNPACKED_OUTPUT_DIR ??
    path.join(unpackedRoot, "prototype-mods")
);
if (process.env.CMM_PLAYER_NAME_REPAIR_SKIP_UNPACKED !== "1" && await exists(unpackedRoot)) {
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
    behavior: [
      "caches non-placeholder PlayerState names",
      "repairs empty, Player Name, and (Player Name) values only",
      "tries in-process Unreal, AdvancedSessions, and AdvancedSteamSessions display-name functions when available",
      "uses local PlayerController and LocalPlayer name fallback for the host PlayerState",
      "does not read Steam account files or local user directories"
    ],
    safetyBoundaries: [
      "normal .clawedmod UE4SS package only",
      "no Steam/EOS/executable/anti-cheat/game DLL/OnlineSubsystem binary patching",
      "no save, inventory, score, movement, collision, pawn transform, or world-item mutation",
      "no networking identity spoofing or server-authority bypass",
      "death-time and host-client replication behavior unvalidated"
    ],
    consoleCommands: ["cmm_repair_names"],
    logMarkers: [
      "[PlayerNamesFix] startup|...",
      "[PlayerNamesFix] cache|...",
      "[PlayerNamesFix] local_cache|...",
      "[PlayerNamesFix] repair|...",
      "[PlayerNamesFix] repair_wait|..."
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
