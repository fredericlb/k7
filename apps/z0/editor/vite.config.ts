import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Single-origin: served at st0.priv.frediver.se/z0/editor; the backend answers
// /api (bare paths — stripApiPrefix), /auth, /audio and the /ws socket on the
// same host. Port 3006 matches the LAN proxy. Direct localhost access during
// dev is http://localhost:3006/editor/.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/z0/editor/",
  port: 3006,
  backendPort: 8080,
  host: DEV_HOST,
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // Compiles messages/{locale}.json into src/paraglide/. First app on
  // Paraglide; the rest follow once this one has proven the setup.
  extend: {
    plugins: [frediverseParaglide()],
    // The old name still reaches these servers — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
  },
});
