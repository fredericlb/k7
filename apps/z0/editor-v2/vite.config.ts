import { defineAppConfig } from "@frediverse/vite-config";
import {
  AUTH_BACKEND_PORT,
  DEV_HOST,
  LEGACY_DEV_HOSTS,
} from "../../../scripts/dev-hosts.mjs";

// The v2 editor, at st0.priv.frediver.se/z0/editor-v2. It is the odd SPA of the seven: it does not
// talk to z0's backend at all. What it opens is a git repository the médiathèque owns, on the
// machine the account works from — so its `/api` and `/auth` are PL8's. `backendPort` therefore
// names pl8 (8795), not z0's 8080.
//
// Behind the LAN proxy neither entry is what actually carries those calls: this SPA asks for
// `/pl8/api/…` (SERVICE_PATHS) and for `/auth/…` at the origin root, and the proxy hands both
// to the dev server that owns them. They are kept for the case this server is visited DIRECT
// on :3007, which is the only way to work on it without the whole session up.
//
// Ports: 3001..3006 are the six game SPAs, so 3007.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/z0/editor-v2/",
  port: 3007,
  backendPort: 8795,
  // No `/auth` here: it is not this app's backend's, and not pl8's either — see the proxy in
  // `extend` below. This SPA signs in with the studio session like every other app on the
  // origin, not with the game's `bt_session`, which models a guest with no account.
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
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as l8 and m9).
  poll: true,
});
