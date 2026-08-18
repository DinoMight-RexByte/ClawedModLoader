import { mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  DeploymentAdapterCapabilities,
  DeploymentAdapterContract,
  DeploymentAdapterDescriptor,
  DeploymentContext,
  PlannedDeploymentFile,
  RuntimeLoadOrder,
  StagedDeployment,
  ValidationResult
} from "../../../shared/contracts/deployment";
import type {
  InstalledModManifestRecord,
  ModProblem,
  Profile
} from "../../../shared/contracts/app";
import { modProblem } from "../../services/packageProblems";
import {
  type PayloadFile,
  listModPayloadFiles,
  stagePayloadFile
} from "../packagePayload";
import {
  isUnrealAssetPayload,
  resolveUnrealPakTarget
} from "./unrealPayload";

const adapterCapabilities: DeploymentAdapterCapabilities = {
  supportsEnableDisable: true,
  supportsOrdering: true,
  supportsExternalStorage: false,
  supportsHotChanges: false,
  requiresRestart: true,
  requiresRuntime: false
};

export class PakDeploymentAdapter implements DeploymentAdapterContract {
  readonly id = "pak";
  readonly version = "1";
  readonly capabilities = adapterCapabilities;
  readonly descriptor: DeploymentAdapterDescriptor = {
    id: this.id,
    label: "Pak Deployment Adapter",
    layer: "unreal",
    status: "ready",
    releaseValidation: "VALIDATED",
    capabilities: this.capabilities
  };

  async validateEnvironment(
    context: DeploymentContext
  ): Promise<ValidationResult> {
    const records = enabledRecordsForLoader(context);
    const problems = await validatePakRecords(
      records,
      context.unrealPakTargetRelativePath
    );

    return {
      ok: problems.every((problem) => problem.severity !== "error"),
      messages: problems.map((problem) => problem.message)
    };
  }

  async generateLoadOrder(profile: Profile): Promise<RuntimeLoadOrder> {
    const logicalOrder = profile.orderedModIds.filter(
      (modId) => profile.selectedMods[modId]?.enabled
    );

    return {
      logicalOrder,
      runtimeBaselineOrder: [],
      effectiveOrderKnown: true,
      messages: [],
      modsTxt: ""
    };
  }

  async stage(context: DeploymentContext): Promise<StagedDeployment> {
    const records = enabledRecordsForLoader(context);
    const stagedGameRoot = path.join(context.stagingPath, "game");
    await mkdir(stagedGameRoot, { recursive: true });

    const files: PlannedDeploymentFile[] = [];
    const problems = await validatePakRecords(
      records,
      context.unrealPakTargetRelativePath
    );
    if (problems.some((problem) => problem.severity === "error")) {
      throw new Error(problems[0].message);
    }

    const orderIndexByModId = new Map(
      context.loadOrder.orderedModIds.map((modId, index) => [modId, index])
    );
    const orderedContainerNames = new Map<string, string>();

    for (const record of records) {
      const payloadFiles = await listModPayloadFiles(record);
      const orderedPosition =
        (orderIndexByModId.get(record.manifest.id) ?? 0) + 1;
      let containerOrdinal = 0;

      for (const payloadFile of payloadFiles) {
        if (!isUnrealAssetPayload(payloadFile.payloadRelativePath)) {
          continue;
        }

        const targetRelativePath = resolveOrderedUnrealPakTarget({
          payloadFile,
          record,
          orderedPosition,
          containerOrdinalByKey: {
            getOrCreate: (key) => {
              const existing = orderedContainerNames.get(key);
              if (existing) {
                return existing;
              }
              containerOrdinal += 1;
              const containerName = createOrderedContainerName({
                pakTargetRelativePath: context.unrealPakTargetRelativePath,
                orderedPosition,
                containerOrdinal,
                modId: record.manifest.id,
                originalStem: path.parse(payloadFile.payloadRelativePath).name
              });
              orderedContainerNames.set(key, containerName);
              return containerName;
            }
          },
          pakTargetRelativePath: context.unrealPakTargetRelativePath
        });
        if (!targetRelativePath) {
          continue;
        }

        files.push(
          await stagePayloadFile({
            sourcePath: payloadFile.absolutePath,
            stagedGameRoot,
            targetRelativePath
          })
        );
      }
    }

    const runtimeLoadOrder = await this.generateLoadOrder(context.profile);
    return {
      adapterId: this.id,
      adapterVersion: this.version,
      profileId: context.profile.id,
      stagedPath: context.stagingPath,
      files,
      runtimeConfiguration: {
        type: "pak",
        releaseValidation: "VALIDATED",
        effectiveOrderKnown: true,
        logicalOrder: runtimeLoadOrder.logicalOrder,
        orderingStrategy: "ordered-project-patch-pak-filenames",
        messages: runtimeLoadOrder.messages
      },
      sourcePackages: records.map((record) => ({
        id: record.manifest.id,
        version: record.manifest.version,
        sha256: record.mod.sha256,
        file: record.mod.packagePath
      })),
      messages: runtimeLoadOrder.messages
    };
  }
}

