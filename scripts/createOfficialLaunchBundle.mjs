import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const releaseRoot = path.resolve("release");
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const folderName = "official-launch-mods";
const outputRoot = path.join(releaseRoot, folderName);
const unpackedOutputRoot = path.join(unpackedRoot, folderName);
const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
const officialZipPath = path.join(
  releaseRoot,
  `Clawed-Mod-Manager-${packageJson.version}-official-launch-win-x64.zip`
);
const hasUnpacked = await exists(unpackedRoot);
const packages = [
  {
    id: "ModsActiveTitleLogo",
    file: "ModsActiveTitleLogo.clawedmod",
    name: "Mods Active Title Logo",
    role: "Mods Active title logo",
    loader: "pak",
    validation: "Generated Pak/IoStore title-logo package; live texture validation is not rerun by this script."
  },
  {
    id: "CoopSessionGuard",
    file: "CoopSessionGuard.clawedmod",
    name: "Co-op Session Guard",
    role: "Co-op session diagnostics, guarded recovery, and lifecycle-safe snapshots",
    loader: "ue4ss",
    validation:
      "Prototype package with broad lifecycle hooks disabled; multi-client supported-party-size host/join validation is still required."
  },
  {
    id: "CoopCatchupTeleport",
    file: "CoopCatchupTeleport.clawedmod",
    name: "Co-op Catch-up Teleport",
    role: "Manual-only host-smart diagnostic co-op catch-up teleport hotfix",
    loader: "ue4ss",
    validation:
      "Manual-only host-smart N-player diagnostic hotfix package; automatic start/load hooks are disabled and multiplayer teleport behavior is still unvalidated."
  }
];

await cleanDir(outputRoot);
if (hasUnpacked) {
  await cleanDir(unpackedOutputRoot);
}

await runPackageScript("createManualTextureOverridePackage.mjs", {
  CMM_TEXTURE_OVERRIDE_OUTPUT_DIR: outputRoot,
  CMM_TEXTURE_OVERRIDE_UNPACKED_OUTPUT_DIR: unpackedOutputRoot
});
await runPackageScript("createCoopSessionGuardPackage.mjs", {
  CMM_COOP_SESSION_GUARD_OUTPUT_DIR: outputRoot,
  CMM_COOP_SESSION_GUARD_UNPACKED_OUTPUT_DIR: unpackedOutputRoot
});
await runPackageScript("createCoopCatchupTeleportPackage.mjs", {
  CMM_COOP_CATCHUP_OUTPUT_DIR: outputRoot,
  CMM_COOP_CATCHUP_UNPACKED_OUTPUT_DIR: unpackedOutputRoot
});

await writeBundleFiles(outputRoot, "release/official-launch-mods");
if (hasUnpacked) {
  await writeBundleFiles(
    unpackedOutputRoot,
    "release/win-unpacked/official-launch-mods"
  );
  await createOfficialZip();
}

process.stdout.write(
  [
    path.relative(process.cwd(), outputRoot),
    hasUnpacked ? path.relative(process.cwd(), unpackedOutputRoot) : null,
    hasUnpacked ? path.relative(process.cwd(), officialZipPath) : null
  ]
    .filter(Boolean)
    .join("\n") + "\n"
);

async function runPackageScript(scriptName, env) {
  await runProcess(
    process.execPath,
    [path.join("scripts", scriptName)],
    scriptName,
    { ...process.env, ...env }
  );
}

async function runProcess(command, args, label, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}.`));
    });
  });
}

async function createOfficialZip() {
  assertReleaseChild(officialZipPath);
  await rm(officialZipPath, { force: true });
  await runProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -Path ${quotePowerShell(
        path.join(unpackedRoot, "*")
      )} -DestinationPath ${quotePowerShell(officialZipPath)} -Force`
    ],
    "Compress-Archive"
  );
}

async function writeBundleFiles(targetRoot, displayPath) {
  const packageSummaries = [];
  for (const item of packages) {
    const packagePath = path.join(targetRoot, item.file);
    await expectPath(packagePath);
    packageSummaries.push({
      ...item,
      packageSha256: await sha256(packagePath)
    });
    await rm(path.join(targetRoot, `${item.id}.summary.json`), { force: true });
  }

  const summary = {
    schemaVersion: 1,
    result: "GENERATED",
    bundle: "official-launch-mods",
    generatedAt: new Date().toISOString(),
    folder: displayPath,
    packages: packageSummaries,
    installFlow: "Import each .clawedmod through CMM Mods > Import, enable the selected packages in the active profile, then Launch Modded.",
    validationBoundaries: [
      "Packages are included for import; CMM does not auto-install or auto-enable them.",
      "All runtime packages remain normal .clawedmod archives.",
      "No package patches Steam, EOS, executable files, anti-cheat, game DLLs, base GameMode assets, or base PlayerController assets.",
      "Co-op host/client behavior remains unvalidated until tested across Clawed's supported party sizes."
    ]
  };

  await writeFile(path.join(targetRoot, "README.md"), readme(), "utf8");
  await writeFile(
    path.join(targetRoot, "official-launch-mods.summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
}

function readme() {
  return [
    "# Official Launch Mods",
    "",
    "These packages ship with the first official Clawed Mod Manager launch.",
    "",
    "Import the `.clawedmod` files from this folder through CMM Mods > Import, enable the selected packages in the active profile, then use Launch Modded.",
    "",
    "Included packages:",
    "",
    "- `ModsActiveTitleLogo.clawedmod`: replaces the title/menu logo with the Mods Active image through the Pak/IoStore route.",
    "- `CoopSessionGuard.clawedmod`: UE4SS co-op session guard prototype with guarded session commands, failure logging, broad lifecycle hooks disabled, and no package-level player-count cap.",
    "- `CoopCatchupTeleport.clawedmod`: manual-only host-smart diagnostic N-player UE4SS co-op catch-up teleport hotfix; automatic start/load hooks are disabled.",
    "",
    "Boundaries:",
    "",
    "- CMM does not auto-install or auto-enable these packages.",
    "- The co-op packages are prototypes and still require real host/client validation across Clawed's supported party sizes.",
    "- None of these packages patch Steam, EOS, executable files, anti-cheat, game DLLs, base GameMode assets, or base PlayerController assets."
  ].join("\n") + "\n";
}

async function cleanDir(targetPath) {
  assertReleaseChild(targetPath);
  await rm(targetPath, { recursive: true, force: true });
  await mkdir(targetPath, { recursive: true });
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertReleaseChild(targetPath) {
  const relative = path.relative(releaseRoot, targetPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${targetPath} is not a release child path.`);
  }
}

async function expectPath(targetPath) {
  if (!(await exists(targetPath))) {
    throw new Error(`${targetPath} must exist.`);
  }
}

async function exists(targetPath) {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

async function sha256(targetPath) {
  return crypto.createHash("sha256").update(await readFile(targetPath)).digest("hex");
}
