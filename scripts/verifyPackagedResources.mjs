import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const requiredMapFiles = [
  "clawed-all-files-and-container-entries.csv",
  "clawed-physical-files.csv",
  "clawed-shipping-manifest-entries.csv",
  "clawed-container-entries-annotated.csv",
  "clawed-map-summary.json"
];
const catchupVersion = "0.2.6-prototype.20261111";
const catchupLuaPath = "payload/Mods/CoopCatchupTeleport/Scripts/main.lua";
const requiredAvailablePackages = {
  "available-mods/official-launch-mods": [
    {
      fileName: "ModsActiveTitleLogo.clawedmod",
      manifest: {
        id: "ModsActiveTitleLogo",
        loader: "pak"
      },
      entries: [
        "payload/Content/Paks/ModsActiveTitleLogo.pak",
        "payload/Content/Paks/ModsActiveTitleLogo.utoc",
        "payload/Content/Paks/ModsActiveTitleLogo.ucas"
      ]
    },
    catchupRequirement()
  ],
  "available-mods/prototype-mods": [catchupRequirement()]
};
const errors = [];

for (const resource of packageJson.build?.extraResources ?? []) {
  const source = path.resolve(repoRoot, resource.from);
  if (!existsSync(source)) {
    errors.push(`Missing packaged resource: ${resource.from}`);
    continue;
  }

  if (resource.to === "clawed-game-file-map/20260814-current") {
    for (const fileName of requiredMapFiles) {
      const filePath = path.join(source, fileName);
      const fileStat = existsSync(filePath) ? statSync(filePath) : null;
      if (!fileStat?.isFile() || fileStat.size === 0) {
        errors.push(`Missing Clawed asset map file: ${resource.from}/${fileName}`);
      }
    }
  }

  const packageRequirements = requiredAvailablePackages[resource.to];
  if (packageRequirements) {
    await verifyAvailablePackages(source, resource.from, packageRequirements);
  }
}

if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Packaged resources verified.\n");

function catchupRequirement() {
  return {
    fileName: "CoopCatchupTeleport.clawedmod",
    manifest: {
      id: "CoopCatchupTeleport",
      version: catchupVersion,
      loader: "ue4ss",
      conflicts: ["ClawedCoopCatchupTeleport"],
      loadAfter: ["CoopSessionGuard"]
    },
    entries: [catchupLuaPath],
    textEntries: [
      {
        path: catchupLuaPath,
        includes: [
          "cmm_catchup_scan",
          "cmm_catchup_host",
          "client_no_authority_host_required",
          "teleport_verify",
          "cooldown_reset"
        ],
        excludes: [
          "RegisterBeginPlayPostHook",
          "RegisterLoadMapPostHook",
          "NotifyOnNewObject",
          ":ClientRestart",
          ":K2_PostLogin"
        ]
      }
    ]
  };
}

async function verifyAvailablePackages(source, displaySource, requirements) {
  for (const requirement of requirements) {
    await verifyAvailablePackage(
      path.join(source, requirement.fileName),
      `${displaySource}/${requirement.fileName}`,
      requirement
    );
  }
}

async function verifyAvailablePackage(packagePath, displayPath, requirement) {
  const packageStat = existsSync(packagePath) ? statSync(packagePath) : null;
  if (!packageStat?.isFile() || packageStat.size === 0) {
    errors.push(`Missing available mod package: ${displayPath}`);
    return;
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(readFileSync(packagePath));
  } catch (error) {
    errors.push(`Unreadable available mod package: ${displayPath}: ${errorMessage(error)}`);
    return;
  }

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) {
    errors.push(`Missing manifest.json in available mod package: ${displayPath}`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(await manifestFile.async("string"));
  } catch (error) {
    errors.push(`Invalid manifest.json in available mod package: ${displayPath}: ${errorMessage(error)}`);
    return;
  }

  verifyManifest(displayPath, manifest, requirement.manifest);

  for (const entry of requirement.entries ?? []) {
    if (!zip.file(entry)) {
      errors.push(`Missing ${entry} in available mod package: ${displayPath}`);
    }
  }

  for (const textEntry of requirement.textEntries ?? []) {
    const file = zip.file(textEntry.path);
    if (!file) {
      continue;
    }
    const text = await file.async("string");
    for (const value of textEntry.includes ?? []) {
      if (!text.includes(value)) {
        errors.push(`Missing marker ${value} in ${textEntry.path} of ${displayPath}`);
      }
    }
    for (const value of textEntry.excludes ?? []) {
      if (text.includes(value)) {
        errors.push(`Stale marker ${value} found in ${textEntry.path} of ${displayPath}`);
      }
    }
  }
}

function verifyManifest(displayPath, manifest, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (Array.isArray(value)) {
      const actual = manifest[key];
      if (
        !Array.isArray(actual) ||
        actual.length !== value.length ||
        value.some((entry, index) => actual[index] !== entry)
      ) {
        errors.push(
          `Unexpected ${key} in ${displayPath}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`
        );
      }
      continue;
    }

    if (manifest[key] !== value) {
      errors.push(
        `Unexpected ${key} in ${displayPath}: expected ${JSON.stringify(value)}, got ${JSON.stringify(manifest[key])}`
      );
    }
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