async function validatePakRecords(
  records: InstalledModManifestRecord[],
  pakTargetRelativePath?: string | null
): Promise<ModProblem[]> {
  const problems: ModProblem[] = [];

  for (const record of records) {
    const payloadFiles = await listModPayloadFiles(record);
    const hasStructuredPak = payloadFiles.some(
      (payloadFile) =>
        isUnrealAssetPayload(payloadFile.payloadRelativePath) &&
        resolveUnrealPakTarget(
          payloadFile.payloadRelativePath,
          pakTargetRelativePath
        ) !== null
    );
    if (!hasStructuredPak) {
      problems.push(
        modProblem(
          "error",
          "PAK_PAYLOAD_NOT_STRUCTURED",
          `${record.manifest.name} does not contain .pak/.utoc/.ucas files under Content/Paks or Paks.`
        )
      );
    }
  }

  return problems;
}

function resolveOrderedUnrealPakTarget({
  payloadFile,
  record,
  orderedPosition,
  containerOrdinalByKey,
  pakTargetRelativePath
}: {
  payloadFile: PayloadFile;
  record: InstalledModManifestRecord;
  orderedPosition: number;
  containerOrdinalByKey: {
    getOrCreate(key: string): string;
  };
  pakTargetRelativePath?: string | null;
}): string | null {
  const pakRootTarget = resolveUnrealPakRootTarget(
    payloadFile.payloadRelativePath,
    pakTargetRelativePath
  );
  if (!pakRootTarget) {
    return null;
  }

  const parsed = path.parse(payloadFile.payloadRelativePath);
  const containerKey = [
    record.manifest.id,
    orderedPosition,
    parsed.name.toLowerCase()
  ].join("\0");
  const orderedContainerName = containerOrdinalByKey.getOrCreate(containerKey);

  return path.join(pakRootTarget, `${orderedContainerName}${parsed.ext}`);
}

function resolveUnrealPakRootTarget(
  payloadRelativePath: string,
  pakTargetRelativePath?: string | null
): string | null {
  const segments = payloadRelativePath.replaceAll("\\", "/").split("/");

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (
      segments[index].toLowerCase() === "content" &&
      segments[index + 1].toLowerCase() === "paks"
    ) {
      if (pakTargetRelativePath) {
        return pakTargetRelativePath;
      }
      return path.join(...segments.slice(0, index + 2));
    }
  }

  const paksIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "paks"
  );
  if (paksIndex < 0) {
    return null;
  }

  return pakTargetRelativePath
    ? pakTargetRelativePath
    : path.join(...segments.slice(0, paksIndex + 1));
}

function createOrderedContainerName({
  pakTargetRelativePath,
  orderedPosition,
  containerOrdinal,
  modId,
  originalStem
}: {
  pakTargetRelativePath?: string | null;
  orderedPosition: number;
  containerOrdinal: number;
  modId: string;
  originalStem: string;
}): string {
  const projectName = deriveProjectNameFromPakTarget(pakTargetRelativePath);
  const projectPrefix = projectName ? `${projectName}-` : "";
  const paddedPosition = orderedPosition.toString().padStart(6, "0");
  return [
    `${projectPrefix}zz-CMM`,
    paddedPosition,
    sanitizeFilenameSegment(modId, "mod"),
    containerOrdinal.toString().padStart(2, "0"),
    `${sanitizeFilenameSegment(originalStem, "container")}_${paddedPosition}_P`
  ].join("-");
}

function deriveProjectNameFromPakTarget(
  pakTargetRelativePath?: string | null
): string | null {
  if (!pakTargetRelativePath) {
    return null;
  }

  const segments = pakTargetRelativePath.replaceAll("\\", "/").split("/");
  const contentIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "content"
  );
  if (contentIndex <= 0) {
    return null;
  }

  return sanitizeFilenameSegment(segments[contentIndex - 1], "project");
}

function sanitizeFilenameSegment(value: string, fallback: string): string {
  const sanitized = value
    .replaceAll(/[^A-Za-z0-9._-]/g, "_")
    .replaceAll(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);

  return sanitized.length > 0 ? sanitized : fallback;
}

function enabledRecordsForLoader(
  context: DeploymentContext
): InstalledModManifestRecord[] {
  const matchingRecordsById = new Map(
    context.installedMods
      .filter((record) => {
        const selection = context.profile.selectedMods[record.manifest.id];
        return (
          record.manifest.loader === "pak" &&
          selection?.enabled === true &&
          selection.version === record.manifest.version
        );
      })
      .map((record) => [record.manifest.id, record])
  );

  return context.loadOrder.orderedModIds.flatMap((modId) => {
    const record = matchingRecordsById.get(modId);
    return record ? [record] : [];
  });
}
