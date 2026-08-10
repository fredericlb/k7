import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Single-origin: served at st0.priv.frediver.se/z0/buzzer; the backend answers
// /api (bare paths — stripApiPrefix), /auth, /audio and the /ws socket on the
// same host. Port 3004 matches the LAN proxy.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/z0/buzzer/",
  port: 3004,
  backendPort: 8080,
  host: DEV_HOST,
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // French-only game surface (see z0's docs): a single locale, and the
  // strategy pinned to baseLocale so a stored language choice from the editor
  // or online — same origin, same localStorage — can't leak in.
  extend: {
    plugins: [frediverseParaglide({ strategy: ["baseLocale"] })],
    // The old name still reaches these servers — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
  },
});
