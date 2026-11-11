local ok_helpers, UEHelpers = pcall(require, "UEHelpers")
local marker = "[CoopCatchupTeleport] "
local max_retries = 8
local retry_delay_ms = 500
local cooldown_seconds = 30.0
local teleport_success_distance_sq = 22500.0
local verification_delays = { 250, 1000, 2500 }
local frame = nil
local active_request = nil
local request_sequence = 0
local radial_radii = { 300.0, 450.0, 650.0, 900.0 }
local radial_angles = { 0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0 }
local unpack_fn = table.unpack or unpack
local last_catchup = {}

local function log(event, value)
    print(marker .. event .. "|" .. tostring(value))
end

local function is_valid(object)
    if object == nil then return false end
    local ok, valid = pcall(function() return object:IsValid() end)
    if not ok or valid ~= true then return false end
    if EInternalObjectFlags ~= nil and EInternalObjectFlags.PendingKill ~= nil then
        local ok_pending, pending = pcall(function() return object:HasAnyInternalFlags(EInternalObjectFlags.PendingKill) end)
        if ok_pending and pending == true then return false end
    end
    return true
end

local function member(object, name)
    if not is_valid(object) then return nil, "invalid_object" end
    local ok_class, class = pcall(function() return object:GetClass():GetFullName() end)
    local key = tostring(ok_class and class or "unknown") .. ":" .. name
    if frame ~= nil and frame.missing[key] then return nil, "member_missing" end
    local ok, value = pcall(function() return object[name] end)
    if not ok or value == nil then
        if frame ~= nil and not ok then frame.missing[key] = true end
        return nil, ok and "member_missing" or tostring(value)
    end
    return value
end

local function call_method(object, name, ...)
    local fn, reason = member(object, name)
    if fn == nil then return false, reason end
    local args = table.pack(...)
    return pcall(function() return fn(object, unpack_fn(args, 1, args.n)) end)
end

local function get_prop(object, name)
    local value = member(object, name)
    return value
end

local function full_name(object)
    if object == nil then return "<nil>" end
    local ok, value = pcall(function() return object:GetFullName() end)
    if ok then return tostring(value) end
    return "<full-name-error:" .. tostring(value) .. ">"
end

local function class_name(object)
    if object == nil then return "<nil>" end
    local ok, value = pcall(function() return object:GetClass() end)
    if ok and value ~= nil then return full_name(value) end
    return "<class-error:" .. tostring(value) .. ">"
end

local function lower_text(value)
    return string.lower(tostring(value or ""))
end

local function value_text(value)
    if value == nil then return nil end
    local value_type = type(value)
    if value_type == "string" or value_type == "number" or value_type == "boolean" then return tostring(value) end
    if is_valid(value) then return full_name(value) end
    local ok, text = pcall(function() return value:ToString() end)
    if ok and type(text) == "string" then return text end
    return nil
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

local function finite_number(value)
    return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function copy_vector(value)
    if value == nil then return nil end
    local ok, x, y, z = pcall(function() return value.X, value.Y, value.Z end)
    if not ok or not finite_number(x) or not finite_number(y) or not finite_number(z) then return nil end
    return vec(x, y, z)
end

local function read_out_vector(value)
    local direct = copy_vector(value)
    if direct ~= nil then return direct end
    if type(value) ~= "table" then return nil end
    return copy_vector(value[1]) or copy_vector(value.ProjectedLocation)
end

local function strict_bool_call(ok, result)
    return ok == true and result == true
end

local function now_seconds()
    return os.time()
end

local function find_all(class_name_value)
    if frame.finds[class_name_value] ~= nil then return frame.finds[class_name_value] end
    if type(FindAllOf) ~= "function" then return nil, "enumeration_api_unavailable:" .. class_name_value end
    frame.scans = frame.scans + 1
    local ok, objects = pcall(FindAllOf, class_name_value)
    if not ok then return nil, "enumeration_failed:" .. class_name_value .. ":" .. tostring(objects) end
    if objects ~= nil and type(objects) ~= "table" then return nil, "enumeration_invalid_output:" .. class_name_value end
    frame.finds[class_name_value] = objects or {}
    return frame.finds[class_name_value]
end

local function get_world()
    if frame ~= nil and is_valid(frame.world) then return frame.world end
    if ok_helpers and UEHelpers.GetGameViewportClient ~= nil then
        local ok, viewport = pcall(UEHelpers.GetGameViewportClient)
        if ok then
            local world_ok, world = call_method(viewport, "GetWorld")
            if world_ok and is_valid(world) then
                if frame ~= nil then frame.world = world end
                return world
            end
        end
    end
    return nil
end

