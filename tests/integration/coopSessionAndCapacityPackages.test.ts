import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";

const execFileAsync = promisify(execFile);

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot !== null) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("remaining co-op packages", () => {
  it("generates the lifecycle-safe session guard package", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-session-guard-"));
    const outputDir = path.join(tempRoot, "prototype-mods");
    const unpackedOutputDir = path.join(tempRoot, "win-unpacked", "prototype-mods");
    await execFileAsync(
      process.execPath,
      [path.resolve("scripts", "createCoopSessionGuardPackage.mjs")],
      {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          CMM_CLAWED_STEAM_BUILD_ID: "test-build",
          CMM_COOP_SESSION_GUARD_OUTPUT_DIR: outputDir,
          CMM_COOP_SESSION_GUARD_UNPACKED_OUTPUT_DIR: unpackedOutputDir
        }
      }
    );

    const parsed = await new ClawedModPackageService().parsePackage(
      path.join(outputDir, "CoopSessionGuard.clawedmod")
    );
    const lua = await parsed.zip
      .file("payload/Mods/CoopSessionGuard/Scripts/main.lua")!
      .async("string");
    const readme = await parsed.zip.file("README.md")!.async("string");

    expect(parsed.manifest).toMatchObject({
      id: "CoopSessionGuard",
      version: "0.2.2-prototype.20260824",
      loader: "ue4ss",
      game: "clawed",
      conflicts: ["ClawedCoopSessionGuard"],
      loadAfter: ["CoopCapacity8"],
      packageIdentity: {
        id: "cmm:generated:CoopSessionGuard",
        source: "cmmGenerated"
      }
    });
    expect(parsed.hasChecksums).toBe(true);
    expect(lua).toContain("session_environment");
    expect(lua).toContain("player_state_count");
    expect(lua).toContain("cmm_session_scan");
    expect(lua).toContain("cmm_session_failures");
    expect(lua).toContain("cmm_session_clear_payloads");
    expect(lua).toContain("broad_lifecycle_hook_deferred");
    expect(lua).toContain("last_find_args");
    expect(lua).not.toContain("RegisterLoadMapPostHook(function");
    expect(lua).not.toContain("NotifyOnNewObject(\"/Script/Engine.GameInstance\"");
    expect(readme).toContain("Broad map-load and object-notify hooks are disabled");
    expect(readme).toContain("ClawedCoopSessionGuard");
  });

  it("generates the scan-and-verify capacity package", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-capacity8-"));
    const outputDir = path.join(tempRoot, "prototype-mods");
    const unpackedOutputDir = path.join(tempRoot, "win-unpacked", "prototype-mods");
    await execFileAsync(
      process.execPath,
      [path.resolve("scripts", "createCoopCapacity8Package.mjs")],
      {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          CMM_CLAWED_STEAM_BUILD_ID: "test-build",
          CMM_COOP_CAPACITY8_OUTPUT_DIR: outputDir,
          CMM_COOP_CAPACITY8_UNPACKED_OUTPUT_DIR: unpackedOutputDir
        }
      }
    );

    const parsed = await new ClawedModPackageService().parsePackage(
      path.join(outputDir, "CoopCapacity8.clawedmod")
    );
    const lua = await parsed.zip
      .file("payload/Mods/CoopCapacity8/Scripts/main.lua")!
      .async("string");
    const readme = await parsed.zip.file("README.md")!.async("string");

    expect(parsed.manifest).toMatchObject({
      id: "CoopCapacity8",
      version: "0.1.1-prototype.20260824",
      loader: "ue4ss",
      game: "clawed",
      conflicts: ["ClawedCoopCapacity8"],
      loadBefore: ["CoopSessionGuard"],
      packageIdentity: {
        id: "cmm:generated:CoopCapacity8",
        source: "cmmGenerated"
      }
    });
    expect(parsed.hasChecksums).toBe(true);
    expect(lua).toContain("capacity_environment");
    expect(lua).toContain("verify_capacity");
    expect(lua).toContain("capacity_verify_property");
    expect(lua).toContain("cmm_coop_capacity8_scan");
    expect(lua).toContain("cmm_coop_capacity8_verify");
    expect(lua).toContain("dry_run_skipped");
    expect(lua).toContain("0.1.1-prototype.20260824");
    expect(readme).toContain("cmm_coop_capacity8_scan");
    expect(readme).toContain("ClawedCoopCapacity8");
  });
});
