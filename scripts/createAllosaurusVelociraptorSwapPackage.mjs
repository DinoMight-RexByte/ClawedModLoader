import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import {
  cp,
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
  generatedPackageIdentity,
  generatedSupportedSteamBuilds,
  packageVirtualPath
} from "./clawedBuildMetadata.mjs";

const execFileAsync = promisify(execFile);
const modId =
  process.env.CMM_ALLOSAURUS_SWAP_ID ?? "ClawedAllosaurusVelociraptorSwap";
const modName =
  process.env.CMM_ALLOSAURUS_SWAP_NAME ?? "Allosaurus Velociraptor Swap";
const sourceDir = path.resolve(
  process.env.CMM_ALLOSAURUS_SOURCE_DIR ??
    path.join(
      process.env.USERPROFILE ?? "",
      "Downloads",
      "Telegram Desktop",
      "Allosaurus Dinosaur Character Rig and Animations 4.27",
      "Allosaurus"
    )
);
const defaultTargetPackagePaths = [
  "/Game/Hybrid_Velociraptor/Meshes/SKM_Hybrid_Velociraptor_T_Pose",
  "/Game/Hybrid_Velociraptor/Meshes/SKM_Deino_V2",
  "/Game/UtahRaptor/Meshes/SKM_UtahRaptor_T_Pose",
  "/Game/UtahRaptor/Meshes/SKM_UtahRaptor_V1"
];
const targetPackagePaths = parseTargetPackagePaths(
  process.env.CMM_ALLOSAURUS_TARGET_PACKAGES ??
    process.env.CMM_ALLOSAURUS_TARGET_PACKAGE
);
const targetPackagePath = targetPackagePaths[0];
const targetDirectories = [
  ...new Set(targetPackagePaths.map((packagePath) => path.posix.dirname(packagePath)))
];
const unrealEditor =
  process.env.CMM_UNREAL_EDITOR_CMD ??
  "C:\\Program Files\\Epic Games\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe";
const unrealPak =
  process.env.CMM_UNREAL_PAK_EXE ??
  "C:\\Program Files\\Epic Games\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealPak.exe";
const releaseRoot = path.resolve("release");
const outputRoot = path.resolve(
  process.env.CMM_ALLOSAURUS_SWAP_OUTPUT_DIR ??
    path.join(releaseRoot, "prototype-mods")
);
const evidenceRoot = path.resolve(
  process.env.CMM_ALLOSAURUS_SWAP_EVIDENCE_ROOT ??
    path.join(".codex", "manual-validation", `${timestampForPath()}-allosaurus-velociraptor-swap`)
);
const version = timestampForVersion();
const steamBuildId = await currentClawedSteamBuildId();
const buildNotes =
  "Generated against the currently detected Clawed build; live gameplay assignment and host/client behavior are not validated by package generation.";

await expectPath(sourceDir);
await expectPath(unrealEditor);
await expectPath(unrealPak);

const sourceHashes = await hashSourceTree(sourceDir);
const sourceSha256 = hashRecords(sourceHashes);
const fixture = await buildFixture();
const packagePath = await writePackage(outputRoot, fixture.containerPayloadPaths, {
  sourceSha256,
  sourceHashes
});
const unpackedRoot = path.join(releaseRoot, "win-unpacked");
const unpackedOutputRoot = path.resolve(
  process.env.CMM_ALLOSAURUS_SWAP_UNPACKED_OUTPUT_DIR ??
    path.join(unpackedRoot, "prototype-mods")
);
let unpackedPackagePath = null;
if (await exists(unpackedRoot)) {
  unpackedPackagePath = await writePackage(
    unpackedOutputRoot,
    fixture.containerPayloadPaths,
    { sourceSha256, sourceHashes }
  );
}

