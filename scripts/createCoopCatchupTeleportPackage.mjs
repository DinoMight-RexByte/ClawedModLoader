import crypto from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import JSZip from "jszip";
import {
  currentClawedSteamBuildId,
  generatedCreatorSupportMetadata,
  generatedPackageIdentity,
  generatedSupportedSteamBuilds
} from "./clawedBuildMetadata.mjs";

const modId = "CoopCatchupTeleport";
const modName = "Co-op Catch-up Teleport";
const version = "0.2.6-prototype.20261111";
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "Host-smart diagnostic teleport hotfix generated against the currently detected Clawed build; no multiplayer runtime validation has been performed.";
const releaseRoot = path.resolve("release");
const outputRoot = path.resolve(
  process.env.CMM_COOP_CATCHUP_OUTPUT_DIR ??
    path.join(releaseRoot, "prototype-mods")
);
const payloadPath = `payload/Mods/${modId}/Scripts/main.lua`;
const lua = await readFile(new URL("./coopCatchupTeleport.lua", import.meta.url), "utf8");
const readme = [
  `# ${modName}`,
  "",
  "Manual-only UE4SS Lua hotfix prototype for Clawed co-op catch-up teleport.",
  `Version: ${version}`,
  "",
  "Intended behavior (multiplayer remains unvalidated):",
  "",
  "- Does not register `PlayerController:ClientRestart`, `GameModeBase:K2_PostLogin`, PlayerController creation, BeginPlay, or map-load hooks.",
  "- Does not run automatic catch-up work while starting a new game or loading a save.",
  "- Routes keybind and console requests through a Lua-side `ServerRequestCatchupToTeammate` contract marker.",
  "- Reacquires the current local controller and pawn for each manual retry instead of retaining UE4SS callback parameter wrappers.",
  "- `CTRL+F8` and `cmm_catchup` are host-smart: when run on the listen-server host, they require a confirmed remote session player and never fall back to moving the host.",
  "- Client-side `CTRL+F8`/`cmm_catchup` logs `client_no_authority_host_required` because a UE4SS Lua package cannot add a native client-to-server replicated request.",
  "- `cmm_catchup_local` keeps the older local-pawn-only behavior for diagnostics.",
  "- `cmm_catchup_host` explicitly runs host-side farthest-player catch-up; pass a logged target index such as `cmm_catchup_host 2` to move a specific eligible target.",
  "- `cmm_catchup_scan` logs host context, discovered players, and target order without moving anyone.",
  "- Iterates Unreal PlayerArray through UE4SS TArray:ForEach and immediately unwraps callback elements; fixes the discovery exception captured on build 25003536, with multiplayer behavior still unvalidated.",
  "- `cmm_catchup_reset` clears the Lua cooldown table for same-session retesting.",
  "- Declares a conflict with the legacy `ClawedCoopCatchupTeleport` package ID and loads after `CoopSessionGuard` when both packages are enabled.",
  "- Teleports only authority-owned possessed pawns and requires at least one distinct valid teammate.",
  "- Uses the current world PlayerArray and one cached PlayerController discovery pass when relationships are missing; rejects unrelated pawns and stale possession links.",
  "- Skips dead, spectator, invalid, unsafe-state, cooldown-blocked, and critical-objective-carrier pawns when those states are detectable.",
  "- Evaluates one placement per scheduled callback using measured capsules, ground support, optional documented navigation projection, unsafe-volume bounds, and required capsule clearance for radial and fallback candidates.",
  "- Stops character movement when available, then uses documented K2_TeleportTo and K2_SetActorLocationAndRotation calls with explicit true returns and measured displacement.",
  "- Reacquires the same world/player identities and verifies movement after 250, 1000, and 2500 ms before starting cooldown; correction, respawn, and travel are explicit failures.",
  "- Calls ForceNetUpdate/FlushNetDormancy where available immediately after a measured move; does not write guessed spawn/save fields or claim client-observed success.",
  "- Registers `CTRL+F8` as a host-smart manual catch-up trigger when UE4SS keybind APIs are available.",
  "- Registers `cmm_catchup`, `cmm_catchup_local`, `cmm_catchup_host`, `cmm_catchup_scan`, and `cmm_catchup_reset` as console command handlers when UE4SS exposes that API.",
  "- Serializes manual requests, caches per-callback discovery/missing members, scans hazard identities once per request, and logs stage timing/native scan counts; individual native scans can still stall.",
  "",
  "Expected UE4SS markers include:",
  "",
  "- `[CoopCatchupTeleport] startup|...`",
  "- `[CoopCatchupTeleport] manual_keybind|...`",
  "- `[CoopCatchupTeleport] manual_console|...`",
  "- `[CoopCatchupTeleport] manual_trigger|...`",
  "- `[CoopCatchupTeleport] host_context|...`",
  "- `[CoopCatchupTeleport] player_record|...`",
  "- `[CoopCatchupTeleport] target_scan|...`",
  "- `[CoopCatchupTeleport] target_candidate|...`",
  "- `[CoopCatchupTeleport] server_rpc|ServerRequestCatchupToTeammate|...`",
  "- `[CoopCatchupTeleport] placement_candidate|...`",
  "- `[CoopCatchupTeleport] placement_fallback_candidate|...`",
  "- `[CoopCatchupTeleport] teleport_attempt|...`",
  "- `[CoopCatchupTeleport] movement_prepare|...`",
  "- `[CoopCatchupTeleport] teleport_result|...`",
  "- `[CoopCatchupTeleport] teleport_verify|...`",
  "- `[CoopCatchupTeleport] controller_sync|...`",
  "- `[CoopCatchupTeleport] cooldown_reset|...`",
  "- `[CoopCatchupTeleport] discovery_summary|...`",
  "- `[CoopCatchupTeleport] discovery_incomplete|...`",
  "- `[CoopCatchupTeleport] movement_api|...`",
  "- `[CoopCatchupTeleport] stage_timing|...`",
  "- `[CoopCatchupTeleport] request_busy|...`",
  "- `[CoopCatchupTeleport] request_complete|...`",
  "- `[CoopCatchupTeleport] teleport_skipped|...`",
  "",
  "Retest on the host:",
  "",
  "1. Close Clawed normally, import this package, and select/enable this exact version in the host active profile.",
  "2. Launch modded, confirm the startup version, join a second player, and separate on safe ordinary terrain.",
  "3. Run cmm_catchup_scan; require distinct player_record rows and an eligible remote target_candidate.",
  "4. Press CTRL+F8 once; keep the joiner still for three seconds while delayed verification completes.",
  "5. Confirm both peers see the joiner stay moved after movement resumes; collect fresh logs from both peers, including any request_complete rejection and stage_timing markers.",
  "6. Host_position_sustained is host readback only; client-observed success remains a separate requirement.",
  "",
  "Safety boundaries:",
  "",
  "- Packaged only as a normal `.clawedmod` with `loader: \"ue4ss\"`.",
  "- Does not patch Steam, EOS, executable files, anti-cheat, game DLLs, GameMode assets, or PlayerController assets.",
  "- Does not replace Clawed Blueprint classes.",
  "- Does not add a native replicated UFUNCTION; the RPC name is implemented as a logged Lua contract around host/server-authority movement.",
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
    "Manual-only UE4SS host-smart N-player co-op catch-up teleport hotfix.",
  game: "clawed",
  loader: "ue4ss",
  dependencies: [],
  conflicts: ["ClawedCoopCatchupTeleport"],
  loadAfter: ["CoopSessionGuard"],
  loadBefore: [],
  packageIdentity: generatedPackageIdentity(modId),
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
      "Manual only: host-smart CTRL+F8/cmm_catchup plus cmm_catchup_local and cmm_catchup_host when UE4SS exposes those APIs; in-game UMG button deferred",
    placement:
      "Scheduled radial/fallback placement with ground support, measured capsules, optional navigation, and required capsule clearance",
    authorityContract:
      "Lua-side ServerRequestCatchupToTeammate contract marker only; no native replicated UFUNCTION added",
    runtimeClaims: [
      "UE4SS Lua package structure only",
      "Manual-only hotfix; no automatic start, load, PlayerController, BeginPlay, or map hooks",
      "Host-smart manual action requires confirmed remote session players and never falls back to moving the host",
      "Client-only manual action logs host authority required instead of attempting non-authoritative movement",
      "No hard-coded party size cap; current-world session membership and reciprocal player relationships are required",
      "Host/server-authority movement path only; no native client-to-server replicated catch-up request is added",
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
