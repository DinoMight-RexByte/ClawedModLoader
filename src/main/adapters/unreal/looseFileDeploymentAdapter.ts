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
  listModPayloadFiles,
  stagePayloadFile
} from "../packagePayload";
import { isLooseCookedUnrealAssetPayload } from "./unrealPayload";

const adapterCapabilities: DeploymentAdapterCapabilities = {
  supportsEnableDisable: true,
  supportsOrdering: false,
  supportsExternalStorage: false,
  supportsHotChanges: false,
  requiresRestart: true,
  requiresRuntime: false
};

export class LooseFileDeploymentAdapter implements DeploymentAdapterContract {
  readonly id = "loose";
  readonly version = "1";
  readonly capabilities = adapterCapabilities;
  readonly descriptor: DeploymentAdapterDescriptor = {
    id: this.id,
    label: "Loose File Deployment Adapter",
    layer: "unreal",
    status: "ready",
    releaseValidation: "UNVALIDATED",
    capabilities: this.capabilities
  };

  async validateEnvironment(
    context: DeploymentContext
  ): Promise<ValidationResult> {
    const records = enabledRecordsForLoader(context);
    const problems = await validateLooseRecords(records);

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
      effectiveOrderKnown: false,
      messages: [
        "Logical order saved. Loose-file runtime behavior has not been validated for this Clawed build."
      ],
      modsTxt: ""
    };
  }

  async stage(context: DeploymentContext): Promise<StagedDeployment> {
    const records = enabledRecordsForLoader(context);
    const stagedGameRoot = path.join(context.stagingPath, "game");
    await mkdir(stagedGameRoot, { recursive: true });

    const problems = await validateLooseRecords(records);
    if (problems.some((problem) => problem.severity === "error")) {
      throw new Error(problems[0].message);
    }

    const files: PlannedDeploymentFile[] = [];
    for (const record of records) {
      const payloadFiles = await listModPayloadFiles(record);
      for (const payloadFile of payloadFiles) {
        files.push(
          await stagePayloadFile({
            sourcePath: payloadFile.absolutePath,
            stagedGameRoot,
            targetRelativePath: payloadFile.payloadRelativePath
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
        type: "loose",
        releaseValidation: "UNVALIDATED",
        effectiveOrderKnown: false,
        logicalOrder: runtimeLoadOrder.logicalOrder,
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

async function validateLooseRecords(
  records: InstalledModManifestRecord[]
): Promise<ModProblem[]> {
  const problems: ModProblem[] = [];

  for (const record of records) {
    const payloadFiles = await listModPayloadFiles(record);
    if (payloadFiles.length === 0) {
      problems.push(
        modProblem(
          "error",
          "LOOSE_PAYLOAD_EMPTY",
          `${record.manifest.name} does not contain deployable loose files.`
        )
      );
      continue;
    }

    const cookedAsset = payloadFiles.find((payloadFile) =>
      isLooseCookedUnrealAssetPayload(payloadFile.payloadRelativePath)
    );
    if (cookedAsset) {
      problems.push(
        modProblem(
          "error",
          "LOOSE_COOKED_ASSET_UNSUPPORTED",
          `${record.manifest.name} contains cooked Unreal asset files that Clawed does not load from loose staging; package them as loader "pak" under payload/Content/Paks/ instead.`,
          `${cookedAsset.payloadRelativePath} must be packaged as loader "pak" under payload/Content/Paks/ so CMM can deploy it through the validated Pak/IoStore path.`
        )
      );
    }
  }

  return problems;
}

function enabledRecordsForLoader(
  context: DeploymentContext
): InstalledModManifestRecord[] {
  return context.installedMods.filter(
    (record) =>
      record.manifest.loader === "loose" &&
      context.profile.selectedMods[record.manifest.id]?.enabled === true &&
      context.profile.selectedMods[record.manifest.id]?.version ===
        record.manifest.version
  );
}
