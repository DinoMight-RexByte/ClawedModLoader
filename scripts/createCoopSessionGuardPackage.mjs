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

const modId = "CoopSessionGuard";
const modName = "Co-op Session Guard";
const version = "0.2.2-prototype.20260824";
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "Host/client diagnostic hardening generated against current package metadata; no multi-client supported-party-size validation has been performed.";
const releaseRoot = path.resolve("release");
const outputRoot = path.resolve(
  process.env.CMM_COOP_SESSION_GUARD_OUTPUT_DIR ??
    path.join(releaseRoot, "prototype-mods")
);
const payloadPath = `payload/Mods/${modId}/Scripts/main.lua`;
const lua = String.raw`local ok_helpers, UEHelpers = pcall(require, "UEHelpers")
local marker = "[CoopSessionGuard] "
local version = "0.2.2-prototype.20260824"
local max_recent_events = 140
local join_timeout_ms = 26000
local invite_join_wait_ms = 1800
local reset_after_failure_ms = 8000
local stale_lock_ms = 45000
local recent_events = {}
local coordinator = {
    state = "idle",
    generation = 0,
    intent = nil,
    intent_started = 0.0,
    lock_reason = "startup",
    original_join_seen_generation = 0,
    last_join_args = nil,
    last_invite_result = nil,
    last_search_result = nil,
    last_game_instance = nil,
    last_failure = nil,
    last_host_args = nil,
    last_find_args = nil
}
local unpack_fn = table.unpack or unpack

local function now()
    return string.format("%.3f", os.clock())
end

local function append_recent(line)
    table.insert(recent_events, line)
    while #recent_events > max_recent_events do
        table.remove(recent_events, 1)
    end
end

local function log(event, value)
    local line = "t=" .. now() .. "|" .. tostring(event) .. "|" .. tostring(value)
    append_recent(line)
    print(marker .. line)
end

local function write_line(target, line)
    local file = io.open(target, "a")
    if file == nil then return false end
    file:write(os.date("!%Y-%m-%dT%H:%M:%SZ") .. "|" .. line .. "\n")
    file:close()
    return true
end

local function write_failure(line)
    local targets = {
        "ue4ss/Mods/CoopSessionGuard/session-failures.log",
        "Mods/CoopSessionGuard/session-failures.log"
    }
    for _, target in ipairs(targets) do
        local ok, result = pcall(function() return write_line(target, line) end)
        if ok and result == true then return true end
    end
    return false
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
    if value == nil then return "nil" end
    local value_type = type(value)
    if value_type == "string" then return "string:" .. tostring(#value) end
    if value_type == "number" or value_type == "boolean" then return tostring(value) end
    return value_type .. ":" .. full_name(value)
end

local function get_prop(object, name)
    object = unwrap(object)
    if not is_valid(object) then return nil end
    local ok, value = pcall(function() return object[name] end)
    if ok then return unwrap(value) end
    return nil
end

local function call_method(object, name, ...)
    object = unwrap(object)
    if not is_valid(object) then return false, "invalid_object" end
    local args = { ... }
    local ok_fn, fn = pcall(function() return object[name] end)
    if not ok_fn or fn == nil then return false, "missing_method:" .. name end
    local ok_call, result = pcall(function() return fn(object, unpack_fn(args)) end)
    if ok_call then return true, result end
    return false, tostring(result)
end

local function find_first(class_name_value)
    if type(FindFirstOf) ~= "function" then return nil end
    local ok, object = pcall(function() return FindFirstOf(class_name_value) end)
    if ok and is_valid(object) then return object end
    return nil
end

local function find_all(class_name_value)
    if type(FindAllOf) ~= "function" then return {} end
    local ok, objects = pcall(function() return FindAllOf(class_name_value) end)
    if ok and objects ~= nil then return objects end
    return {}
end

local function get_world()
    if ok_helpers and UEHelpers.GetWorld ~= nil then
        local ok, world = pcall(function() return UEHelpers.GetWorld() end)
        if ok and is_valid(world) then return world end
    end
    return find_first("World")
end

local function value_text(value)
    value = unwrap(value)
    if value == nil then return nil end
    local value_type = type(value)
    if value_type == "string" or value_type == "number" or value_type == "boolean" then return tostring(value) end
    local ok, text_value = pcall(function() return value:ToString() end)
    if ok and text_value ~= nil then return tostring(text_value) end
    return full_name(value)
end

local function net_mode_label()
    local world = get_world()
    local ok, mode = call_method(world, "GetNetMode")
    if ok then return value_text(mode) or tostring(mode) end
    return "unknown"
end

local function get_game_instance()
    if ok_helpers and UEHelpers.GetGameInstance ~= nil then
        local ok, instance = pcall(function() return UEHelpers.GetGameInstance() end)
        if ok and is_valid(instance) then
            coordinator.last_game_instance = instance
            return instance
        end
    end
    for _, candidate in ipairs({ "BP_MenuSystemGameInstance_FDG_C", "GameInstance" }) do
        local instance = find_first(candidate)
        if is_valid(instance) then
            coordinator.last_game_instance = instance
            return instance
        end
    end
    return coordinator.last_game_instance
end

local function world_label()
    return full_name(get_world())
end

local function is_menu_world()
    local label = string.lower(world_label())
    return string.find(label, "menu", 1, true) ~= nil or string.find(label, "clawed_menu", 1, true) ~= nil
end

local function controller_count()
    local seen = {}
    local count = 0
    for _, candidate in ipairs({ "PlayerController", "BP_MenuSystemPlayerController_C" }) do
        for _, controller in pairs(find_all(candidate)) do
            if is_valid(controller) then
                local key = full_name(controller)
                if seen[key] ~= true then
                    seen[key] = true
                    count = count + 1
                end
            end
        end
    end
    return count
end

local function pawn_count()
    local count = 0
    for _, pawn in pairs(find_all("Pawn")) do
        if is_valid(pawn) then count = count + 1 end
    end
    return count
end

local function player_state_count()
    local seen = {}
    local count = 0
    local world = get_world()
    local game_state = get_prop(world, "GameState") or find_first("GameStateBase")
    local player_array = get_prop(game_state, "PlayerArray")
    if player_array ~= nil then
        for _, state in pairs(player_array) do
            if is_valid(state) then
                local key = full_name(state)
                if seen[key] ~= true then
                    seen[key] = true
                    count = count + 1
                end
            end
        end
    end
    for _, class_name_value in ipairs({ "PlayerState_FDG_C", "PlayerState" }) do
        for _, state in pairs(find_all(class_name_value)) do
            if is_valid(state) then
                local key = full_name(state)
                if seen[key] ~= true then
                    seen[key] = true
                    count = count + 1
                end
            end
        end
    end
    return count
end

local function compact_args(args)
    local parts = {}
    for i = 1, math.min(#args, 8) do
        local value = unwrap(args[i])
        local value_type = type(value)
        if value_type == "string" then
            table.insert(parts, tostring(i) .. "=string:" .. tostring(#value))
        elseif value_type == "number" or value_type == "boolean" or value == nil then
            table.insert(parts, tostring(i) .. "=" .. tostring(value))
        else
            table.insert(parts, tostring(i) .. "=" .. value_type .. ":" .. full_name(value))
        end
    end
    return table.concat(parts, ",")
end

local function clone_args(...)
    local args = { ... }
    for i = 1, #args do
        args[i] = unwrap(args[i])
    end
    return args
end

local function likely_session_result(args)
    for i = #args, 1, -1 do
        local value = unwrap(args[i])
        local value_type = type(value)
        if value ~= nil and value_type ~= "boolean" and value_type ~= "number" and value_type ~= "string" then
            return value, i
        end
    end
    return nil, nil
end

local function state_line()
    return "state=" .. coordinator.state ..
        "|generation=" .. tostring(coordinator.generation) ..
        "|intent=" .. tostring(coordinator.intent) ..
        "|lock_reason=" .. tostring(coordinator.lock_reason) ..
        "|world=" .. world_label() ..
        "|net_mode=" .. net_mode_label() ..
        "|menu_world=" .. tostring(is_menu_world()) ..
        "|controllers=" .. tostring(controller_count()) ..
        "|pawns=" .. tostring(pawn_count()) ..
        "|player_states=" .. tostring(player_state_count()) ..
        "|gi=" .. full_name(get_game_instance())
end

local function session_environment(source)
    log("session_environment", tostring(source) .. "|" .. state_line())
end

local function transition(next_state, reason)
    local prev = coordinator.state
    coordinator.state = next_state
    coordinator.lock_reason = reason
    log("state_transition", "from=" .. prev .. "|to=" .. next_state .. "|reason=" .. tostring(reason) .. "|" .. state_line())
end

local function snapshot(source)
    local ok, err = pcall(function()
        local instance = get_game_instance()
        session_environment(source)
        log("snapshot", tostring(source) .. "|" .. state_line() .. "|gi_class=" .. class_name(instance))
        for _, widget_class in ipairs({ "WBP_HostMultiplayer_C", "WBP_ServerBrowser_C", "WBP_ServerSlotBase_C" }) do
            local count = 0
            for _, widget in pairs(find_all(widget_class)) do
                if is_valid(widget) then
                    count = count + 1
                    if count <= 4 then
                        log("widget", tostring(source) ..
                            "|class=" .. widget_class ..
                            "|idx=" .. tostring(count) ..
                            "|name=" .. full_name(widget) ..
                            "|friendsOnly=" .. text(get_prop(widget, "FRIENDSONLYOPTION")) ..
                            "|lan=" .. text(get_prop(widget, "LANOptionsPicker")) ..
                            "|maxPlayers=" .. text(get_prop(widget, "MaxPlayerCountSlider")))
                    end
                end
            end
            log("widget_count", tostring(source) .. "|" .. widget_class .. "|" .. tostring(count))
        end
    end)
    if not ok then log("snapshot_error", tostring(source) .. "|" .. tostring(err)) end
end

local function emit_failure(reason, detail)
    local line = "failure|" .. tostring(reason) .. "|" .. tostring(detail) .. "|" .. state_line()
    coordinator.last_failure = line
    log("failure", line)
    write_failure(line)
    local first = math.max(1, #recent_events - 32)
    for i = first, #recent_events do
        local recent = "failure_recent|" .. tostring(i) .. "|" .. tostring(recent_events[i])
        print(marker .. recent)
        write_failure(recent)
    end
end

local function reset_to_idle(reason)
    coordinator.intent = nil
    coordinator.intent_started = 0.0
    transition("idle", reason)
end

local function reset_later(reason)
    local generation = coordinator.generation
    ExecuteWithDelay(reset_after_failure_ms, function()
        ExecuteInGameThread(function()
            if coordinator.generation ~= generation then return end
            if coordinator.state == "failed" or coordinator.state == "join_timeout" then
                reset_to_idle("failure_window_elapsed|" .. tostring(reason))
            end
        end)
    end)
end

local function busy()
    if coordinator.state == "idle" or coordinator.state == "joined" or coordinator.state == "failed" then
        return false
    end
    if os.clock() - coordinator.intent_started > (stale_lock_ms / 1000.0) then
        emit_failure("stale_intent_unlocked", "age=" .. tostring(os.clock() - coordinator.intent_started))
        reset_to_idle("stale_intent_unlocked")
        return false
    end
    return true
end

local function begin_intent(intent, reason)
    if busy() then
        emit_failure("intent_denied", "requested=" .. tostring(intent) .. "|reason=" .. tostring(reason))
        return false
    end
    coordinator.generation = coordinator.generation + 1
    coordinator.intent = intent
    coordinator.intent_started = os.clock()
    transition(intent .. "_requested", reason)
    return true
end

local function join_flow_active()
    return coordinator.state == "guarded_joining" or
        coordinator.state == "observing_original_join" or
        coordinator.state == "travel_pending" or
        coordinator.state == "host_dispatched" or
        coordinator.state == "observing_host"
end

local function finish_if_joined(source)
    if not join_flow_active() then return false end
    if is_menu_world() or controller_count() == 0 then return false end
    transition("joined", source)
    return true
end

local function schedule_join_timeout(generation, source)
    ExecuteWithDelay(join_timeout_ms, function()
        ExecuteInGameThread(function()
            if coordinator.generation ~= generation then return end
            if coordinator.state ~= "guarded_joining" and coordinator.state ~= "observing_original_join" and coordinator.state ~= "travel_pending" then return end
            if finish_if_joined("join_timeout_success_observed|" .. tostring(source)) then return end
            transition("join_timeout", tostring(source))
            emit_failure("join_timeout", "source=" .. tostring(source) .. "|last_join_args=" .. compact_args(coordinator.last_join_args or {}))
            reset_later("join_timeout")
        end)
    end)
end

local function guarded_join(reason, result)
    if result ~= nil and not is_valid(result) then
        emit_failure("guarded_join_skipped", tostring(reason) .. "|invalid_session_result")
        return false
    end
    if coordinator.state == "invite_pending" and string.find(tostring(reason), "invite_handoff_missing_original_join", 1, true) ~= nil then
        coordinator.intent = "guarded_join"
        coordinator.intent_started = os.clock()
        transition("guarded_join_requested", reason)
    elseif not begin_intent("guarded_join", reason) then
        return false
    end
    local generation = coordinator.generation
    local instance = get_game_instance()
    if not is_valid(instance) then
        transition("failed", "game_instance_missing")
        emit_failure("guarded_join_failed", tostring(reason) .. "|game_instance_missing")
        reset_later("guarded_join_no_instance")
        return false
    end
    local ok, result_value
    if result ~= nil then
        ok, result_value = call_method(instance, "Join Session", result)
    elseif coordinator.last_join_args ~= nil then
        ok, result_value = call_method(instance, "Join Session", unpack_fn(coordinator.last_join_args))
    else
        transition("failed", "no_join_payload")
        emit_failure("guarded_join_failed", tostring(reason) .. "|no_captured_join_payload")
        reset_later("guarded_join_no_payload")
        return false
    end
    log("guarded_call", "Join Session|reason=" .. tostring(reason) .. "|ok=" .. tostring(ok) .. "|result=" .. tostring(result_value))
    if not ok then
        transition("failed", "join_call_failed")
        emit_failure("guarded_join_failed", tostring(reason) .. "|" .. tostring(result_value))
        reset_later("guarded_join_call_failed")
        return false
    end
    transition("guarded_joining", reason)
    schedule_join_timeout(generation, reason)
    return true
end

local function guarded_find(reason)
    if not begin_intent("find", reason) then return false end
    local instance = get_game_instance()
    if not is_valid(instance) then
        transition("failed", "game_instance_missing")
        emit_failure("find_failed", tostring(reason) .. "|game_instance_missing")
        reset_later("find_no_instance")
        return false
    end
    local ok, result_value
    if coordinator.last_find_args ~= nil then
        ok, result_value = call_method(instance, "Find Friends Sessions", unpack_fn(coordinator.last_find_args))
    else
        ok, result_value = call_method(instance, "Find Friends Sessions")
    end
    log("guarded_call", "Find Friends Sessions|reason=" .. tostring(reason) .. "|args=" .. compact_args(coordinator.last_find_args or {}) .. "|ok=" .. tostring(ok) .. "|result=" .. tostring(result_value))
    if ok then
        transition("find_dispatched", reason)
        local generation = coordinator.generation
        ExecuteWithDelay(7000, function()
            ExecuteInGameThread(function()
                if coordinator.generation == generation and coordinator.state == "find_dispatched" then
                    reset_to_idle("find_window_elapsed|" .. tostring(reason))
                end
            end)
        end)
        return true
    end
    transition("failed", "find_call_failed")
    emit_failure("find_failed", tostring(reason) .. "|" .. tostring(result_value))
    reset_later("find_call_failed")
    return false
end

local function guarded_host(reason)
    if not begin_intent("host", reason) then return false end
    local instance = get_game_instance()
    if not is_valid(instance) then
        transition("failed", "game_instance_missing")
        emit_failure("host_failed", tostring(reason) .. "|game_instance_missing")
        reset_later("host_no_instance")
        return false
    end
    local ok, result_value
    if coordinator.last_host_args ~= nil then
        ok, result_value = call_method(instance, "Create  Friends Session", unpack_fn(coordinator.last_host_args))
    else
        ok, result_value = call_method(instance, "Create  Friends Session")
    end
    log("guarded_call", "Create  Friends Session|reason=" .. tostring(reason) .. "|args=" .. compact_args(coordinator.last_host_args or {}) .. "|ok=" .. tostring(ok) .. "|result=" .. tostring(result_value))
    if ok then
        transition("host_dispatched", reason)
        return true
    end
    transition("failed", "host_call_failed")
    emit_failure("host_failed", tostring(reason) .. "|" .. tostring(result_value))
    reset_later("host_call_failed")
    return false
end

local function on_join_session(source, ...)
    local args = clone_args(...)
    coordinator.last_join_args = args
    coordinator.original_join_seen_generation = coordinator.generation
    if not busy() then
        coordinator.generation = coordinator.generation + 1
        coordinator.intent = "original_join"
        coordinator.intent_started = os.clock()
    end
    transition("observing_original_join", source .. "|args=" .. compact_args(args))
    schedule_join_timeout(coordinator.generation, source)
    snapshot("join_observed")
end

local function on_join_failure(source, ...)
    local args = clone_args(...)
    transition("failed", source)
    emit_failure("join_failure", "source=" .. source .. "|args=" .. compact_args(args))
    reset_later("join_failure")
end

local function on_invite_accepted(source, ...)
    local args = clone_args(...)
    local result, idx = likely_session_result(args)
    if result ~= nil then coordinator.last_invite_result = result end
    if not busy() then
        coordinator.generation = coordinator.generation + 1
        coordinator.intent = "invite"
        coordinator.intent_started = os.clock()
    end
    local generation = coordinator.generation
    transition("invite_pending", source .. "|result_idx=" .. tostring(idx) .. "|args=" .. compact_args(args))
    snapshot("invite_accepted")
    ExecuteWithDelay(invite_join_wait_ms, function()
        ExecuteInGameThread(function()
            if coordinator.generation ~= generation then return end
            if coordinator.original_join_seen_generation == generation then
                log("invite_handoff", "original_join_seen|generation=" .. tostring(generation))
                return
            end
            guarded_join("invite_handoff_missing_original_join|" .. source, coordinator.last_invite_result)
        end)
    end)
end

local function on_find_sessions(source, ...)
    local args = clone_args(...)
    coordinator.last_find_args = args
    coordinator.last_search_result = select(1, likely_session_result(args)) or coordinator.last_search_result
    if not busy() then
        coordinator.generation = coordinator.generation + 1
        coordinator.intent = "original_find"
        coordinator.intent_started = os.clock()
    end
    transition("observing_find", source .. "|args=" .. compact_args(args))
    snapshot("find_sessions")
    local generation = coordinator.generation
    ExecuteWithDelay(7000, function()
        ExecuteInGameThread(function()
            if coordinator.generation == generation and coordinator.state == "observing_find" then
                reset_to_idle("find_window_elapsed|" .. tostring(source))
            end
        end)
    end)
end

local function on_create_session(source, ...)
    local args = clone_args(...)
    coordinator.last_host_args = args
    if not busy() then
        coordinator.generation = coordinator.generation + 1
        coordinator.intent = "original_host"
        coordinator.intent_started = os.clock()
    end
    transition("observing_host", source .. "|args=" .. compact_args(args))
    snapshot("create_session")
end

local function on_load_session_level(source, ...)
    transition("travel_pending", source .. "|args=" .. compact_args(clone_args(...)))
    snapshot("load_session_level")
    local generation = coordinator.generation
    ExecuteWithDelay(6000, function()
        ExecuteInGameThread(function()
            if coordinator.generation ~= generation then return end
            if not finish_if_joined("post_load_session_level|" .. tostring(source)) then
                snapshot("post_load_session_level")
            end
        end)
    end)
end

local function on_server_slot(source, ...)
    local args = clone_args(...)
    local result, idx = likely_session_result(args)
    if result ~= nil then
        coordinator.last_search_result = result
        log("server_slot_result", source .. "|result_idx=" .. tostring(idx) .. "|result=" .. full_name(result) .. "|args=" .. compact_args(args))
        if coordinator.state == "find_dispatched" or coordinator.state == "observing_find" then
            reset_to_idle("server_slot_result_ready")
        end
    else
        log("server_slot_result_missing", source .. "|args=" .. compact_args(args))
    end
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
    if type(ar) == "userdata" and ar:type() == "FOutputDevice" then
        ar:Log(line)
    end
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
                emit_failure("console_command_failed", name .. "|" .. tostring(result))
                console_reply(ar, name .. "|failed|" .. tostring(result))
                return true
            end
            return result ~= false
        end)
    end)
    log("console_command", name .. "|registered=" .. tostring(ok) .. "|" .. tostring(err))
end

register_command("cmm_session_status", function(full_command, parameters, ar)
    console_reply(ar, "cmm_session_status|" .. state_line())
    if coordinator.last_failure ~= nil then console_reply(ar, "last_failure|" .. coordinator.last_failure) end
    return true
end)

register_command("cmm_session_scan", function(full_command, parameters, ar)
    session_environment("console_scan")
    snapshot("console_scan")
    console_reply(ar, "cmm_session_scan|ok|" .. state_line())
    return true
end)

register_command("cmm_session_failures", function(full_command, parameters, ar)
    console_reply(ar, "cmm_session_failures|recent_count=" .. tostring(#recent_events))
    if coordinator.last_failure ~= nil then console_reply(ar, "last_failure|" .. coordinator.last_failure) end
    local first = math.max(1, #recent_events - 12)
    for i = first, #recent_events do
        console_reply(ar, "recent|" .. tostring(i) .. "|" .. tostring(recent_events[i]))
    end
    return true
end)

register_command("cmm_session_reset", function(full_command, parameters, ar)
    reset_to_idle("console_reset")
    console_reply(ar, "cmm_session_reset|ok")
    return true
end)

register_command("cmm_session_clear_payloads", function(full_command, parameters, ar)
    coordinator.last_join_args = nil
    coordinator.last_invite_result = nil
    coordinator.last_search_result = nil
    coordinator.last_host_args = nil
    coordinator.last_find_args = nil
    console_reply(ar, "cmm_session_clear_payloads|ok")
    return true
end)

register_command("cmm_session_find", function(full_command, parameters, ar)
    local ok = guarded_find("console_find")
    console_reply(ar, "cmm_session_find|" .. tostring(ok))
    return true
end)

register_command("cmm_session_host", function(full_command, parameters, ar)
    local ok = guarded_host("console_host")
    console_reply(ar, "cmm_session_host|" .. tostring(ok))
    return true
end)

register_command("cmm_session_join_last", function(full_command, parameters, ar)
    local result = coordinator.last_search_result or coordinator.last_invite_result
    local ok = guarded_join("console_join_last", result)
    console_reply(ar, "cmm_session_join_last|" .. tostring(ok))
    return true
end)

local gi_class = "/Game/MenuSystemPro/Blueprints/GameFramework/BP_MenuSystemGameInstance_FDG.BP_MenuSystemGameInstance_FDG_C"
register_hook("GI_OnSessionInviteAccepted", gi_class .. ":OnSessionInviteAccepted", function(self, ...) coordinator.last_game_instance = unwrap(self) on_invite_accepted("GI_OnSessionInviteAccepted", ...) end)
register_hook("GI_JoinSession", gi_class .. ":Join Session", function(self, ...) coordinator.last_game_instance = unwrap(self) on_join_session("GI_JoinSession", ...) end)
register_hook("GI_HandleJoinFailure", gi_class .. ":Handle Join Failure", function(self, ...) coordinator.last_game_instance = unwrap(self) on_join_failure("GI_HandleJoinFailure", ...) end)
register_hook("GI_FindFriendsSessions", gi_class .. ":Find Friends Sessions", function(self, ...) coordinator.last_game_instance = unwrap(self) on_find_sessions("GI_FindFriendsSessions", ...) end)
register_hook("GI_CreateFriendsSession", gi_class .. ":Create  Friends Session", function(self, ...) coordinator.last_game_instance = unwrap(self) on_create_session("GI_CreateFriendsSession", ...) end)
register_hook("GI_LoadSessionLevel", gi_class .. ":Load Session Level", function(self, ...) coordinator.last_game_instance = unwrap(self) on_load_session_level("GI_LoadSessionLevel", ...) end)
register_hook("GI_OnOpenLevel", gi_class .. ":OnOpenLevel", function(self, ...) coordinator.last_game_instance = unwrap(self) on_load_session_level("GI_OnOpenLevel", ...) end)
register_hook("GI_ToggleGameOnline", gi_class .. ":Toggle Game Online", function(self, ...) coordinator.last_game_instance = unwrap(self) log("toggle_game_online", compact_args(clone_args(...))) end)

local host_widget = "/Game/MenuSystemPro/Blueprints/Widgets/WBP_HostMultiplayer.WBP_HostMultiplayer_C"
local browser_widget = "/Game/MenuSystemPro/Blueprints/Widgets/WBP_ServerBrowser.WBP_ServerBrowser_C"
local slot_widget = "/Game/MenuSystemPro/Blueprints/Widgets/WBP_ServerSlotBase.WBP_ServerSlotBase_C"
register_hook("WBP_Host_LoadSessionLevel", host_widget .. ":Load Session Level", function(_, ...) on_load_session_level("WBP_Host_LoadSessionLevel", ...) end)
register_hook("WBP_Browser_OnOpenLevel", browser_widget .. ":OnOpenLevel", function(_, ...) on_load_session_level("WBP_Browser_OnOpenLevel", ...) end)
register_hook("WBP_ServerSlot_SetupSlotFromServerData", slot_widget .. ":SetupSlotFromServerData", function(_, ...) on_server_slot("WBP_ServerSlot_SetupSlotFromServerData", ...) end)

log("hook_register", "LoadMapPostHook|disabled|broad_lifecycle_hook_deferred")
log("hook_register", "NotifyGameInstance|disabled|broad_lifecycle_hook_deferred")

log("startup", "version=" .. version .. "|helpers=" .. tostring(ok_helpers))
ExecuteInGameThread(function() snapshot("startup") end)
ExecuteWithDelay(5000, function()
    ExecuteInGameThread(function() snapshot("startup_delayed") end)
end)
`;
const readme = [
  `# ${modName}`,
  "",
  "Prototype UE4SS package for hardening and diagnosing Clawed co-op lobby/session failures with a coordinator state machine.",
  "",
  "What it does:",
  "",
  "- Hooks Clawed's packaged `BP_MenuSystemGameInstance_FDG` session functions: `OnSessionInviteAccepted`, `Join Session`, `Handle Join Failure`, `Find Friends Sessions`, `Create  Friends Session`, `Load Session Level`, `OnOpenLevel`, and `Toggle Game Online`.",
  "- Hooks host, server browser, and server-slot widget entry points where available.",
  "- Tracks a single active session intent at a time: invite, join, host, find, travel, joined, failed, and idle.",
  "- Completes the invite-accepted handoff once if the game accepts an invite but never dispatches `Join Session`.",
  "- Refuses duplicate guarded commands while a join/host/find/travel flow is active instead of stacking retries.",
  "- Captures the latest invite/search/join payloads and exposes deliberate recovery commands through the UE console.",
  "- Reuses captured host/find Blueprint arguments for guarded console retries when available.",
  "- Logs `session_environment` snapshots with world, net mode, controller count, pawn count, and PlayerState count.",
  "- Leaves broad map-load and object-notify hooks disabled; only specific Clawed session/widget hooks are registered.",
  "- Declares a conflict with the legacy `ClawedCoopSessionGuard` package ID and loads after `CoopCapacity8` when both packages are enabled.",
  "- Records structured session, invite, join, failure, timeout, world, widget, controller, and pawn markers to `UE4SS.log`.",
  "- Writes compact failure bundles to `ue4ss/Mods/CoopSessionGuard/session-failures.log` when Lua file IO is available.",
  "",
  "Console commands:",
  "",
  "- `cmm_session_status`: print the coordinator state and last failure.",
  "- `cmm_session_scan`: print a diagnostic snapshot without dispatching session calls.",
  "- `cmm_session_failures`: print recent guard events and the latest failure.",
  "- `cmm_session_reset`: release the coordinator lock after a stuck lobby/session flow.",
  "- `cmm_session_clear_payloads`: clear captured invite/search/join/host/find payloads.",
  "- `cmm_session_find`: dispatch one guarded `Find Friends Sessions` call.",
  "- `cmm_session_host`: dispatch one guarded `Create  Friends Session` call.",
  "- `cmm_session_join_last`: join the latest captured server-slot or invite session result.",
  "",
  "Expected support markers:",
  "",
  "- `[CoopSessionGuard] startup|...`",
  "- `[CoopSessionGuard] hook_register|...`",
  "- `[CoopSessionGuard] session_environment|...`",
  "- `[CoopSessionGuard] snapshot|...`",
  "- `[CoopSessionGuard] state_transition|...`",
  "- `[CoopSessionGuard] invite_handoff|...`",
  "- `[CoopSessionGuard] guarded_call|...`",
  "- `[CoopSessionGuard] join_failure|...`",
  "- `[CoopSessionGuard] join_timeout|...`",
  "- `[CoopSessionGuard] failure_recent|...`",
  "",
  "Collection path:",
  "",
  "- Primary: `Clawed\\Binaries\\Win64\\ue4ss\\UE4SS.log`",
  "- Failure sidecar, if writable: `Clawed\\Binaries\\Win64\\ue4ss\\Mods\\CoopSessionGuard\\session-failures.log`",
  "",
  "Safety boundaries:",
  "",
  "- Packaged only as a normal `.clawedmod` with `loader: \"ue4ss\"`.",
  "- Does not patch Steam, EOS, executable files, anti-cheat, game DLLs, OnlineSubsystem binaries, cooked Blueprint assets, GameMode assets, or PlayerController assets.",
  "- Does not force-close Clawed, mutate save data, or attempt to bypass server authority.",
  "- Uses only observed packaged Blueprint functions and UE4SS hooks/console commands.",
  "- Lua hooks are observational for the original UI flow; UE4SS has not been proven here to cancel original Blueprint execution.",
  "- Broad map-load and object-notify hooks are disabled because they share the same lifecycle risk class as the prior co-op crash path.",
  "- No package-level player-count cap is imposed; actual maximum party size is governed by Clawed.",
  "- Host/client multiplayer behavior remains unvalidated until tested across Clawed's supported party sizes."
].join("\n");
const manifest = {
  schemaVersion: 1,
  id: modId,
  name: modName,
  version,
  author: "Clawed Mod Manager",
  description:
    "Prototype UE4SS coordinator that serializes Clawed co-op session intent without imposing a package-level player-count cap, completes missing invite handoff, and captures failed-join diagnostics.",
  game: "clawed",
  loader: "ue4ss",
  dependencies: [],
  conflicts: ["ClawedCoopSessionGuard"],
  loadAfter: ["CoopCapacity8"],
  loadBefore: [],
  packageIdentity: generatedPackageIdentity(modId),
  creatorAssets: generatedCreatorSupportMetadata({
    modId,
    modName,
    version,
    payloadPath,
    buildId: steamBuildId,
    buildNotes: steamBuildNotes,
    tags: ["ue4ss_runtime", "lua", "coop_session_coordinator"]
  })
};

