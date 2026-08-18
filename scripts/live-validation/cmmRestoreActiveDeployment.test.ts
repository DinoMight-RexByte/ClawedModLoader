import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ClawedGameAdapter } from "../../src/main/adapters/clawed/clawedGameAdapter";
import { LooseFileDeploymentAdapter } from "../../src/main/adapters/unreal/looseFileDeploymentAdapter";
import { PakDeploymentAdapter } from "../../src/main/adapters/unreal/pakDeploymentAdapter";
import { UE4SSDeploymentAdapter } from "../../src/main/adapters/ue4ss/ue4ssDeploymentAdapter";
import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalDeploymentService } from "../../src/main/services/deploymentService";
import { findUnrealShippingExecutable } from "../../src/main/services/gameExecutableDiscovery";
import { NullLifecycleLogger } from "../../src/main/services/lifecycleLogger";
import { LocalModLibraryService } from "../../src/main/services/modLibraryService";
import {
  LocalLoadOrderService,
  LocalProfileService
} from "../../src/main/services/profileService";
import { LocalRuntimeManager } from "../../src/main/services/runtimeManager";
import {
  createStorageLayout,
  ensureStorageLayout
} from "../../src/main/services/storageLayout";
import {
  CLAWED_STEAM_APP_ID,
  DeploymentManifestSchema,
  type AppStorageLayout,
  type GameDiscovery
} from "../../src/shared/contracts/app";
import type { StorageServiceContract } from "../../src/shared/contracts/services";

const restoreEnabled = process.env.CMM_LIVE_CLAWED_RESTORE === "1";

class RestoreStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

describe.runIf(restoreEnabled)("live CMM deployment restore", () => {
  it("restores the active deployment from an isolated user-data root", async () => {
    const userDataRoot = process.env.CMM_LIVE_CLAWED_RESTORE_USER_DATA_DIR;
    expect(userDataRoot).toBeTruthy();

    const storageService = new RestoreStorageService(
      createStorageLayout(path.resolve(userDataRoot!))
    );
    const manifest = DeploymentManifestSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            userDataRoot!,
            "runtime",
            "deployments",
            "current-deployment.json"
          ),
          "utf8"
        )
      )
    );
    const gameExecutable =
      manifest.gameFingerprint.executablePath ??
      (await findUnrealShippingExecutable(manifest.gameInstallPath));
    const discovery = createDiscovery(manifest.gameInstallPath, gameExecutable);
    const packageService = new ClawedModPackageService();
    const modLibraryService = new LocalModLibraryService(
      storageService,
      packageService
    );
    const profileService = new LocalProfileService(
      storageService,
      modLibraryService
    );
    const loadOrderService = new LocalLoadOrderService(profileService);
    const runtimeManager = new LocalRuntimeManager(storageService);
    const deploymentService = new LocalDeploymentService(
      storageService,
      modLibraryService,
      profileService,
      loadOrderService,
      runtimeManager,
      [
        new UE4SSDeploymentAdapter(),
        new PakDeploymentAdapter(),
        new LooseFileDeploymentAdapter()
      ],
      new NullLifecycleLogger(),
      {},
      new ClawedGameAdapter()
    );

    const result = await deploymentService.prepareVanillaDeployment(discovery);
    expect(result.status).toBe("ok");
    expect(result.state).toBe("vanillaReady");
  });
});

function createDiscovery(
  installPath: string,
  gameExecutable: string | null
): GameDiscovery {
  return {
    appId: CLAWED_STEAM_APP_ID,
    steamPath: null,
    steamLibrary: null,
    steamLibraries: [],
    appManifestPath: null,
    gameInstallPath: installPath,
    gameExecutable,
    discoveryStatus: "READY",
    source: "manual",
    manualOverride: installPath,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}
