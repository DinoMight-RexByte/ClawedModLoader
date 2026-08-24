import crypto from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";
import {
  currentClawedSteamBuildId,
  generatedCreatorSupportMetadata,
  generatedSupportedSteamBuilds
} from "./clawedBuildMetadata.mjs";

const modId = "CoopCatchupTeleport";
const modName = "Co-op Catch-up Teleport";
const version = "0.2.2-prototype.20260822";
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "Manual-only N-player hotfix generated against the currently detected Clawed build; no multiplayer runtime validation has been performed.";
const releaseRoot = path.resolve("release");
const outputRoot = path.resolve(
  process.env.CMM_COOP_CATCHUP_OUTPUT_DIR ??
    path.join(releaseRoot, "prototype-mods")
);
const payloadPath = `payload/Mods/${modId}/Scripts/main.lua`;
const lua = String.raw`local ok_helpers, UEHelpers = pcall(require, "UEHelpers")
local marker = "[CoopCatchupTeleport] "
local max_retries = 8
local retry_delay_ms = 500
local cooldown_seconds = 30.0
local radial_radii = { 300.0, 450.0, 650.0, 900.0 }
local radial_angles = { 0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0 }
local capsule_radius = 45.0
local capsule_half_height = 96.0
local unpack_fn = table.unpack or unpack
local last_catchup = {}

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

local function call_method(object, name, ...)
    object = unwrap(object)
    if not is_valid(object) then return false, nil end
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
    if not is_valid(object) then return false, "invalid_object" end
    local ok, err = pcall(function() object[name] = value end)
    return ok, err
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

local function bool_text(value)
    if value == nil then return "unknown" end
    return tostring(value)
end

local function lower_text(value)
    return string.lower(tostring(value or ""))
end

local function value_text(value)
    value = unwrap(value)
    if value == nil then return nil end
    local value_type = type(value)
    if value_type == "string" or value_type == "number" or value_type == "boolean" then return tostring(value) end
    if is_valid(value) then return full_name(value) end
    return tostring(value)
end

local function vec_text(value)
    if value == nil then return "<nil>" end
    return string.format("%.1f,%.1f,%.1f", tonumber(value.X) or 0.0, tonumber(value.Y) or 0.0, tonumber(value.Z) or 0.0)
end

local function vec(x, y, z)
    return { X = x, Y = y, Z = z }
end

local function vec_add(a, b)
    return vec((tonumber(a.X) or 0.0) + (tonumber(b.X) or 0.0), (tonumber(a.Y) or 0.0) + (tonumber(b.Y) or 0.0), (tonumber(a.Z) or 0.0) + (tonumber(b.Z) or 0.0))
end

local function vec_key(value)
    return string.format("%.0f:%.0f:%.0f", tonumber(value.X) or 0.0, tonumber(value.Y) or 0.0, tonumber(value.Z) or 0.0)
end

local function now_seconds()
    return os.clock()
end

local function find_all(class_name_value)
    if type(FindAllOf) ~= "function" then return {} end
    local ok, objects = pcall(function() return FindAllOf(class_name_value) end)
    if not ok or objects == nil then return {} end
    return objects
end

local function find_first(class_name_value)
    if type(FindFirstOf) ~= "function" then return nil end
    local ok, object = pcall(function() return FindFirstOf(class_name_value) end)
    if ok and is_valid(object) then return object end
    return nil
end

local function get_world()
    if ok_helpers and UEHelpers.GetWorld ~= nil then
        local ok, world = pcall(function() return UEHelpers.GetWorld() end)
        if ok and is_valid(world) then return world end
    end
    return find_first("World")
end

local function get_location(actor)
    local ok, value = call_method(actor, "K2_GetActorLocation")
    if ok and value ~= nil then return value, "actor" end
    local root = get_prop(actor, "RootComponent")
    ok, value = call_method(root, "K2_GetComponentLocation")
    if ok and value ~= nil then return value, "root" end
    return nil, "missing"
end

local function get_rotation(actor)
    local ok, value = call_method(actor, "K2_GetActorRotation")
    if ok and value ~= nil then return value, "actor" end
    local root = get_prop(actor, "RootComponent")
    ok, value = call_method(root, "K2_GetComponentRotation")
    if ok and value ~= nil then return value, "root" end
    return { Pitch = 0.0, Yaw = 0.0, Roll = 0.0 }, "default"
end

local function dist_sq(a, b)
    if a == nil or b == nil then return nil end
    local dx = (tonumber(a.X) or 0.0) - (tonumber(b.X) or 0.0)
    local dy = (tonumber(a.Y) or 0.0) - (tonumber(b.Y) or 0.0)
    local dz = (tonumber(a.Z) or 0.0) - (tonumber(b.Z) or 0.0)
    return dx * dx + dy * dy + dz * dz
end

local function has_authority(actor)
    local ok, value = call_method(actor, "HasAuthority")
    if ok then return value == true end
    return nil
end

local function is_local_controller(controller)
    local ok, value = call_method(controller, "IsLocalController")
    if ok then return value == true end
    return nil
end

local function death_reason(pawn)
    if not is_valid(pawn) then return "invalid" end
    local lower_class = string.lower(class_name(pawn))
    if string.find(lower_class, "spectator", 1, true) ~= nil then return "spectator" end
    for _, name in ipairs({ "IsDead", "GetIsDead", "IsDying", "IsPendingKillPending" }) do
        local ok, value = call_method(pawn, name)
        if ok and value == true then return name end
    end
    for _, name in ipairs({ "IsAlive" }) do
        local ok, value = call_method(pawn, name)
        if ok and value == false then return name end
    end
    for _, name in ipairs({ "Health", "CurrentHealth" }) do
        local value = get_prop(pawn, name)
        if type(value) == "number" and value <= 0 then return name .. "<=0" end
    end
    return nil
end

local function same_object(left, right)
    if not is_valid(left) or not is_valid(right) then return false end
    return full_name(left) == full_name(right)
end

local function get_player_state(controller, pawn)
    for _, object in ipairs({ controller, pawn }) do
        local state = get_prop(object, "PlayerState")
        if is_valid(state) then return state, "PlayerState" end
        local ok, method_state = call_method(object, "GetPlayerState")
        if ok and is_valid(method_state) then return method_state, "GetPlayerState" end
        ok, method_state = call_method(object, "K2_GetPlayerState")
        if ok and is_valid(method_state) then return method_state, "K2_GetPlayerState" end
    end
    if ok_helpers and UEHelpers.GetAllPlayerStates ~= nil then
        local ok, states = pcall(function() return UEHelpers.GetAllPlayerStates() end)
        if ok and states ~= nil then
            for _, state in ipairs(states) do
                local state_pawn = get_prop(state, "PawnPrivate") or get_prop(state, "Pawn")
                if same_object(state_pawn, pawn) then return state, "PlayerArray" end
            end
        end
    end
    return nil, "missing"
end

local function state_key(record)
    if record ~= nil and is_valid(record.state) then return full_name(record.state) end
    if record ~= nil and is_valid(record.controller) then return full_name(record.controller) end
    if record ~= nil and is_valid(record.pawn) then return full_name(record.pawn) end
    return "<unknown>"
end

local function bool_gate(object, names)
    for _, name in ipairs(names) do
        local ok, value = call_method(object, name)
        if ok and value == true then return name end
        value = get_prop(object, name)
        if value == true then return name end
    end
    return nil
end

local function team_value(state)
    for _, name in ipairs({ "Team", "TeamID", "TeamId", "TeamIndex", "TeamNumber", "TeamName", "GenericTeamId" }) do
        local value = value_text(get_prop(state, name))
        if value ~= nil and value ~= "" then return value, name end
        local ok, method_value = call_method(state, "Get" .. name)
        value = value_text(method_value)
        if ok and value ~= nil and value ~= "" then return value, "Get" .. name end
    end
    return nil, "unknown"
end

local function same_session_team(requester, target)
    if requester == nil or target == nil then return false, "missing_record" end
    local requester_team, requester_source = team_value(requester.state)
    local target_team, target_source = team_value(target.state)
    if requester_team ~= nil and target_team ~= nil and requester_team ~= target_team then
        return false, "team_mismatch:" .. requester_source .. "=" .. requester_team .. "," .. target_source .. "=" .. target_team
    end
    if requester_team == nil or target_team == nil then
        return true, "team_unknown"
    end
    return true, "team_match:" .. requester_team
end

local function critical_objective_reason(record)
    local names = {
        "bIsCarryingCriticalObjective",
        "IsCarryingCriticalObjective",
        "HasCriticalObjective",
        "bCarryingCriticalObjective",
        "bCarryingObjective",
        "IsCarryingObjective",
        "HasObjective"
    }
    for _, object in ipairs({ record.pawn, record.controller, record.state }) do
        local source = bool_gate(object, names)
        if source ~= nil then return source end
    end
    for _, object in ipairs({ record.pawn, record.controller, record.state }) do
        for _, name in ipairs({ "CriticalObjective", "CarriedCriticalObjective", "ObjectiveActor", "HeldObjective" }) do
            local value = get_prop(object, name)
            if is_valid(value) then
                local text = lower_text(full_name(value))
                if string.find(text, "critical", 1, true) ~= nil or string.find(text, "objective", 1, true) ~= nil then return name end
            end
        end
    end
    return nil
end

local function state_gate_reason(record)
    if record == nil then return "missing_record" end
    local reason = death_reason(record.pawn)
    if reason ~= nil then return "not_alive:" .. reason end
    local names = {
        "bCinematicMode",
        "bInCinematic",
        "IsInCinematic",
        "IsPlayingCinematic",
        "bInBossFight",
        "IsInBossFight",
        "bInUnsafeVolume",
        "IsInUnsafeVolume"
    }
    for _, object in ipairs({ record.pawn, record.controller, record.state }) do
        local source = bool_gate(object, names)
        if source ~= nil then return source end
    end
    for _, object in ipairs({ record.pawn, record.controller, record.state }) do
        local text = lower_text(full_name(object) .. "|" .. class_name(object))
        for _, keyword in ipairs({ "cinematic", "boss", "unsafevolume" }) do
            if string.find(text, keyword, 1, true) ~= nil then return "name_contains_" .. keyword end
        end
    end
    return nil
end

local function get_controller_pawn(controller)
    for _, name in ipairs({ "Pawn", "AcknowledgedPawn" }) do
        local pawn = get_prop(controller, name)
        if is_valid(pawn) then return pawn, name end
    end
    local ok, pawn = call_method(controller, "GetPawn")
    if ok and is_valid(pawn) then return pawn, "GetPawn" end
    return nil, "missing"
end

local function collect_controllers()
    local controllers = {}
    local seen = {}
    for _, class_name_value in ipairs({ "PlayerController", "BP_MenuSystemPlayerController_C" }) do
        for _, controller in pairs(find_all(class_name_value)) do
            if is_valid(controller) then
                local name = full_name(controller)
                if seen[name] ~= true then
                    seen[name] = true
                    table.insert(controllers, controller)
                end
            end
        end
    end
    return controllers
end

local function local_controller()
    if ok_helpers and UEHelpers.GetPlayerController ~= nil then
        local ok, controller = pcall(function() return UEHelpers.GetPlayerController() end)
        if ok and is_valid(controller) then return controller end
    end
    local controllers = collect_controllers()
    for _, controller in ipairs(controllers) do
        if is_local_controller(controller) == true then return controller end
    end
    return controllers[1]
end

local function collect_player_pawns()
    local players = {}
    local seen = {}
    for _, controller in ipairs(collect_controllers()) do
        local pawn = get_controller_pawn(controller)
        local reason = death_reason(pawn)
        local location = nil
        if reason == nil then location = get_location(pawn) end
        local state = get_player_state(controller, pawn)
        if reason == nil and location ~= nil then
            local key = full_name(pawn)
            if seen[key] ~= true then
                seen[key] = true
                table.insert(players, { controller = controller, pawn = pawn, state = state, location = location, name = key })
            end
        end
    end
    return players
end

local function ensure_target_record(players, pawn)
    for _, player in ipairs(players) do
        if same_object(player.pawn, pawn) then return player end
    end
    local location = get_location(pawn)
    if location == nil then return nil end
    local state = get_player_state(nil, pawn)
    local target = { controller = nil, pawn = pawn, state = state, location = location, name = full_name(pawn) }
    table.insert(players, target)
    return target
end

local function teammate_candidates(target, players, preferred_state)
    local candidates = {}
    local preferred_requested = is_valid(preferred_state)
    for _, player in ipairs(players) do
        if not same_object(player.pawn, target.pawn) then
            local distance = dist_sq(target.location, player.location)
            if distance ~= nil then
                local preferred = preferred_requested and same_object(player.state, preferred_state)
                table.insert(candidates, { player = player, distance = distance, choice = preferred and "preferred" or "nearest", preferred = preferred })
            end
        end
    end
    table.sort(candidates, function(left, right)
        if left.preferred ~= right.preferred then return left.preferred == true end
        return left.distance < right.distance
    end)
    return candidates
end

local function get_kismet_system_library()
    if ok_helpers and UEHelpers.GetKismetSystemLibrary ~= nil then
        local ok, kismet = pcall(function() return UEHelpers.GetKismetSystemLibrary() end)
        if ok and is_valid(kismet) then return kismet end
    end
    return find_first("KismetSystemLibrary")
end

local function find_nav_system()
    for _, object_path in ipairs({
        "/Script/NavigationSystem.Default__NavigationSystemV1",
        "/Script/NavigationSystem.NavigationSystemV1"
    }) do
        if type(StaticFindObject) == "function" then
            local ok, object = pcall(function() return StaticFindObject(object_path) end)
            if ok and is_valid(object) then return object, object_path end
        end
    end
    return find_first("NavigationSystemV1"), "FindFirstOf"
end

local function project_point_to_navigation(world, point)
    local nav, source = find_nav_system()
    if not is_valid(nav) then return point, "nav_unavailable", true end
    local projected = {}
    local extent = vec(500.0, 500.0, 650.0)
    local attempts = {
        function() return nav:K2_ProjectPointToNavigation(world, point, projected, nil, nil, extent) end,
        function() return nav:ProjectPointToNavigation(point, projected, extent) end,
        function() return nav:ProjectPointToNavigation(world, point, projected, extent) end
    }
    for idx, attempt in ipairs(attempts) do
        local ok, result = pcall(attempt)
        if ok and result ~= false then
            if projected.X ~= nil or projected.Y ~= nil or projected.Z ~= nil then
                return projected, "nav_projected:" .. source .. ":" .. tostring(idx), true
            end
            return point, "nav_called_no_projected:" .. source .. ":" .. tostring(idx), true
        end
    end
    return point, "nav_failed:" .. source, true
end

local function unsafe_volume_clear(location)
    local checked = 0
    for _, class_name_value in ipairs({ "PainCausingVolume", "TriggerVolume", "PhysicsVolume", "Volume" }) do
        for _, volume in pairs(find_all(class_name_value)) do
            if is_valid(volume) then
                local text = lower_text(full_name(volume) .. "|" .. class_name(volume))
                local unsafe = false
                for _, keyword in ipairs({ "unsafe", "hazard", "death", "kill", "pain", "lava", "void", "boss", "cinematic" }) do
                    if string.find(text, keyword, 1, true) ~= nil then unsafe = true end
                end
                if unsafe then
                    checked = checked + 1
                    local ok, inside = call_method(volume, "EncompassesPoint", location, capsule_radius, nil)
                    if ok and inside == true then return false, "unsafe_volume:" .. full_name(volume) end
                    local volume_location = get_location(volume)
                    local distance = dist_sq(location, volume_location)
                    if distance ~= nil and distance < 4000000.0 then return false, "near_unsafe_volume:" .. full_name(volume) end
                end
            end
        end
    end
    return true, "checked=" .. tostring(checked)
end

local function capsule_sweep_clear(world, pawn, teammate, location)
    local kismet = get_kismet_system_library()
    if not is_valid(kismet) then return false, "kismet_unavailable" end
    local actors_to_ignore = {}
    if is_valid(pawn) then table.insert(actors_to_ignore, pawn) end
    if is_valid(teammate) then table.insert(actors_to_ignore, teammate) end
    local start_location = vec_add(location, vec(0.0, 0.0, -30.0))
    local end_location = vec_add(location, vec(0.0, 0.0, 30.0))
    local hit_result = {}
    local trace_color = { R = 0.0, G = 0.0, B = 0.0, A = 0.0 }
    local ok, was_hit = pcall(function()
        return kismet:CapsuleTraceSingle(
            is_valid(world) and world or pawn,
            start_location,
            end_location,
            capsule_radius,
            capsule_half_height,
            0,
            false,
            actors_to_ignore,
            0,
            hit_result,
            true,
            trace_color,
            trace_color,
            0.0
        )
    end)
    if not ok then return false, "capsule_error:" .. tostring(was_hit) end
    if was_hit == true then
        local hit_actor = nil
        if ok_helpers and UEHelpers.GetActorFromHitResult ~= nil then
            local hit_ok, actor = pcall(function() return UEHelpers.GetActorFromHitResult(hit_result) end)
            if hit_ok and is_valid(actor) then hit_actor = full_name(actor) end
        end
        return false, "capsule_blocked:" .. tostring(hit_actor or "unknown")
    end
    return true, "capsule_clear"
end

local function find_safe_location(source, world, target, teammate)
    local idx = 0
    for _, radius in ipairs(radial_radii) do
        for _, angle in ipairs(radial_angles) do
            idx = idx + 1
            local radians = math.rad(angle)
            local candidate = vec_add(teammate.location, vec(math.cos(radians) * radius, math.sin(radians) * radius, capsule_half_height + 20.0))
            local projected, nav_detail = project_point_to_navigation(world, candidate)
            local volume_ok, volume_detail = unsafe_volume_clear(projected)
            local sweep_ok, sweep_detail = false, "volume_blocked"
            if volume_ok then sweep_ok, sweep_detail = capsule_sweep_clear(world, target.pawn, teammate.pawn, projected) end
            log("placement_candidate", source .. "|idx=" .. tostring(idx) .. "|radius=" .. tostring(radius) .. "|angle=" .. tostring(angle) .. "|candidate=" .. vec_text(candidate) .. "|projected=" .. vec_text(projected) .. "|nav=" .. nav_detail .. "|volume=" .. tostring(volume_ok) .. ":" .. volume_detail .. "|sweep=" .. tostring(sweep_ok) .. ":" .. sweep_detail)
            if volume_ok and sweep_ok then
                return projected, get_rotation(teammate.pawn), "idx=" .. tostring(idx) .. "|radius=" .. tostring(radius) .. "|angle=" .. tostring(angle) .. "|nav=" .. nav_detail .. "|sweep=" .. sweep_detail
            end
        end
    end
    return nil, nil, "none"
end

local function update_last_authoritative_spawn(record, location, rotation)
    local transform = { Translation = location, Rotation = rotation, Scale3D = vec(1.0, 1.0, 1.0) }
    for _, object in ipairs({ record.pawn, record.controller, record.state }) do
        for _, name in ipairs({ "SetLastAuthoritativeSpawnTransform", "UpdateLastAuthoritativeSpawnTransform" }) do
            local ok, result = call_method(object, name, transform)
            if ok and result ~= false then
                log("spawn_transform_update", "method=" .. name .. "|object=" .. full_name(object))
                return
            end
            ok, result = call_method(object, name, location, rotation)
            if ok and result ~= false then
                log("spawn_transform_update", "method=" .. name .. "_location_rotation|object=" .. full_name(object))
                return
            end
        end
        local ok_transform = set_prop(object, "LastAuthoritativeSpawnTransform", transform)
        local ok_location = set_prop(object, "LastAuthoritativeSpawnLocation", location)
        local ok_rotation = set_prop(object, "LastAuthoritativeSpawnRotation", rotation)
        if ok_transform or ok_location or ok_rotation then
            log("spawn_transform_update", "property|object=" .. full_name(object) .. "|transform=" .. tostring(ok_transform) .. "|location=" .. tostring(ok_location) .. "|rotation=" .. tostring(ok_rotation))
            return
        end
    end
    log("spawn_transform_update", "deferred|missing_known_member")
end

local function replicate_result(record)
    local hits = {}
    for _, object in ipairs({ record.pawn, record.controller, record.state }) do
        local ok, result = call_method(object, "ForceNetUpdate")
        if ok and result ~= false then table.insert(hits, full_name(object)) end
    end
    log("replicate_result", #hits > 0 and table.concat(hits, ",") or "deferred|ForceNetUpdate_unavailable")
end

local function teleport_actor(pawn, target_location, target_rotation)
    local attempts = {}
    local ok, result = call_method(pawn, "K2_TeleportTo", target_location, target_rotation)
    table.insert(attempts, "K2_TeleportTo=" .. tostring(ok) .. ":" .. tostring(result))
    if ok and result ~= false then return true, "K2_TeleportTo", table.concat(attempts, ",") end
    local hit_result = {}
    ok, result = call_method(pawn, "K2_SetActorLocationAndRotation", target_location, target_rotation, false, hit_result, true)
    table.insert(attempts, "K2_SetActorLocationAndRotation=" .. tostring(ok) .. ":" .. tostring(result))
    if ok and result ~= false then return true, "K2_SetActorLocationAndRotation", table.concat(attempts, ",") end
    hit_result = {}
    ok, result = call_method(pawn, "K2_SetActorLocation", target_location, false, hit_result, true)
    table.insert(attempts, "K2_SetActorLocation=" .. tostring(ok) .. ":" .. tostring(result))
    if ok and result ~= false then return true, "K2_SetActorLocation", table.concat(attempts, ",") end
    return false, "none", table.concat(attempts, ",")
end

local function validate_requester(record)
    if record == nil then return false, "requester_missing" end
    if not is_valid(record.controller) then return false, "controller_missing" end
    if not is_valid(record.pawn) then return false, "pawn_missing" end
    local possessed = get_controller_pawn(record.controller)
    if not same_object(possessed, record.pawn) then return false, "not_possessed" end
    if has_authority(record.pawn) ~= true then return false, "no_authority:pc=" .. bool_text(has_authority(record.controller)) .. ",pawn=" .. bool_text(has_authority(record.pawn)) end
    local state_reason = state_gate_reason(record)
    if state_reason ~= nil then return false, "requester_state:" .. state_reason end
    local objective_reason = critical_objective_reason(record)
    if objective_reason ~= nil then return false, "critical_objective:" .. objective_reason end
    local key = state_key(record)
    local last = last_catchup[key]
    if last ~= nil then
        local elapsed = now_seconds() - last
        if elapsed < cooldown_seconds then return false, "cooldown:" .. string.format("%.1f", cooldown_seconds - elapsed) end
    end
    return true, "ok"
end

local function server_request_catchup_to_teammate(source, requester, preferred_target, manual, attempt)
    log("server_rpc", "ServerRequestCatchupToTeammate|source=" .. source .. "|manual=" .. tostring(manual == true) .. "|attempt=" .. tostring(attempt) .. "|requester=" .. state_key(requester) .. "|preferred_target=" .. full_name(preferred_target))
    local ok_request, request_reason = validate_requester(requester)
    log("validation", source .. "|requester=" .. tostring(ok_request) .. "|" .. request_reason .. "|pawn=" .. full_name(requester and requester.pawn or nil))
    if not ok_request then
        log("teleport_skipped", source .. "|reason=validation_" .. request_reason)
        return false
    end
    local players = collect_player_pawns()
    local target = ensure_target_record(players, requester.pawn)
    if target == nil then
        log("teleport_skipped", source .. "|reason=target_location_missing|pawn=" .. full_name(requester.pawn))
        return false
    end
    target.controller = requester.controller
    target.state = requester.state
    log("teammate_scan", source .. "|attempt=" .. tostring(attempt) .. "|valid_player_pawns=" .. tostring(#players))
    if #players < 2 then
        log("teleport_skipped", source .. "|reason=teammate_missing|valid_player_pawns=" .. tostring(#players))
        return false
    end
    local candidates = teammate_candidates(target, players, preferred_target)
    if #candidates < 1 then
        log("teleport_skipped", source .. "|reason=no_distinct_teammate|valid_player_pawns=" .. tostring(#players))
        return false
    end
    log("teammate_candidates", source .. "|count=" .. tostring(#candidates) .. "|valid_player_pawns=" .. tostring(#players))
    local world = get_world()
    local teammate = nil
    local distance = nil
    local choice = nil
    local target_location = nil
    local target_rotation = nil
    local placement_detail = nil
    for idx, candidate in ipairs(candidates) do
        local candidate_teammate = candidate.player
        local candidate_distance = candidate.distance
        log("teammate_candidate", source .. "|idx=" .. tostring(idx) .. "|choice=" .. candidate.choice .. "|target=" .. target.name .. "|target_state=" .. full_name(target.state) .. "|teammate=" .. candidate_teammate.name .. "|teammate_state=" .. full_name(candidate_teammate.state) .. "|distance=" .. tostring(math.sqrt(candidate_distance)))
        local team_ok, team_reason = same_session_team(target, candidate_teammate)
        log("validation", source .. "|candidate=" .. tostring(idx) .. "|same_session_team=" .. tostring(team_ok) .. "|" .. team_reason)
        if team_ok then
            local teammate_state_reason = state_gate_reason(candidate_teammate)
            log("validation", source .. "|candidate=" .. tostring(idx) .. "|teammate_state=" .. tostring(teammate_state_reason == nil) .. "|" .. tostring(teammate_state_reason or "ok"))
            if teammate_state_reason == nil then
                local candidate_location, candidate_rotation, candidate_detail = find_safe_location(source, world, target, candidate_teammate)
                if candidate_location ~= nil then
                    teammate = candidate_teammate
                    distance = candidate_distance
                    choice = candidate.choice
                    target_location = candidate_location
                    target_rotation = candidate_rotation
                    placement_detail = candidate_detail
                    break
                end
                log("teammate_candidate_skipped", source .. "|idx=" .. tostring(idx) .. "|reason=no_safe_radial_candidate|detail=" .. tostring(candidate_detail) .. "|teammate=" .. candidate_teammate.name)
            else
                log("teammate_candidate_skipped", source .. "|idx=" .. tostring(idx) .. "|reason=validation_teammate_" .. teammate_state_reason .. "|teammate=" .. candidate_teammate.name)
            end
        else
            log("teammate_candidate_skipped", source .. "|idx=" .. tostring(idx) .. "|reason=validation_" .. team_reason .. "|teammate=" .. candidate_teammate.name)
        end
    end
    if teammate == nil then
        log("teleport_skipped", source .. "|reason=no_viable_teammate|valid_player_pawns=" .. tostring(#players) .. "|candidates=" .. tostring(#candidates))
        return false
    end
    log("teammate_found", source .. "|choice=" .. choice .. "|target=" .. target.name .. "|target_state=" .. full_name(target.state) .. "|teammate=" .. teammate.name .. "|teammate_state=" .. full_name(teammate.state) .. "|distance=" .. tostring(distance ~= nil and math.sqrt(distance) or "unknown"))
    log("teleport_attempt", source .. "|manual=" .. tostring(manual == true) .. "|pawn=" .. target.name .. "|teammate=" .. teammate.name .. "|from=" .. vec_text(target.location) .. "|to=" .. vec_text(target_location) .. "|distance=" .. tostring(distance ~= nil and math.sqrt(distance) or "unknown") .. "|placement=" .. placement_detail)
    local success, method, detail = teleport_actor(target.pawn, target_location, target_rotation)
    if success then
        last_catchup[state_key(target)] = now_seconds()
        update_last_authoritative_spawn(target, target_location, target_rotation)
        replicate_result(target)
    end
    log("teleport_result", source .. "|success=" .. tostring(success) .. "|method=" .. method .. "|detail=" .. detail)
    return false
end

local function attempt_catchup(source, attempt, manual)
    local controller = local_controller()
    local pawn = get_controller_pawn(controller)
    if not is_valid(pawn) and is_valid(controller) then
        pawn = get_controller_pawn(controller)
        log("pawn_found", source .. "|attempt=" .. tostring(attempt) .. "|pc=" .. full_name(controller) .. "|pawn=" .. full_name(pawn))
    end
    if not is_valid(pawn) then
        if attempt < max_retries then
            log("teleport_wait", source .. "|attempt=" .. tostring(attempt) .. "|reason=pawn_missing")
            return true
        end
        log("teleport_skipped", source .. "|reason=pawn_missing|attempt=" .. tostring(attempt))
        return false
    end
    local state, state_source = get_player_state(controller, pawn)
    local target = { controller = controller, pawn = pawn, state = state, location = get_location(pawn), name = full_name(pawn) }
    log("pawn_found", source .. "|attempt=" .. tostring(attempt) .. "|pc=" .. full_name(controller) .. "|pawn=" .. full_name(pawn) .. "|player_state=" .. full_name(state) .. "|state_source=" .. state_source .. "|loc=" .. vec_text(target.location))
    if target.location == nil then
        if attempt < max_retries then
            log("teleport_wait", source .. "|attempt=" .. tostring(attempt) .. "|reason=target_location_missing|pawn=" .. full_name(pawn))
            return true
        end
        log("teleport_skipped", source .. "|reason=target_location_missing|pawn=" .. full_name(pawn))
        return false
    end
    local players = collect_player_pawns()
    log("teammate_scan", source .. "|attempt=" .. tostring(attempt) .. "|valid_player_pawns=" .. tostring(#players))
    if #players < 2 then
        if attempt < max_retries then
            log("teleport_wait", source .. "|attempt=" .. tostring(attempt) .. "|reason=teammate_missing|valid_player_pawns=" .. tostring(#players))
            return true
        end
        log("teleport_skipped", source .. "|reason=teammate_missing|valid_player_pawns=" .. tostring(#players))
        return false
    end
    return server_request_catchup_to_teammate(source, target, nil, manual, attempt)
end

local function run_scheduled(source, attempt, manual)
    local ok, retry = pcall(function() return attempt_catchup(source, attempt, manual) end)
    if not ok then
        log("error", source .. "|attempt=" .. tostring(attempt) .. "|" .. tostring(retry))
        return
    end
    if retry == true and attempt < max_retries then
        local delay_ms = retry_delay_ms
        ExecuteWithDelay(delay_ms, function()
            ExecuteInGameThread(function()
                run_scheduled(source, attempt + 1, manual)
            end)
        end)
    end
end

local function schedule_catchup(source, manual)
    ExecuteInGameThread(function()
        run_scheduled(source, 1, manual)
    end)
end

local function manual_catchup(source)
    local label = source or "manual"
    log("manual_trigger", label .. "|deferred=reacquire_current_controller")
    schedule_catchup(label, true)
end

local function register_manual_trigger()
    local ok_key = false
    local key_err = "api_missing"
    if type(RegisterKeyBind) == "function" and Key ~= nil and ModifierKey ~= nil and Key.F8 ~= nil and ModifierKey.CONTROL ~= nil then
        ok_key, key_err = pcall(function() RegisterKeyBind(Key.F8, { ModifierKey.CONTROL }, function() manual_catchup("manual_keybind") end) end)
    end
    if ok_key then
        log("manual_keybind", "registered|CTRL+F8")
    else
        log("manual_keybind", "deferred|" .. tostring(key_err))
    end
    if type(RegisterConsoleCommandHandler) == "function" then
        local ok_console, console_err = pcall(function()
            RegisterConsoleCommandHandler("cmm_catchup", function()
                manual_catchup("manual_console")
                return true
            end)
        end)
        log("manual_console", (ok_console and "registered|cmm_catchup" or "deferred|" .. tostring(console_err)))
    else
        log("manual_console", "deferred|api_missing")
    end
end

local function register_ui_button_probe()
    log("ui_button", "deferred|active_umg_button_deferred_pending_pause_or_map_widget_validation")
end

log("startup", "version=0.2.2-prototype.20260822|helpers=" .. tostring(ok_helpers) .. "|mode=manual_only_no_start_load_hooks")
register_manual_trigger()
register_ui_button_probe()
`;
const readme = [
  `# ${modName}`,
  "",
  "Manual-only UE4SS Lua hotfix prototype for Clawed co-op catch-up teleport.",
  "",
  "Behavior:",
  "",
  "- Does not register `PlayerController:ClientRestart`, `GameModeBase:K2_PostLogin`, PlayerController creation, BeginPlay, or map-load hooks.",
  "- Does not run automatic catch-up work while starting a new game or loading a save.",
  "- Routes keybind and console requests through a Lua-side `ServerRequestCatchupToTeammate` contract marker.",
  "- Reacquires the current local controller and pawn for each manual retry instead of retaining UE4SS callback parameter wrappers.",
  "- Teleports only from an authority-owned possessed pawn and requires at least one distinct valid teammate.",
  "- Supports any number of visible player pawns by sorting all candidate teammates, preferring a requested target when available, and falling back to the nearest viable teammate.",
  "- Skips dead, spectator, invalid, unsafe-state, cooldown-blocked, and critical-objective-carrier pawns when those states are detectable.",
  "- Searches radial offsets around each viable teammate, attempts `ProjectPointToNavigation`, requires a clear `CapsuleTraceSingle`, probes unsafe volume names before moving, and tries the next viable teammate if placement fails.",
  "- Attempts to update `LastAuthoritativeSpawnTransform`/related members and calls `ForceNetUpdate` when those members are available.",
  "- Registers `CTRL+F8` as a manual local catch-up trigger when UE4SS keybind APIs are available.",
  "- Registers `cmm_catchup` as a console command handler when UE4SS exposes that API.",
  "- Logs `ui_button|deferred` because active pause/menu/map UMG insertion is deferred until a Clawed-specific widget target is validated.",
  "",
  "Expected UE4SS markers include:",
  "",
  "- `[CoopCatchupTeleport] startup|...`",
  "- `[CoopCatchupTeleport] manual_keybind|...`",
  "- `[CoopCatchupTeleport] manual_console|...`",
  "- `[CoopCatchupTeleport] manual_trigger|...`",
  "- `[CoopCatchupTeleport] server_rpc|ServerRequestCatchupToTeammate|...`",
  "- `[CoopCatchupTeleport] validation|...`",
  "- `[CoopCatchupTeleport] teammate_scan|...`",
  "- `[CoopCatchupTeleport] teammate_candidates|...`",
  "- `[CoopCatchupTeleport] teammate_candidate|...`",
  "- `[CoopCatchupTeleport] teammate_candidate_skipped|...`",
  "- `[CoopCatchupTeleport] teammate_found|...`",
  "- `[CoopCatchupTeleport] placement_candidate|...`",
  "- `[CoopCatchupTeleport] teleport_attempt|...`",
  "- `[CoopCatchupTeleport] teleport_result|...`",
  "- `[CoopCatchupTeleport] teleport_skipped|...`",
  "- `[CoopCatchupTeleport] ui_button|...`",
  "",
  "Safety boundaries:",
  "",
  "- Packaged only as a normal `.clawedmod` with `loader: \"ue4ss\"`.",
  "- Does not patch Steam, EOS, executable files, anti-cheat, game DLLs, GameMode assets, or PlayerController assets.",
  "- Does not replace Clawed Blueprint classes.",
  "- Does not add a native replicated UFUNCTION; the RPC name is implemented as a logged Lua contract around server-authority movement.",
  "- Start/load/player hook automation is disabled because user crash evidence showed UE4SS access violations during new-game/load flows.",
  "- Multiplayer behavior is unvalidated until tested in real host/client sessions across supported party sizes."
].join("\n");
const manifest = {
  schemaVersion: 1,
  id: modId,
  name: modName,
  version,
  author: "Clawed Mod Manager",
  description:
    "Manual-only UE4SS host-side N-player co-op catch-up teleport hotfix.",
  game: "clawed",
  loader: "ue4ss",
  dependencies: [],
  conflicts: [],
  loadAfter: [],
  loadBefore: [],
  creatorAssets: generatedCreatorSupportMetadata({
    modId,
    modName,
    version,
    payloadPath,
    buildId: steamBuildId,
    buildNotes: steamBuildNotes,
    tags: ["ue4ss_runtime", "lua", "coop_catchup"]
  })
};

const packagePaths = [];
packagePaths.push(await writePackage(outputRoot));
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const unpackedOutputRoot = path.resolve(
  process.env.CMM_COOP_CATCHUP_UNPACKED_OUTPUT_DIR ??
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
    manualTrigger:
      "Manual only: CTRL+F8 and cmm_catchup when UE4SS exposes those APIs; in-game UMG button deferred",
    placement:
      "Radial candidate search with best-effort ProjectPointToNavigation and required CapsuleTraceSingle clearance",
    authorityContract:
      "Lua-side ServerRequestCatchupToTeammate contract marker only; no native replicated UFUNCTION added",
    runtimeClaims: [
      "UE4SS Lua package structure only",
      "Manual-only hotfix; no automatic start, load, PlayerController, BeginPlay, or map hooks",
      "No hard-coded party size cap; every visible player pawn is considered and nearest viable teammate fallback is used",
      "Host/server-authority movement path only; client-only movement is skipped",
      "No executable, Steam, EOS, anti-cheat, game DLL, GameMode asset, or PlayerController asset patching",
      "Multiplayer host/client behavior unvalidated"
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
