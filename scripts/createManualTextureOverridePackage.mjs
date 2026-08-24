import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import JSZip from "jszip";
import {
  currentClawedSteamBuildId,
  generatedSupportedSteamBuilds,
  packageVirtualPath
} from "./clawedBuildMetadata.mjs";

const execFileAsync = promisify(execFile);
const defaultTargetPackagePaths = [
  "/Game/MenuSystemPro/ExampleContent/Art/Textures/Logos/Library_Logo"
];
const modId = process.env.CMM_TEXTURE_OVERRIDE_ID ?? "ModsActiveTitleLogo";
const modName =
  process.env.CMM_TEXTURE_OVERRIDE_NAME ?? "Mods Active Title Logo";
const sourceImage =
  process.env.CMM_TEXTURE_OVERRIDE_SOURCE ??
  path.join(process.env.USERPROFILE ?? "", "Downloads", "Clawed Mods Active.png");
const targetPackagePaths = parsePackagePaths(
  process.env.CMM_TEXTURE_OVERRIDE_PACKAGES ??
    process.env.CMM_TEXTURE_OVERRIDE_PACKAGE ??
    defaultTargetPackagePaths.join(",")
);
const targets = targetPackagePaths.map((packagePath) => ({
  packagePath,
  packageDirectory: path.posix.dirname(packagePath),
  packageName: path.posix.basename(packagePath)
}));
const uniqueTargetDirectories = [...new Set(targets.map((target) => target.packageDirectory))];
const unrealEditor =
  process.env.CMM_UNREAL_EDITOR_CMD ??
  "C:\\Program Files\\Epic Games\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe";
const unrealPak =
  process.env.CMM_UNREAL_PAK_EXE ??
  "C:\\Program Files\\Epic Games\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealPak.exe";
const releaseRoot = path.resolve("release");
const outputRoot = path.resolve(
  process.env.CMM_TEXTURE_OVERRIDE_OUTPUT_DIR ??
    path.join(releaseRoot, "manual-test-mods")
);
const evidenceRoot = path.resolve(
  process.env.CMM_TEXTURE_OVERRIDE_EVIDENCE_ROOT ??
    path.join(".codex", "manual-validation", `${timestampForPath()}-texture-override`)
);
const version = timestampForVersion();
const steamBuildId = await currentClawedSteamBuildId();
const steamBuildNotes =
  "Generated against the currently detected Clawed build; no live texture validation has been performed.";

await expectPath(sourceImage);
await expectPath(unrealEditor);
await expectPath(unrealPak);

const sourceImageSha256 = await sha256(sourceImage);
const fixture = await buildFixture();
const packagePath = await writePackage(
  outputRoot,
  fixture.containerPayloadPaths,
  sourceImageSha256
);
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const unpackedOutputRoot = path.resolve(
  process.env.CMM_TEXTURE_OVERRIDE_UNPACKED_OUTPUT_DIR ??
    path.join(unpackedRoot, "manual-test-mods")
);
let unpackedPackagePath = null;
if (await exists(unpackedRoot)) {
  unpackedPackagePath = await writePackage(
    unpackedOutputRoot,
    fixture.containerPayloadPaths,
    sourceImageSha256
  );
}
const containerPayloads = [];
for (const file of fixture.containerPayloadPaths) {
  containerPayloads.push({
    path: file,
    sha256: await sha256(file)
  });
}

const summary = {
  result: "GENERATED",
  modId,
  modName,
  version,
  packagePath,
  unpackedPackagePath,
  sourceImage,
  sourceImageSha256,
  targetPackagePaths,
  targetAssetPaths: targets.map(
    (target) => `${target.packagePath}.${target.packageName}`
  ),
  steamBuildId,
  loader: "pak",
  containerFormat: "iostore",
  evidenceRoot,
  cookedFiles: fixture.cookedFiles,
  containerPayloads
};

await writeJson(path.join(outputRoot, `${modId}.summary.json`), summary);
if (unpackedPackagePath) {
  await writeJson(
    path.join(unpackedOutputRoot, `${modId}.summary.json`),
    summary
  );
}
await writeJson(path.join(evidenceRoot, "summary.json"), summary);

