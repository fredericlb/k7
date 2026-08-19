import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Served at st0.priv.frediver.se/pl8, against its OWN backend: the library is hosted, so
// /api and /auth both go to :8795 and nothing here talks to a local service. The cache the
// moteur plays from is a separate concern this app never reads.
//
// It answered the ROOT until l8 took it — the front door is now the editor, and the catalogue
// is what a project draws on, one link away in l8's header. What did NOT move is /auth: this
// backend still owns the origin-wide OIDC flow, because the IdP knows one prefixless
// redirect_uri. `proxyPaths` below therefore covers BOTH spellings, and the bare one is the
// live one — see packages/web-protocol/services.ts.
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 is l8; the next free one in that block.
  port: 5224,
  backendPort: 8795,
  // The public prefix, matching SERVICE_PATHS.pl8. `defineAppConfig` proxies each backend path
  // twice once a base is set — `/api` and `/pl8/api` — which is exactly what this app needs:
  // its own calls carry the prefix (BASE_URL), while /auth stays bare for the IdP.
  base: "/pl8/",
  proxyPaths: ["/auth"],
  // The engine relay. `/api` is proxied already, but only a declared wsPath gets `ws: true`,
  // and without it an `upgrade` dies here rather than reaching the backend. Invisible behind
  // the proxy, which routes /pl8/api straight to :8795. See packages/engine-registry/docs/proxy.md.
  wsPaths: ["/api/engine"],
  host: DEV_HOST,
  // The old name still reaches these servers — see scripts/dev-hosts.mjs.
  extend: { server: { allowedHosts: LEGACY_DEV_HOSTS } },
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as l8).
  poll: true,
});
