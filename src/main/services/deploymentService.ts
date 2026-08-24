import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import type {
  DeploymentAdapterContract,
  PlannedDeploymentFile,
  StagedDeployment
} from "../../shared/contracts/deployment";
import {
  CLAWED_STEAM_APP_ID,
  DeploymentManifestSchema,
  DeploymentOperationResultSchema,
  DeploymentSnapshotSchema,
  InstalledModManifestRecordSchema,
  ProfileSchema,
  type DeploymentBackupRecord,
  type DeploymentDirectoryRecord,
  type DeploymentFileRecord,
  type DeploymentManifest,
  type DeploymentOperationResult,
  type DeploymentSnapshot,
  type GameDiscovery,
  type GameFingerprint,
  type InstalledModManifestRecord,
  type ModLoader,
  type ModProblem,
  type RuntimeGeneratedFileRecord,
  type RuntimeStatus,
  type AppSettings,
  type ServiceStatus
} from "../../shared/contracts/app";
import type {
  DeploymentServiceContract,
  LoadOrderServiceContract,
  ModLibraryServiceContract,
  ProfileServiceContract,
  RuntimeManagerContract,
  SettingsServiceContract,
  StorageServiceContract
} from "../../shared/contracts/services";
import { hashFileSha256 } from "./clawedModPackageService";
import { ClawedGameAdapter } from "../adapters/clawed/clawedGameAdapter";
import {
  cleanupManifestGeneratedArtifacts,
  collectMissingParentDirectories,
  inspectKnownRuntimeGeneratedFiles
} from "./deploymentManifestCleanup";
import { rmWithRetry } from "./fileRemoval";
import type { LifecycleLogger } from "./lifecycleLogger";
import { modProblem } from "./packageProblems";
import { isPathInside } from "./packagePaths";
import { atomicWriteJson } from "./profileService";
import { validateLogicalLoadOrder } from "./loadOrderRules";
import {
  PACKAGED_RUNTIME_VALIDATION_MOD_ID,
  packagedRuntimeValidationLua
} from "./runtimeValidationProbe";
import {
  UNREAL_MAPPINGS_DUMP_MOD_ID,
  unrealMappingsDumpLua
} from "./unrealMappingsDumpProbe";

const CURRENT_MANIFEST_FILENAME = "current-deployment.json";

export interface DeploymentServiceOptions {
  failAfterFileOperations?: number;
  settingsService?: SettingsServiceContract;
}

export class LocalDeploymentService implements DeploymentServiceContract {
  private readonly adapters: DeploymentAdapterContract[];

  constructor(
    private readonly storageService: StorageServiceContract,
    private readonly modLibraryService: ModLibraryServiceContract,
    private readonly profileService: ProfileServiceContract,
    private readonly loadOrderService: LoadOrderServiceContract,
    private readonly runtimeManager: RuntimeManagerContract,
    adapter: DeploymentAdapterContract | DeploymentAdapterContract[],
    private readonly logger: LifecycleLogger,
    private readonly options: DeploymentServiceOptions = {},
    private readonly gameAdapter: ClawedGameAdapter = new ClawedGameAdapter()
  ) {
    this.adapters = Array.isArray(adapter) ? adapter : [adapter];
  }

  getStatus(): ServiceStatus {
    return {
      id: "deploymentService",
      label: "Deployment Service",
      status: "ready",
      detail:
        "Stages, applies, records, and rolls back manager-owned deployment files through runtime adapters."
    };
  }

  async getSnapshot(): Promise<DeploymentSnapshot> {
    const [manifest, activeProfile, validation, installedMods] =
      await Promise.all([
      this.readCurrentManifest(),
      this.profileService.getActiveProfile(),
      this.loadOrderService.validateActiveOrder(),
      this.modLibraryService.listInstalledModManifests()
    ]);
    const runtime = await this.runtimeManager.getRuntimeSnapshot(
      manifest?.gameFingerprint.steamBuildId ?? null,
      manifest?.gameFingerprint.fingerprintSha256 ?? null
    );
    const problems: ModProblem[] = [];

    if (manifest) {
      const requiresRuntime = manifestRequiresRuntime(manifest);
      const runtimeValidationManifest = isRuntimeValidationManifest(manifest);
      if (requiresRuntime) {
        problems.push(
          ...(runtimeValidationManifest
            ? runtime.problems.filter((problem) => problem.severity !== "error")
            : runtime.problems)
        );
      }
      const verifyProblems = await this.verifyManifestFiles(manifest);
      problems.push(...verifyProblems);
      problems.push(...runtimeConfigurationMessages(manifest));
      const fingerprint = await this.gameAdapter.getFingerprint(
        discoveryFromManifest(manifest),
        manifest.gameFingerprint as Partial<GameFingerprint>,
        { mode: "quick" }
      );
      problems.push(...fingerprint.problems);
      const hasVerificationError = verifyProblems.some(
        (problem) => problem.severity === "error"
      );
      const currentProfileMatches =
        manifest.profileId === activeProfile.id && validation.validity === "valid";
      const state: DeploymentSnapshot["state"] = hasVerificationError
        ? "deploymentError"
        : fingerprint.status === "NEW_CHANGED_BUILD"
          ? "runtimeIncompatible"
          : runtimeValidationManifest
            ? "runtimeUnvalidated"
          : requiresRuntime &&
              runtimeBlocksDeployment(runtime.status)
          ? "runtimeIncompatible"
          : currentProfileMatches &&
              requiresRuntime &&
              runtime.status === "unvalidated"
            ? "runtimeUnvalidated"
            : currentProfileMatches
              ? "moddedReady"
              : "deploymentRequired";

      return DeploymentSnapshotSchema.parse({
        state,
        activeManifest: manifest,
        runtime,
        problems
      });
    }

    const plan = this.createAdapterPlan(activeProfile, installedMods);
    if (plan.requiresRuntime) {
      problems.push(...runtime.problems);
    }
    if (plan.problems.some((problem) => problem.severity === "error")) {
      return DeploymentSnapshotSchema.parse({
        state: "deploymentError",
        activeManifest: null,
        runtime,
        problems: [...problems, ...plan.problems]
      });
    }

    if (Object.values(activeProfile.selectedMods).every((mod) => !mod.enabled)) {
      return DeploymentSnapshotSchema.parse({
        state: "vanillaReady",
        activeManifest: null,
        runtime,
        problems
      });
    }

    if (
      plan.requiresRuntime &&
      runtimeBlocksDeployment(runtime.status)
    ) {
      return DeploymentSnapshotSchema.parse({
        state: "runtimeIncompatible",
        activeManifest: null,
        runtime,
        problems
      });
    }

    if (plan.requiresRuntime && runtime.status === "unvalidated") {
      return DeploymentSnapshotSchema.parse({
        state: "runtimeUnvalidated",
        activeManifest: null,
        runtime,
        problems
      });
    }

    return DeploymentSnapshotSchema.parse({
      state: "deploymentRequired",
      activeManifest: null,
      runtime,
      problems
    });
  }