async function buildFixture() {
  const variantRoot = path.join(evidenceRoot, "generated-unreal-fixture");
  const projectPath = path.join(variantRoot, "Clawed.uproject");
  const configRoot = path.join(variantRoot, "Config");
  const sourceAssetPath = path.join(variantRoot, "source.png");
  const importScriptPath = path.join(variantRoot, "import_texture.py");
  const contentTargetRoot = path.join(variantRoot, "Content");

  await mkdir(configRoot, { recursive: true });
  await mkdir(contentTargetRoot, { recursive: true });
  for (const target of targets) {
    await mkdir(
      path.join(
        variantRoot,
        "Content",
        ...target.packageDirectory.replace(/^\/Game\/?/, "").split("/")
      ),
      { recursive: true }
    );
  }
  await copyFile(sourceImage, sourceAssetPath);
  await copyFile(sourceImage, path.join(evidenceRoot, "source.png"));
  await writeFile(
    projectPath,
    `${JSON.stringify(
      {
        FileVersion: 3,
        EngineAssociation: "5.5",
        Category: "",
        Description: "Generated CMM manual texture override project.",
        Plugins: [{ Name: "PythonScriptPlugin", Enabled: true }]
      },
      null,
      2
    )}\n`
  );
  await writeFile(
    path.join(configRoot, "DefaultGame.ini"),
    [
      "[/Script/UnrealEd.ProjectPackagingSettings]",
      ...uniqueTargetDirectories.map(
        (directory) => `+DirectoriesToAlwaysCook=(Path="${directory}")`
      ),
      "bCookMapsOnly=False"
    ].join("\n"),
    "ascii"
  );
  await writeFile(
    importScriptPath,
    [
      "import unreal",
      `source = r'${sourceAssetPath.replaceAll("\\", "\\\\")}'`,
      `targets = ${JSON.stringify(
        targets.map((target) => ({
          asset_path: target.packagePath,
          directory: target.packageDirectory,
          name: target.packageName
        }))
      )}`,
      "settings = [('srgb', True), ('s_rgb', True)]",
      "try:",
      "    settings.append(('mip_gen_settings', unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS))",
      "except Exception as exc:",
      "    unreal.log_warning('mip enum skipped: {}'.format(exc))",
      "try:",
      "    settings.append(('compression_settings', unreal.TextureCompressionSettings.TC_USER_INTERFACE2D))",
      "except Exception as exc:",
      "    unreal.log_warning('compression enum skipped: {}'.format(exc))",
      "try:",
      "    settings.append(('lod_group', unreal.TextureGroup.TEXTUREGROUP_UI))",
      "except Exception as exc:",
      "    unreal.log_warning('texture group enum skipped: {}'.format(exc))",
      "for target in targets:",
      "    unreal.EditorAssetLibrary.make_directory(target['directory'])",
      "    task = unreal.AssetImportTask()",
      "    task.filename = source",
      "    task.destination_path = target['directory']",
      "    task.destination_name = target['name']",
      "    task.automated = True",
      "    task.save = True",
      "    task.replace_existing = True",
      "    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])",
      "    asset = unreal.load_asset(target['asset_path'])",
      "    if asset is None:",
      "        raise RuntimeError('texture import failed: {}'.format(target['asset_path']))",
      "    for name, value in settings:",
      "        try:",
      "            asset.set_editor_property(name, value)",
      "        except Exception as exc:",
      "            unreal.log_warning('texture setting {} skipped: {}'.format(name, exc))",
      "    unreal.EditorAssetLibrary.save_loaded_asset(asset)",
      "    unreal.log('CMM_TEXTURE_OVERRIDE_IMPORTED {}'.format(asset.get_path_name()))"
    ].join("\n"),
    "ascii"
  );

  await runLogged(
    unrealEditor,
    [
      toUnrealPath(projectPath),
      "-run=pythonscript",
      `-script=${toUnrealPath(importScriptPath)}`,
      "-unattended",
      "-nop4",
      "-nosplash",
      "-NoLogTimes"
    ],
    path.join(variantRoot, "import.log")
  );
  await runLogged(
    unrealEditor,
    [
      toUnrealPath(projectPath),
      "-run=cook",
      "-targetplatform=Windows",
      `-COOKDIR=${toUnrealPath(contentTargetRoot)}`,
      "-unversioned",
      "-SkipCookingEditorContent",
      "-NoDefaultMaps",
      "-unattended",
      "-nop4",
      "-nosplash",
      "-NoLogTimes"
    ],
    path.join(variantRoot, "cook.log")
  );

  const cookedPlatformRoot = path.join(variantRoot, "Saved", "Cooked", "Windows");
  const cookedProjectRoot = path.join(cookedPlatformRoot, "Clawed");
  const cookedProbeFiles = await findCookedTargetFiles(cookedProjectRoot);
  const cookedProbeEntries = cookedProbeFiles.map((cookedFile) => ({
    cookedFile,
    mountPath: `../../../${toUnrealPath(path.relative(cookedPlatformRoot, cookedFile))}`
  }));
  const pakPath = path.join(variantRoot, `${modId}.pak`);
  const markerPath = path.join(variantRoot, `${modId}.marker`);
  const pakResponsePath = path.join(variantRoot, "pak-response.txt");
  await writeFile(
    markerPath,
    `Generated CMM manual texture override marker for ${modId}.\n`,
    "ascii"
  );
  await writeFile(
    pakResponsePath,
    `"${markerPath}" "../../../Clawed/Content/CMM/${modId}.marker"\n`,
    "ascii"
  );
  await runLogged(
    unrealPak,
    [pakPath, `-Create=${pakResponsePath}`, "-compress"],
    path.join(variantRoot, "unrealpak-create.log")
  );
  await runLogged(
    unrealPak,
    [pakPath, "-List"],
    path.join(variantRoot, "unrealpak-list.log")
  );

  const metadataRoot = path.join(cookedPlatformRoot, "Clawed", "Metadata");
  const ioStoreRoot = path.join(variantRoot, "iostore");
  const utocPath = path.join(ioStoreRoot, `${modId}.utoc`);
  const ucasPath = path.join(ioStoreRoot, `${modId}.ucas`);
  const globalUtocPath = path.join(ioStoreRoot, "global.utoc");
  const ioStoreResponsePath = path.join(ioStoreRoot, "iostore-response.txt");
  const ioStoreCommandsPath = path.join(ioStoreRoot, "IoStoreCommands.txt");
  await mkdir(ioStoreRoot, { recursive: true });
  await writeFile(
    ioStoreResponsePath,
    `${cookedProbeEntries
      .map((entry) => `"${entry.cookedFile}" "${entry.mountPath}" -compress`)
      .join("\n")}\n`,
    "ascii"
  );
  await writeFile(
    ioStoreCommandsPath,
    `-Output="${utocPath}" -ContainerName=${modId} -ResponseFile="${ioStoreResponsePath}"\n`,
    "ascii"
  );
  await runLogged(
    unrealPak,
    [
      toUnrealPath(projectPath),
      `-CreateGlobalContainer=${toUnrealPath(globalUtocPath)}`,
      `-PackageStoreManifest=${toUnrealPath(
        path.join(metadataRoot, "packagestore.manifest")
      )}`,
      `-CookedDirectory=${toUnrealPath(cookedPlatformRoot)}`,
      `-Commands=${toUnrealPath(ioStoreCommandsPath)}`,
      `-ScriptObjects=${toUnrealPath(path.join(metadataRoot, "scriptobjects.bin"))}`,
      "-unattended"
    ],
    path.join(ioStoreRoot, "unrealpak-iostore.log")
  );
  await runLogged(
    unrealPak,
    [
      "IoStore",
      `-List=${toUnrealPath(utocPath)}`,
      `-CSV=${toUnrealPath(path.join(ioStoreRoot, "iostore-list.csv"))}`
    ],
    path.join(ioStoreRoot, "unrealpak-iostore-list.log")
  );
  await expectPath(utocPath);
  await expectPath(ucasPath);

  return {
    cookedFiles: cookedProbeEntries.map((entry) => entry.mountPath),
    containerPayloadPaths: [pakPath, utocPath, ucasPath]
  };
}

