import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/live-validation/**/*.test.ts"],
    passWithNoTests: false,
    testTimeout: 180_000,
    hookTimeout: 180_000
  }
});
