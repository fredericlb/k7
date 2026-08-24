/// <reference types="vitest/config" />
import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// `base` is what the dev proxy derives /k7/api and /k7/rtc from — see ../docs/routing.md.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/k7/",
  port: 5173,
  backendPort: 8787,
  host: DEV_HOST,
  proxyPaths: ["/auth"],
  wsPaths: ["/rtc"],
  extend: {
    plugins: [frediverseParaglide()],
    // The extra host names these servers answer to — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
    // Plain node unit tests; component stories live in the single root Storybook.
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  },
});