async function writePackage(
  outputDirectory,
  containerPayloadPaths,
  sourceImageSha256
) {
  await mkdir(outputDirectory, { recursive: true });
  const payloadPaths = containerPayloadPaths.map(
    (containerPath) => `payload/Content/Paks/${path.basename(containerPath)}`
  );
  const manifest = {
    schemaVersion: 1,
    id: modId,
    name: modName,
    version,
    author: "Clawed Mod Manager",
    description:
      "Manual Pak/IoStore Texture2D override for the Clawed title logo texture.",
    game: "clawed",
    loader: "pak",
    dependencies: [],
    conflicts: [],
    loadAfter: [],
    loadBefore: [],
    creatorAssets: textureCreatorAssets(payloadPaths, sourceImageSha256)
  };
  const readme = [
    `# ${modName}`,
    "",
    `Replaces these Texture2D package paths with \`${path.basename(sourceImage)}\`:`,
    "",
    ...targetPackagePaths.map((packagePath) => `- \`${packagePath}\``),
    "",
    "Expected result:",
    "",
    "- The main title menu Clawed logo changes to the supplied Clawed Mods Active image.",
    "- Game input remains usable.",
    "- No loose cooked files are deployed; this package uses Pak plus IoStore sidecars."
  ].join("\n");
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.md", readme);
  for (const [index, containerPath] of containerPayloadPaths.entries()) {
    zip.file(payloadPaths[index], await readFile(containerPath));
  }
  const packagePath = path.join(outputDirectory, `${modId}.clawedmod`);
  await writeFile(packagePath, await zip.generateAsync({ type: "nodebuffer" }));
  await writeFile(path.join(outputDirectory, `${modId}.README.md`), readme);
  return packagePath;
}