local function get_location(actor)
    local ok, value = call_method(actor, "K2_GetActorLocation")
    if ok and copy_vector(value) ~= nil then return copy_vector(value), "actor" end
    local root = get_prop(actor, "RootComponent")
    ok, value = call_method(root, "K2_GetComponentLocation")
    if ok and copy_vector(value) ~= nil then return copy_vector(value), "root" end
    return nil, "missing"
end

local function get_rotation(actor)
    local ok, value = call_method(actor, "K2_GetActorRotation")
    if not ok or value == nil then return nil end
    local read_ok, pitch, yaw, roll = pcall(function() return value.Pitch, value.Yaw, value.Roll end)
    if not read_ok or not finite_number(pitch) or not finite_number(yaw) or not finite_number(roll) then return nil end
    return { Pitch = pitch, Yaw = yaw, Roll = roll }
end

local function dist_sq(a, b)
    a, b = copy_vector(a), copy_vector(b)
    if a == nil or b == nil then return nil end
    local dx, dy, dz = a.X - b.X, a.Y - b.Y, a.Z - b.Z
    local result = dx * dx + dy * dy + dz * dz
    if not finite_number(result) then return nil end
    return result
end

local function movement_verdict(before, desired, after, delayed)
    local initial, remaining, travelled = dist_sq(before, desired), dist_sq(after, desired), dist_sq(before, after)
    if initial == nil or remaining == nil or travelled == nil then return false, "invalid_location" end
    if initial <= teleport_success_distance_sq then return false, "already_near_destination" end
    if travelled < 100.0 then return false, "no_position_change" end
    local tolerance = delayed and math.max(90000.0, math.min(2250000.0, initial * 0.25)) or teleport_success_distance_sq
    if remaining > tolerance then return false, delayed and "movement_corrected_or_left_destination" or "destination_not_reached" end
    return true, "position_confirmed"
end

local function remote_candidate_reason(local_player, local_known, controller_local, session_member, reciprocal)
    if local_player then return "local_host_excluded" end
    if not local_known then return "local_identity_unknown" end
    if controller_local ~= false then return "remote_identity_unconfirmed" end
    if not session_member then return "not_in_session_player_array" end
    if not reciprocal then return "controller_pawn_mismatch" end
    return nil
end

local function target_less(left, right)
    if left.eligible ~= right.eligible then return left.eligible == true end
    if left.distance ~= right.distance then return left.distance > right.distance end
    return left.player.name < right.player.name
end

local function has_authority(actor)
    local ok, value = call_method(actor, "HasAuthority")
    if ok and type(value) == "boolean" then return value end
    return nil
end

local function is_local_controller(controller)
    local ok, value = call_method(controller, "IsLocalController")
    if ok and type(value) == "boolean" then return value end
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
    for _, object in pairs({ controller, pawn }) do
        local state = get_prop(object, "PlayerState")
        if is_valid(state) then return state, "PlayerState" end
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
    for _, object in pairs({ record.pawn, record.controller, record.state }) do
        local source = bool_gate(object, names)
        if source ~= nil then return source end
    end
    for _, object in pairs({ record.pawn, record.controller, record.state }) do
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
    for _, object in pairs({ record.pawn, record.controller, record.state }) do
        local source = bool_gate(object, names)
        if source ~= nil then return source end
    end
    for _, object in pairs({ record.pawn, record.controller, record.state }) do
        local text = lower_text(full_name(object) .. "|" .. class_name(object))
        for _, keyword in ipairs({ "cinematic", "boss", "unsafevolume" }) do
            if string.find(text, keyword, 1, true) ~= nil then return "name_contains_" .. keyword end
        end
    end
    return nil
end

local function get_controller_pawn(controller)
    for _, name in ipairs({ "Pawn", "AcknowledgedPawn", "Character" }) do
        local pawn = get_prop(controller, name)
        if is_valid(pawn) then return pawn, name end
    end
    for _, name in ipairs({ "GetPawn", "K2_GetPawn", "GetCharacter" }) do
        local ok, pawn = call_method(controller, name)
        if ok and is_valid(pawn) then return pawn, name end
    end
    return nil, "missing"
end

local function get_pawn_controller(pawn)
    for _, name in ipairs({ "Controller", "InstigatorController" }) do
        local controller = get_prop(pawn, name)
        if is_valid(controller) then return controller, name end
    end
    for _, name in ipairs({ "GetController" }) do
        local ok, controller = call_method(pawn, name)
        if ok and is_valid(controller) then return controller, name end
    end
    return nil, "missing"
end

