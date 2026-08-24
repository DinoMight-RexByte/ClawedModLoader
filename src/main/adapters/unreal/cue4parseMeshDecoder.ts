import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import type {
  CreatorAssetIndexEntry,
  CreatorMeshExportFormat,
  ModProblem
} from "../../../shared/contracts/app";
import type {
  BaseGameMeshDecodeRequest,
  BaseGameMeshDecodeResult,
  BaseGameMeshDecoder,
  BaseGameMeshProbeRequest,
  BaseGameMeshProbeResult
} from "../../services/assetRegistryService";
import { modProblem } from "../../services/packageProblems";
import { isPathInside } from "../../services/packagePaths";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_OUTPUT_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;

const SidecarProblemSchema = z
  .object({
    severity: z.enum(["info", "warning", "error"]).default("warning"),
    code: z.string().min(1),
    message: z.string().min(1),
    technicalDetail: z.string().optional()
  })
  .strict();

const SidecarMetadataSchema = z
  .object({
    meshType: z.enum(["staticMesh", "skeletalMesh", "skeleton", "unknown"]).optional(),
    skeleton: z.string().min(1).nullable().optional(),
    physicsAsset: z.string().min(1).nullable().optional(),
    materialSlots: z
      .array(
        z
          .object({
            name: z.string().min(1),
            materialPath: z.string().min(1).nullable()
          })
          .strict()
      )
      .optional(),
    lods: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            screenSize: z.number().nonnegative().nullable().default(null),
            triangleCount: z.number().int().nonnegative().nullable().default(null),
            vertexCount: z.number().int().nonnegative().nullable().default(null)
          })
          .strict()
      )
      .optional(),
    dependencyPaths: z.array(z.string().min(1)).optional(),
    lodCount: z.number().int().nonnegative().nullable().optional(),
    vertexCount: z.number().int().nonnegative().nullable().optional(),
    triangleCount: z.number().int().nonnegative().nullable().optional(),
    materialSlotCount: z.number().int().nonnegative().nullable().optional()
  })
  .strict();

const SidecarResponseSchema = z
  .object({
    status: z.enum(["ready", "unsupported", "dependency-missing", "decode-error"]),
    format: z.enum(["gltf", "glb", "obj"]).optional(),
    fileName: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    dataBase64: z.string().min(1).optional(),
    metadata: SidecarMetadataSchema.optional(),
    problems: z.array(SidecarProblemSchema).default([])
  })
  .strict();

type SidecarResponse = z.infer<typeof SidecarResponseSchema>;