const containerPayloads = [];
for (const file of fixture.containerPayloadPaths) {
  containerPayloads.push({
    path: file,
    sha256: await sha256File(file)
  });
}
const summary = {
  result: "GENERATED",
  modId,
  modName,
  version,
  packagePath,
  unpackedPackagePath,
  packageSha256: await sha256File(packagePath),
  sourceName: path.basename(sourceDir),
  sourceFileCount: sourceHashes.length,
  sourceSha256,
  targetPackagePath,
  targetObjectPath: objectPathForPackage(targetPackagePath),
  targetPackagePaths,
  targetObjectPaths: targetPackagePaths.map(objectPathForPackage),
  steamBuildId,
  loader: "pak",
  containerFormat: "pak+iostore",
  evidenceRoot,
  cookedFiles: fixture.cookedFiles,
  containerPayloads
};

await writeJson(path.join(outputRoot, `${modId}.summary.json`), summary);
if (unpackedPackagePath) {
  await writeJson(path.join(unpackedOutputRoot, `${modId}.summary.json`), summary);
}
await writeJson(path.join(evidenceRoot, "summary.json"), summary);
process.stdout.write(`${packagePath}\n`);

async function buildFixture() {
  const fixtureRoot = path.join(evidenceRoot, "generated-unreal-fixture");
  const projectPath = path.join(fixtureRoot, "Clawed.uproject");
  const configRoot = path.join(fixtureRoot, "Config");
  const contentRoot = path.join(fixtureRoot, "Content");
  const sourceContentRoot = path.join(contentRoot, "Allosaurus");
  const targetContentRoots = targetDirectories.map((targetDirectory) =>
    path.join(contentRoot, ...targetDirectory.replace(/^\/Game\/?/, "").split("/"))
  );
  const importScriptPath = path.join(fixtureRoot, "duplicate_allosaurus_mesh.py");

  await mkdir(configRoot, { recursive: true });
  for (const targetContentRoot of targetContentRoots) {
    await mkdir(targetContentRoot, { recursive: true });
  }
  await cp(sourceDir, sourceContentRoot, { recursive: true, force: true });
  await writeFile(
    projectPath,
    `${JSON.stringify(
      {
        FileVersion: 3,
        EngineAssociation: "5.5",
        Category: "",
        Description: "Generated CMM Allosaurus velociraptor swap project.",
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
      ...targetDirectories.map(
        (targetDirectory) => `+DirectoriesToAlwaysCook=(Path="${targetDirectory}")`
      ),
      "bCookMapsOnly=False"
    ].join("\n"),
    "ascii"
  );
  await writeFile(
    importScriptPath,
    [
      "import unreal",
      "source_asset = '/Game/Allosaurus/Rigs/Allosaurus_Rig'",
      "targets = [",
      ...targetPackagePaths.map(
        (packagePath) => `    ('${packagePath}', '${path.posix.dirname(packagePath)}'),`
      ),
      "]",
      "asset = unreal.load_asset(source_asset)",
      "if asset is None:",
      "    raise RuntimeError('source Allosaurus skeletal mesh failed to load')",
      "for target_asset, target_directory in targets:",
      "    unreal.EditorAssetLibrary.make_directory(target_directory)",
      "    if unreal.EditorAssetLibrary.does_asset_exist(target_asset):",
      "        unreal.EditorAssetLibrary.delete_asset(target_asset)",
      "    duplicated = unreal.EditorAssetLibrary.duplicate_asset(source_asset, target_asset)",
      "    if not duplicated:",
      "        raise RuntimeError('Allosaurus skeletal mesh duplicate failed for {}'.format(target_asset))",
      "    target = unreal.load_asset(target_asset)",
      "    if target is None:",
      "        raise RuntimeError('target velociraptor skeletal mesh failed to load for {}'.format(target_asset))",
      "    unreal.EditorAssetLibrary.save_loaded_asset(target)",
      "    unreal.log('CMM_ALLOSAURUS_SWAP_IMPORTED {}'.format(target.get_path_name()))"
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
    path.join(fixtureRoot, "import.log")
  );
  for (const [index, targetContentRoot] of targetContentRoots.entries()) {
    await runLogged(
      unrealEditor,
      [
        toUnrealPath(projectPath),
        "-run=cook",
        "-targetplatform=Windows",
        `-COOKDIR=${toUnrealPath(targetContentRoot)}`,
        "-unversioned",
        "-SkipCookingEditorContent",
        "-NoDefaultMaps",
        "-unattended",
        "-nop4",
        "-nosplash",
        "-NoLogTimes"
      ],
      path.join(fixtureRoot, `cook-${index + 1}.log`)
    );
  }

  const cookedPlatformRoot = path.join(fixtureRoot, "Saved", "Cooked", "Windows");
  const cookedProjectRoot = path.join(cookedPlatformRoot, "Clawed");
  const cookedFiles = await findCookedAssetPayloadFiles(cookedProjectRoot);
  const cookedEntries = cookedFiles.map((cookedFile) => ({
    cookedFile,
    mountPath: `../../../${toUnrealPath(path.relative(cookedPlatformRoot, cookedFile))}`
  }));
  const pakPath = path.join(fixtureRoot, `${modId}.pak`);
  const markerPath = path.join(fixtureRoot, `${modId}.marker`);
  const pakResponsePath = path.join(fixtureRoot, "pak-response.txt");
  await writeFile(
    markerPath,
    `Generated CMM Allosaurus velociraptor swap marker for ${modId}.\n`,
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
    path.join(fixtureRoot, "unrealpak-create.log")
  );
  await runLogged(
    unrealPak,
    [pakPath, "-List"],
    path.join(fixtureRoot, "unrealpak-list.log")
  );

  const metadataRoot = path.join(cookedPlatformRoot, "Clawed", "Metadata");
  const ioStoreRoot = path.join(fixtureRoot, "iostore");
  const utocPath = path.join(ioStoreRoot, `${modId}.utoc`);
  const ucasPath = path.join(ioStoreRoot, `${modId}.ucas`);
  const globalUtocPath = path.join(ioStoreRoot, "global.utoc");
  const ioStoreResponsePath = path.join(ioStoreRoot, "iostore-response.txt");
  const ioStoreCommandsPath = path.join(ioStoreRoot, "IoStoreCommands.txt");
  await mkdir(ioStoreRoot, { recursive: true });
  await writeFile(
    ioStoreResponsePath,
    `${cookedEntries
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
    cookedFiles: cookedEntries.map((entry) => entry.mountPath),
    containerPayloadPaths: [pakPath, utocPath, ucasPath]
  };
}

async function writePackage(outputDirectory, containerPayloadPaths, source) {
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
      "Prototype Pak/IoStore SkeletalMesh override that places the supplied Allosaurus mesh on Clawed's likely raptor mesh package paths.",
    game: "clawed",
    loader: "pak",
    dependencies: [],
    conflicts: [],
    loadAfter: [],
    loadBefore: [],
    packageIdentity: generatedPackageIdentity(modId),
    creatorAssets: creatorAssets(payloadPaths, source)
  };
  const readme = [
    `# ${modName}`,
    "",
    "Targets:",
    "",
    ...targetPackagePaths.map(
      (packagePath) => `- \`${objectPathForPackage(packagePath)}\``
    ),
    "",
    "Source:",
    "",
    `- \`${path.basename(sourceDir)}\``,
    "",
    "Expected result:",
    "",
    "- The listed raptor SkeletalMesh package paths resolve to cooked Allosaurus mesh assets.",
    "- Deployment uses CMM's normal Pak/IoStore path under `payload/Content/Paks/`.",
    "- This package does not change player authority, networking, anti-cheat behavior, save data, Blueprints, GameMode, PlayerController, or loose cooked files.",
    "- Gameplay assignment and host/client visibility still require live in-session validation."
  ].join("\n");
  const checksums = {
    schemaVersion: 1,
    source: {
      name: path.basename(sourceDir),
      sha256: source.sourceSha256
    },
    files: []
  };
  const zip = new JSZip();
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  zip.file("README.md", `${readme}\n`);
  for (const [index, containerPath] of containerPayloadPaths.entries()) {
    const payloadPath = payloadPaths[index];
    const content = await readFile(containerPath);
    zip.file(payloadPath, content);
    checksums.files.push({
      path: payloadPath,
      sha256: sha256Buffer(content)
    });
  }
  checksums.files.push({
    path: "README.md",
    sha256: sha256Buffer(Buffer.from(`${readme}\n`, "utf8"))
  });
  zip.file("checksums.json", `${JSON.stringify(checksums, null, 2)}\n`);
  const packagePath = path.join(outputDirectory, `${modId}.clawedmod`);
  await writeFile(packagePath, await zip.generateAsync({ type: "nodebuffer" }));
  await writeFile(path.join(outputDirectory, `${modId}.README.md`), `${readme}\n`);
  return packagePath;
}

