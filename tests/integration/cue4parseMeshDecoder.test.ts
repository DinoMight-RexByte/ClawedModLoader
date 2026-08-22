import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Cue4ParseMeshDecoder } from "../../src/main/adapters/unreal/cue4parseMeshDecoder";
import type { BaseGameMeshDecodeRequest } from "../../src/main/services/assetRegistryService";
import type {
  CreatorAssetDetail,
  CreatorAssetIndexEntry,
  CreatorMeshExportFormat
} from "../../src/shared/contracts/app";

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true }))
  );
  tempRoots = [];
});

describe("Cue4ParseMeshDecoder", () => {
  it("reports unavailable when the sidecar is missing", async () => {
    const decoder = new Cue4ParseMeshDecoder({
      sidecarPath: path.join(os.tmpdir(), "missing-cue4parse-sidecar.exe"),
      resolveArchiveRoot: async () => null
    });

    expect(await decoder.isAvailable()).toBe(false);
  });

  it("invokes the sidecar and returns decoded model data", async () => {
    const root = await tempRoot();
    const sidecarPath = await writeFakeSidecar(root, "data");
    const archiveRoot = path.join(root, "paks");
    const mappingsPath = path.join(root, "Mappings.usmap");
    await mkdir(archiveRoot);
    await writeFile(mappingsPath, "");
    const decoder = new Cue4ParseMeshDecoder({
      sidecarPath,
      resolveArchiveRoot: async () => archiveRoot,
      resolveMappingsPath: async () => mappingsPath,
      unrealVersion: "GAME_UE5_5"
    });

    const result = await decoder.decode(request("glb"));
    const payload = JSON.parse(result.data?.toString("utf8") ?? "{}") as {
      archiveRoot?: string;
      objectPath?: string;
      relativePath?: string;
      format?: string;
      mappingsPath?: string;
      unrealVersion?: string;
    };

    expect(result.status).toBe("ready");
    expect(result.format).toBe("glb");
    expect(result.fileName).toBe("decoded.glb");
    expect(result.metadata?.meshType).toBe("staticMesh");
    expect(result.metadata?.lods?.[0]).toMatchObject({
      index: 0,
      screenSize: 1,
      triangleCount: null,
      vertexCount: null
    });
    expect(payload).toMatchObject({
      archiveRoot,
      objectPath: "/Game/Test/SM_Target.SM_Target",
      relativePath: "Clawed/Content/Test/SM_Target.uasset",
      format: "glb",
      mappingsPath,
      unrealVersion: "GAME_UE5_5"
    });
  });

  it("short-circuits unsupported formats before sidecar execution", async () => {
    const decoder = new Cue4ParseMeshDecoder({
      sidecarPath: path.join(os.tmpdir(), "missing-cue4parse-sidecar.exe"),
      resolveArchiveRoot: async () => {
        throw new Error("archive root should not be resolved");
      }
    });

    const result = await decoder.decode(request("gltf"));

    expect(result.status).toBe("unsupported");
    expect(result.problems?.[0]?.code).toBe(
      "CUE4PARSE_OUTPUT_FORMAT_UNSUPPORTED"
    );
  });

  it("probes sidecar classification without requiring model output", async () => {
    const root = await tempRoot();
    const sidecarPath = await writeFakeSidecar(root, "data");
    const archiveRoot = path.join(root, "paks");
    await mkdir(archiveRoot);
    const decoder = new Cue4ParseMeshDecoder({
      sidecarPath,
      resolveArchiveRoot: async () => archiveRoot
    });

    const entry = asset({ assetClass: "CookedUnrealAsset" });
    const result = await decoder.probe({
      asset: entry,
      cookedPayload: {
        objectPath: entry.objectPath,
        packagePath: entry.packagePath,
        relativePath: entry.relativePath,
        containerName: entry.containerName,
        extension: entry.extension,
        sizeBytes: entry.sizeBytes,
        sha256: entry.sha256
      },
      purpose: "preview"
    });

    expect(result.status).toBe("ready");
    expect(result.assetClass).toBe("StaticMesh");
    expect(result.metadata?.meshType).toBe("staticMesh");
  });

  it("rejects sidecar output outside the decoder temp directory", async () => {
    const root = await tempRoot();
    const sidecarPath = await writeFakeSidecar(root, "escape");
    const archiveRoot = path.join(root, "paks");
    await mkdir(archiveRoot);
    const decoder = new Cue4ParseMeshDecoder({
      sidecarPath,
      resolveArchiveRoot: async () => archiveRoot
    });

    const result = await decoder.decode(request("glb"));

    expect(result.status).toBe("decode-error");
    expect(result.problems?.[0]?.code).toBe("CUE4PARSE_DECODER_FAILED");
  });

  it("rejects sidecar stdout that exceeds the configured output limit", async () => {
    const root = await tempRoot();
    const sidecarPath = await writeFakeSidecar(root, "large-output");
    const archiveRoot = path.join(root, "paks");
    await mkdir(archiveRoot);
    const decoder = new Cue4ParseMeshDecoder({
      sidecarPath,
      resolveArchiveRoot: async () => archiveRoot,
      maxOutputBytes: 16
    });

    const result = await decoder.decode(request("glb"));

    expect(result.status).toBe("decode-error");
    expect(result.problems?.[0]?.technicalDetail).toContain(
      "stdout exceeded the output limit"
    );
  });

  it("exposes CUE4Parse output capabilities by asset class", () => {
    const decoder = new Cue4ParseMeshDecoder({
      sidecarPath: path.join(os.tmpdir(), "missing-cue4parse-sidecar.exe"),
      resolveArchiveRoot: async () => null
    });
    const skeleton = asset({ assetClass: "Skeleton" });

    expect(decoder.supportsFormat("glb", asset())).toBe(true);
    expect(decoder.supportsFormat("obj", asset())).toBe(true);
    expect(decoder.supportsFormat("gltf", asset())).toBe(false);
    expect(decoder.supportsFormat("gltf", skeleton)).toBe(true);
    expect(decoder.supportsFormat("glb", skeleton)).toBe(false);
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cmm-cue4parse-test-"));
  tempRoots.push(root);
  return root;
}

async function writeFakeSidecar(
  root: string,
  mode: "data" | "escape" | "large-output"
): Promise<string> {
  const sidecarPath = path.join(root, `${mode}.cjs`);
  await writeFile(
    sidecarPath,
    [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  const req = JSON.parse(input);",
      sidecarBody(mode),
      "});"
    ].join("\n")
  );
  return sidecarPath;
}

function sidecarBody(mode: "data" | "escape" | "large-output"): string {
  if (mode === "escape") {
    return "  process.stdout.write(JSON.stringify({ status: 'ready', format: req.format, fileName: 'decoded.glb', filePath: require('path').resolve('package.json'), problems: [] }));";
  }
  if (mode === "large-output") {
    return "  process.stdout.write('x'.repeat(70000));";
  }
  return "  process.stdout.write(JSON.stringify(req.mode === 'classify' ? { status: 'ready', metadata: { meshType: 'staticMesh', materialSlots: [], lods: [{ index: 0, screenSize: 1 }], dependencyPaths: [] }, problems: [] } : { status: 'ready', format: req.format, fileName: 'decoded.' + req.format, dataBase64: Buffer.from(JSON.stringify(req)).toString('base64'), metadata: { meshType: 'staticMesh', materialSlots: [], lods: [{ index: 0, screenSize: 1 }], dependencyPaths: [] }, problems: [] }));";
}

function request(format: CreatorMeshExportFormat): BaseGameMeshDecodeRequest {
  const entry = asset();
  return {
    asset: entry,
    detail: detail(entry),
    cookedPayload: {
      objectPath: entry.objectPath,
      packagePath: entry.packagePath,
      relativePath: entry.relativePath,
      containerName: entry.containerName,
      extension: entry.extension,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256
    },
    format,
    purpose: "preview"
  };
}

function asset(
  overrides: Partial<CreatorAssetIndexEntry> = {}
): CreatorAssetIndexEntry {
  return {
    id: "base:sm-target",
    label: "SM_Target",
    source: "baseGameMap",
    ownerLabel: "Clawed Base Game",
    packageId: null,
    packageVersion: null,
    packageName: null,
    containerName: "Clawed-Windows",
    loader: null,
    activeProfileEnabled: false,
    activeProfileOrder: null,
    assetClass: "StaticMesh",
    packagePath: "/Game/Test/SM_Target",
    objectPath: "/Game/Test/SM_Target.SM_Target",
    virtualPath: null,
    payloadPath: null,
    relativePath: "Clawed/Content/Test/SM_Target.uasset",
    extension: ".uasset",
    tags: ["model_visuals"],
    modUses: null,
    sizeBytes: 1024,
    sha256: "a".repeat(64),
    validationState: null,
    deploymentRoute: null,
    exportState: "exportable",
    viewportState: "viewable",
    conflictState: "none",
    ...overrides
  };
}

function detail(entry: CreatorAssetIndexEntry): CreatorAssetDetail {
  return {
    status: "ok",
    asset: entry,
    relatedAssets: [],
    conflicts: [],
    activeWinner: null,
    previews: [],
    checksums: [],
    dependencies: [],
    problems: []
  };
}
