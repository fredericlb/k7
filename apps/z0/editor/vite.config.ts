import { defineAppConfig } from "@frediverse/vite-config";
import {
  AUTH_BACKEND_PORT,
  DEV_HOST,
  LEGACY_DEV_HOSTS,
} from "../../../scripts/dev-hosts.mjs";

// The odd SPA of the six: it never talks to z0's backend, so what follows names st0's throughout.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/z0/editor/",
  // 3006, which is what the proxy's /z0/editor rule targets.
  port: 3006,
  // st0's 8789, not z0's 8080: what this app opens is a repository st0's file hub owns.
  backendPort: 8789,
  host: DEV_HOST,
  extend: {
    server: {
      // The extra host names these servers answer to — see scripts/dev-hosts.mjs.
      allowedHosts: LEGACY_DEV_HOSTS,
      // The ONE path forwarded elsewhere: the origin's OIDC flow is st0's, having no prefix.
      proxy: {
        "/auth": {
          target: `http://localhost:${AUTH_BACKEND_PORT}`,
          changeOrigin: true,
          // changeOrigin overwrites Host, and the backend derives its redirect_uri from it.
          xfwd: true,
        },
      },
    },
  },
  // Polling only when asked for: native file events are enough (same as st0).
  poll: !!process.env.STUDIO_POLL,
});
