import { describe, expect, it } from "vitest";

import { validateLogicalLoadOrder } from "../../src/main/services/loadOrderRules";
import {
  InstalledModVersionSchema,
  ProfileSchema,
  type ClawedModManifestV1,
  type InstalledModManifestRecord,
  type Profile
} from "../../src/shared/contracts/app";
import { createFixtureManifest } from "../helpers/clawedModFixture";

function installedRecord(
  overrides: Partial<ClawedModManifestV1>
): InstalledModManifestRecord {
  const manifest = createFixtureManifest(overrides);
  return {
    manifest,
    mod: InstalledModVersionSchema.parse({
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      author: manifest.author,
      description: manifest.description,
      loader: manifest.loader,
      sha256: `${manifest.id}-${manifest.version}`,
      enabled: false,
      installPath: `C:/fake/${manifest.id}/${manifest.version}`,
      packagePath: `C:/fake/${manifest.id}/${manifest.version}/package.clawedmod`,
      iconDataUrl: null,
      hasReadme: false,
      status: "ready",
      problems: [],
      installedAt: "2026-08-11T00:00:00.000Z"
    })
  };
}

function profile(
  records: InstalledModManifestRecord[],
  orderedModIds: string[]
): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    id: "profile-a",
    name: "Profile A",
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    selectedMods: Object.fromEntries(
      records.map((record) => [
        record.manifest.id,
        {
          modId: record.manifest.id,
          version: record.manifest.version,
          enabled: true,
          config: {}
        }
      ])
    ),
    orderedModIds,
    preferredLaunchMode: "VANILLA"
  });
}

describe("logical load-order validation", () => {
  it("reports missing dependencies as errors", () => {
    const child = installedRecord({
      id: "child",
      name: "Child",
      dependencies: [{ id: "core" }]
    });

    const result = validateLogicalLoadOrder(profile([child], ["child"]), [child]);

    expect(result.validity).toBe("invalid");
    expect(result.problems).toContainEqual(
      expect.objectContaining({
        severity: "ERROR",
        code: "MISSING_DEPENDENCY",
        modId: "child",
        relatedModId: "core"
      })
    );
  });

  it("reports invalid selected versions as errors", () => {
    const installed = installedRecord({
      id: "core",
      name: "Core",
      version: "1.0.0"
    });
    const selectedProfile = ProfileSchema.parse({
      ...profile([installed], ["core"]),
      selectedMods: {
        core: {
          modId: "core",
          version: "2.0.0",
          enabled: true,
          config: {}
        }
      }
    });

    const result = validateLogicalLoadOrder(selectedProfile, [installed]);

    expect(result.validity).toBe("invalid");
    expect(result.problems[0]).toMatchObject({
      severity: "ERROR",
      code: "INVALID_SELECTED_VERSION",
      modId: "core"
    });
  });

  it("detects dependency cycles", () => {
    const first = installedRecord({
      id: "first",
      name: "First",
      dependencies: [{ id: "second" }]
    });
    const second = installedRecord({
      id: "second",
      name: "Second",
      dependencies: [{ id: "first" }]
    });

    const result = validateLogicalLoadOrder(
      profile([first, second], ["first", "second"]),
      [first, second]
    );

    expect(result.problems).toContainEqual(
      expect.objectContaining({
        severity: "ERROR",
        code: "DEPENDENCY_CYCLE"
      })
    );
  });

  it("reports declared conflicts as warnings", () => {
    const first = installedRecord({
      id: "first",
      name: "First",
      conflicts: ["second"]
    });
    const second = installedRecord({
      id: "second",
      name: "Second"
    });

    const result = validateLogicalLoadOrder(
      profile([first, second], ["first", "second"]),
      [first, second]
    );

    expect(result.validity).toBe("valid");
    expect(result.problems).toContainEqual(
      expect.objectContaining({
        severity: "WARNING",
        code: "DECLARED_CONFLICT"
      })
    );
  });

  it("reports loadAfter and loadBefore violations as warnings", () => {
    const first = installedRecord({
      id: "first",
      name: "First",
      loadAfter: ["second"]
    });
    const second = installedRecord({
      id: "second",
      name: "Second",
      loadBefore: ["first"]
    });

    const result = validateLogicalLoadOrder(
      profile([first, second], ["first", "second"]),
      [first, second]
    );

    expect(result.validity).toBe("valid");
    expect(result.problems.map((problem) => problem.code)).toEqual([
      "LOAD_AFTER_VIOLATION",
      "LOAD_BEFORE_VIOLATION"
    ]);
  });
});