local function get_state_pawn(state)
    for _, name in ipairs({ "PawnPrivate", "Pawn", "ControlledPawn", "CurrentPawn" }) do
        local pawn = get_prop(state, name)
        if is_valid(pawn) then return pawn, name end
    end
    for _, name in ipairs({ "GetPawn", "K2_GetPawn" }) do
        local ok, pawn = call_method(state, name)
        if ok and is_valid(pawn) then return pawn, name end
    end
    return nil, "missing"
end

local function get_state_controller(state)
    for _, name in ipairs({ "Owner", "Controller", "PlayerController" }) do
        local controller = get_prop(state, name)
        if is_valid(controller) then return controller, name end
    end
    return nil, "missing"
end

local function path_of(object)
    local name = full_name(object)
    return string.match(name, "^[^ ]+ (.+)$")
end

local function resolve_path(value)
    if type(value) ~= "string" or type(StaticFindObject) ~= "function" then return nil end
    local ok, object = pcall(StaticFindObject, value)
    if ok and is_valid(object) then return object end
    return nil
end

local function same_world(object, world)
    local ok, object_world = call_method(object, "GetWorld")
    return ok and same_object(object_world, world)
end

local function collect_player_states()
    if frame.states ~= nil then return frame.states, frame.state_keys end
    frame.states, frame.state_keys = {}, {}
    local game_state = get_prop(get_world(), "GameState")
    local player_array = get_prop(game_state, "PlayerArray")
    if player_array == nil then
        log("discovery_incomplete", "session_player_array_unavailable")
        return frame.states, frame.state_keys
    end
    local function add_state(state)
        if not is_valid(state) or not same_world(state, get_world()) then return end
        local name = full_name(state)
        if frame.state_keys[name] then return end
        frame.state_keys[name] = true
        table.insert(frame.states, state)
    end
    player_array:ForEach(function(_, state)
        add_state(state:get())
    end)
    return frame.states, frame.state_keys
end

local function collect_controllers()
    if frame.controllers ~= nil then return frame.controllers end
    frame.controllers = {}
    local controllers, reason = find_all("PlayerController")
    if controllers == nil then log("discovery_incomplete", reason); return frame.controllers end
    for _, controller in pairs(controllers) do
        if is_valid(controller) and same_world(controller, get_world()) then
            table.insert(frame.controllers, controller)
        end
    end
    return frame.controllers
end

local function local_controller()
    if frame.local_searched then return frame.local_controller end
    frame.local_searched = true
    local function consider(controller)
        if is_valid(controller) and same_world(controller, get_world()) and is_local_controller(controller) == true then
            frame.local_controller = controller
            return true
        end
        return false
    end
    for _, state in ipairs(collect_player_states()) do
        if consider(get_state_controller(state)) then return frame.local_controller end
    end
    for _, controller in ipairs(collect_controllers()) do
        if consider(controller) then return frame.local_controller end
    end
    return nil
end

local function host_context()
    local controller = local_controller()
    if not is_valid(controller) then return false, "local_identity_unknown" end
    if has_authority(controller) == true and has_authority(get_controller_pawn(controller)) == true then
        return true, "confirmed_local_controller_and_pawn_authority"
    end
    return false, "client_no_authority_host_required"
end