function creatorAssets(payloadPaths, source) {
  const replacementVirtualPath = packageVirtualPath(modId, version, payloadPaths[0]);
  const targets = targetPackagePaths.map((packagePath) => {
    const id = assetIdForPackagePath(packagePath);
    const targetObjectPath = objectPathForPackage(packagePath);
    const targetVirtualPath = baseVirtualPath(packagePath);
    return {
      packagePath,
      targetAssetId: `target-${id}`,
      replacementAssetId: `replacement-allosaurus-${id}`,
      targetObjectPath,
      targetVirtualPath
    };
  });
  return {
    schemaVersion: 1,
    affectedAssets: targets.flatMap((target) => [
      {
        id: target.targetAssetId,
        assetClass: "SkeletalMesh",
        packagePath: target.packagePath,
        objectPath: target.targetObjectPath,
        virtualPath: target.targetVirtualPath,
        source: "baseGame",
        role: "target",
        tags: ["model_visuals", "character_model_animation", "enemy_ai"]
      },
      {
        id: target.replacementAssetId,
        assetClass: "SkeletalMesh",
        packagePath: target.packagePath,
        objectPath: target.targetObjectPath,
        virtualPath: replacementVirtualPath,
        payloadPath: payloadPaths[0],
        source: "generated",
        role: "replacement",
        tags: ["model_visuals", "character_model_animation", "allosaurus"]
      }
    ]),
    replacements: targets.map((target) => ({
      targetAssetId: target.targetAssetId,
      replacementAssetId: target.replacementAssetId,
      targetPackagePath: target.packagePath,
      targetObjectPath: target.targetObjectPath,
      targetVirtualPath: target.targetVirtualPath,
      replacementPackagePath: target.packagePath,
      replacementObjectPath: target.targetObjectPath,
      replacementVirtualPath,
      payloadPaths,
      deploymentRoute: "pak-iostore-existing-path",
      validationState: "untested"
    })),
    cookTarget: {
      unrealVersion: "5.5",
      platform: "Windows",
      containerFormat: "pak+iostore",
      requiresAssetRegistry: false,
      mountPoint: "../../../Clawed",
      toolName: "UnrealEditor-Cmd/UnrealPak"
    },
    supportedSteamBuilds: generatedSupportedSteamBuilds(steamBuildId, buildNotes),
    previewAssets: [],
    importProvenance: [
      {
        sourceKind: "creatorSource",
        sourceName: path.basename(sourceDir),
        sourceSha256: source.sourceSha256,
        sourceHashes: source.sourceHashes,
        toolName: "CMM Allosaurus velociraptor swap package script",
        toolVersion: "1",
        rights: "userOwned"
      }
    ],
    assetDependencies: targets.flatMap((target) => [
      {
        fromAssetId: target.replacementAssetId,
        toPackagePath: "/Game/Allosaurus/Materials/Allosaurus",
        toObjectPath: "/Game/Allosaurus/Materials/Allosaurus.Allosaurus",
        assetClass: "Material",
        relation: "material",
        required: true,
        source: "samePackage"
      },
      {
        fromAssetId: target.replacementAssetId,
        toPackagePath: "/Game/Allosaurus/Rigs/Allosaurus_Rig_Skeleton",
        toObjectPath: "/Game/Allosaurus/Rigs/Allosaurus_Rig_Skeleton.Allosaurus_Rig_Skeleton",
        assetClass: "Skeleton",
        relation: "skeleton",
        required: true,
        source: "samePackage"
      },
      {
        fromAssetId: target.replacementAssetId,
        toPackagePath: "/Game/Allosaurus/Rigs/Allosaurus_Rig_Physics",
        toObjectPath: "/Game/Allosaurus/Rigs/Allosaurus_Rig_Physics.Allosaurus_Rig_Physics",
        assetClass: "PhysicsAsset",
        relation: "physicsAsset",
        required: false,
        source: "samePackage"
      }
    ]),
    textureBindings: [],
    exportEligibility: {
      state: "exportable",
      allowedOutputs: ["clawedmod", "assetIndex", "conflictReport", "validationReport"],
      containsBaseGameContent: false,
      requiresUserOwnedSource: true,
      reason: "Cooked replacement content is generated from the supplied Allosaurus source assets."
    }
  };
}