const packagePaths = [];
packagePaths.push(await writePackage(outputRoot));
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const unpackedOutputRoot = path.resolve(
  process.env.CMM_COOP_SESSION_GUARD_UNPACKED_OUTPUT_DIR ??
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
    supportedSteamBuilds: generatedSupportedSteamBuilds(
      steamBuildId,
      steamBuildNotes
    ),
    hardening: [
      "serializes join, host, find, invite, and travel intent in a coordinator state machine",
      "completes invite-accepted flows only when no original Join Session dispatch is observed",
      "exposes deliberate console recovery commands instead of automatic join retry loops",
      "captures latest invite/search/join payloads for controlled user-driven recovery",
      "reuses captured host/find Blueprint arguments for guarded console retries",
      "logs session_environment snapshots with world, net mode, controller, pawn, and PlayerState counts",
      "leaves broad map-load and object-notify hooks disabled",
      "does not impose a package-level player-count cap",
      "records failure bundles and recent event context for support"
    ],
    safetyBoundaries: [
      "normal .clawedmod UE4SS package only",
      "no Steam/EOS/executable/anti-cheat/GameMode/PlayerController asset patching",
      "no save, inventory, or world-item mutation",
      "observational hooks cannot guarantee original Blueprint execution is cancelled",
      "multi-client supported-party-size behavior unvalidated"
    ],
    consoleCommands: [
      "cmm_session_status",
      "cmm_session_scan",
      "cmm_session_failures",
      "cmm_session_reset",
      "cmm_session_clear_payloads",
      "cmm_session_find",
      "cmm_session_host",
      "cmm_session_join_last"
    ],
    logMarkers: [
      "[CoopSessionGuard] state_transition|...",
      "[CoopSessionGuard] session_environment|...",
      "[CoopSessionGuard] snapshot|...",
      "[CoopSessionGuard] guarded_call|...",
      "[CoopSessionGuard] join_failure|...",
      "[CoopSessionGuard] join_timeout|...",
      "[CoopSessionGuard] failure_recent|..."
    ],
    logPaths: [
      "Clawed\\Binaries\\Win64\\ue4ss\\UE4SS.log",
      "Clawed\\Binaries\\Win64\\ue4ss\\Mods\\CoopSessionGuard\\session-failures.log"
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
