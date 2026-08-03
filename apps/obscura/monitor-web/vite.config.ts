import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";

// Single-origin: served under /monitor at studio.test/obscura/monitor; the
// backend answers /api (bare paths — stripApiPrefix), /auth, /audio and the /ws
// socket on the same host. Port 3002 matches the Caddyfile. It used to sit on
// the admin host's apex; the apex now belongs to the online SPA.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/obscura/monitor/",
  port: 3002,
  backendPort: 8080,
  host: "studio.test",
  stripApiPrefix: true,
  proxyPaths: ["/auth", "/audio"],
  wsPaths: ["/ws"],
  // Compiles messages/<locale>.json into src/paraglide/.
  extend: { plugins: [frediverseParaglide()] },
});
