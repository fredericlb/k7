import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Served at /z0/presenter on port 3001, which is the LAN proxy's rule; the backend sees bare paths.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/z0/presenter/",
  port: 3001,
  backendPort: 8080,
  host: DEV_HOST,
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // A French-only surface, pinned to baseLocale so another app's stored choice cannot leak in.
  extend: {
    plugins: [frediverseParaglide({ strategy: ["baseLocale"] })],
    // The old name still reaches these servers — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
  },
});