local function collect_player_pawns()
    if frame.players ~= nil then return frame.players end
    local states, state_keys = collect_player_states()
    local players, seen = {}, {}
    local function add(controller, pawn, state, source)
        if not is_valid(pawn) or not is_valid(state) or not state_keys[full_name(state)] then return end
        if not same_world(pawn, get_world()) then return end
        if not is_valid(controller) then controller = get_pawn_controller(pawn) end
        if not is_valid(controller) or not same_world(controller, get_world()) then return end
        local name = full_name(pawn)
        if seen[name] then return end
        local location = get_location(pawn)
        if location == nil then return end
        local possessed = get_controller_pawn(controller)
        local pawn_controller = get_pawn_controller(pawn)
        local controller_state = get_player_state(controller, nil)
        local reciprocal = same_object(possessed, pawn) and same_object(pawn_controller, controller) and same_object(controller_state, state)
        if not reciprocal then
            log("discovery_rejected", "controller_pawn_or_state_mismatch|pawn=" .. name)
            return
        end
        seen[name] = true
        table.insert(players, { controller = controller, pawn = pawn, state = state, location = location, name = name, source = source, session_member = true, reciprocal = true })
    end
    for _, state in ipairs(states) do
        add(get_state_controller(state), get_state_pawn(state), state, "session_player_array")
    end
    if #players < #states then
        for _, controller in ipairs(collect_controllers()) do
            local pawn = get_controller_pawn(controller)
            add(controller, pawn, get_player_state(controller, pawn), "session_controller")
        end
    end
    frame.players = players
    log("discovery_summary", "session_states=" .. tostring(#states) .. "|resolved_players=" .. tostring(#players) .. "|unresolved_states=" .. tostring(#states - #players))
    return players
end

local function log_player_records(source, players)
    for index, player in ipairs(players) do
        log("player_record", source .. "|idx=" .. tostring(index) .. "|source=" .. player.source .. "|name=" .. player.name .. "|controller=" .. full_name(player.controller) .. "|state=" .. full_name(player.state) .. "|local=" .. tostring(is_local_controller(player.controller)) .. "|loc=" .. vec_text(player.location))
    end
end

local function cooldown_reason(record)
    local last = last_catchup[state_key(record)]
    if last ~= nil and now_seconds() - last < cooldown_seconds then return "cooldown" end
    return nil
end

local function catchup_target_candidates(players, mode)
    local candidates = {}
    local local_pc = local_controller()
    local local_known = is_valid(local_pc) and is_local_controller(local_pc) == true
    local local_pawn = get_controller_pawn(local_pc)
    for _, player in ipairs(players) do
        local local_player = same_object(player.controller, local_pc) or same_object(player.pawn, local_pawn)
        local reason = nil
        if mode == "local" then
            if not local_known or not local_player then reason = "local_diagnostic_only" end
        else
            reason = remote_candidate_reason(local_player, local_known, is_local_controller(player.controller), player.session_member, player.reciprocal)
        end
        if reason == nil and has_authority(player.pawn) ~= true then reason = "pawn_authority_unconfirmed" end
        if reason == nil then reason = state_gate_reason(player) or critical_objective_reason(player) or cooldown_reason(player) end
        local distance = nil
        for _, teammate in ipairs(players) do
            if teammate.name ~= player.name then
                local candidate = dist_sq(player.location, teammate.location)
                if candidate ~= nil and (distance == nil or candidate < distance) then distance = candidate end
            end
        end
        table.insert(candidates, { player = player, distance = distance or -1, local_player = local_player, eligible = reason == nil, reason = reason or "ok" })
    end
    table.sort(candidates, target_less)
    for index, candidate in ipairs(candidates) do
        log("target_candidate", "idx=" .. tostring(index) .. "|eligible=" .. tostring(candidate.eligible) .. "|reason=" .. candidate.reason .. "|local=" .. tostring(candidate.local_player) .. "|target=" .. candidate.player.name)
    end
    return candidates
end

local function describe_player(record)
    local address_ok, address = pcall(function() return record.pawn:GetAddress() end)
    if not address_ok then return nil end
    return { pawn = path_of(record.pawn), controller = path_of(record.controller), state = path_of(record.state), address = tostring(address), name = record.name }
end

local function resolve_player(identity)
    if identity == nil then return nil, "identity_missing" end
    local pawn, controller, state = resolve_path(identity.pawn), resolve_path(identity.controller), resolve_path(identity.state)
    if not is_valid(pawn) or not is_valid(controller) or not is_valid(state) then return nil, "player_left_or_respawned" end
    local ok, address = pcall(function() return pawn:GetAddress() end)
    if not ok or tostring(address) ~= identity.address then return nil, "pawn_replaced" end
    if not same_world(pawn, get_world()) or not same_world(controller, get_world()) or not same_world(state, get_world()) then return nil, "world_changed" end
    local _, state_keys = collect_player_states()
    if not state_keys[full_name(state)] then return nil, "player_left_session" end
    if not same_object(get_controller_pawn(controller), pawn) or not same_object(get_pawn_controller(pawn), controller) or not same_object(get_player_state(controller, nil), state) then
        return nil, "possession_changed"
    end
    if has_authority(pawn) ~= true then return nil, "authority_lost" end
    local record = { pawn = pawn, controller = controller, state = state, name = full_name(pawn), location = get_location(pawn) }
    if record.location == nil then return nil, "location_unavailable" end
    return record
end

local function release_request(request, reason)
    if active_request ~= request then return end
    log("request_complete", request.source .. "|id=" .. tostring(request.id) .. "|reason=" .. reason)
    active_request = nil
end

local function queue_stage(request, delay_ms, label, callback)
    if active_request ~= request then return end
    if type(ExecuteInGameThread) ~= "function" or type(ExecuteWithDelay) ~= "function" then
        release_request(request, "scheduler_unavailable")
        return
    end
    local function on_game_thread()
        if active_request ~= request then return end
        if now_seconds() - request.started > 30 then release_request(request, "request_timeout"); return end
        local started = os.clock()
        frame = { finds = {}, missing = request.missing, scans = 0 }
        local ok, err = pcall(function()
            if request.world ~= nil then
                frame.world = resolve_path(request.world)
                if not is_valid(frame.world) then release_request(request, "world_unloaded"); return end
                local current_world = nil
                if ok_helpers and UEHelpers.GetGameViewportClient ~= nil then
                    local viewport_ok, viewport = pcall(UEHelpers.GetGameViewportClient)
                    if viewport_ok then
                        local world_ok, world = call_method(viewport, "GetWorld")
                        if world_ok then current_world = world end
                    end
                end
                if not same_object(frame.world, current_world) then release_request(request, "world_changed"); return end
            end
            callback(request)
        end)
        log("stage_timing", request.source .. "|stage=" .. label .. "|cpu_ms=" .. string.format("%.2f", (os.clock() - started) * 1000) .. "|native_scans=" .. tostring(frame.scans))
        frame = nil
        if not ok then
            log("error", request.source .. "|stage=" .. label .. "|" .. tostring(err))
            release_request(request, "stage_error")
        end
    end
    local ok, err = pcall(function()
        ExecuteWithDelay(delay_ms, function()
            local dispatched, dispatch_error = pcall(function() ExecuteInGameThread(on_game_thread) end)
            if not dispatched then
                log("error", request.source .. "|dispatch=" .. tostring(dispatch_error))
                release_request(request, "dispatch_failed")
            end
        end)
    end)
    if not ok then
        log("error", request.source .. "|schedule=" .. tostring(err))
        release_request(request, "schedule_failed")
    end
end

local function get_library(name)
    return resolve_path("/Script/" .. name)
end

local function capsule_shape(pawn)
    local component = get_prop(pawn, "CapsuleComponent")
    local radius_ok, radius = call_method(component, "GetScaledCapsuleRadius")
    local height_ok, height = call_method(component, "GetScaledCapsuleHalfHeight")
    if not radius_ok or not height_ok or not finite_number(radius) or not finite_number(height) or radius <= 0 or height < radius then return nil end
    return { radius = radius, height = height }
end

local function collect_unsafe_volumes()
    local hazards = {}
    local volumes, reason = find_all("Volume")
    if volumes == nil then return nil, reason end
    for _, volume in pairs(volumes) do
        if is_valid(volume) and same_world(volume, get_world()) then
            local name = lower_text(full_name(volume) .. "|" .. class_name(volume))
            local unsafe = false
            for _, keyword in ipairs({ "unsafe", "hazard", "death", "kill", "pain", "lava", "void", "boss", "cinematic" }) do
                if string.find(name, keyword, 1, true) ~= nil then unsafe = true end
            end
            if unsafe then
                table.insert(hazards, { name = name, path = path_of(volume) })
            end
        end
    end
    return hazards
end

local function unsafe_volume_clear(request, location)
    for _, hazard in ipairs(request.hazards) do
        local volume = resolve_path(hazard.path)
        if is_valid(volume) and same_world(volume, get_world()) then
            local origin, extent = {}, {}
            local ok = call_method(volume, "GetActorBounds", false, origin, extent, false)
            local center, bounds = read_out_vector(origin), read_out_vector(extent)
            if not ok or center == nil or bounds == nil or bounds.X < 0 or bounds.Y < 0 or bounds.Z < 0 then return false, "hazard_bounds_invalid_output:" .. hazard.name end
            if math.abs(location.X - center.X) <= bounds.X + request.shape.radius and math.abs(location.Y - center.Y) <= bounds.Y + request.shape.radius and math.abs(location.Z - center.Z) <= bounds.Z + request.shape.height then
                return false, "unsafe_volume:" .. hazard.name
            end
        end
    end
    return true, "clear"
end

local function project_point_to_navigation(world, point)
    local nav = get_library("NavigationSystem.Default__NavigationSystemV1")
    if not is_valid(nav) then return point, "nav_unavailable_ground_trace_required", true end
    local projected = {}
    local ok, result = call_method(nav, "K2_ProjectPointToNavigation", world, point, projected, nil, nil, vec(500, 500, 800))
    local location = read_out_vector(projected)
    if not ok or type(result) ~= "boolean" then return point, "nav_api_unavailable_ground_trace_required", true end
    if not result then return point, "nav_no_projection_ground_trace_required", true end
    if location == nil then return nil, "nav_invalid_output", false end
    return location, "nav_projected", true
end

local function find_safe_location(request, target, teammate, offset, fallback)
    local kismet = get_library("Engine.Default__KismetSystemLibrary")
    if not is_valid(kismet) then return nil, "placement_api_unavailable:kismet" end
    local teammate_shape = capsule_shape(teammate.pawn)
    if teammate_shape == nil then return nil, "teammate_capsule_dimensions_unavailable" end
    if fallback then offset = vec(request.shape.radius + teammate_shape.radius + 100, 0, 260) end
    local point = vec_add(teammate.location, offset)
    local projected, nav_reason, nav_ok = project_point_to_navigation(get_world(), point)
    if not nav_ok then return nil, nav_reason end
    local floor_hit, color = {}, { R = 0.0, G = 0.0, B = 0.0, A = 0.0 }
    local ignored = { target.pawn, teammate.pawn }
    local ok, hit = call_method(kismet, "LineTraceSingle", get_world(), vec_add(projected, vec(0, 0, request.shape.height + 300)), vec_add(projected, vec(0, 0, -1000)), 0, false, ignored, 0, floor_hit, true, color, color, 0.0)
    if not ok or type(hit) ~= "boolean" then return nil, "placement_api_unavailable:ground_trace:" .. tostring(hit) end
    if not hit then return nil, "ground_missing" end
    local hit_data = floor_hit[1] or floor_hit
    local output_ok, floor, normal = pcall(function() return copy_vector(hit_data.ImpactPoint), copy_vector(hit_data.ImpactNormal) end)
    if not output_ok or floor == nil or normal == nil then return nil, "ground_trace_invalid_output" end
    if normal.Z < 0.7 then return nil, "ground_too_steep" end
    local location = vec_add(floor, vec(0, 0, request.shape.height + 10))
    local volume_ok, volume_reason = unsafe_volume_clear(request, location)
    if not volume_ok then return nil, volume_reason end
    if math.abs(location.Z - teammate.location.Z) < request.shape.height + teammate_shape.height then
        local dx, dy = location.X - teammate.location.X, location.Y - teammate.location.Y
        if dx * dx + dy * dy < (request.shape.radius + teammate_shape.radius + 10) ^ 2 then return nil, "teammate_capsule_overlap" end
    end
    local capsule_hit = {}
    ok, hit = call_method(kismet, "CapsuleTraceSingle", get_world(), location, vec_add(location, vec(0, 0, 1)), request.shape.radius + 2, request.shape.height + 2, 0, false, { target.pawn }, 0, capsule_hit, true, color, color, 0.0)
    if not ok or type(hit) ~= "boolean" then return nil, "placement_api_unavailable:capsule_trace:" .. tostring(hit) end
    if hit then return nil, "capsule_blocked" end
    local rotation = get_rotation(teammate.pawn)
    if rotation == nil then return nil, "rotation_unavailable" end
    log(fallback and "placement_fallback_candidate" or "placement_candidate", request.source .. "|clear=true|to=" .. vec_text(location) .. "|nav=" .. nav_reason)
    return location, rotation
end

local function replicate_result(record)
    local hits = {}
    for _, object in pairs({ record.pawn, record.controller, record.state }) do
        for _, name in ipairs({ "ForceNetUpdate", "FlushNetDormancy" }) do
            local ok, result = call_method(object, name)
            if ok then table.insert(hits, name .. "=" .. tostring(result)) end
        end
    end
    log("replicate_result", table.concat(hits, ","))
end

local function prepare_movement_for_teleport(record)
    local component = get_prop(record.pawn, "CharacterMovement")
    local ok, result = call_method(component, "StopMovementImmediately")
    log("movement_prepare", "StopMovementImmediately=" .. tostring(ok) .. ":" .. tostring(result))
end

local function teleport_actor(pawn, before, destination, rotation)
    for _, method in ipairs({ "K2_TeleportTo", "K2_SetActorLocationAndRotation" }) do
        local ok, result
        if method == "K2_TeleportTo" then
            ok, result = call_method(pawn, method, destination, rotation)
        else
            local hit = {}
            ok, result = call_method(pawn, method, destination, rotation, false, hit, true)
        end
        local measured, reason = movement_verdict(before, destination, get_location(pawn), false)
        local accepted = strict_bool_call(ok, result) and measured
        log("movement_api", method .. "|called=" .. tostring(ok) .. "|return=" .. tostring(result) .. "|measured=" .. tostring(measured) .. "|reason=" .. reason)
        if accepted then return true, method end
    end
    return false, "no_documented_movement_api_confirmed"
end

local function sync_controller_after_teleport(record, destination, rotation)
    local ok, result = call_method(record.controller, "ClientSetLocation", destination, rotation)
    log("controller_sync", "ClientSetLocation=" .. tostring(ok) .. ":" .. tostring(result))
end

local function verify_movement(request)
    local target, reason = resolve_player(request.target)
    if target == nil then release_request(request, reason); return end
    if state_gate_reason(target) ~= nil then release_request(request, "target_state_changed"); return end
    local verified, detail = movement_verdict(request.before, request.destination, target.location, true)
    log("teleport_verify", request.source .. "|phase=delayed|sample=" .. tostring(request.verify_index) .. "|verified=" .. tostring(verified) .. "|reason=" .. detail .. "|after=" .. vec_text(target.location))
    if not verified then release_request(request, detail); return end
    if request.verify_index == #verification_delays then
        last_catchup[state_key(target)] = now_seconds()
        log("host_catchup_result", request.source .. "|success=true|host_position_sustained=true|client_observation_required=true|target=" .. target.name)
        release_request(request, "host_position_sustained_client_unverified")
        return
    end
    local previous = verification_delays[request.verify_index]
    request.verify_index = request.verify_index + 1
    queue_stage(request, verification_delays[request.verify_index] - previous, "verify", verify_movement)
end

local function place_and_move(request)
    local target, reason = resolve_player(request.target)
    if target == nil then release_request(request, reason); return end
    if request.mode ~= "local" and is_local_controller(target.controller) ~= false then release_request(request, "remote_identity_changed"); return end
    if state_gate_reason(target) ~= nil or critical_objective_reason(target) ~= nil then release_request(request, "target_state_changed"); return end
    local planned = request.placements[request.placement_index]
    if planned == nil then release_request(request, "no_safe_placement"); return end
    local teammate, teammate_reason = resolve_player(planned.teammate)
    if teammate == nil then release_request(request, "teammate_changed:" .. teammate_reason); return end
    local team_ok = same_session_team(target, teammate)
    if not team_ok or state_gate_reason(teammate) ~= nil then release_request(request, "teammate_no_longer_viable"); return end
    request.shape = capsule_shape(target.pawn)
    if request.shape == nil then release_request(request, "capsule_dimensions_unavailable"); return end
    if request.hazards == nil then
        local hazards, hazard_reason = collect_unsafe_volumes()
        if hazards == nil then release_request(request, hazard_reason); return end
        request.hazards = hazards
    end
    local destination, rotation_or_reason = find_safe_location(request, target, teammate, planned.offset, planned.fallback)
    if destination == nil then
        log(planned.fallback and "placement_fallback_candidate" or "placement_candidate", request.source .. "|idx=" .. tostring(request.placement_index) .. "|clear=false|reason=" .. rotation_or_reason)
        if string.find(rotation_or_reason, "placement_api_unavailable", 1, true) ~= nil or string.find(rotation_or_reason, "invalid_output", 1, true) ~= nil then release_request(request, rotation_or_reason); return end
        request.placement_index = request.placement_index + 1
        queue_stage(request, 16, "placement", place_and_move)
        return
    end
    request.before, request.destination = target.location, destination
    local initial_distance = dist_sq(request.before, destination)
    if initial_distance == nil then release_request(request, "destination_distance_invalid"); return end
    if initial_distance <= teleport_success_distance_sq then release_request(request, "already_near_destination"); return end
    log("teleport_attempt", request.source .. "|target=" .. target.name .. "|from=" .. vec_text(request.before) .. "|to=" .. vec_text(destination))
    prepare_movement_for_teleport(target)
    local success, method = teleport_actor(target.pawn, request.before, destination, rotation_or_reason)
    log("teleport_result", request.source .. "|success=" .. tostring(success) .. "|method=" .. method)
    log("teleport_verify", request.source .. "|phase=immediate|verified=" .. tostring(success))
    if not success then release_request(request, method); return end
    sync_controller_after_teleport(target, destination, rotation_or_reason)
    replicate_result(target)
    request.verify_index = 1
    queue_stage(request, verification_delays[1], "verify", verify_movement)
end

local function discover_request(request)
    local world = get_world()
    if not is_valid(world) then release_request(request, "current_world_unavailable"); return end
    local world_path = path_of(world)
    if request.world ~= nil and request.world ~= world_path then release_request(request, "world_changed"); return end
    request.world = world_path
    local host, host_reason = host_context()
    log("host_context", request.source .. "|host=" .. tostring(host) .. "|reason=" .. host_reason)
    if not host then release_request(request, host_reason); return end
    local players = collect_player_pawns()
    log_player_records(request.source, players)
    log("target_scan", request.source .. "|valid_player_pawns=" .. tostring(#players))
    local candidates = catchup_target_candidates(players, request.mode)
    if request.mode == "scan" then release_request(request, "scan_complete"); return end
    if #players < 2 then
        if request.attempt < max_retries then
            request.attempt = request.attempt + 1
            log("teleport_wait", request.source .. "|reason=teammate_missing|attempt=" .. tostring(request.attempt))
            queue_stage(request, retry_delay_ms, "discovery", discover_request)
        else
            release_request(request, "teammate_missing")
        end
        return
    end
    local selected = request.target_index and candidates[request.target_index] or nil
    if request.target_index == nil then
        for _, candidate in ipairs(candidates) do
            if candidate.eligible then selected = candidate; break end
        end
    end
    if selected == nil or not selected.eligible then release_request(request, selected and selected.reason or "no_eligible_remote_target"); return end
    request.target = describe_player(selected.player)
    if request.target == nil then release_request(request, "target_identity_unavailable"); return end
    local teammates = {}
    for _, player in ipairs(players) do
        local team_ok = same_session_team(selected.player, player)
        if player.name ~= selected.player.name and team_ok and state_gate_reason(player) == nil and has_authority(player.pawn) == true then
            local identity = describe_player(player)
            local distance = dist_sq(selected.player.location, player.location)
            if identity ~= nil and distance ~= nil then table.insert(teammates, { identity = identity, distance = distance }) end
        end
    end
    table.sort(teammates, function(a, b)
        if a.distance ~= b.distance then return a.distance < b.distance end
        return a.identity.name < b.identity.name
    end)
    request.placements = {}
    for _, teammate in ipairs(teammates) do
        for _, radius in ipairs(radial_radii) do
            for _, angle in ipairs(radial_angles) do
                table.insert(request.placements, { teammate = teammate.identity, offset = vec(math.cos(math.rad(angle)) * radius, math.sin(math.rad(angle)) * radius, 0), fallback = false })
            end
        end
        table.insert(request.placements, { teammate = teammate.identity, offset = vec(0, 0, 260), fallback = true })
    end
    request.placement_index = 1
    log("server_rpc", "ServerRequestCatchupToTeammate|lua_host_contract_only|target=" .. selected.player.name)
    queue_stage(request, 16, "placement", place_and_move)
end

local function schedule_catchup(source, mode, target_index)
    if active_request ~= nil then
        if now_seconds() - active_request.started > 30 then release_request(active_request, "request_timeout") else log("request_busy", source); return end
    end
    request_sequence = request_sequence + 1
    local request = { id = request_sequence, source = source, mode = mode, target_index = target_index, started = now_seconds(), attempt = 1, missing = {} }
    active_request = request
    log("manual_trigger", source .. "|mode=" .. mode .. "|id=" .. tostring(request.id))
    queue_stage(request, 1, "discovery", discover_request)
end

local function numeric_parameter(full_command, parameters)
    if type(parameters) ~= "table" then return nil, full_command ~= "cmm_catchup_host" end
    if parameters[1] == nil then return nil, false end
    if parameters[2] ~= nil then return nil, true end
    local value = tonumber(parameters[1])
    if not finite_number(value) or value < 1 or value % 1 ~= 0 then return nil, true end
    return value, false
end

local function register_manual_trigger()
    if type(RegisterKeyBind) == "function" and Key ~= nil and ModifierKey ~= nil and Key.F8 ~= nil and ModifierKey.CONTROL ~= nil then
        local ok, err = pcall(function() RegisterKeyBind(Key.F8, { ModifierKey.CONTROL }, function() schedule_catchup("manual_keybind", "smart", nil) end) end)
        log("manual_keybind", ok and "registered|CTRL+F8" or "unavailable|" .. tostring(err))
    end
    if type(RegisterConsoleCommandHandler) == "function" then
        for _, command in ipairs({ { "cmm_catchup", "smart" }, { "cmm_catchup_local", "local" }, { "cmm_catchup_scan", "scan" } }) do
            local name, mode = command[1], command[2]
            RegisterConsoleCommandHandler(name, function() schedule_catchup(name, mode, nil); return true end)
        end
        RegisterConsoleCommandHandler("cmm_catchup_host", function(full_command, parameters)
            local index, invalid = numeric_parameter(full_command, parameters)
            if invalid then log("teleport_skipped", "invalid_target_index") else schedule_catchup("manual_console_host", "host", index) end
            return true
        end)
        RegisterConsoleCommandHandler("cmm_catchup_reset", function()
            if active_request ~= nil then log("request_busy", "reset") else last_catchup = {}; log("cooldown_reset", "manual_reset") end
            return true
        end)
        log("manual_console", "registered|cmm_catchup,cmm_catchup_local,cmm_catchup_host,cmm_catchup_scan,cmm_catchup_reset")
    end
end

log("startup", "version=0.2.6-prototype.20261111|helpers=" .. tostring(ok_helpers) .. "|mode=manual_host_smart_session_bound_sustained_verification")
register_manual_trigger()
