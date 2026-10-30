// Split out of vite.config.ts: these are plain node unit tests (component stories live in the
// single root Storybook) and don't need the app's build plugins — Tailwind, PWA, the dev proxy.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
