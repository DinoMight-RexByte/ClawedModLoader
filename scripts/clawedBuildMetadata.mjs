import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CLAWED_STEAM_APP_ID = "3394840";

export async function currentClawedSteamBuildId() {
  const override = process.env.CMM_CLAWED_STEAM_BUILD_ID?.trim();
  if (override) {
    return override;
  }

  const manifestPath = await findClawedAppManifestPath();
  if (!manifestPath) {
    return null;
  }

  return parseSteamBuildId(await readFile(manifestPath, "utf8"));
}

export function generatedSupportedSteamBuilds(buildId, notes) {
  return buildId
    ? [
        {
          buildId,
          status: "untested",
          notes
        }
      ]
    : [];
}

export function generatedCreatorSupportMetadata({
  modId,
  modName,
  version,
  payloadPath,
  buildId,
  buildNotes,
  tags = ["ue4ss_runtime"]
}) {
  return {
    schemaVersion: 1,
    affectedAssets: [
      {
        id: "support-1",
        assetClass: "SupportFile",
        virtualPath: packageVirtualPath(modId, version, payloadPath),
        payloadPath,
        source: "generated",
        role: "support",
        tags
      }
    ],
    replacements: [],
    supportedSteamBuilds: generatedSupportedSteamBuilds(buildId, buildNotes),
    previewAssets: [],
    importProvenance: [
      {
        sourceKind: "generated",
        sourceName: modName,
        toolName: "CMM package script",
        toolVersion: version,
        rights: "generated"
      }
    ],
    assetDependencies: [],
    exportEligibility: {
      state: "exportable",
      allowedOutputs: ["clawedmod", "assetIndex", "conflictReport", "validationReport"],
      containsBaseGameContent: false,
      requiresUserOwnedSource: false
    }
  };
}

export function packageVirtualPath(modId, version, payloadPath) {
  return `/Packages/${modId}/${version}/${payloadPath
    .replaceAll("\\", "/")
    .replace(/^payload\//, "")}`;
}

async function findClawedAppManifestPath() {
  const override = process.env.CMM_CLAWED_APP_MANIFEST_PATH;
  if (override && (await exists(override))) {
    return override;
  }

  for (const steamRoot of candidateSteamRoots()) {
    const directManifest = path.join(
      steamRoot,
      "steamapps",
      `appmanifest_${CLAWED_STEAM_APP_ID}.acf`
    );
    if (await exists(directManifest)) {
      return directManifest;
    }

    const libraryFoldersPath = path.join(
      steamRoot,
      "steamapps",
      "libraryfolders.vdf"
    );
    const libraryFolders = await readFile(libraryFoldersPath, "utf8").catch(
      () => ""
    );
    for (const libraryPath of parseSteamLibraryPaths(libraryFolders)) {
      const libraryManifest = path.join(
        libraryPath,
        "steamapps",
        `appmanifest_${CLAWED_STEAM_APP_ID}.acf`
      );
      if (await exists(libraryManifest)) {
        return libraryManifest;
      }
    }
  }

  return null;
}

function candidateSteamRoots() {
  return [
    process.env.STEAM_PATH,
    process.env.STEAM_ROOT,
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, "Steam")
      : null,
    process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"], "Steam")
      : null,
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam"
  ].filter((entry) => typeof entry === "string" && entry.length > 0);
}

function parseSteamLibraryPaths(vdfText) {
  return [...vdfText.matchAll(/"path"\s+"([^"]+)"/gi)]
    .map((match) => match[1].replaceAll("\\\\", "\\"))
    .filter((entry) => entry.length > 0);
}

function parseSteamBuildId(vdfText) {
  return vdfText.match(/"buildid"\s+"([^"]+)"/i)?.[1] ?? null;
}

async function exists(targetPath) {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}
