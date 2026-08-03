import { defineAppConfig } from "@frediverse/vite-config";

// Served at mediatek.test, against its OWN backend: the library is hosted, so /api and
// /auth both go to :8795 and nothing here talks to a local service. The cache the moteur
// plays from is a separate concern this app never reads.
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 is lanes; the next free one in that block.
  port: 5224,
  backendPort: 8795,
  proxyPaths: ["/auth"],
  host: "mediatek.test",
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as lanes).
  poll: true,
});
