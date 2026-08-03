import { defineAppConfig } from "@frediverse/vite-config";

// m9 now has a backend, and 8796 is a REAL port: it holds the login, this service's
// engine registry, and which machine the account DJs from. That port used to be reserved
// deliberately unused, so a stray `/api` call would fail loudly rather than quietly reach
// somebody else's service.
//
// What has NOT changed: the decks still talk to the MACHINE directly — the file service for
// the médiathèque's cached catalogue, the engine for playback — both by absolute URL, both
// cross-origin. The backend knows who you are and which engines exist, never what is on any
// engine's disk.
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 pistes, 5224 mediatek, so:
  port: 5225,
  backendPort: 8796,
  base: "/m9/",
  host: "studio.test",
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as pistes).
  poll: true,
});
