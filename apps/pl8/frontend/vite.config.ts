import { defineAppConfig } from "@frediverse/vite-config";
import {
  AUTH_BACKEND_PORT,
  DEV_HOST,
  LEGACY_DEV_HOSTS,
} from "../../../scripts/dev-hosts.mjs";

// Served under /pl8 against its OWN backend, except `/auth`, which is st0's (../docs/routing.md).
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 is st0; the next free one in that block.
  port: 5224,
  backendPort: 8795,
  // The public prefix: with a base set, `defineAppConfig` proxies each backend path twice.
  base: "/pl8/",
  // The engine relay: only a declared wsPath gets `ws: true` (packages/engine-registry/docs/proxy.md).
  wsPaths: ["/api/engine"],
  host: DEV_HOST,
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
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as st0).
  poll: true,
});
