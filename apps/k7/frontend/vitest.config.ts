// Split out of vite.config.ts: these are plain node unit tests (component stories live in the
// single root Storybook) and don't need the app's build plugins — alphaTab, Tailwind, PWA, the
// dev proxy. Loading vite.config.ts just for `test` dragged all of that in, and Vite's native
// config loader failed to resolve @coderline/alphatab-vite from there in CI.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
