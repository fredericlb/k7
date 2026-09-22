import { defineAppConfig } from "@frediverse/vite-config";
import {
  AUTH_BACKEND_PORT,
  LEGACY_DEV_HOSTS,
  PL8_DEV_HOST,
} from "../../../scripts/dev-hosts.mjs";

// Served at the ROOT of its own subdomain, against its OWN backend, except `/auth`,
// which is st0's — ../docs/routing.md.
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 is st0; the next free one in that block.
  port: 5224,
  backendPort: 8795,
  // The engine relay: only a declared wsPath gets `ws: true` (packages/engine-registry/docs/proxy.md).
  wsPaths: ["/api/engine"],
  host: PL8_DEV_HOST,
  extend: {
    server: {
      // The alternate names reach these servers too — see scripts/dev-hosts.mjs.
      allowedHosts: LEGACY_DEV_HOSTS,
      // The ONE path this dev server forwards to a backend that is not its own (../../../docs/dev.md).
      proxy: {
        "/auth": {
          target: `http://localhost:${AUTH_BACKEND_PORT}`,
          changeOrigin: true,
          // changeOrigin overwrites Host, and the backend derives its redirect_uri from the request.
          xfwd: true,
        },
      },
    },
  },
  // Polling only when asked for, the tree being on ext4 (same as st0).
  poll: !!process.env.STUDIO_POLL,
});
