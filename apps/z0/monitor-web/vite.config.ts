import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Served at /z0/monitor on port 3002, which is the LAN proxy's rule; the apex is online's now.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/z0/monitor/",
  port: 3002,
  backendPort: 8080,
  host: DEV_HOST,
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // Compiles messages/<locale>.json into src/paraglide/.
  extend: {
    plugins: [frediverseParaglide()],
    // The old name still reaches these servers — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
  },
});
