import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";

describe("release build config", () => {
  it("keeps validation harnesses and evidence out of packaged inputs", () => {
    const build = packageJson.build;
    const packagedInputs = [
      ...build.files,
      ...build.extraResources.map((resource) => resource.from)
    ];

    expect(packagedInputs).toEqual([
      "dist/**/*",
      "package.json",
      "assets/branding",
      "assets/runtime",
      "assets/unreal-decoder",
      "assets/clawed-game-file-map/20260814-current",
      "release/official-launch-mods",
      "release/prototype-mods"
    ]);

    for (const blocked of [
      ".codex/clawed-game-file-map",
      ".codex/live-validation",
      ".codex/pak-order-fixture",
      ".codex/fixture-candidates",
      ".codex/scratch",
      "live-validation",
      "scripts/live-validation",
      "tests",
      "docs",
      "coverage",
      "playwright-report",
      "test-results"
    ]) {
      expect(packagedInputs.join("\n")).not.toContain(blocked);
    }

    expect(build.extraResources).toContainEqual({
      from: "assets/unreal-decoder",
      to: "unreal-decoder",
      filter: ["**/*", "!*.pdb"]
    });
    expect(build.extraResources).toContainEqual({
      from: "assets/clawed-game-file-map/20260814-current",
      to: "clawed-game-file-map/20260814-current"
    });
    expect(build.extraResources).toContainEqual({
      from: "release/official-launch-mods",
      to: "available-mods/official-launch-mods",
      filter: ["**/*"]
    });
    expect(build.extraResources).toContainEqual({
      from: "release/prototype-mods",
      to: "available-mods/prototype-mods",
      filter: ["**/*"]
    });
  });

  it("keeps the official launch mod bundle as an explicit packaging step", () => {
    const officialLaunchScript = readFileSync(
      "scripts/createOfficialLaunchBundle.mjs",
      "utf8"
    );

    expect(packageJson.scripts.package).toContain("npm run build:unreal-decoder");
    expect(packageJson.scripts.dist).toContain("npm run build:unreal-decoder");
    expect(packageJson.scripts["package:official-launch-mods"]).toBe(
      "node scripts/createOfficialLaunchBundle.mjs"
    );
    expect(packageJson.scripts["package:official-launch"]).toBe(
      "npm run package && npm run package:official-launch-mods"
    );
    expect(officialLaunchScript).toContain(
      "CMM_OFFICIAL_LAUNCH_SKIP_TEXTURE_OVERRIDE"
    );
  });

  it("includes all app-bundled available mods in package commands", () => {
    expect(packageJson.scripts["package:available-mods"]).toBe(
      "npm run package:official-launch-mods && npm run package:coop-session-guard && npm run package:coop-catchup && npm run package:coop-capacity8 && npm run package:player-name-repair && npm run package:save-backup"
    );
    expect(packageJson.scripts["package:available-mods:github"]).toBe(
      "cross-env CMM_OFFICIAL_LAUNCH_SKIP_TEXTURE_OVERRIDE=1 npm run package:available-mods"
    );
    expect(packageJson.scripts["package:manual-qa"]).toBe(
      "npm run package:manual-smoke && npm run package:manual-logo-test && node scripts/createManualQaReadme.mjs"
    );
    expect(packageJson.scripts.package).toContain("npm run package:available-mods");
    expect(packageJson.scripts.dist).toContain("npm run package:available-mods");
    expect(packageJson.scripts.package).toContain("npm run verify:packaged-resources");
    expect(packageJson.scripts.dist).toContain("npm run verify:packaged-resources");
    expect(packageJson.scripts.package.indexOf("npm run package:available-mods")).toBeLessThan(
      packageJson.scripts.package.indexOf("electron-builder")
    );
    expect(packageJson.scripts.dist.indexOf("npm run package:available-mods")).toBeLessThan(
      packageJson.scripts.dist.indexOf("electron-builder")
    );
    expect(packageJson.scripts.package.indexOf("npm run verify:packaged-resources")).toBeLessThan(
      packageJson.scripts.package.indexOf("electron-builder")
    );
    expect(packageJson.scripts.dist.indexOf("npm run verify:packaged-resources")).toBeLessThan(
      packageJson.scripts.dist.indexOf("electron-builder")
    );
    expect(packageJson.scripts["package:available-mods"]).not.toContain(
      "package:coop-reliability-plugin"
    );
    expect(packageJson.scripts["package:available-mods"]).not.toContain(
      "package:optimization-dev-plugins"
    );
    expect(packageJson.scripts["package:available-mods"]).not.toContain(
      "package:manual-qa"
    );
  });

  it("publishes app updates only through the explicit GitHub release command", () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "https://github.com/DinoMight-RexByte/ClawedModLoader.git"
    });
    expect(packageJson.build.artifactName).toBe(
      "CMM-${version}-Portable_${os}-${arch}.${ext}"
    );
    expect(packageJson.build.nsis.artifactName).toBe(
      "Clawed-Mod-Manager-Installer_${os}-${arch}.${ext}"
    );
    expect(packageJson.build.publish).toEqual([
      {
        provider: "github",
        owner: "DinoMight-RexByte",
        repo: "ClawedModLoader",
        releaseType: "release"
      }
    ]);
    expect(packageJson.scripts.dist).toContain("--publish never");
    expect(packageJson.scripts.release).toBe("node scripts/runReleaseFlow.mjs");
    expect(packageJson.scripts["release:github"]).toContain("--publish always");
    expect(packageJson.scripts["release:github"]).toContain(
      "requireWindowsCodeSigningCredentials"
    );
    expect(packageJson.scripts["release:github"]).toContain(
      "--config.forceCodeSigning=true"
    );
    expect(packageJson.scripts["release:github"]).toContain(
      "npm run package:available-mods:github"
    );
    expect(packageJson.scripts["release:github"]).toContain(
      "npm run verify:packaged-resources"
    );
    expect(packageJson.scripts["release:github"]).not.toContain(
      "npm run package:available-mods &&"
    );
    expect(packageJson.scripts["release:github"]).not.toContain("package:manual-qa");
    expect(packageJson.scripts["release:github"]).not.toContain(
      "package:manual-logo-test"
    );
    expect(
      packageJson.scripts["release:github"].indexOf(
        "npm run package:available-mods:github"
      )
    ).toBeLessThan(packageJson.scripts["release:github"].indexOf("electron-builder"));
    expect(
      packageJson.scripts["release:github"].indexOf(
        "npm run verify:packaged-resources"
      )
    ).toBeLessThan(packageJson.scripts["release:github"].indexOf("electron-builder"));
    expect(packageJson.build.win.verifyUpdateCodeSignature).toBe(false);
    expect(packageJson.build.win.signtoolOptions).toEqual({
      signingHashAlgorithms: ["sha256"],
      rfc3161TimeStampServer: "http://timestamp.digicert.com",
      timeStampServer: "http://timestamp.digicert.com"
    });
  });

  it("documents the version flag for the local release command", () => {
    const releaseScript = readFileSync("scripts/runReleaseFlow.mjs", "utf8");

    expect(releaseScript).toContain("npm run release -- -v <x.y.z>");
    expect(releaseScript).toContain("--version <x.y.z>");
  });

  it("keeps the Clawed asset map as a tracked packaged resource", () => {
    const files = [
      "clawed-all-files-and-container-entries.csv",
      "clawed-physical-files.csv",
      "clawed-shipping-manifest-entries.csv",
      "clawed-container-entries-annotated.csv",
      "clawed-map-summary.json"
    ];

    for (const fileName of files) {
      const filePath = `assets/clawed-game-file-map/20260814-current/${fileName}`;
      expect(existsSync(filePath)).toBe(true);
      expect(statSync(filePath).size).toBeGreaterThan(0);
    }
  });

  it("uses the active npm CLI when the local release command runs npm subcommands", () => {
    const npmExecPath = "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js";
    const nodePath = "C:/Program Files/nodejs/node.exe";
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'import { createNpmInvocation } from "./scripts/runReleaseFlow.mjs";',
          `const npmExecPath = ${JSON.stringify(npmExecPath)};`,
          `const nodePath = ${JSON.stringify(nodePath)};`,
          "process.stdout.write(JSON.stringify([",
          'createNpmInvocation(["run", "verify"], { env: { npm_execpath: npmExecPath }, nodePath, platform: "win32" }),',
          'createNpmInvocation(["run", "verify"], { env: {}, nodePath, platform: "win32" })',
          "]));"
        ].join("\n")
      ],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([
      [nodePath, [npmExecPath, "run", "verify"]],
      ["npm.cmd", ["run", "verify"]]
    ]);
  });

  it("can resume an interrupted package-only version bump", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'import { isVersionOnlyReleaseBump } from "./scripts/runReleaseFlow.mjs";',
          'const headPackage = { name: "clawed-mod-manager", version: "0.1.0", scripts: { release: "node scripts/runReleaseFlow.mjs" } };',
          'const workingPackage = { ...headPackage, version: "0.2.0" };',
          'const headLock = { name: "clawed-mod-manager", version: "0.1.0", packages: { "": { name: "clawed-mod-manager", version: "0.1.0" } } };',
          'const workingLock = { ...headLock, version: "0.2.0", packages: { "": { ...headLock.packages[""], version: "0.2.0" } } };',
          "process.stdout.write(JSON.stringify([",
          'isVersionOnlyReleaseBump("0.2.0", workingPackage, workingLock, headPackage, headLock),',
          'isVersionOnlyReleaseBump("0.2.0", { ...workingPackage, description: "changed" }, workingLock, headPackage, headLock)',
          "]));"
        ].join("\n")
      ],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([true, false]);
  });

  it("passes Windows signing secrets into the GitHub release workflow", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain(
      "WIN_CSC_LINK: ${{ secrets.WINDOWS_CODESIGN_PFX_BASE64 }}"
    );
    expect(workflow).toContain(
      "WIN_CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CODESIGN_PASSWORD }}"
    );
  });
});
