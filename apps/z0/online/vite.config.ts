import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// The apex SPA at /z0 on port 3003, which is the LAN proxy's rule; the backend sees bare paths.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/z0/",
  port: 3003,
  backendPort: 8080,
  host: DEV_HOST,
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // Compiles messages/{locale}.json into src/paraglide/.
  extend: {
    plugins: [frediverseParaglide()],
    // The extra host names these servers answer to — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
  },
});
