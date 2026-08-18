import { describe, expect, it } from "vitest";

import rendererConfig from "../../vite.renderer.config";

describe("renderer build config", () => {
  it("uses relative assets for Electron file loading", () => {
    expect(rendererConfig.base).toBe("./");
  });
});
