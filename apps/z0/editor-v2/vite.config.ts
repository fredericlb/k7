import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

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
  // pl8's backend owns `/auth/*` for the whole origin — prefixless, wherever its own SPA sits,
  // because the IdP knows one redirect_uri. This SPA signs in with the studio session like l8
  // — not with the game's `bt_session`, which models a guest with no account.
  proxyPaths: ["/auth"],
  host: DEV_HOST,
  // The old name still reaches these servers — see scripts/dev-hosts.mjs.
  extend: { server: { allowedHosts: LEGACY_DEV_HOSTS } },
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as l8 and m9).
  poll: true,
});
