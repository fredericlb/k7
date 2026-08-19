import { defineAppConfig } from "@frediverse/vite-config";
import {
  AUTH_BACKEND_PORT,
  DEV_HOST,
  LEGACY_DEV_HOSTS,
} from "../../../scripts/dev-hosts.mjs";

// Served at st0.priv.frediver.se/pl8, against its OWN backend: the library is hosted, so /api
// goes to :8795 and nothing here talks to a local service. The cache the moteur plays from is a
// separate concern this app never reads.
//
// It answered the ROOT until l8 took it — the front door is now the editor, and the catalogue
// is what a project draws on, one link away in l8's header. /auth went with the root: this
// backend mounts no auth routes any more and only verifies the cookie l8 mints, so the `/auth`
// proxy below points at l8's port rather than at this app's own.
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 is l8; the next free one in that block.
  port: 5224,
  backendPort: 8795,
  // The public prefix, matching SERVICE_PATHS.pl8. `defineAppConfig` proxies each backend path
  // twice once a base is set — `/api` and `/pl8/api` — which is exactly what this app needs:
  // its own calls carry the prefix (BASE_URL), while /auth stays bare for the IdP.
  base: "/pl8/",
  // The engine relay. `/api` is proxied already, but only a declared wsPath gets `ws: true`,
  // and without it an `upgrade` dies here rather than reaching the backend. Invisible behind
  // the proxy, which routes /pl8/api straight to :8795. See packages/engine-registry/docs/proxy.md.
  wsPaths: ["/api/engine"],
  host: DEV_HOST,
  extend: {
    server: {
      // The old name still reaches these servers — see scripts/dev-hosts.mjs.
      allowedHosts: LEGACY_DEV_HOSTS,
      // `/auth` is the ONE path this dev server forwards to a backend that is not its own: the
      // origin's OIDC flow is l8's, being the service with no path prefix. `proxyPaths` cannot
      // say it — that helper points every path at `backendPort` — so it is spelled here.
      // Only reached when this server is visited DIRECTLY on its port; behind the LAN proxy
      // `/auth` never gets this far, because it is at the origin root. See
      // packages/web-protocol/services.ts.
      proxy: {
        "/auth": {
          target: `http://localhost:${AUTH_BACKEND_PORT}`,
          changeOrigin: true,
          // Same reason `defineAppConfig` sets it: changeOrigin overwrites Host, and the backend
          // derives its own public origin — and so its redirect_uri — from the request. Without
          // it the browser is handed a callback pointing straight at the backend's port.
          xfwd: true,
        },
      },
    },
  },
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as l8).
  poll: true,
});
