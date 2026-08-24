import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { ClawedGameAdapter } from "../../src/main/adapters/clawed/clawedGameAdapter";
import { LooseFileDeploymentAdapter } from "../../src/main/adapters/unreal/looseFileDeploymentAdapter";
import { PakDeploymentAdapter } from "../../src/main/adapters/unreal/pakDeploymentAdapter";
import { UE4SSDeploymentAdapter } from "../../src/main/adapters/ue4ss/ue4ssDeploymentAdapter";
import { ClawedModPackageService } from "../../src/main/services/clawedModPackageService";
import { LocalDeploymentService } from "../../src/main/services/deploymentService";
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
const modId = "PlayerNamesFix";

class FakeStorageService implements StorageServiceContract {
  constructor(private readonly layout: AppStorageLayout) {}

  async getLayout(): Promise<AppStorageLayout> {
    return ensureStorageLayout(this.layout);
  }
}

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot !== null) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("PlayerNamesFix package", () => {
  it("generates and deploys through the normal UE4SS package flow", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "cmm-name-repair-"));
    const outputDir = path.join(tempRoot, "prototype-mods");
    await execFileAsync(
      process.execPath,
      [path.resolve("scripts", "createPlayerNameRepairPackage.mjs")],
      {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          CMM_CLAWED_STEAM_BUILD_ID: "test-build",
          CMM_PLAYER_NAME_REPAIR_OUTPUT_DIR: outputDir,
          CMM_PLAYER_NAME_REPAIR_SKIP_UNPACKED: "1"
        }
      }
    );

    const packagePath = path.join(outputDir, `${modId}.clawedmod`);
    const packageService = new ClawedModPackageService();
    const parsed = await packageService.parsePackage(packagePath);
    const lua = await parsed.zip
      .file(`payload/Mods/${modId}/Scripts/main.lua`)!
      .async("string");
    const readme = await parsed.zip.file("README.md")!.async("string");

    expect(parsed.manifest).toMatchObject({
      id: modId,
      loader: "ue4ss",
      game: "clawed",
      creatorAssets: {
        supportedSteamBuilds: [
          {
            buildId: "test-build",
            status: "untested"
          }
        ]
      }
    });
    expect(parsed.hasChecksums).toBe(true);
    expect(lua).toContain("[PlayerNamesFix]");
    expect(lua).toContain("SetPlayerName");
    expect(lua).toContain("PlayerNamePrivate");
    expect(lua).toContain("AdvancedSteamFriendsLibrary");
    expect(lua).toContain("cmm_repair_names");
    expect(lua).toContain("Player Name");
    expect(lua).not.toContain("io.open");
    expect(readme).toContain("Does not read Steam account files");
    expect(readme).toContain("Death-time repair");

    const storageService = new FakeStorageService(createStorageLayout(tempRoot));
    const modLibraryService = new LocalModLibraryService(
      storageService,
      packageService
    );
    const profileService = new LocalProfileService(
      storageService,
      modLibraryService
    );
    const runtimeManager = new LocalRuntimeManager(storageService);
    const runtimeZip = await createNestedRuntimeZip(
      path.join(tempRoot, "fixtures", "UE4SS.zip")
    );
    const runtimeResult = await runtimeManager.importUe4ssRuntime({
      sourcePath: runtimeZip
    });
    expect(runtimeResult.status).toBe("imported");
    expect((await modLibraryService.importModPackage({ packagePath })).status).toBe(
      "installed"
    );
    expect(
      await profileService.setModEnabled({
        id: modId,
        version: parsed.manifest.version,
        enabled: true
      })
    ).toMatchObject({ status: "ok" });

    const deploymentService = new LocalDeploymentService(
      storageService,
      modLibraryService,
      profileService,
      new LocalLoadOrderService(profileService),
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
    const discovery = await createReleaseLayoutFakeGame(tempRoot);
    const deployment = await deploymentService.prepareModdedDeployment(discovery);
    const runtimeRoot = path.join(
      discovery.gameInstallPath!,
      "Clawed",
      "Binaries",
      "Win64"
    );
    const deployedLua = await readFile(
      path.join(runtimeRoot, "ue4ss", "Mods", modId, "Scripts", "main.lua"),
      "utf8"
    );
    const modsTxt = await readFile(
      path.join(runtimeRoot, "ue4ss", "Mods", "mods.txt"),
      "utf8"
    );

    expect(deployment.status).toBe("ok");
    expect(deployment.manifest?.adapterId).toBe("ue4ss");
    expect(deployedLua).toContain("repair_wait");
    expect(modsTxt).toContain(`${modId} : 1`);
  });
});

async function createNestedRuntimeZip(outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const zip = new JSZip();
  zip.file("dwmapi.dll", "fake proxy dll");
  zip.file("ue4ss/UE4SS.dll", "fake nested ue4ss dll");
  zip.file("ue4ss/UE4SS-settings.ini", "[UE4SS]\n");
  zip.file("ue4ss/Mods/mods.txt", "BPModLoaderMod : 1\nKeybinds : 1\n");
  await writeFile(outputPath, await zip.generateAsync({ type: "nodebuffer" }));
  return outputPath;
}

async function createReleaseLayoutFakeGame(root: string): Promise<GameDiscovery> {
  const gameInstallPath = path.join(root, "fake-release-game");
  const gameExecutable = path.join(
    gameInstallPath,
    "Clawed",
    "Binaries",
    "Win64",
    "Clawed-Win64-Shipping.exe"
  );
  await mkdir(path.dirname(gameExecutable), { recursive: true });
  await writeFile(gameExecutable, "fake release executable");

  return {
    appId: CLAWED_STEAM_APP_ID,
    steamPath: path.join(root, "Steam"),
    steamLibrary: root,
    steamLibraries: [{ path: root, appManifestPath: null }],
    appManifestPath: null,
    gameInstallPath,
    gameExecutable,
    discoveryStatus: "READY",
    source: "manual",
    manualOverride: gameInstallPath,
    diagnosticErrors: [],
    discoveredAt: new Date().toISOString()
  };
}
