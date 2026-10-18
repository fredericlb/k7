// playwright.desktop.config.ts — the same specs, run inside k7 the desktop app rather than against a live instance.
// It starts the app itself (apps/k7-standalone/e2e/launch.ts), seeds it, and signs in as its local user (docs/e2e.md).
import { defineConfig } from "@playwright/test";
import { K7 } from "../apps/k7-standalone/e2e/launch.ts";

// Read by src/target.ts in every worker, which inherits the runner's environment.
process.env.E2E_TARGET = "desktop";

export default defineConfig({
  testDir: "./specs",
  testMatch: /app\/.*\.spec\.ts/,
  outputDir: "./test-results/desktop",
  fullyParallel: false,
  // One worker: the app's backend port is fixed, so only one app runs at a time.
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./report/desktop", open: "never" }],
  ],
  use: { baseURL: K7, trace: "retain-on-failure" },
  projects: [{ name: "desktop" }],
});