export interface Cue4ParseMeshDecoderOptions {
  sidecarPath: string;
  resolveArchiveRoot(): Promise<string | null>;
  resolveMappingsPath?(): Promise<string | null>;
  unrealVersion?: string;
  mappingsPath?: string | null;
  aesKey?: string | null;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export class Cue4ParseMeshDecoder implements BaseGameMeshDecoder {
  constructor(private readonly options: Cue4ParseMeshDecoderOptions) {}

  async isAvailable(): Promise<boolean> {
    return pathExists(this.options.sidecarPath);
  }

  supportsFormat(format: CreatorMeshExportFormat, asset: CreatorAssetIndexEntry) {
    if (asset.assetClass === "Skeleton") {
      return format === "gltf";
    }
    return format === "glb" || format === "obj";
  }

  async probe(request: BaseGameMeshProbeRequest): Promise<BaseGameMeshProbeResult> {
    const archiveRoot = await this.options.resolveArchiveRoot();
    if (!archiveRoot) {
      return {
        status: "dependency-missing",
        problems: [
          modProblem(
            "warning",
            "CUE4PARSE_ARCHIVE_ROOT_MISSING",
            "Clawed must be detected before CMM can classify base-game Unreal model assets."
          )
        ]
      };
    }

    const sidecarPath = path.resolve(this.options.sidecarPath);
    if (!(await pathExists(sidecarPath))) {
      return {
        status: "dependency-missing",
        problems: [
          modProblem(
            "warning",
            "CUE4PARSE_DECODER_SIDECAR_MISSING",
            "The CUE4Parse decoder sidecar is not installed in CMM resources.",
            path.basename(sidecarPath)
          )
        ]
      };
    }

    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-cue4parse-"));
    try {
      const response = await this.runSidecar(sidecarPath, {
        schemaVersion: 1,
        mode: "classify",
        archiveRoot,
        outputRoot,
        objectPath: request.cookedPayload.objectPath,
        packagePath: request.cookedPayload.packagePath,
        relativePath: request.cookedPayload.relativePath,
        assetClass: request.asset.assetClass,
        format: null,
        unrealVersion: this.options.unrealVersion ?? "GAME_UE5_5",
        mappingsPath: await this.resolveMappingsPath(),
        aesKey: this.options.aesKey ?? null
      });
      const assetClass = assetClassFromMeshType(response.metadata?.meshType);
      const status =
        response.status === "ready" && !assetClass
          ? "unsupported"
          : response.status;
      return {
        status,
        assetClass,
        metadata: response.metadata,
        problems:
          status === "unsupported" && response.status === "ready"
            ? [
                modProblem(
                  "info",
                  "CUE4PARSE_ASSET_CLASS_UNSUPPORTED",
                  "The cooked Unreal asset is not a StaticMesh, SkeletalMesh, or Skeleton export.",
                  response.metadata?.meshType ?? "unknown"
                )
              ]
            : sidecarProblems(response)
      };
    } catch (error) {
      return {
        status: "decode-error",
        problems: [
          modProblem(
            "warning",
            "CUE4PARSE_DECODER_FAILED",
            "The CUE4Parse decoder sidecar failed while classifying the Unreal asset.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      };
    } finally {
      await rm(outputRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async decode(request: BaseGameMeshDecodeRequest): Promise<BaseGameMeshDecodeResult> {
    if (!this.supportsFormat(request.format, request.asset)) {
      return {
        status: "unsupported",
        problems: [
          modProblem(
            "info",
            "CUE4PARSE_OUTPUT_FORMAT_UNSUPPORTED",
            "The configured Unreal decoder does not support this output format for the selected asset.",
            `${request.asset.assetClass ?? "unknown"} -> ${request.format}`
          )
        ]
      };
    }

    const archiveRoot = await this.options.resolveArchiveRoot();
    if (!archiveRoot) {
      return {
        status: "dependency-missing",
        problems: [
          modProblem(
            "warning",
            "CUE4PARSE_ARCHIVE_ROOT_MISSING",
            "Clawed must be detected before CMM can decode base-game Unreal model assets."
          )
        ]
      };
    }

    const sidecarPath = path.resolve(this.options.sidecarPath);
    if (!(await pathExists(sidecarPath))) {
      return {
        status: "dependency-missing",
        problems: [
          modProblem(
            "warning",
            "CUE4PARSE_DECODER_SIDECAR_MISSING",
            "The CUE4Parse decoder sidecar is not installed in CMM resources.",
            path.basename(sidecarPath)
          )
        ]
      };
    }

    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-cue4parse-"));
    try {
      const response = await this.runSidecar(sidecarPath, {
        schemaVersion: 1,
        mode: "decode",
        archiveRoot,
        outputRoot,
        objectPath: request.cookedPayload.objectPath,
        packagePath: request.cookedPayload.packagePath,
        relativePath: request.cookedPayload.relativePath,
        assetClass: request.asset.assetClass,
        format: request.format,
        unrealVersion: this.options.unrealVersion ?? "GAME_UE5_5",
        mappingsPath: await this.resolveMappingsPath(),
        aesKey: this.options.aesKey ?? null
      });

      if (response.status !== "ready") {
        return {
          status: response.status,
          metadata: response.metadata,
          problems: sidecarProblems(response)
        };
      }

      const data = await sidecarData(response, outputRoot);
      const maxBytes = this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      if (data.byteLength > maxBytes) {
        return {
          status: "unsupported",
          problems: [
            modProblem(
              "warning",
              "CUE4PARSE_OUTPUT_TOO_LARGE",
              "The decoded Unreal model is larger than the Creator viewport transfer limit.",
              `${data.byteLength} bytes`
            )
          ]
        };
      }

      return {
        status: "ready",
        format: response.format ?? request.format,
        data,
        fileName:
          response.fileName ??
          `${safeBaseName(request.asset.label)}.${response.format ?? request.format}`,
        metadata: response.metadata,
        problems: sidecarProblems(response)
      };
    } catch (error) {
      return {
        status: "decode-error",
        problems: [
          modProblem(
            "warning",
            "CUE4PARSE_DECODER_FAILED",
            "The CUE4Parse decoder sidecar failed while converting the Unreal asset.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      };
    } finally {
      await rm(outputRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async resolveMappingsPath(): Promise<string | null> {
    return this.options.resolveMappingsPath
      ? await this.options.resolveMappingsPath()
      : this.options.mappingsPath ?? null;
  }

  private async runSidecar(
    sidecarPath: string,
    payload: Record<string, unknown>
  ): Promise<SidecarResponse> {
    const invocation = sidecarInvocation(sidecarPath);
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const stdoutLimit = maxStdoutBytes(
      this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    );
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        child.kill();
        reject(new Error("CUE4Parse decoder timed out."));
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (settled) {
          return;
        }
        const next = appendProcessOutput(
          stdout,
          stdoutBytes,
          chunk,
          stdoutLimit
        );
        if (!next.ok) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error("CUE4Parse decoder stdout exceeded the output limit."));
          return;
        }
        stdout = next.value;
        stdoutBytes = next.bytes;
      });
      child.stderr.on("data", (chunk) => {
        if (settled) {
          return;
        }
        const next = appendProcessOutput(
          stderr,
          stderrBytes,
          chunk,
          DEFAULT_MAX_STDERR_BYTES
        );
        if (!next.ok) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error("CUE4Parse decoder stderr exceeded the output limit."));
          return;
        }
        stderr = next.value;
        stderrBytes = next.bytes;
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(trimDetail(stderr || stdout || `exit ${code}`)));
          return;
        }
        try {
          resolve(SidecarResponseSchema.parse(JSON.parse(stdout)));
        } catch (error) {
          reject(
            new Error(
              error instanceof Error
                ? `Invalid CUE4Parse decoder response: ${error.message}`
                : "Invalid CUE4Parse decoder response."
            )
          );
        }
      });
      child.stdin.end(`${JSON.stringify(payload)}\n`);
    });
  }
}

async function sidecarData(
  response: SidecarResponse,
  outputRoot: string
): Promise<Buffer> {
  if (response.dataBase64) {
    return Buffer.from(response.dataBase64, "base64");
  }
  if (!response.filePath) {
    throw new Error("CUE4Parse decoder returned no output file.");
  }
  const filePath = path.resolve(response.filePath);
  const root = path.resolve(outputRoot);
  if (!isPathInside(root, filePath)) {
    throw new Error("CUE4Parse decoder output escaped its temporary directory.");
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error("CUE4Parse decoder output is not a file.");
  }
  return readFile(filePath);
}

function sidecarProblems(response: SidecarResponse): ModProblem[] {
  return response.problems.map((problem) =>
    modProblem(
      problem.severity,
      problem.code,
      problem.message,
      problem.technicalDetail
    )
  );
}

function maxStdoutBytes(maxOutputBytes: number): number {
  return Math.ceil(maxOutputBytes * 1.5) + 64 * 1024;
}

function appendProcessOutput(
  current: string,
  currentBytes: number,
  chunk: string,
  limit: number
): { ok: true; value: string; bytes: number } | { ok: false } {
  const bytes = currentBytes + Buffer.byteLength(chunk, "utf8");
  return bytes <= limit
    ? { ok: true, value: current + chunk, bytes }
    : { ok: false };
}

function sidecarInvocation(sidecarPath: string): {
  command: string;
  args: string[];
} {
  const extension = path.extname(sidecarPath).toLowerCase();
  if ([".js", ".cjs", ".mjs"].includes(extension)) {
    return { command: process.execPath, args: [sidecarPath] };
  }
  if (extension === ".dll") {
    return { command: "dotnet", args: [sidecarPath] };
  }
  return { command: sidecarPath, args: [] };
}

function assetClassFromMeshType(
  meshType: string | undefined
): "StaticMesh" | "SkeletalMesh" | "Skeleton" | null {
  if (meshType === "staticMesh") {
    return "StaticMesh";
  }
  if (meshType === "skeletalMesh") {
    return "SkeletalMesh";
  }
  if (meshType === "skeleton") {
    return "Skeleton";
  }
  return null;
}

function safeBaseName(value: string): string {
  return value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "model";
}

function trimDetail(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 600);
}

async function pathExists(targetPath: string): Promise<boolean> {
  return access(targetPath)
    .then(() => true)
    .catch(() => false);
}

export type { BaseGameMeshDecoder };
