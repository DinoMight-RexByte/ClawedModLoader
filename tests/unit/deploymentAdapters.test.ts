import { describe, expect, it } from "vitest";

import { LooseFileDeploymentAdapter } from "../../src/main/adapters/unreal/looseFileDeploymentAdapter";
import { PakDeploymentAdapter } from "../../src/main/adapters/unreal/pakDeploymentAdapter";
import { UE4SSDeploymentAdapter } from "../../src/main/adapters/ue4ss/ue4ssDeploymentAdapter";
import type { Profile } from "../../src/shared/contracts/app";

const profile: Profile = {
  schemaVersion: 1,
  id: "default",
  name: "Default",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  selectedMods: {
    "pak-mod": {
      modId: "pak-mod",
      version: "1.0.0",
      enabled: true,
      config: {}
    }
  },
  orderedModIds: ["pak-mod"],
  preferredLaunchMode: "MODDED"
};

describe("deployment adapter capabilities", () => {
  it("reports UE4SS Lua ordering as known only for validated runtimes", async () => {
    const adapter = new UE4SSDeploymentAdapter();
    const ue4ssProfile: Profile = {
      ...profile,
      selectedMods: {
        alpha: {
          modId: "alpha",
          version: "1.0.0",
          enabled: true,
          config: {}
        },
        beta: {
          modId: "beta",
          version: "1.0.0",
          enabled: true,
          config: {}
        }
      },
      orderedModIds: ["beta", "alpha"]
    };

    const unvalidatedOrder = await adapter.generateLoadOrder(ue4ssProfile);
    const validatedOrder = await adapter.generateLoadOrder(
      ue4ssProfile,
      undefined,
      "VALIDATED"
    );

    expect(adapter.descriptor.releaseValidation).toBe("VALIDATED");
    expect(adapter.capabilities.supportsOrdering).toBe(true);
    expect(unvalidatedOrder.effectiveOrderKnown).toBe(false);
    expect(unvalidatedOrder.messages[1]).toContain("unvalidated");
    expect(validatedOrder.effectiveOrderKnown).toBe(true);
    expect(validatedOrder.logicalOrder).toEqual(["beta", "alpha"]);
    expect(validatedOrder.messages).toEqual([]);
    expect(validatedOrder.modsTxt).toContain("beta : 1\nalpha : 1");
    expect(validatedOrder.modsTxt).toContain("Lua mod startup order is validated");
  });

  it("reports Pak ordering as validated for Clawed package overrides", async () => {
    const adapter = new PakDeploymentAdapter();
    const loadOrder = await adapter.generateLoadOrder(profile);

    expect(adapter.descriptor.status).toBe("ready");
    expect(adapter.descriptor.releaseValidation).toBe("VALIDATED");
    expect(adapter.capabilities.supportsOrdering).toBe(true);
    expect(adapter.capabilities.requiresRuntime).toBe(false);
    expect(loadOrder.effectiveOrderKnown).toBe(true);
    expect(loadOrder.messages).toEqual([]);
  });

  it("reports loose-file deployment as runtime-independent non-asset staging", () => {
    const adapter = new LooseFileDeploymentAdapter();

    expect(adapter.descriptor.status).toBe("ready");
    expect(adapter.capabilities.supportsOrdering).toBe(false);
    expect(adapter.capabilities.requiresRuntime).toBe(false);
    expect(adapter.descriptor.releaseValidation).toBe("UNVALIDATED");
  });
});
