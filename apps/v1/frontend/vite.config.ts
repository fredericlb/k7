import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// 5223 l8, 5224 st0, 5225 m9, so 5226 here; 8790 is this service's backend — auth, the
// registry, and which machine the account cuts on.
//
// Like m9, the app talks to the MACHINE directly for everything that is a file: the project's
// YAML and the footage itself both come from that machine's file service, cross-origin. Unlike
// m9, there is no moteur in the picture at all — a cut has no audio, so `wsPaths` still carries
// the relay only because the registry's probe opens one to learn a machine's file base.
export default defineAppConfig({
  dir: import.meta.url,
  port: 5226,
  backendPort: 8790,
  base: "/v1/",
  wsPaths: ["/api/engine"],
  host: DEV_HOST,
  // Dev runs under WSL against /mnt/c, where inotify never fires (same as l8 and m9).
  poll: true,
  extend: {
    // The old name still reaches these servers — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
    // These are consumed as raw .ts (no build step, like the rest of the brain). Vite
    // usually skips pre-bundling a linked workspace dep, but esbuild's dep scanner can grab
    // them and choke on the .ts extension in their exports maps — exclude them so they are
    // served as source like the rest of the app. l8 pays for this one already.
    optimizeDeps: {
      exclude: [
        "@studio/song",
        "@studio/ui-editor",
        "@studio/ui-eyes",
        "@studio/ui-timeline",
      ],
    },
  },
});
