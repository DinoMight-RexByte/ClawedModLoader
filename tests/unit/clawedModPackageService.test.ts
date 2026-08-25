import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ClawedModPackageError,
  ClawedModPackageService,
  hashFileSha256
} from "../../src/main/services/clawedModPackageService";
import { createClawedModFixture } from "../helpers/clawedModFixture";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

async function makeTempRoot(): Promise<string> {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-package-"));
  return tempRoot;
}

async function expectPackageError(
  action: () => Promise<unknown>,
  code: string
): Promise<void> {
  await expect(action()).rejects.toMatchObject({
    problems: expect.arrayContaining([expect.objectContaining({ code })])
  });
}

describe("clawed mod package service", () => {
  it("parses a valid .clawedmod archive and calculates SHA-256", async () => {
    const root = await makeTempRoot();
    const packagePath = path.join(root, "core.clawedmod");
    const { manifest } = await createClawedModFixture(packagePath);
    const service = new ClawedModPackageService();

    const parsed = await service.parsePackage(packagePath);

    expect(parsed.manifest).toEqual(manifest);
    expect(parsed.hasReadme).toBe(true);
    expect(parsed.sha256).toBe(await hashFileSha256(packagePath));
  });

  it("parses legacy manifest V1 packages without creator metadata", async () => {
    const root = await makeTempRoot();
    const packagePath = path.join(root, "legacy.clawedmod");
    await createClawedModFixture(packagePath);

    const parsed = await new ClawedModPackageService().parsePackage(packagePath);

    expect(parsed.manifest.creatorAssets).toBeUndefined();
  });

  it("rejects creator metadata that declares cooked loose deployment", async () => {
    const root = await makeTempRoot();
    const packagePath = path.join(root, "bad-creator-metadata.clawedmod");
    await createClawedModFixture(packagePath, {
      manifest: {
        loader: "loose",
        creatorAssets: {
          schemaVersion: 1,
          affectedAssets: [
            {
              id: "replacement",
              assetClass: "Texture2D",
              payloadPath: "payload/Content/Loose/T_Target.uasset",
              source: "generated",
              role: "replacement",
              tags: ["texture_material_visuals"]
            }
          ],
          replacements: [
            {
              replacementAssetId: "replacement",
              payloadPaths: ["payload/Content/Loose/T_Target.uasset"],
              deploymentRoute: "loose-non-cooked",
              validationState: "untested"
            }
          ],
          supportedSteamBuilds: [],
          previewAssets: [],
          textureBindings: [],
          importProvenance: [
            {
              sourceKind: "generated",
              sourceName: "bad fixture",
              sourceHashes: [],
              rights: "generated"
            }
          ],
          assetDependencies: [],
          exportEligibility: {
            state: "unknown",
            allowedOutputs: ["assetIndex"],
            containsBaseGameContent: false,
            requiresUserOwnedSource: true
          }
        }
      },
      payloadEntries: [
        {
          name: "Content/Loose/T_Target.uasset",
          content: "fake cooked loose asset"
        }
      ]
    });

    await expectPackageError(
      () => new ClawedModPackageService().parsePackage(packagePath),
      "MANIFEST_SCHEMA_INVALID"
    );
  });

  it("rejects invalid manifests", async () => {
    const root = await makeTempRoot();
    const packagePath = path.join(root, "bad-manifest.clawedmod");
    await createClawedModFixture(packagePath, {
      manifestJsonOverride: { schemaVersion: 1, id: "missing-fields" }
    });

    await expectPackageError(
      () => new ClawedModPackageService().parsePackage(packagePath),
      "MANIFEST_SCHEMA_INVALID"
    );
  });

  it("rejects archives missing payload", async () => {
    const root = await makeTempRoot();
    const packagePath = path.join(root, "missing-payload.clawedmod");
    await createClawedModFixture(packagePath, { includePayload: false });

    await expectPackageError(
      () => new ClawedModPackageService().parsePackage(packagePath),
      "PAYLOAD_MISSING"
    );
  });

  it("rejects malformed ZIP files", async () => {
    const root = await makeTempRoot();
    const packagePath = path.join(root, "malformed.clawedmod");
    await writeFile(packagePath, "not a zip");

    await expectPackageError(
      () => new ClawedModPackageService().parsePackage(packagePath),
      "MALFORMED_ZIP"
    );
  });

  it("rejects zip-slip path traversal", async () => {
    const root = await makeTempRoot();
    const packagePath = path.join(root, "zip-slip.clawedmod");
    await createClawedModFixture(packagePath, {
      unsafeEntries: [{ name: "../evil.txt", content: "bad" }]
    });

    await expectPackageError(
      () => new ClawedModPackageService().parsePackage(packagePath),
      "UNSAFE_ARCHIVE_PATH"
    );
  });

  it("rejects absolute archive paths", async () => {
    const root = await makeTempRoot();
    const packagePath = path.join(root, "absolute.clawedmod");
    await createClawedModFixture(packagePath, {
      unsafeEntries: [{ name: "C:/evil.txt", content: "bad" }]
    });

    await expectPackageError(
      () => new ClawedModPackageService().parsePackage(packagePath),
      "UNSAFE_ARCHIVE_PATH"
    );
  });

  it("uses structured package errors", async () => {
    const error = new ClawedModPackageError([]);
    expect(error).toBeInstanceOf(Error);
  });
});
