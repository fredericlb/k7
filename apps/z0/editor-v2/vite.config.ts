import { defineAppConfig } from "@frediverse/vite-config";

// The v2 editor, at studio.test/z0/editor-v2. It is the odd SPA of the seven: it does not
// talk to z0's backend at all. What it opens is a git repository the médiathèque owns, on the
// machine the account works from — so its `/api` and `/auth` are ST0's, at the origin root,
// like l8's and m9's. `backendPort` therefore names st0 (8795), not z0's 8080.
//
// Ports: 3001..3006 are the six game SPAs, so 3007.
export default defineAppConfig({
  dir: import.meta.url,
  base: "/z0/editor-v2/",
  port: 3007,
  backendPort: 8795,
  // st0 owns `/auth/*` for the whole origin, and this SPA signs in with the studio session
  // like l8 and m9 — not with the game's `bt_session`, which models a guest with no account.
  proxyPaths: ["/auth"],
  host: "studio.test",
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as l8 and m9).
  poll: true,
});
