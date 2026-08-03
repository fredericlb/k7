/// <reference types="vitest/config" />
import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";

// Single-origin: the SPA is at /k7 and the backend at /k7/api on the same host.
// /rtc is the WebRTC signalling socket. The prefix is shorter than the app's name
// on purpose — `base` is what the dev proxy derives /k7/api and /k7/rtc from.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/k7/",
  port: 5173,
  backendPort: 8787,
  host: "studio.test",
  proxyPaths: ["/auth"],
  wsPaths: ["/rtc"],
  extend: {
    plugins: [frediverseParaglide()],
    // Plain node unit tests (parsers, utilities) — no browser needed. Component
    // stories live in the single root Storybook (../../../.storybook).
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  },
});
