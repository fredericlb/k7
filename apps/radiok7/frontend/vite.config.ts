/// <reference types="vitest/config" />
import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";

// Single-origin: the SPA is at / and the backend at /api on the same host.
// /rtc is the WebRTC signalling socket.
export default defineAppConfig({
  dir: import.meta.url,
  port: 5173,
  backendPort: 8787,
  host: "rec.test",
  proxyPaths: ["/auth"],
  wsPaths: ["/rtc"],
  extend: {
    plugins: [frediverseParaglide()],
    // Plain node unit tests (parsers, utilities) — no browser needed. Component
    // stories live in the single root Storybook (../../../.storybook).
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  },
});
