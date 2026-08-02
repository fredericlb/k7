import { defineAppConfig } from "@frediverse/vite-config";

// platines has NO backend of its own. It talks to the MACHINE — the file service on :8770
// for the médiathèque's cached catalogue, the engine on :8765 for playback — both by
// absolute URL, both cross-origin, both discovered at runtime. Nothing about it is hosted.
//
// `backendPort` is required by the shared config and only aims the dev server's `/api`
// proxy, which nothing here ever calls. It gets a reserved-but-unused port rather than a
// real one, so a stray `/api` request fails loudly instead of quietly reaching somebody
// else's service. Making the field optional would mean editing `commons/`, which is shared
// with phare — the wrong place for something only studio wants.
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 lanes, 5224 mediatek, so:
  port: 5225,
  backendPort: 8796,
  host: "platines.test",
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as lanes).
  poll: true,
});