  async prepareModdedDeployment(
    discovery: GameDiscovery
  ): Promise<DeploymentOperationResult> {
    if (!discovery.gameInstallPath) {
      return blockedResult("runtimeIncompatible", [
        modProblem(
          "error",
          "GAME_INSTALL_MISSING",
          "Clawed must be detected before CMM can deploy mods."
        )
      ]);
    }

    const [profile, installedMods, loadOrder, settings] = await Promise.all([
      this.profileService.getActiveProfile(),
      this.modLibraryService.listInstalledModManifests(),
      this.loadOrderService.validateActiveOrder(),
      this.options.settingsService?.getSettings() ??
        Promise.resolve(defaultDeploymentSettings())
    ]);
    const loadOrderProblems = loadOrder.problems.map(loadOrderProblemToModProblem);

    if (loadOrder.validity === "invalid") {
      return blockedResult("deploymentError", loadOrderProblems);
    }

    const plan = this.createAdapterPlan(profile, installedMods);
    if (plan.problems.some((problem) => problem.severity === "error")) {
      return blockedResult("deploymentError", plan.problems);
    }

    if (plan.adapters.length === 0) {
      return this.prepareVanillaDeployment(discovery);
    }

    const activeManifest = await this.readCurrentManifest();
    const currentFingerprint = await this.gameAdapter.getFingerprint(
      discovery,
      activeManifest?.gameFingerprint as Partial<GameFingerprint> | null,
      { mode: "quick" }
    );
    const buildRefreshProblems =
      activeManifest && currentFingerprint.status === "NEW_CHANGED_BUILD"
        ? currentFingerprint.problems
        : [];
    let runtime = await this.runtimeManager.getRuntimeSnapshot(
      currentFingerprint.steamBuildId,
      currentFingerprint.fingerprintSha256
    );

    if (
      plan.requiresRuntime &&
      settings.autoUpdatePackagedRuntime &&
      (runtime.status === "missing" ||
        runtime.status === "invalid" ||
        runtime.status === "incompatible")
    ) {
      await this.runtimeManager.ensureBundledUe4ssRuntime();
      runtime = await this.runtimeManager.getRuntimeSnapshot(
        currentFingerprint.steamBuildId,
        currentFingerprint.fingerprintSha256
      );
    }

    if (
      plan.requiresRuntime &&
      runtimeBlocksDeployment(runtime.status)
    ) {
      return blockedResult("runtimeIncompatible", [
        ...runtime.problems,
        ...(!settings.autoUpdatePackagedRuntime
          ? [autoRuntimeUpdateDisabledProblem()]
          : [])
      ]);
    }

    const transactionId = randomUUID();
    const layout = await this.storageService.getLayout();
    const stagingPath = path.join(
      layout.directories.staging,
      `deployment-${transactionId}`
    );

    try {
      await mkdir(stagingPath, { recursive: true });
      const gameLayout = this.gameAdapter.getLayout(discovery);
      const context = {
        transactionId,
        profile,
        installedMods,
        loadOrder,
        gameInstallPath: discovery.gameInstallPath,
        gameExecutable: discovery.gameExecutable,
        gameFingerprint: currentFingerprint,
        runtimeTargetRelativePath: relativeTargetPath(
          discovery.gameInstallPath,
          gameLayout.runtimePath
        ),
        unrealPakTargetRelativePath: relativeTargetPath(
          discovery.gameInstallPath,
          gameLayout.pakDirectory
        ),
        stagingPath,
        runtime
      };
      const validationResults = await Promise.all(
        plan.adapters.map((adapter) => adapter.validateEnvironment(context))
      );
      const blockingMessages = validationResults
        .filter((validation) => !validation.ok)
        .flatMap((validation) => validation.messages);
      if (blockingMessages.length > 0) {
        return blockedResult(
          plan.requiresRuntime && runtime.status === "unvalidated"
            ? "runtimeUnvalidated"
            : "deploymentError",
          blockingMessages.map((message) =>
            modProblem("error", "DEPLOYMENT_VALIDATION_FAILED", message)
          )
        );
      }

      const staged = await this.stageWithAdapters(plan.adapters, context);
      const manifest = await this.applyStagedDeployment({
        staged,
        discovery,
        transactionId
      });

      await this.logger.log({
        category: "deploymentService",
        action: "modded_deployment_applied",
        result: "ok"
      });

      return DeploymentOperationResultSchema.parse({
        status: "ok",
        state:
          plan.requiresRuntime && runtime.status === "unvalidated"
            ? "runtimeUnvalidated"
            : "moddedReady",
        manifest,
        problems: [
          ...loadOrderProblems,
          ...plan.problems,
          ...buildRefreshProblems,
          ...validationResults.flatMap((validation) =>
            validation.messages.map((message) =>
              modProblem("warning", "DEPLOYMENT_ADAPTER_MESSAGE", message)
            )
          ),
          ...(plan.requiresRuntime
            ? runtime.problems.filter((problem) => problem.severity !== "error")
            : [])
        ]
      });
    } catch (error) {
      const rollback = await this.rollbackActiveTransaction(transactionId);
      await this.logger.log({
        category: "deploymentService",
        action: "modded_deployment_failed",
        result: rollback ? "ok" : "failed"
      });

      return DeploymentOperationResultSchema.parse({
        status: rollback ? "rolledBack" : "failed",
        state: "deploymentError",
        manifest: null,
        problems: [
          modProblem(
            "error",
            "DEPLOYMENT_FAILED",
            "CMM could not complete deployment and attempted rollback.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    } finally {
      await rm(stagingPath, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }

  async prepareVanillaDeployment(
    discovery: GameDiscovery
  ): Promise<DeploymentOperationResult> {
    if (!discovery.gameInstallPath) {
      return blockedResult("runtimeIncompatible", [
        modProblem(
          "error",
          "GAME_INSTALL_MISSING",
          "Clawed must be detected before CMM can prepare vanilla launch."
        )
      ]);
    }

    const manifest = await this.readCurrentManifest();
    const runtime = await this.runtimeManager.getRuntimeSnapshot();
    if (!manifest) {
      return DeploymentOperationResultSchema.parse({
        status: "ok",
        state: "vanillaReady",
        manifest: null,
        problems: runtime.problems
      });
    }

    if (path.resolve(manifest.gameInstallPath) !== path.resolve(discovery.gameInstallPath)) {
      return blockedResult("deploymentError", [
        modProblem(
          "error",
          "DEPLOYMENT_GAME_PATH_CHANGED",
          "The active deployment was created for a different Clawed installation.",
          manifest.gameInstallPath
        )
      ]);
    }

    try {
      await this.undeployManifest(manifest);
      await this.markManifestRolledBack(manifest);
      await rm(await this.getCurrentManifestPath(), { force: true });
      await this.logger.log({
        category: "deploymentService",
        action: "vanilla_deployment_prepared",
        result: "ok"
      });

      return DeploymentOperationResultSchema.parse({
        status: "ok",
        state: "vanillaReady",
        manifest: null,
        problems: []
      });
    } catch (error) {
      return DeploymentOperationResultSchema.parse({
        status: "failed",
        state: "deploymentError",
        manifest,
        problems: [
          modProblem(
            "error",
            "VANILLA_UNDEPLOY_FAILED",
            "CMM could not restore the game to its recorded vanilla state.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    }
  }

  async prepareRuntimeValidationDeployment(
    discovery: GameDiscovery
  ): Promise<DeploymentOperationResult> {
    if (!discovery.gameInstallPath) {
      return blockedResult("runtimeIncompatible", [
        modProblem(
          "error",
          "GAME_INSTALL_MISSING",
          "Clawed must be detected before CMM can validate the packaged runtime."
        )
      ]);
    }

    const ue4ssAdapter = this.adapters.find((adapter) => adapter.id === "ue4ss");
    if (!ue4ssAdapter) {
      return blockedResult("deploymentError", [
        modProblem(
          "error",
          "DEPLOYMENT_ADAPTER_MISSING",
          "No UE4SS deployment adapter is available for packaged runtime validation."
        )
      ]);
    }

    const currentFingerprint = await this.gameAdapter.getFingerprint(
      discovery,
      null,
      { mode: "quick" }
    );
    const runtime = await this.runtimeManager.getRuntimeSnapshot(
      currentFingerprint.steamBuildId,
      currentFingerprint.fingerprintSha256
    );

    if (!runtime.ue4ss || runtime.ue4ss.source !== "bundled") {
      return blockedResult("runtimeIncompatible", [
        modProblem(
          "error",
          "UE4SS_PACKAGED_RUNTIME_REQUIRED",
          "Automatic validation only runs for the packaged UE4SS runtime."
        )
      ]);
    }

    if (runtime.status !== "unvalidated" && runtime.status !== "incompatible") {
      return blockedResult(
        "deploymentError",
        runtime.problems.length
          ? runtime.problems
          : [
              modProblem(
                "warning",
                "UE4SS_RUNTIME_VALIDATION_NOT_REQUIRED",
                "The packaged UE4SS runtime is not in an unvalidated state."
              )
            ]
      );
    }
    const validationRuntime =
      runtime.status === "incompatible"
        ? {
            ...runtime,
            status: "unvalidated" as const,
            ue4ss: {
              ...runtime.ue4ss,
              releaseValidation: "UNVALIDATED" as const
            },
            problems: runtime.problems.filter(
              (problem) => problem.severity !== "error"
            )
          }
        : runtime;

    const transactionId = randomUUID();
    const layout = await this.storageService.getLayout();
    const stagingPath = path.join(
      layout.directories.staging,
      `runtime-validation-${transactionId}`
    );

    try {
      await mkdir(stagingPath, { recursive: true });
      const validationRecord = await createRuntimeValidationRecord(stagingPath);
      const validationProfile = createRuntimeValidationProfile(
        validationRecord.manifest.version
      );
      const loadOrder = validateLogicalLoadOrder(validationProfile, [
        validationRecord
      ]);
      const gameLayout = this.gameAdapter.getLayout(discovery);
      const context = {
        transactionId,
        profile: validationProfile,
        installedMods: [validationRecord],
        loadOrder,
        gameInstallPath: discovery.gameInstallPath,
        gameExecutable: discovery.gameExecutable,
        gameFingerprint: currentFingerprint,
        runtimeTargetRelativePath: relativeTargetPath(
          discovery.gameInstallPath,
          gameLayout.runtimePath
        ),
        unrealPakTargetRelativePath: relativeTargetPath(
          discovery.gameInstallPath,
          gameLayout.pakDirectory
        ),
        stagingPath,
        runtime: validationRuntime
      };
      const validation = await ue4ssAdapter.validateEnvironment(context);
      if (!validation.ok) {
        return blockedResult(
          "deploymentError",
          validation.messages.map((message) =>
            modProblem("error", "DEPLOYMENT_VALIDATION_FAILED", message)
          )
        );
      }

      const staged = await this.stageWithAdapters([ue4ssAdapter], context);
      const manifest = await this.applyStagedDeployment({
        staged,
        discovery,
        transactionId
      });

      return DeploymentOperationResultSchema.parse({
        status: "ok",
        state: "runtimeUnvalidated",
        manifest,
        problems: [
          ...runtime.problems.filter((problem) => problem.severity !== "error"),
          ...validation.messages.map((message) =>
            modProblem("warning", "DEPLOYMENT_ADAPTER_MESSAGE", message)
          )
        ]
      });
    } catch (error) {
      const rollback = await this.rollbackActiveTransaction(transactionId);
      return DeploymentOperationResultSchema.parse({
        status: rollback ? "rolledBack" : "failed",
        state: "deploymentError",
        manifest: null,
        problems: [
          modProblem(
            "error",
            "RUNTIME_VALIDATION_DEPLOYMENT_FAILED",
            "CMM could not stage packaged runtime validation.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    } finally {
      await rm(stagingPath, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }

  async prepareUnrealMappingsDumpDeployment(
    discovery: GameDiscovery
  ): Promise<DeploymentOperationResult> {
    if (!discovery.gameInstallPath) {
      return blockedResult("runtimeIncompatible", [
        modProblem(
          "error",
          "GAME_INSTALL_MISSING",
          "Clawed must be detected before CMM can generate Unreal mappings."
        )
      ]);
    }

    const ue4ssAdapter = this.adapters.find((adapter) => adapter.id === "ue4ss");
    if (!ue4ssAdapter) {
      return blockedResult("deploymentError", [
        modProblem(
          "error",
          "DEPLOYMENT_ADAPTER_MISSING",
          "No UE4SS deployment adapter is available for Unreal mappings generation."
        )
      ]);
    }

    const currentFingerprint = await this.gameAdapter.getFingerprint(
      discovery,
      null,
      { mode: "quick" }
    );
    let runtime = await this.runtimeManager.getRuntimeSnapshot(
      currentFingerprint.steamBuildId,
      currentFingerprint.fingerprintSha256
    );

    if (
      !runtime.ue4ss ||
      runtime.ue4ss.source !== "bundled" ||
      runtimeBlocksDeployment(runtime.status)
    ) {
      await this.runtimeManager.ensureBundledUe4ssRuntime();
      runtime = await this.runtimeManager.getRuntimeSnapshot(
        currentFingerprint.steamBuildId,
        currentFingerprint.fingerprintSha256
      );
    }

    if (!runtime.ue4ss || runtime.ue4ss.source !== "bundled") {
      return blockedResult("runtimeIncompatible", [
        modProblem(
          "error",
          "UE4SS_PACKAGED_RUNTIME_REQUIRED",
          "Unreal mappings generation requires the packaged UE4SS runtime."
        )
      ]);
    }

    if (runtimeBlocksDeployment(runtime.status)) {
      return blockedResult("runtimeIncompatible", runtime.problems);
    }

    const transactionId = randomUUID();
    const layout = await this.storageService.getLayout();
    const stagingPath = path.join(
      layout.directories.staging,
      `unreal-mappings-${transactionId}`
    );

    try {
      await mkdir(stagingPath, { recursive: true });
      const dumpRecord = await createUnrealMappingsDumpRecord(stagingPath);
      const dumpProfile = createUnrealMappingsDumpProfile(
        dumpRecord.manifest.version
      );
      const loadOrder = validateLogicalLoadOrder(dumpProfile, [dumpRecord]);
      const gameLayout = this.gameAdapter.getLayout(discovery);
      const context = {
        transactionId,
        profile: dumpProfile,
        installedMods: [dumpRecord],
        loadOrder,
        gameInstallPath: discovery.gameInstallPath,
        gameExecutable: discovery.gameExecutable,
        gameFingerprint: currentFingerprint,
        runtimeTargetRelativePath: relativeTargetPath(
          discovery.gameInstallPath,
          gameLayout.runtimePath
        ),
        unrealPakTargetRelativePath: relativeTargetPath(
          discovery.gameInstallPath,
          gameLayout.pakDirectory
        ),
        stagingPath,
        runtime
      };
      const validation = await ue4ssAdapter.validateEnvironment(context);
      if (!validation.ok) {
        return blockedResult(
          "deploymentError",
          validation.messages.map((message) =>
            modProblem("error", "DEPLOYMENT_VALIDATION_FAILED", message)
          )
        );
      }

      const staged = await this.stageWithAdapters([ue4ssAdapter], context);
      const manifest = await this.applyStagedDeployment({
        staged,
        discovery,
        transactionId
      });

      return DeploymentOperationResultSchema.parse({
        status: "ok",
        state: "runtimeUnvalidated",
        manifest,
        problems: [
          ...runtime.problems.filter((problem) => problem.severity !== "error"),
          ...validation.messages.map((message) =>
            modProblem("warning", "DEPLOYMENT_ADAPTER_MESSAGE", message)
          )
        ]
      });
    } catch (error) {
      const rollback = await this.rollbackActiveTransaction(transactionId);
      return DeploymentOperationResultSchema.parse({
        status: rollback ? "rolledBack" : "failed",
        state: "deploymentError",
        manifest: null,
        problems: [
          modProblem(
            "error",
            "UNREAL_MAPPINGS_DEPLOYMENT_FAILED",
            "CMM could not stage Unreal mappings generation.",
            error instanceof Error ? error.message : String(error)
          )
        ]
      });
    } finally {
      await rm(stagingPath, { recursive: true, force: true }).catch(
        () => undefined
      );
    }
  }

  private async applyStagedDeployment({
    staged,
    discovery,
    transactionId
  }: {
    staged: StagedDeployment;
    discovery: GameDiscovery;
    transactionId: string;
  }): Promise<DeploymentManifest> {
    if (!discovery.gameInstallPath) {
      throw new Error("Game install path is required for deployment.");
    }

    const gameInstallPath = discovery.gameInstallPath;
    const vanillaResult = await this.prepareVanillaDeployment(discovery);
    if (vanillaResult.status !== "ok") {
      const reason =
        vanillaResult.problems[0]?.technicalDetail ??
        vanillaResult.problems[0]?.message ??
        "Existing deployment could not be safely removed.";
      throw new Error(reason);
    }

    const filesCreated: DeploymentFileRecord[] = [];
    const filesModified: DeploymentFileRecord[] = [];
    const backups: DeploymentBackupRecord[] = [];
    const directoriesCreated: DeploymentDirectoryRecord[] = [];
    const directoryKeys = new Set<string>();
    const runtimeGeneratedFiles = await inspectKnownRuntimeGeneratedFiles(
      gameInstallPath,
      staged.runtimeConfiguration
    );
    const operationState = {
      operations: 0
    };

    for (const file of staged.files) {
      validatePlannedFile(gameInstallPath, file);
      const targetPath = path.resolve(gameInstallPath, file.targetRelativePath);
      directoriesCreated.push(
        ...(await collectMissingParentDirectories({
          gameInstallPath,
          directoryPath: path.dirname(targetPath),
          seenKeys: directoryKeys
        }))
      );
      await mkdir(path.dirname(targetPath), { recursive: true });

      const targetExists = await pathExists(targetPath);
      if (targetExists) {
        const backup = await this.backupTarget({
          gameInstallPath,
          targetPath,
          targetRelativePath: file.targetRelativePath,
          transactionId
        });
        backups.push(backup);
        await copyFile(file.sourcePath, targetPath);
        filesModified.push({
          relativePath: file.targetRelativePath,
          absolutePath: targetPath,
          sha256: await hashFileSha256(targetPath),
          action: "modified"
        });
      } else {
        await copyFile(file.sourcePath, targetPath);
        filesCreated.push({
          relativePath: file.targetRelativePath,
          absolutePath: targetPath,
          sha256: await hashFileSha256(targetPath),
          action: "created"
        });
      }

      operationState.operations += 1;
      if (
        this.options.failAfterFileOperations !== undefined &&
        operationState.operations >= this.options.failAfterFileOperations
      ) {
        const partialManifest = await this.createManifest({
          staged,
          discovery,
          transactionId,
          filesCreated,
          filesModified,
          backups,
          directoriesCreated,
          runtimeGeneratedFiles,
          lastVerifiedState: "unknown"
        });
        await this.writeCurrentManifest(partialManifest);
        throw new Error("Injected deployment failure for verification.");
      }
    }

    const manifest = await this.createManifest({
      staged,
      discovery,
      transactionId,
      filesCreated,
      filesModified,
      backups,
      directoriesCreated,
      runtimeGeneratedFiles,
      lastVerifiedState: "applied"
    });
    await this.writeCurrentManifest(manifest);
    return manifest;
  }

  private async createManifest({
    staged,
    discovery,
    transactionId,
    filesCreated,
    filesModified,
    backups,
    directoriesCreated,
    runtimeGeneratedFiles,
    lastVerifiedState
  }: {
    staged: StagedDeployment;
    discovery: GameDiscovery;
    transactionId: string;
    filesCreated: DeploymentFileRecord[];
    filesModified: DeploymentFileRecord[];
    backups: DeploymentBackupRecord[];
    directoriesCreated: DeploymentDirectoryRecord[];
    runtimeGeneratedFiles: RuntimeGeneratedFileRecord[];
    lastVerifiedState: DeploymentManifest["lastVerifiedState"];
  }): Promise<DeploymentManifest> {
    if (!discovery.gameInstallPath) {
      throw new Error("Game install path is required for deployment manifest.");
    }

    const gameInstallPath = discovery.gameInstallPath;
    const gameFingerprint = await this.gameAdapter.getFingerprint(
      discovery,
      null,
      { mode: "quick" }
    );
    return DeploymentManifestSchema.parse({
      schemaVersion: 1,
      id: transactionId,
      profileId: staged.profileId,
      adapterId: staged.adapterId,
      adapterVersion: staged.adapterVersion,
      gameInstallPath,
      gameFingerprint,
      runtimeConfiguration: staged.runtimeConfiguration,
      filesCreated,
      filesModified,
      backups,
      directoriesCreated,
      runtimeGeneratedFiles,
      sourcePackages: staged.sourcePackages,
      deployedAt: new Date().toISOString(),
      lastVerifiedState
    });
  }

  private async backupTarget({
    gameInstallPath,
    targetPath,
    targetRelativePath,
    transactionId
  }: {
    gameInstallPath: string;
    targetPath: string;
    targetRelativePath: string;
    transactionId: string;
  }): Promise<DeploymentBackupRecord> {
    const layout = await this.storageService.getLayout();
    const backupPath = path.join(
      layout.directories.backups,
      "deployments",
      transactionId,
      encodeURIComponent(targetRelativePath)
    );
    await mkdir(path.dirname(backupPath), { recursive: true });
    await copyFile(targetPath, backupPath);
    const originalSha256 = await hashFileSha256(backupPath);

    return {
      relativePath: targetRelativePath,
      originalPath: path.resolve(gameInstallPath, targetRelativePath),
      backupPath,
      originalSha256,
      sha256: originalSha256
    };
  }

  private async undeployManifest(manifest: DeploymentManifest): Promise<void> {
    const createdFiles = [...manifest.filesCreated].reverse();
    for (const file of createdFiles) {
      if (!isPathInside(manifest.gameInstallPath, file.absolutePath)) {
        throw new Error(`Owned file is outside game install: ${file.absolutePath}`);
      }

      const currentHash = await pathExists(file.absolutePath)
        ? await hashFileSha256(file.absolutePath)
        : null;
      if (currentHash && file.sha256 && currentHash !== file.sha256) {
        throw new Error(`CMM-owned file changed after deployment: ${file.relativePath}`);
      }

      await rmWithRetry(file.absolutePath, { force: true });
    }

    const backups = [...manifest.backups].reverse();
    for (const backup of backups) {
      if (!isPathInside(manifest.gameInstallPath, backup.originalPath)) {
        throw new Error(`Backup restore target is outside game install: ${backup.originalPath}`);
      }

      const modifiedFile = manifest.filesModified.find(
        (file) => file.relativePath === backup.relativePath
      );
      const currentHash = await pathExists(backup.originalPath)
        ? await hashFileSha256(backup.originalPath)
        : null;
      if (
        currentHash &&
        modifiedFile?.sha256 &&
        currentHash !== modifiedFile.sha256
      ) {
        throw new Error(`Modified file changed after deployment: ${backup.relativePath}`);
      }

      if ((await hashFileSha256(backup.backupPath)) !== backup.sha256) {
        throw new Error(`Backup hash mismatch: ${backup.relativePath}`);
      }

      await mkdir(path.dirname(backup.originalPath), { recursive: true });
      await copyFile(backup.backupPath, backup.originalPath);
    }

    const cleanup = await cleanupManifestGeneratedArtifacts(manifest);
    const cleanupError = cleanup.problems.find(
      (problem) => problem.severity === "error"
    );
    if (cleanupError) {
      throw new Error(cleanupError.message);
    }
  }

  private async rollbackActiveTransaction(transactionId: string): Promise<boolean> {
    const manifest = await this.readCurrentManifest();
    if (!manifest || manifest.id !== transactionId) {
      return false;
    }

    try {
      await this.undeployManifest(manifest);
      await this.markManifestRolledBack(manifest);
      await rm(await this.getCurrentManifestPath(), { force: true });
      return true;
    } catch {
      return false;
    }
  }

  private async verifyManifestFiles(
    manifest: DeploymentManifest
  ): Promise<ModProblem[]> {
    const problems: ModProblem[] = [];

    for (const file of [...manifest.filesCreated, ...manifest.filesModified]) {
      if (!(await pathExists(file.absolutePath))) {
        problems.push(
          modProblem(
            "error",
            "DEPLOYED_FILE_MISSING",
            `${file.relativePath} is recorded as deployed but is missing.`
          )
        );
        continue;
      }

      if (file.sha256 && (await hashFileSha256(file.absolutePath)) !== file.sha256) {
        problems.push(
          modProblem(
            "error",
            "DEPLOYED_FILE_CHANGED",
            `${file.relativePath} changed after CMM deployed it.`
          )
        );
      }
    }

    return problems;
  }

  private async writeCurrentManifest(manifest: DeploymentManifest): Promise<void> {
    const layout = await this.storageService.getLayout();
    const manifestPath = path.join(
      layout.directories.runtime,
      "deployments",
      manifest.id,
      "manifest.json"
    );
    await atomicWriteJson(manifestPath, manifest);
    await atomicWriteJson(await this.getCurrentManifestPath(), manifest);
  }

  private async markManifestRolledBack(
    manifest: DeploymentManifest
  ): Promise<void> {
    const updatedManifest = DeploymentManifestSchema.parse({
      ...manifest,
      lastVerifiedState: "rolledBack"
    });
    const layout = await this.storageService.getLayout();
    await atomicWriteJson(
      path.join(
        layout.directories.runtime,
        "deployments",
        manifest.id,
        "manifest.json"
      ),
      updatedManifest
    );
  }

  private async readCurrentManifest(): Promise<DeploymentManifest | null> {
    try {
      return DeploymentManifestSchema.parse(
        JSON.parse(await readFile(await this.getCurrentManifestPath(), "utf8"))
      );
    } catch {
      return null;
    }
  }

  private async getCurrentManifestPath(): Promise<string> {
    const layout = await this.storageService.getLayout();
    return path.join(
      layout.directories.runtime,
      "deployments",
      CURRENT_MANIFEST_FILENAME
    );
  }

  private async stageWithAdapters(
    adapters: DeploymentAdapterContract[],
    context: Parameters<DeploymentAdapterContract["stage"]>[0]
  ): Promise<StagedDeployment> {
    const stagedDeployments = await Promise.all(
      adapters.map((adapter) => adapter.stage(context))
    );
    const files = mergePlannedFiles(stagedDeployments);
    const sourcePackages = uniqueSourcePackages(stagedDeployments);
    const adapterIds = stagedDeployments.map((staged) => staged.adapterId);

    return {
      adapterId: adapterIds.length === 1 ? adapterIds[0] : "composite",
      adapterVersion:
        stagedDeployments.length === 1
          ? stagedDeployments[0].adapterVersion
          : stagedDeployments
              .map((staged) => `${staged.adapterId}@${staged.adapterVersion}`)
              .join("+"),
      profileId: context.profile.id,
      stagedPath: context.stagingPath,
      files,
      runtimeConfiguration:
        stagedDeployments.length === 1
          ? stagedDeployments[0].runtimeConfiguration
          : {
              type: "composite",
              releaseValidation: "UNVALIDATED",
              adapters: Object.fromEntries(
                stagedDeployments.map((staged) => [
                  staged.adapterId,
                  staged.runtimeConfiguration
                ])
              )
            },
      sourcePackages,
      messages: stagedDeployments.flatMap((staged) => staged.messages)
    };
  }

  private createAdapterPlan(
    profile: { selectedMods: Record<string, { enabled: boolean; version: string }> },
    installedMods: InstalledModManifestRecord[]
  ): {
    adapters: DeploymentAdapterContract[];
    problems: ModProblem[];
    requiresRuntime: boolean;
  } {
    const enabledRecords = getEnabledInstalledRecords(profile, installedMods);
    const loaderIds = new Set(enabledRecords.map((record) => record.manifest.loader));
    const problems: ModProblem[] = [];

    if (loaderIds.has("unknown")) {
      problems.push(
        modProblem(
          "error",
          "UNKNOWN_LOADER_ENABLED",
          "At least one enabled mod uses an unknown loader and cannot be deployed."
        )
      );
    }

    const adapters = this.adapters.filter((adapter) =>
      loaderIds.has(adapter.id as ModLoader)
    );
    for (const loader of loaderIds) {
      if (
        loader !== "unknown" &&
        !this.adapters.some((adapter) => adapter.id === loader)
      ) {
        problems.push(
          modProblem(
            "error",
            "DEPLOYMENT_ADAPTER_MISSING",
            `No deployment adapter is available for ${loader} mods.`
          )
        );
      }
    }

    return {
      adapters,
      problems,
      requiresRuntime: adapters.some((adapter) => adapter.capabilities.requiresRuntime)
    };
  }
}

function validatePlannedFile(
  gameInstallPath: string,
  file: PlannedDeploymentFile
): void {
  if (
    path.isAbsolute(file.targetRelativePath) ||
    file.targetRelativePath.includes("\0")
  ) {
    throw new Error(`Deployment target is not relative: ${file.targetRelativePath}`);
  }

  const targetPath = path.resolve(gameInstallPath, file.targetRelativePath);
  if (!isPathInside(gameInstallPath, targetPath)) {
    throw new Error(`Deployment target escapes game install: ${file.targetRelativePath}`);
  }
}

function blockedResult(
  state: DeploymentOperationResult["state"],
  problems: ModProblem[]
): DeploymentOperationResult {
  return DeploymentOperationResultSchema.parse({
    status: "blocked",
    state,
    manifest: null,
    problems
  });
}

function loadOrderProblemToModProblem(problem: {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  technicalDetail?: string;
}): ModProblem {
  return {
    severity: problem.severity === "ERROR" ? "error" : "warning",
    code: problem.code,
    message: problem.message,
    technicalDetail: problem.technicalDetail
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  return stat(targetPath)
    .then(() => true)
    .catch(() => false);
}

function relativeTargetPath(
  gameInstallPath: string,
  targetPath: string | null
): string | null {
  if (!targetPath || !isPathInside(gameInstallPath, targetPath)) {
    return null;
  }

  const relative = path.relative(gameInstallPath, targetPath);
  return relative.length > 0 ? relative : null;
}

function getEnabledInstalledRecords(
  profile: { selectedMods: Record<string, { enabled: boolean; version: string }> },
  installedMods: InstalledModManifestRecord[]
): InstalledModManifestRecord[] {
  return installedMods.filter((record) => {
    const selection = profile.selectedMods[record.manifest.id];
    return (
      selection?.enabled === true &&
      selection.version === record.manifest.version
    );
  });
}

async function createRuntimeValidationRecord(
  stagingPath: string
): Promise<InstalledModManifestRecord> {
  const now = new Date().toISOString();
  const packageRoot = path.join(stagingPath, "runtime-validation-package");
  const packagePath = path.join(
    packageRoot,
    `${PACKAGED_RUNTIME_VALIDATION_MOD_ID}.clawedmod`
  );
  const payloadPath = path.join(
    packageRoot,
    "payload",
    "Mods",
    PACKAGED_RUNTIME_VALIDATION_MOD_ID,
    "Scripts",
    "main.lua"
  );
  await mkdir(path.dirname(payloadPath), { recursive: true });
  await writeFile(payloadPath, packagedRuntimeValidationLua());
  await writeFile(packagePath, "internal packaged runtime validation package\n");

  const manifest = {
    schemaVersion: 1 as const,
    id: PACKAGED_RUNTIME_VALIDATION_MOD_ID,
    name: "CMM Packaged Runtime Validation",
    version: timestampForVersion(now),
    author: "Clawed Mod Manager",
    description: "Temporary read-only marker for packaged UE4SS validation.",
    game: "clawed" as const,
    loader: "ue4ss" as const,
    dependencies: [],
    conflicts: [],
    loadAfter: [],
    loadBefore: []
  };

  return InstalledModManifestRecordSchema.parse({
    mod: {
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      author: manifest.author,
      description: manifest.description,
      loader: manifest.loader,
      sha256: await hashFileSha256(packagePath),
      enabled: true,
      installPath: packageRoot,
      packagePath,
      iconDataUrl: null,
      hasReadme: false,
      status: "ready",
      problems: [],
      installedAt: now
    },
    manifest
  });
}

function createRuntimeValidationProfile(version: string) {
  const now = new Date().toISOString();
  return ProfileSchema.parse({
    schemaVersion: 1,
    id: "cmm-runtime-validation",
    name: "CMM Runtime Validation",
    createdAt: now,
    updatedAt: now,
    selectedMods: {
      [PACKAGED_RUNTIME_VALIDATION_MOD_ID]: {
        modId: PACKAGED_RUNTIME_VALIDATION_MOD_ID,
        version,
        enabled: true,
        config: {}
      }
    },
    orderedModIds: [PACKAGED_RUNTIME_VALIDATION_MOD_ID],
    preferredLaunchMode: "MODDED"
  });
}

async function createUnrealMappingsDumpRecord(
  stagingPath: string
): Promise<InstalledModManifestRecord> {
  const now = new Date().toISOString();
  const packageRoot = path.join(stagingPath, "unreal-mappings-package");
  const packagePath = path.join(
    packageRoot,
    `${UNREAL_MAPPINGS_DUMP_MOD_ID}.clawedmod`
  );
  const payloadPath = path.join(
    packageRoot,
    "payload",
    "Mods",
    UNREAL_MAPPINGS_DUMP_MOD_ID,
    "Scripts",
    "main.lua"
  );
  await mkdir(path.dirname(payloadPath), { recursive: true });
  await writeFile(payloadPath, unrealMappingsDumpLua());
  await writeFile(packagePath, "internal Unreal mappings dump package\n");

  const manifest = {
    schemaVersion: 1 as const,
    id: UNREAL_MAPPINGS_DUMP_MOD_ID,
    name: "CMM Unreal Mappings Dump",
    version: timestampForVersion(now),
    author: "Clawed Mod Manager",
    description: "Temporary UE4SS task that asks Clawed to generate Mappings.usmap.",
    game: "clawed" as const,
    loader: "ue4ss" as const,
    dependencies: [],
    conflicts: [],
    loadAfter: [],
    loadBefore: []
  };

  return InstalledModManifestRecordSchema.parse({
    mod: {
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      author: manifest.author,
      description: manifest.description,
      loader: manifest.loader,
      sha256: await hashFileSha256(packagePath),
      enabled: true,
      installPath: packageRoot,
      packagePath,
      iconDataUrl: null,
      hasReadme: false,
      status: "ready",
      problems: [],
      installedAt: now
    },
    manifest
  });
}

function createUnrealMappingsDumpProfile(version: string) {
  const now = new Date().toISOString();
  return ProfileSchema.parse({
    schemaVersion: 1,
    id: "cmm-unreal-mappings-dump",
    name: "CMM Unreal Mappings Dump",
    createdAt: now,
    updatedAt: now,
    selectedMods: {
      [UNREAL_MAPPINGS_DUMP_MOD_ID]: {
        modId: UNREAL_MAPPINGS_DUMP_MOD_ID,
        version,
        enabled: true,
        config: {}
      }
    },
    orderedModIds: [UNREAL_MAPPINGS_DUMP_MOD_ID],
    preferredLaunchMode: "MODDED"
  });
}

function timestampForVersion(timestamp: string): string {
  return timestamp.replace(/[-:.TZ]/g, "").slice(0, 14);
}

function mergePlannedFiles(
  stagedDeployments: StagedDeployment[]
): PlannedDeploymentFile[] {
  const byTarget = new Map<string, PlannedDeploymentFile>();

  for (const staged of stagedDeployments) {
    for (const file of staged.files) {
      const key = path.normalize(file.targetRelativePath).toLowerCase();
      const existing = byTarget.get(key);
      if (existing) {
        if (
          existing.sha256 &&
          file.sha256 &&
          existing.sha256 !== file.sha256
        ) {
          throw new Error(
            `Multiple deployment adapters target ${file.targetRelativePath} with different bytes.`
          );
        }
        continue;
      }

      byTarget.set(key, file);
    }
  }

  return [...byTarget.values()];
}

function uniqueSourcePackages(
  stagedDeployments: StagedDeployment[]
): StagedDeployment["sourcePackages"] {
  const byIdentity = new Map<string, StagedDeployment["sourcePackages"][number]>();

  for (const staged of stagedDeployments) {
    for (const sourcePackage of staged.sourcePackages) {
      byIdentity.set(
        `${sourcePackage.id}\0${sourcePackage.version}\0${sourcePackage.sha256}`,
        sourcePackage
      );
    }
  }

  return [...byIdentity.values()];
}

function discoveryFromManifest(manifest: DeploymentManifest): GameDiscovery {
  return {
    appId: CLAWED_STEAM_APP_ID,
    steamPath: null,
    steamLibrary: null,
    steamLibraries: [],
    appManifestPath: manifest.gameFingerprint.appManifestPath ?? null,
    gameInstallPath: manifest.gameInstallPath,
    gameExecutable: manifest.gameFingerprint.executablePath ?? null,
    discoveryStatus: "READY",
    source: "manual",
    manualOverride: null,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}

function manifestRequiresRuntime(manifest: DeploymentManifest): boolean {
  const configuration = manifest.runtimeConfiguration;
  if (configuration.type === "ue4ss") {
    return true;
  }

  if (
    configuration.type === "composite" &&
    typeof configuration.adapters === "object" &&
    configuration.adapters !== null
  ) {
    return Object.prototype.hasOwnProperty.call(
      configuration.adapters,
      "ue4ss"
    );
  }

  return false;
}

function isRuntimeValidationManifest(manifest: DeploymentManifest): boolean {
  const configuration = manifest.runtimeConfiguration;
  return (
    manifest.profileId === "cmm-runtime-validation" &&
    configuration.type === "ue4ss" &&
    Array.isArray(configuration.logicalOrder) &&
    configuration.logicalOrder.length === 1 &&
    configuration.logicalOrder[0] === PACKAGED_RUNTIME_VALIDATION_MOD_ID
  );
}

function runtimeBlocksDeployment(status: RuntimeStatus): boolean {
  return (
    status === "missing" ||
    status === "invalid" ||
    status === "incompatible"
  );
}

function autoRuntimeUpdateDisabledProblem(): ModProblem {
  return modProblem(
    "warning",
    "UE4SS_AUTO_RUNTIME_UPDATE_DISABLED",
    "Automatic packaged runtime updates are disabled.",
    "Use Settings to install the packaged UE4SS runtime or import a different runtime manually."
  );
}

function defaultDeploymentSettings(): AppSettings {
  return {
    manualGameDirectory: null,
    autoUpdatePackagedRuntime: true,
    autoValidatePackagedRuntime: false
  };
}

function runtimeConfigurationMessages(manifest: DeploymentManifest): ModProblem[] {
  const messages = extractRuntimeMessages(manifest.runtimeConfiguration);
  return messages.map((message) =>
    modProblem("warning", "RUNTIME_ORDER_UNVALIDATED", message)
  );
}

function extractRuntimeMessages(configuration: Record<string, unknown>): string[] {
  const directMessages = Array.isArray(configuration.messages)
    ? configuration.messages.filter((message): message is string => typeof message === "string")
    : [];
  const adapterMessages =
    configuration.type === "composite" &&
    typeof configuration.adapters === "object" &&
    configuration.adapters !== null
      ? Object.values(configuration.adapters).flatMap((adapterConfiguration) =>
          typeof adapterConfiguration === "object" &&
          adapterConfiguration !== null
            ? extractRuntimeMessages(
                adapterConfiguration as Record<string, unknown>
              )
            : []
        )
      : [];

  return [...directMessages, ...adapterMessages];
}
