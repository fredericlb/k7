import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";

// Single-origin: served under /editor on obscura.test; the backend answers
// /api (bare paths — stripApiPrefix), /auth, /audio and the /ws socket on the
// same host. Port 3006 matches the Caddyfile. Direct localhost access during
// dev is http://localhost:3006/editor/.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/editor/",
  port: 3006,
  backendPort: 8080,
  host: "obscura.test",
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // Compiles messages/{locale}.json into src/paraglide/. First app on
  // Paraglide; the rest follow once this one has proven the setup.
  extend: { plugins: [frediverseParaglide()] },
});