function textureCreatorAssets(payloadPaths, sourceImageSha256) {
  const targetAssets = targets.map((target, index) => ({
    id: `target-${index + 1}`,
    assetClass: "Texture2D",
    packagePath: target.packagePath,
    objectPath: `${target.packagePath}.${target.packageName}`,
    virtualPath: `/Clawed/Base${target.packagePath.replace(/^\/Game/, "")}`,
    source: "baseGame",
    role: "target",
    tags: ["texture2d", "title_logo"]
  }));
  const replacementAssets = payloadPaths.map((payloadPath, index) => ({
    id: `payload-${index + 1}`,
    assetClass: "CookedUnrealAsset",
    virtualPath: packageVirtualPath(modId, version, payloadPath),
    payloadPath,
    source: "generated",
    role: "replacement",
    tags: ["pak_iostore", "texture2d"]
  }));

  return {
    schemaVersion: 1,
    affectedAssets: [...targetAssets, ...replacementAssets],
    replacements: targetAssets.map((targetAsset) => ({
      targetAssetId: targetAsset.id,
      targetPackagePath: targetAsset.packagePath,
      targetObjectPath: targetAsset.objectPath,
      targetVirtualPath: targetAsset.virtualPath,
      payloadPaths,
      deploymentRoute: "pak-iostore-existing-path",
      validationState: "untested"
    })),
    cookTarget: {
      unrealVersion: "5.5",
      platform: "Windows",
      containerFormat: "pak+iostore",
      requiresAssetRegistry: false,
      toolName: "UnrealEditor-Cmd/UnrealPak"
    },
    supportedSteamBuilds: generatedSupportedSteamBuilds(
      steamBuildId,
      steamBuildNotes
    ),
    previewAssets: [],
    importProvenance: [
      {
        sourceKind: "generated",
        sourceName: path.basename(sourceImage),
        sourceSha256: sourceImageSha256,
        sourceHashes: [
          {
            algorithm: "sha256",
            scope: "source",
            path: path.basename(sourceImage),
            sha256: sourceImageSha256
          }
        ],
        toolName: "CMM manual texture override package script",
        toolVersion: "1",
        rights: "userOwned"
      }
    ],
    assetDependencies: [],
    exportEligibility: {
      state: "exportable",
      allowedOutputs: ["clawedmod", "assetIndex", "conflictReport", "validationReport"],
      containsBaseGameContent: false,
      requiresUserOwnedSource: true,
      reason: "Texture package is generated from a user-supplied source image."
    }
  };
}

async function findCookedTargetFiles(cookedProjectRoot) {
  const files = await listFilesRecursive(cookedProjectRoot);
  const probeFiles = [];
  for (const target of targets) {
    const expectedBase = path.join(
      cookedProjectRoot,
      "Content",
      ...target.packagePath.replace(/^\/Game\/?/, "").split("/")
    );
    const expectedFiles = files.filter((file) =>
      file.toLowerCase().startsWith(`${expectedBase.toLowerCase()}.`)
    );
    if (expectedFiles.length === 0) {
      throw new Error(`No cooked files found for ${target.packagePath}.`);
    }
    probeFiles.push(...expectedFiles);
  }
  return probeFiles.sort((left, right) => left.localeCompare(right));
}

async function listFilesRecursive(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function runLogged(command, args, logPath) {
  await mkdir(path.dirname(logPath), { recursive: true });
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true
    });
    await writeFile(logPath, `${stdout}${stderr}`, "utf8");
  } catch (error) {
    const stdout = Buffer.isBuffer(error.stdout)
      ? error.stdout.toString("utf8")
      : error.stdout ?? "";
    const stderr = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8")
      : error.stderr ?? "";
    await writeFile(logPath, `${stdout}${stderr}`, "utf8");
    throw error;
  }
}

async function writeJson(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
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

function parsePackagePaths(value) {
  const packagePaths = value
    .split(/[;,]/)
    .map((entry) => normalizePackagePath(entry.trim()))
    .filter((entry) => entry !== "/Game/");
  if (packagePaths.length === 0) {
    throw new Error("At least one target package path is required.");
  }
  return [...new Set(packagePaths)];
}

function normalizePackagePath(packagePath) {
  const normalized = packagePath.replaceAll("\\", "/").replace(/\..*$/, "");
  return normalized.startsWith("/Game/")
    ? normalized
    : `/Game/${normalized.replace(/^\/+/, "")}`;
}

function timestampForPath() {
  return new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}

function timestampForVersion() {
  return new Date().toISOString().replaceAll("-", "").replaceAll(":", "");
}

function toUnrealPath(targetPath) {
  return targetPath.replaceAll("\\", "/");
}
