// playwright.desktop.config.ts — the same specs, run inside k7 the desktop app rather than against a live instance.
// It starts the app itself (apps/k7-standalone/e2e/launch.ts), seeds it, and signs in as its local user (docs/e2e.md).
import { defineConfig } from "@playwright/test";

// Read by src/target.ts in every worker, which inherits the runner's environment.
process.env.E2E_TARGET = "desktop";

export default defineConfig({
  testDir: "./specs",
  testMatch: /app\/.*\.spec\.ts/,
  outputDir: "./test-results/desktop",
  fullyParallel: false,
  // One worker: the specs share one app, and the machine one engine output.
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./report/desktop", open: "never" }],
  ],
  // No baseURL: the app picks its port at boot, and `k7.open` resolves against the launch's own origin.
  use: { trace: "retain-on-failure" },
  projects: [{ name: "desktop" }],
});
