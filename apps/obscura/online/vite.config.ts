import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";

// Single-origin: online is the apex SPA at studio.test/obscura, and the
// backend answers /api (+ /auth, /audio, and the /ws socket) on the same host.
// The backend serves BARE paths — its Caddy block strips /api — so the dev
// proxy strips it too (stripApiPrefix). Port 3003 matches the Caddyfile.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/obscura/",
  port: 3003,
  backendPort: 8080,
  host: "studio.test",
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // Compiles messages/{locale}.json into src/paraglide/.
  extend: { plugins: [frediverseParaglide()] },
});
