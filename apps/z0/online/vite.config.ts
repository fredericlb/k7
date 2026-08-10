import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Single-origin: online is the apex SPA at st0.priv.frediver.se/z0, and the
// backend answers /api (+ /auth, /audio, and the /ws socket) on the same host.
// The backend serves BARE paths — the proxy strips /api for it — so the dev
// proxy strips it too (stripApiPrefix). Port 3003 matches the LAN proxy.
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
    // The old name still reaches these servers — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
  },
});
