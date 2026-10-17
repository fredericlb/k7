// playwright.config.ts — the desktop app's end-to-end run: one worker, since every launch takes the same fixed port.
// Named *.e2e.ts so vitest's own run never picks the specs up. See docs/e2e.md.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  retries: 0,
  outputDir: "test-results",
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
});
