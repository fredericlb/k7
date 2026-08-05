import { defineAppConfig } from "@frediverse/vite-config";

// Served at the ROOT of studio.test, against its OWN backend: the library is hosted, so
// /api and /auth both go to :8795 and nothing here talks to a local service. The cache the
// moteur plays from is a separate concern this app never reads.
//
// No `base`: st0 is the studio's home page, so its assets and its routes sit at `/`. That
// also makes it the only SPA here whose /auth proxy is not a courtesy — this backend owns
// the origin-wide OIDC flow, so /auth/callback really does have to land on :8795.
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 is l8; the next free one in that block.
  port: 5224,
  backendPort: 8795,
  proxyPaths: ["/auth"],
  // The engine relay. `/api` is proxied already, but only a declared wsPath gets `ws: true`,
  // and without it an `upgrade` dies here rather than reaching the backend. Invisible behind
  // Caddy, which routes /api straight to :8795. See packages/engine-registry/docs/proxy.md.
  wsPaths: ["/api/engine"],
  host: "studio.test",
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as l8).
  poll: true,
});
