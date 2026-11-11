import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";

type LuaState = object;

interface LuaRuntime {
  lua: {
    lua_close(state: LuaState): void;
    lua_pcall(state: LuaState, args: number, results: number, handler: number): number;
    lua_tojsstring(state: LuaState, index: number): string | null;
  };
  lauxlib: {
    luaL_newstate(): LuaState;
    luaL_loadstring(state: LuaState, source: Uint8Array): number;
  };
  lualib: {
    luaL_openlibs(state: LuaState): void;
  };
  to_luastring(source: string): Uint8Array;
}

const runtime = createRequire(import.meta.url)("fengari") as LuaRuntime;
const execFileAsync = promisify(execFile);
let tempRoot: string | null = null;
let source = "";
let policySource = "";

function execute(script: string, run = true): void {
  const state = runtime.lauxlib.luaL_newstate();
  try {
    runtime.lualib.luaL_openlibs(state);
    const compiled = runtime.lauxlib.luaL_loadstring(state, runtime.to_luastring(script));
    if (compiled !== 0) throw new Error(runtime.lua.lua_tojsstring(state, -1) ?? "Lua compilation failed");
    if (run && runtime.lua.lua_pcall(state, 0, 0, 0) !== 0) {
      throw new Error(runtime.lua.lua_tojsstring(state, -1) ?? "Lua execution failed");
    }
  } finally {
    runtime.lua.lua_close(state);
  }
}

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-catchup-runtime-"));
  const outputDir = path.join(tempRoot, "prototype-mods");
  await execFileAsync(process.execPath, [path.resolve("scripts/createCoopCatchupTeleportPackage.mjs")], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      CMM_CLAWED_STEAM_BUILD_ID: "test-build",
      CMM_COOP_CATCHUP_OUTPUT_DIR: outputDir,
      CMM_COOP_CATCHUP_UNPACKED_OUTPUT_DIR: path.join(tempRoot, "unpacked")
    }
  });
  const parsed = await new ClawedModPackageService().parsePackage(path.join(outputDir, "CoopCatchupTeleport.clawedmod"));
  source = await parsed.zip.file("payload/Mods/CoopCatchupTeleport/Scripts/main.lua")!.async("string");
  const startup = source.lastIndexOf('\nlog("startup",');
  expect(startup).toBeGreaterThan(0);
  policySource = source.slice(0, startup);
});

afterAll(async () => {
  if (tempRoot !== null) {
    const root = path.resolve(tempRoot);
    if (!root.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unexpected runtime test directory");
    await rm(root, { recursive: true, force: true });
  }
});

describe("generated catch-up Lua policy without an Unreal simulation", () => {
  it("compiles the complete generated Lua payload", () => {
    execute(source, false);
  });

  it("rejects invalid vectors and copies supported out-parameter vectors", () => {
    execute(`${policySource}
assert(copy_vector(nil) == nil)
assert(copy_vector({ X = 1, Y = 2 }) == nil)
assert(copy_vector({ X = "1", Y = 2, Z = 3 }) == nil)
assert(copy_vector({ X = 0/0, Y = 2, Z = 3 }) == nil)
assert(copy_vector({ X = math.huge, Y = 2, Z = 3 }) == nil)
assert(copy_vector({ X = -math.huge, Y = 2, Z = 3 }) == nil)
local raw = { X = 1.5, Y = -2.5, Z = 3.5 }
local copied = copy_vector(raw)
assert(copied ~= raw and copied.X == 1.5 and copied.Y == -2.5 and copied.Z == 3.5)
copied.X = 100
assert(raw.X == 1.5)
assert(read_out_vector(raw).Z == 3.5)
assert(read_out_vector({ raw }).Y == -2.5)
assert(read_out_vector({ ProjectedLocation = raw }).X == 1.5)
assert(read_out_vector({ {} }) == nil)
`);
  });

  it("requires an explicit true result from boolean Unreal calls", () => {
    execute(`${policySource}
assert(strict_bool_call(true, true) == true)
assert(strict_bool_call(true, nil) == false)
assert(strict_bool_call(true, false) == false)
assert(strict_bool_call(true, 1) == false)
assert(strict_bool_call(false, true) == false)
`);
  });

  it("rejects unchanged positions, snap-back, invalid samples, and already-near targets", () => {
    execute(`${policySource}
local origin = { X = 0, Y = 0, Z = 0 }
local desired = { X = 10000, Y = 0, Z = 0 }
assert(movement_verdict(origin, desired, desired, false) == true)
assert(movement_verdict(origin, desired, origin, false) == false)
assert(movement_verdict(origin, desired, nil, false) == false)
assert(movement_verdict(origin, desired, { X = 9900, Y = 0, Z = 0 }, false) == true)
assert(movement_verdict(origin, desired, { X = 9000, Y = 0, Z = 0 }, false) == false)
assert(movement_verdict(desired, desired, desired, false) == false)
assert(movement_verdict(origin, desired, { X = 11000, Y = 0, Z = 0 }, true) == true)
assert(movement_verdict(origin, desired, origin, true) == false)
assert(movement_verdict(origin, desired, { X = 1000, Y = 0, Z = 0 }, true) == false)
assert(movement_verdict(origin, { X = 1e308, Y = 0, Z = 0 }, desired, false) == false)
local close = { X = 400, Y = 0, Z = 0 }
assert(movement_verdict(origin, close, { X = 1000, Y = 0, Z = 0 }, true) == false)
`);
  });

  it("excludes the host, ambiguous ownership, and unrelated player records", () => {
    execute(`${policySource}
assert(remote_candidate_reason(false, true, false, true, true) == nil)
assert(remote_candidate_reason(true, true, false, true, true) ~= nil)
assert(remote_candidate_reason(false, false, false, true, true) ~= nil)
assert(remote_candidate_reason(false, true, nil, true, true) ~= nil)
assert(remote_candidate_reason(false, true, true, true, true) ~= nil)
assert(remote_candidate_reason(false, true, false, false, true) ~= nil)
assert(remote_candidate_reason(false, true, false, true, false) ~= nil)
`);
  });

  it("orders eligible targets by distance with stable identity tie-breaking", () => {
    execute(`${policySource}
local candidates = {
    { eligible = true, distance = 100, player = { name = "B" } },
    { eligible = false, distance = 10000, player = { name = "D" } },
    { eligible = true, distance = 100, player = { name = "A" } },
    { eligible = true, distance = 200, player = { name = "C" } }
}
table.sort(candidates, target_less)
assert(candidates[1].player.name == "C")
assert(candidates[2].player.name == "A")
assert(candidates[3].player.name == "B")
assert(candidates[4].player.name == "D")
assert(target_less(candidates[1], candidates[1]) == false)
`);
  });

  it("rejects ambiguous target indices instead of selecting an unintended player", () => {
    execute(`${policySource}
local index, invalid = numeric_parameter("cmm_catchup_host", {})
assert(index == nil and invalid == false)
index, invalid = numeric_parameter("cmm_catchup_host", { "2" })
assert(index == 2 and invalid == false)
for _, value in ipairs({ "0", "-1", "1.5", "nan", "inf", "", "two" }) do
    index, invalid = numeric_parameter("cmm_catchup_host", { value })
    assert(index == nil and invalid == true)
end
index, invalid = numeric_parameter("cmm_catchup_host", { "2", "3" })
assert(index == nil and invalid == true)
index, invalid = numeric_parameter("cmm_catchup_host 2", nil)
assert(index == nil and invalid == true)
`);
  });
});
