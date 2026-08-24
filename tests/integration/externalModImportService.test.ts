import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

import { afterEach, describe, expect, it } from "vitest";

import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalExternalModImportService } from "../../src/main/services/externalModImportService";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import {
  ClawedModManifestV1Schema,
  type AppStorageLayout
} from "../../src/shared/contracts/app";
import type { StorageServiceContract } from "../../src/shared/contracts/services";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

async function makeImporter(): Promise<{
  root: string;
  service: LocalExternalModImportService;
  libraryService: LocalModLibraryService;
}> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-external-import-"));
  const storageService = new FakeStorageService(createStorageLayout(tempRoot));
  const packageService = new ClawedModPackageService();
  const libraryService = new LocalModLibraryService(
    storageService,
    packageService
  );

  return {
    root: tempRoot,
    libraryService,
    service: new LocalExternalModImportService(
      storageService,
      packageService,
      libraryService
    )
  };
}

async function createZip(
  outputPath: string,
  entries: Record<string, string | Buffer>
): Promise<string> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content, { date: new Date("2000-01-01T00:00:00.000Z") });
  }
  await writeFile(
    outputPath,
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  );
  return outputPath;
}

async function exists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

describe("external mod import service", () => {
  it("wraps a raw Unreal Pak as a canonical .clawedmod package", async () => {
    const { root, service } = await makeImporter();
    const pakPath = path.join(root, "Cool_Clawed_P.pak");
    await writeFile(pakPath, "fake pak bytes");

    const inspection = await service.inspectExternalModPackage({
      packagePath: pakPath
    });
    const result = await service.importExternalModPackage({
      packagePath: pakPath
    });

    expect(inspection).toMatchObject({
      status: "recognized",
      format: "rawPak",
      support: "installable",
      loader: "pak"
    });
    expect(result.status).toBe("installed");
    expect(result.mod).toMatchObject({
      id: "external.cool_clawed_p",
      packageIdentityId: `cmm:external:rawPak:${inspection.sha256}`,
      loader: "pak",
      version: "0.0.0-external"
    });
    await expect(
      readFile(
        path.join(
          result.mod!.installPath,
          "payload",
          "Content",
          "Paks",
          "Cool_Clawed_P.pak"
        ),
        "utf8"
      )
    ).resolves.toBe("fake pak bytes");
    const installedManifest = ClawedModManifestV1Schema.parse(
      JSON.parse(
        await readFile(path.join(result.mod!.installPath, "manifest.json"), "utf8")
      )
    );
    const checksums = JSON.parse(
      await readFile(path.join(result.mod!.installPath, "checksums.json"), "utf8")
    ) as {
      source: { sha256: string };
      files: Array<{ path: string; sha256: string }>;
    };

    expect(installedManifest.creatorAssets).toMatchObject({
      schemaVersion: 1,
      affectedAssets: [
        {
          assetClass: "CookedUnrealAsset",
          payloadPath: "payload/Content/Paks/Cool_Clawed_P.pak",
          source: "external",
          role: "replacement"
        }
      ],
      replacements: [
        {
          deploymentRoute: "inspect-only",
          validationState: "untested",
          payloadPaths: ["payload/Content/Paks/Cool_Clawed_P.pak"]
        }
      ],
      exportEligibility: {
        state: "unknown",
        containsBaseGameContent: false,
        requiresUserOwnedSource: true
      }
    });
    expect(installedManifest.packageIdentity).toMatchObject({
      id: `cmm:external:rawPak:${inspection.sha256}`,
      source: "externalImport"
    });
    expect(
      installedManifest.creatorAssets?.importProvenance[0].sourceHashes[0]
    ).toMatchObject({
      scope: "source",
      path: "Cool_Clawed_P.pak",
      sha256: inspection.sha256
    });
    expect(checksums.source.sha256).toBe(inspection.sha256);
    expect(checksums.files[0]).toMatchObject({
      path: "payload/Content/Paks/Cool_Clawed_P.pak"
    });
  });

  it("replaces generated external packages only after matching identity confirmation", async () => {
    const { root, service, libraryService } = await makeImporter();
    const firstPakPath = path.join(root, "FirstName.pak");
    const secondPakPath = path.join(root, "SecondName.pak");
    await writeFile(firstPakPath, "same pak bytes");
    await writeFile(secondPakPath, "same pak bytes");

    const first = await service.importExternalModPackage({
      packagePath: firstPakPath
    });
    const pending = await service.importExternalModPackage({
      packagePath: secondPakPath
    });

    expect(first.status).toBe("installed");
    expect(pending.status).toBe("needsReplacementConfirmation");
    expect(pending.replacementCandidates?.[0]).toMatchObject({
      id: "external.firstname"
    });

    const replaced = await service.importExternalModPackage({
      packagePath: secondPakPath,
      replacement: {
        action: "replaceMatchingIdentity",
        packageIdentityId: pending.packageIdentityId!
      }
    });

    expect(replaced.status).toBe("installed");
    expect(replaced.mod).toMatchObject({ id: "external.secondname" });
    expect((await libraryService.listInstalledMods()).mods.map((mod) => mod.id)).toEqual([
      "external.secondname"
    ]);
  });

  it("converts a Thunderstore-style ZIP with Pak payloads", async () => {
    const { root, service } = await makeImporter();
    const zipPath = await createZip(path.join(root, "Thunder.zip"), {
      "manifest.json": JSON.stringify({
        name: "Thunder Character",
        version_number: "1.2.3",
        description: "Thunderstore fixture.",
        dependencies: ["Author-Dependency-1.0.0"]
      }),
      "README.md": "# Thunder Character",
      "ThunderCharacter_P.pak": "pak data"
    });

    const inspection = await service.inspectExternalModPackage({
      packagePath: zipPath
    });
    const result = await service.importExternalModPackage({
      packagePath: zipPath
    });

    expect(inspection).toMatchObject({
      status: "recognized",
      format: "thunderstore",
      support: "installable",
      loader: "pak",
      detectedVersion: "1.2.3"
    });
    expect(result.status).toBe("installed");
    expect(result.mod).toMatchObject({
      id: "thunderstore.thunder-character",
      name: "Thunder Character",
      loader: "pak",
      version: "1.2.3"
    });
    expect(result.problems.map((problem) => problem.code)).toContain(
      "THUNDERSTORE_DEPENDENCIES_NOT_CONVERTED"
    );
    expect(
      await exists(
        path.join(
          result.mod!.installPath,
          "payload",
          "Content",
          "Paks",
          "ThunderCharacter_P.pak"
        )
      )
    ).toBe(true);
  });

  it("converts a UE4SS ZIP mod folder into the generated manifest mod root", async () => {
    const { root, service } = await makeImporter();
    const zipPath = await createZip(path.join(root, "CommunityLua.zip"), {
      "Mods/OriginalCommunityName/Scripts/main.lua": "print('external ue4ss')",
      "Mods/OriginalCommunityName/config.json": "{}"
    });

    const inspection = await service.inspectExternalModPackage({
      packagePath: zipPath
    });
    const result = await service.importExternalModPackage({
      packagePath: zipPath
    });

    expect(inspection).toMatchObject({
      status: "recognized",
      format: "ue4ssArchive",
      support: "installable",
      loader: "ue4ss"
    });
    expect(result.status).toBe("installed");
    expect(result.mod).toMatchObject({
      id: "external_communitylua",
      packageIdentityId: `cmm:external:ue4ssArchive:${inspection.sha256}`,
      loader: "ue4ss",
      version: "0.0.0-external"
    });
    await expect(
      readFile(
        path.join(
          result.mod!.installPath,
          "payload",
          "Mods",
          "external_communitylua",
          "Scripts",
          "main.lua"
        ),
        "utf8"
      )
    ).resolves.toBe("print('external ue4ss')");
    await expect(
      readFile(
        path.join(
          result.mod!.installPath,
          "payload",
          "Mods",
          "external_communitylua",
          "config.json"
        ),
        "utf8"
      )
    ).resolves.toBe("{}");
    expect(
      await exists(
        path.join(
          result.mod!.installPath,
          "payload",
          "Mods",
          "OriginalCommunityName",
          "Scripts",
          "main.lua"
        )
      )
    ).toBe(false);
    const installedManifest = ClawedModManifestV1Schema.parse(
      JSON.parse(
        await readFile(path.join(result.mod!.installPath, "manifest.json"), "utf8")
      )
    );

    expect(installedManifest.creatorAssets?.affectedAssets[0]).toMatchObject({
      assetClass: "SupportFile",
      role: "support",
      source: "external",
      payloadPath: "payload/Mods/external_communitylua/Scripts/main.lua"
    });
    expect(installedManifest.packageIdentity).toMatchObject({
      id: `cmm:external:ue4ssArchive:${inspection.sha256}`,
      source: "externalImport"
    });
    expect(installedManifest.creatorAssets?.replacements).toHaveLength(0);
  });

  it("converts a UE4SS Scripts ZIP into the generated manifest mod root", async () => {
    const { root, service } = await makeImporter();
    const zipPath = await createZip(path.join(root, "ScriptOnly.zip"), {
      "Scripts/main.lua": "print('script only')"
    });

    const result = await service.importExternalModPackage({
      packagePath: zipPath
    });

    expect(result.status).toBe("installed");
    expect(result.mod).toMatchObject({
      id: "external_scriptonly",
      loader: "ue4ss"
    });
    await expect(
      readFile(
        path.join(
          result.mod!.installPath,
          "payload",
          "Mods",
          "external_scriptonly",
          "Scripts",
          "main.lua"
        ),
        "utf8"
      )
    ).resolves.toBe("print('script only')");
  });

  it("recognizes FOMOD archives but does not install installer logic", async () => {
    const { root, service } = await makeImporter();
    const zipPath = await createZip(path.join(root, "installer.zip"), {
      "fomod/ModuleConfig.xml": "<config />",
      "Data/Character_P.pak": "pak data"
    });

    const inspection = await service.inspectExternalModPackage({
      packagePath: zipPath
    });
    const result = await service.importExternalModPackage({
      packagePath: zipPath
    });

    expect(inspection).toMatchObject({
      status: "recognized",
      format: "fomod",
      support: "inspectOnly"
    });
    expect(result.status).toBe("failed");
    expect(result.problems[0].code).toBe("FOMOD_INSTALLER_UNSUPPORTED");
  });

  it("blocks unsupported archive containers and executable installers", async () => {
    const { root, service } = await makeImporter();
    const rarPath = path.join(root, "community-mod.rar");
    const sevenZipPath = path.join(root, "community-mod.7z");
    const exePath = path.join(root, "setup.exe");
    await writeFile(rarPath, "rar bytes");
    await writeFile(sevenZipPath, "7z bytes");
    await writeFile(exePath, "installer bytes");

    await expect(
      service.inspectExternalModPackage({ packagePath: rarPath })
    ).resolves.toMatchObject({
      status: "unsupported",
      format: "unsupportedArchive",
      support: "unsupported"
    });
    await expect(
      service.inspectExternalModPackage({ packagePath: sevenZipPath })
    ).resolves.toMatchObject({
      status: "unsupported",
      format: "unsupportedArchive",
      support: "unsupported"
    });

    const executableResult = await service.importExternalModPackage({
      packagePath: exePath
    });

    expect(executableResult.status).toBe("failed");
    expect(executableResult.problems[0].code).toBe(
      "EXTERNAL_EXECUTABLE_BLOCKED"
    );
  });

  it("rejects hostile ZIP paths during external inspection", async () => {
    const { root, service } = await makeImporter();
    const zipPath = await createZip(path.join(root, "hostile.zip"), {
      "../escape.pak": "bad"
    });

    const inspection = await service.inspectExternalModPackage({
      packagePath: zipPath
    });

    expect(inspection).toMatchObject({
      status: "invalid",
      support: "unsupported"
    });
    expect(inspection.problems[0].code).toBe("UNSAFE_ARCHIVE_PATH");
  });
});
