import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";

// Single-origin: served under /remote on obscura.test; the backend answers
// /api (bare paths — stripApiPrefix), /auth, /audio and the /ws socket on the
// same host. Port 3005 matches the Caddyfile.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/remote/",
  port: 3005,
  backendPort: 8080,
  host: "obscura.test",
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // French-only game surface (see obscura's docs): a single locale, and the
  // strategy pinned to baseLocale so a stored language choice from the editor
  // or online — same origin, same localStorage — can't leak in.
  extend: { plugins: [frediverseParaglide({ strategy: ["baseLocale"] })] },
});
