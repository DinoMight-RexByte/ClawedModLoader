import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  reporter: [["list"]],
  webServer: {
    command: "npm run dev:renderer",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://127.0.0.1:5173"
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  }
});
