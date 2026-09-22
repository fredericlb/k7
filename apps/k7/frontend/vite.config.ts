import { alphaTab } from "@coderline/alphatab-vite";
import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { K7_DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Served at the ROOT of its own subdomain — see ../docs/routing.md.
export default defineAppConfig({
  dir: import.meta.url,
  port: 5173,
  backendPort: 8787,
  host: K7_DEV_HOST,
  proxyPaths: ["/auth"],
  wsPaths: ["/rtc"],
  extend: {
    // alphaTab copies its font and soundfont and wires its worker and worklet — ../docs/score.md.
    plugins: [frediverseParaglide(), alphaTab()],
    // The extra host names these servers answer to — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
  },
});
