import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const modId = "SafeInputSmoke";
const message = "CMM SAFE INPUT SMOKE ACTIVE";
const readme = `# Safe Input Smoke

Minimal manual test package for Clawed Mod Manager.

Expected result:

- Clawed launches modded.
- Input remains usable.
- \`Clawed\\Binaries\\Win64\\ue4ss\\UE4SS.log\` contains \`[${modId}] done|${message}\`.
- A short \`${message}\` message may appear on screen.

This package does not mutate widgets, render CVars, pawn scale, debug draw, input mode, menus, saves, inventory, multiplayer state, or original game files.
`;

const lua = `local okHelpers, UEHelpers = pcall(require, "UEHelpers")
local marker = "[${modId}] "

local function log(event, value)
    print(marker .. event .. "|" .. tostring(value))
end

local function is_valid(object)
    return object ~= nil and object.IsValid ~= nil and object:IsValid()
end

local function emit()
    local engine = FindFirstOf("GameEngine")
    log("engine", tostring(engine ~= nil))

    if not okHelpers then
        log("helpers", "false")
        log("done", "LOG_ONLY")
        return
    end

    local kismet = UEHelpers.GetKismetSystemLibrary()
    if not is_valid(kismet) then
        log("print_string", "kismet_invalid")
        log("done", "LOG_ONLY")
        return
    end

    local world = UEHelpers.GetWorld()
    if not is_valid(world) then world = FindFirstOf("World") end
    if not is_valid(world) then world = engine end
    if not is_valid(world) then
        log("print_string", "world_missing")
        log("done", "LOG_ONLY")
        return
    end

    local key = UEHelpers.FindOrAddFName("${modId}")
    local color = { R = 0.0, G = 1.0, B = 0.2, A = 1.0 }
    local ok, err = pcall(function()
        kismet:PrintString(world, "${message}", true, false, color, 8.0, key)
    end)

    log("print_string", tostring(ok) .. "|" .. tostring(err))
    log("done", "${message}")
end

ExecuteInGameThread(emit)
`;

const manifest = {
  schemaVersion: 1,
  id: modId,
  name: "Safe Input Smoke",
  version: "20260815T110000",
  author: "Clawed Mod Manager",
  description:
    "Minimal UE4SS smoke test that logs and prints a short marker without mutating gameplay input, widgets, global rendering, or pawn state.",
  game: "clawed",
  loader: "ue4ss",
  dependencies: [],
  conflicts: [],
  loadAfter: [],
  loadBefore: []
};

async function exists(targetPath) {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function writePackage(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file(`payload/Mods/${modId}/Scripts/main.lua`, lua);
  zip.file("README.md", readme);

  const packagePath = path.join(outputDirectory, `${modId}.clawedmod`);
  await writeFile(packagePath, await zip.generateAsync({ type: "nodebuffer" }));
  await writeFile(path.join(outputDirectory, "README.md"), readme);
  return packagePath;
}

const releaseRoot = path.resolve("release");
const targets = [path.join(releaseRoot, "manual-test-mods")];
const unpackedRoot = path.join(releaseRoot, "win-unpacked");

if (await exists(unpackedRoot)) {
  targets.push(path.join(unpackedRoot, "manual-test-mods"));
}

for (const target of targets) {
  await writePackage(target);
}
