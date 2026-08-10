import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Single-origin: served under /monitor at st0.priv.frediver.se/z0/monitor; the
// backend answers /api (bare paths — stripApiPrefix), /auth, /audio and the /ws
// socket on the same host. Port 3002 matches the LAN proxy. It used to sit on
// the admin host's apex; the apex now belongs to the online SPA.
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
