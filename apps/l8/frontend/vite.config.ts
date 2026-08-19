import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

// Unlike the other apps, l8's dev server does not always sit on a fixed
// port: the backend URL it proxies to is env-driven with the repo defaults as the
// fallback. The backend URL it passes is always localhost, so taking the port
// off it is faithful.
const port = Number(process.env.STUDIO_WEB_PORT) || 5223;
const backendPort =
  Number(
    new URL(process.env.STUDIO_BACKEND_URL || "http://localhost:8789").port,
  ) || 8789;

export default defineAppConfig({
  dir: import.meta.url,
  // Dedicated port (k7 5173 / frotomaton 5183 / froutine 5193 /
  // frediprofile 5203 / labs 5213 taken). `defineAppConfig` sets `strictPort`,
  // so a clash is a hard failure rather than a silent renumber and this has to
  // stay unique — it was 5203, which frediprofile already owns, and whichever
  // dev server started second simply died.
  port,
  backendPort,
  // The engine relay. `/api` is proxied already, but only a declared wsPath gets `ws: true`,
  // and without it an `upgrade` dies here — invisible behind the proxy, which routes /l8/api
  // straight to the backend, and fatal under `l8 --web` where this server is visited direct.
  // See packages/engine-registry/docs/proxy.md.
  wsPaths: ["/api/engine"],
  // `/auth` alongside the default `/api`, and both go to THIS app's backend: :8789 runs the
  // origin's OIDC flow, being the service with no path prefix. It was a hand-written proxy to
  // pl8's :8795 for as long as the médiathèque owned the flow; `proxyPaths` says it in one word
  // now, which is the shape every other SPA here already had.
  proxyPaths: ["/auth"],
  // The public dev host, which also pins HMR to :443 (the LAN proxy terminates
  // TLS there). Declared ONLY for the fixed-port case: under `l8 --web`
  // the server is on a free port and visited directly over plain http, where
  // both the allowlist entry and a 443 HMR socket would be wrong.
  host: process.env.STUDIO_WEB_PORT ? undefined : DEV_HOST,
  // No `base`: l8 is the studio's front door now, so its assets and its routes sit at `/` and
  // `import.meta.env.BASE_URL` is `/` — which is what puts this app's own API at `/api`. It was
  // `/l8/` until the médiathèque moved to `/pl8`; anything still linking there gets l8's SPA
  // and an address whose first segment reads as a repository name (see src/main.tsx).
  // Dev runs under WSL against /mnt/c, where inotify never fires.
  poll: true,
  extend: {
    // Compiles messages/<locale>.json into src/paraglide/.
    plugins: [frediverseParaglide()],
    // The old name still reaches these servers — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
    // @studio/ui-chains, /ui-editor and /ui-timeline are consumed as raw .ts
    // (no build step, like the rest of the brain). Vite usually skips
    // pre-bundling a linked workspace dep, but esbuild's dep scanner can grab
    // these and choke on the .ts extension in their exports maps — exclude them
    // so they're served as source like the rest of the app.
    optimizeDeps: {
      exclude: [
        "@studio/ui-chains",
        "@studio/ui-chains-react",
        "@studio/ui-editor",
        "@studio/ui-timeline",
      ],
    },
  },
});
