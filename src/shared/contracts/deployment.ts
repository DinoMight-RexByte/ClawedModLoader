import { z } from "zod";

import type {
  DeploymentManifest,
  GameFingerprint,
  InstalledModManifestRecord,
  LoadOrderValidation,
  ModpackPackageRecord,
  Profile,
  RuntimeSnapshot
} from "./app";

export const DeploymentAdapterCapabilitiesSchema = z.object({
  supportsEnableDisable: z.boolean(),
  supportsOrdering: z.boolean(),
  supportsExternalStorage: z.boolean(),
  supportsHotChanges: z.boolean(),
  requiresRestart: z.boolean(),
  requiresRuntime: z.boolean()
});
export type DeploymentAdapterCapabilities = z.infer<
  typeof DeploymentAdapterCapabilitiesSchema
>;

export const DeploymentAdapterDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  layer: z.enum(["unreal", "ue4ss", "clawed", "generic"]),
  status: z.enum(["planned", "stubbed", "validated", "ready"]),
  capabilities: DeploymentAdapterCapabilitiesSchema,
  releaseValidation: z.enum(["UNVALIDATED", "VALIDATED"])
});
export type DeploymentAdapterDescriptor = z.infer<
  typeof DeploymentAdapterDescriptorSchema
>;

export interface ValidationResult {
  ok: boolean;
  messages: string[];
}

export interface RuntimeLoadOrder {
  logicalOrder: string[];
  runtimeBaselineOrder: string[];
  effectiveOrderKnown: boolean;
  messages: string[];
  modsTxt: string;
}

export interface DeploymentContext {
  transactionId: string;
  profile: Profile;
  installedMods: InstalledModManifestRecord[];
  loadOrder: LoadOrderValidation;
  gameInstallPath: string;
  gameExecutable: string | null;
  gameFingerprint: GameFingerprint;
  runtimeTargetRelativePath: string | null;
  unrealPakTargetRelativePath: string | null;
  stagingPath: string;
  runtime: RuntimeSnapshot;
}

export interface PlannedDeploymentFile {
  sourcePath: string;
  targetRelativePath: string;
  sha256: string | null;
}

export interface StagedDeployment {
  adapterId: string;
  adapterVersion: string;
  profileId: string;
  stagedPath: string;
  files: PlannedDeploymentFile[];
  runtimeConfiguration: Record<string, unknown>;
  sourcePackages: ModpackPackageRecord[];
  messages: string[];
}

export interface DeploymentResult {
  ok: boolean;
  manifest: DeploymentManifest | null;
  messages: string[];
}

export interface UndeploymentResult {
  ok: boolean;
  restoredBackups: string[];
  removedFiles: string[];
  messages: string[];
}

export interface DeploymentAdapterContract {
  id: string;
  version: string;
  descriptor: DeploymentAdapterDescriptor;
  capabilities: DeploymentAdapterCapabilities;
  validateEnvironment(context: DeploymentContext): Promise<ValidationResult>;
  stage(context: DeploymentContext): Promise<StagedDeployment>;
  generateLoadOrder(
    profile: Profile,
    runtimePath?: string,
    releaseValidation?: "UNVALIDATED" | "VALIDATED",
    currentSteamBuildId?: string | null
  ): Promise<RuntimeLoadOrder>;
}
