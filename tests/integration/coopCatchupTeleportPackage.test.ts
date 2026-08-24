import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";

const execFileAsync = promisify(execFile);
const modId = "CoopCatchupTeleport";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot !== null) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("CoopCatchupTeleport package", () => {
  it("generates the host-smart manual teleport package without automatic start hooks", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-catchup-"));
    const outputDir = path.join(tempRoot, "prototype-mods");
    const unpackedOutputDir = path.join(tempRoot, "win-unpacked", "prototype-mods");
    await execFileAsync(
      process.execPath,
      [path.resolve("scripts", "createCoopCatchupTeleportPackage.mjs")],
      {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          CMM_CLAWED_STEAM_BUILD_ID: "test-build",
          CMM_COOP_CATCHUP_OUTPUT_DIR: outputDir,
          CMM_COOP_CATCHUP_UNPACKED_OUTPUT_DIR: unpackedOutputDir
        }
      }
    );

    const parsed = await new ClawedModPackageService().parsePackage(
      path.join(outputDir, `${modId}.clawedmod`)
    );
    const lua = await parsed.zip
      .file(`payload/Mods/${modId}/Scripts/main.lua`)!
      .async("string");
    const readme = await parsed.zip.file("README.md")!.async("string");

    expect(parsed.manifest).toMatchObject({
      id: modId,
      version: "0.2.4-prototype.20260824",
      loader: "ue4ss",
      game: "clawed",
      conflicts: ["ClawedCoopCatchupTeleport"],
      loadAfter: ["CoopSessionGuard"],
      packageIdentity: {
        id: `cmm:generated:${modId}`,
        source: "cmmGenerated"
      },
      creatorAssets: {
        supportedSteamBuilds: [
          {
            buildId: "test-build",
            status: "untested"
          }
        ]
      }
    });
    expect(parsed.hasChecksums).toBe(true);
    expect(lua).toContain("attempt_smart_catchup");
    expect(lua).toContain("catchup_target_candidates");
    expect(lua).toContain("collect_player_states");
    expect(lua).toContain("client_no_authority_host_required");
    expect(lua).toContain("cmm_catchup_host");
    expect(lua).toContain("cmm_catchup_local");
    expect(lua).toContain("cmm_catchup_scan");
    expect(lua).toContain("cmm_catchup_reset");
    expect(lua).toContain("placement_fallback_candidate");
    expect(lua).toContain("movement_prepare");
    expect(lua).toContain("teleport_success_distance_sq");
    expect(lua).toContain("ClientSetLocation");
    expect(lua).toContain("FlushNetDormancy");
    expect(lua).toContain("teleport_verify");
    expect(lua).toContain("verified=");
    expect(lua).toContain("cooldown_reset");
    expect(lua).toContain("host_context");
    expect(lua).toContain("player_record");
    expect(lua).toContain("target_candidate");
    expect(lua).toContain("local_player");
    expect(lua).not.toContain("RegisterBeginPlayPostHook");
    expect(lua).not.toContain("RegisterLoadMapPostHook");
    expect(lua).not.toContain("NotifyOnNewObject");
    expect(lua).not.toContain(":ClientRestart");
    expect(lua).not.toContain(":K2_PostLogin");
    expect(readme).toContain("host-smart");
    expect(readme).toContain("client_no_authority_host_required");
    expect(readme).toContain("cmm_catchup_scan");
    expect(readme).toContain("cmm_catchup_host 2");
  });
});
