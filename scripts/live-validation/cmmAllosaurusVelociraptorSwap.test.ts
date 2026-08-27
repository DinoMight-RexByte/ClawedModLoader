import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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
  type AppStorageLayout,
  type GameDiscovery
} from "../../src/shared/contracts/app";
import type { StorageServiceContract } from "../../src/shared/contracts/services";

const execFileAsync = promisify(execFile);
const liveEnabled = process.env.CMM_LIVE_CLAWED_ALLOSAURUS_SWAP === "1";
const packagePath = path.resolve(
  process.env.CMM_ALLOSAURUS_SWAP_PACKAGE ??
    "release/prototype-mods/ClawedAllosaurusVelociraptorSwap.clawedmod"
);
const userDataRoot = path.resolve(
  process.env.CMM_ALLOSAURUS_SWAP_USER_DATA_DIR ??
    path.join(process.env.APPDATA ?? "", "clawed-mod-manager")
);
const installPath = path.resolve(
  process.env.CMM_LIVE_CLAWED_INSTALL ??
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Clawed"
);
const evidenceRoot = path.resolve(
  process.env.CMM_ALLOSAURUS_SWAP_DEPLOY_EVIDENCE_ROOT ??
    path.join(".codex", "manual-validation", `${timestampForPath()}-allosaurus-velociraptor-deploy`)
);

class StorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

describe.runIf(liveEnabled)("live Allosaurus velociraptor swap deployment", () => {
  it("imports, enables, and deploys the generated package through CMM services", async () => {
    await mkdir(evidenceRoot, { recursive: true });
    const gameExecutable = await findUnrealShippingExecutable(installPath);
    expect(gameExecutable).toBeTruthy();
    const initialProcesses = await getClawedProcesses();
    await writeJson(path.join(evidenceRoot, "initial-processes.json"), {
      processes: initialProcesses
    });
    expect(initialProcesses).toEqual([]);

    const storageService = new StorageService(createStorageLayout(userDataRoot));
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

    const discovery = createDiscovery(installPath, gameExecutable);
    const parsed = await packageService.parsePackage(packagePath);
    expect(parsed.manifest.id).toBe("ClawedAllosaurusVelociraptorSwap");
    expect(parsed.manifest.loader).toBe("pak");

    let imported = await modLibraryService.importModPackage({ packagePath });
    if (
      imported.status === "needsReplacementConfirmation" &&
      imported.packageIdentityId
    ) {
      imported = await modLibraryService.importModPackage({
        packagePath,
        replacement: {
          action: "replaceMatchingIdentity",
          packageIdentityId: imported.packageIdentityId
        }
      });
    }
    expect(["installed", "alreadyInstalled"]).toContain(imported.status);
    expect(imported.mod).toBeTruthy();

    const enabled = await profileService.setModEnabled({
      id: parsed.manifest.id,
      version: parsed.manifest.version,
      enabled: true
    });
    expect(enabled.status).toBe("ok");

    const activeProfile = await profileService.getActiveProfile();
    await writeJson(path.join(evidenceRoot, "active-profile.json"), activeProfile);
    const deployment = await deploymentService.prepareModdedDeployment(discovery);
    await writeJson(path.join(evidenceRoot, "deployment-result.json"), deployment);
    expect(deployment.status).toBe("ok");
    expect(deployment.state).toBe("moddedReady");

    const deployedPakFiles =
      deployment.manifest?.filesCreated
        .map((file) => file.relativePath)
        .filter((relativePath) =>
          [".pak", ".utoc", ".ucas"].includes(
            path.extname(relativePath).toLowerCase()
          )
        ) ?? [];
    await writeJson(path.join(evidenceRoot, "deployed-pak-files.json"), {
      files: deployedPakFiles
    });
    expect(deployedPakFiles).toHaveLength(3);
    expect(deployedPakFiles.every((file) => file.includes("Clawed-zz-CMM"))).toBe(
      true
    );
    expect(
      deployedPakFiles.some((file) =>
        file.includes("ClawedAllosaurusVelociraptorSwap")
      )
    ).toBe(true);
  });
});

function createDiscovery(
  gameInstallPath: string,
  gameExecutable: string | null
): GameDiscovery {
  const steamAppsPath = path.dirname(path.dirname(gameInstallPath));
  const steamLibraryPath = path.dirname(steamAppsPath);
  return {
    appId: CLAWED_STEAM_APP_ID,
    steamPath: steamLibraryPath,
    steamLibrary: steamLibraryPath,
    steamLibraries: [
      {
        path: steamLibraryPath,
        appManifestPath: path.join(
          steamAppsPath,
          `appmanifest_${CLAWED_STEAM_APP_ID}.acf`
        )
      }
    ],
    appManifestPath: path.join(
      steamAppsPath,
      `appmanifest_${CLAWED_STEAM_APP_ID}.acf`
    ),
    gameInstallPath,
    gameExecutable,
    discoveryStatus: "READY",
    source: "manual",
    manualOverride: gameInstallPath,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}

async function getClawedProcesses() {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$p=@(Get-Process | Where-Object { $_.ProcessName -eq 'Clawed-Win64-Shipping' } | Select-Object Id,ProcessName,MainWindowTitle); if ($p.Count -eq 0) { '[]' } else { $p | ConvertTo-Json -Compress }"
    ],
    { encoding: "utf8", windowsHide: true }
  );
  const parsed = JSON.parse(stdout.trim() || "[]") as unknown[] | Record<string, unknown>;
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function writeJson(outputPath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function timestampForPath(): string {
  return new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}
