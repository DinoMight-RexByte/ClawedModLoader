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
      ".codex/clawed-game-file-map/20260814-current"
    ]);

    for (const blocked of [
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
      from: ".codex/clawed-game-file-map/20260814-current",
      to: "clawed-game-file-map/20260814-current"
    });
  });

  it("keeps the official launch mod bundle as an explicit packaging step", () => {
    expect(packageJson.scripts.package).toContain("npm run build:unreal-decoder");
    expect(packageJson.scripts.dist).toContain("npm run build:unreal-decoder");
    expect(packageJson.scripts["package:official-launch-mods"]).toBe(
      "node scripts/createOfficialLaunchBundle.mjs"
    );
    expect(packageJson.scripts["package:official-launch"]).toBe(
      "npm run package && npm run package:official-launch-mods"
    );
  });

  it("includes all generated user-facing mods in the dist command", () => {
    expect(packageJson.scripts["package:available-mods"]).toBe(
      "npm run package:manual-qa && npm run package:coop-session-guard && npm run package:coop-catchup && npm run package:coop-capacity8 && npm run package:player-name-repair && npm run package:save-backup"
    );
    expect(packageJson.scripts.dist).toContain("npm run package:available-mods");
    expect(packageJson.scripts["package:available-mods"]).not.toContain(
      "package:coop-reliability-plugin"
    );
    expect(packageJson.scripts["package:available-mods"]).not.toContain(
      "package:optimization-dev-plugins"
    );
  });
});
