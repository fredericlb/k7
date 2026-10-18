// playwright.android.config.ts — the same specs, run inside the app on a phone: its e2e build, through its own WebView.
// The global setup builds and installs that build first; E2E_ANDROID_BUILD=0 runs what is installed (docs/e2e.md).
import { defineConfig } from "@playwright/test";
import { PHONE_ORIGIN } from "./src/android.ts";

// Read by src/target.ts in every worker, which inherits the runner's environment.
process.env.E2E_TARGET = "android";

export default defineConfig({
  testDir: "./specs",
  testMatch: /app\/.*\.spec\.ts/,
  outputDir: "./test-results/android",
  globalSetup: "./src/androidBuild.ts",
  fullyParallel: false,
  // One worker: one phone, one engine, one app.
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./report/android", open: "never" }],
  ],
  use: { baseURL: PHONE_ORIGIN, trace: "retain-on-failure" },
  projects: [{ name: "android" }],
});
