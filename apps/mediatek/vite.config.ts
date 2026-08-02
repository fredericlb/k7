import { defineAppConfig } from "@frediverse/vite-config";

// Served at mediatek.test. It has no backend of its own: /auth and /api go to the SAME
// hosted backend lanes uses (8789), which is the studio-wide OIDC gate and engine
// registry despite living under apps/lanes. Everything else — the library itself — is
// fetched cross-origin from the LOCAL file service, whose address the engine probe finds.
export default defineAppConfig({
  dir: import.meta.url,
  // 5223 is lanes; the next free one in that block.
  port: 5224,
  backendPort: 8789,
  proxyPaths: ["/auth"],
  host: "mediatek.test",
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as lanes).
  poll: true,
});
