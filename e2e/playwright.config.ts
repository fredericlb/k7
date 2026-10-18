// playwright.config.ts — the functional suite, run against a live instance (app.priv.k7.rocks by default).
// It drives a running dev session rather than starting one: `npm run dev` must already be up (docs/e2e.md).
import { defineConfig, devices } from "@playwright/test";
import { AUTH_STATE } from "./src/paths.ts";

const baseURL = process.env.E2E_BASE_URL ?? "https://app.priv.k7.rocks";

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  fullyParallel: false,
  // One worker: the specs share the e2e account's workspace and one engine.
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "./report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "seed", testMatch: /seed\.setup\.ts/, dependencies: ["setup"] },
    {
      name: "web",
      testMatch: /app\/.*\.spec\.ts/,
      dependencies: ["seed"],
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
    },
  ],
});