async function findCookedAssetPayloadFiles(cookedProjectRoot) {
  const files = await listFilesRecursive(cookedProjectRoot);
  const payloadFiles = files.filter((file) =>
    [".uasset", ".uexp", ".ubulk"].includes(path.extname(file).toLowerCase())
  );
  if (payloadFiles.length === 0) {
    throw new Error("Cooked asset payload files were not generated.");
  }
  for (const packagePath of targetPackagePaths) {
    const targetCookedAsset = path.join(
      cookedProjectRoot,
      "Content",
      ...packagePath.replace(/^\/Game\/?/, "").split(".")[0].split("/")
    );
    if (
      !payloadFiles.some(
        (file) =>
          path.extname(file).toLowerCase() === ".uasset" &&
          file.toLowerCase() === `${targetCookedAsset.toLowerCase()}.uasset`
      )
    ) {
      throw new Error(`Cooked target mesh was not generated for ${packagePath}.`);
    }
  }
  return payloadFiles.sort((left, right) => left.localeCompare(right));
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

async function hashSourceTree(root) {
  const files = await listFilesRecursive(root);
  const hashes = [];
  for (const file of files.sort((left, right) => left.localeCompare(right))) {
    hashes.push({
      algorithm: "sha256",
      scope: "source",
      path: toUnrealPath(path.relative(root, file)),
      sha256: await sha256File(file)
    });
  }
  return hashes;
}

function hashRecords(records) {
  const hash = crypto.createHash("sha256");
  for (const record of records) {
    hash.update(record.path);
    hash.update("\0");
    hash.update(record.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
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

async function sha256File(targetPath) {
  return sha256Buffer(await readFile(targetPath));
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseTargetPackagePaths(value) {
  const values = value
    ? value.split(/[,\r\n;]+/)
    : defaultTargetPackagePaths;
  const paths = [];
  for (const candidate of values) {
    const packagePath = normalizePackagePath(candidate.trim());
    if (packagePath && !paths.includes(packagePath)) {
      paths.push(packagePath);
    }
  }
  return paths.length > 0 ? paths : defaultTargetPackagePaths;
}

function objectPathForPackage(packagePath) {
  return `${packagePath}.${path.posix.basename(packagePath)}`;
}

function assetIdForPackagePath(packagePath) {
  return packagePath
    .replace(/^\/Game\/?/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function baseVirtualPath(packagePath) {
  return `/Clawed/Base${packagePath.replace(/^\/Game/, "")}`;
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
