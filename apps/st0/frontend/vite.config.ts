import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { VitePWA } from "vite-plugin-pwa";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

/**
 * The paths on this origin that are NOT st0.
 *
 * st0 answers the origin ROOT, so its service worker's scope is `/` — a scope is a prefix and
 * there is no way to say "everything except `/pl8`". The worker therefore controls the whole
 * origin, the four other apps included, and the only thing that keeps it honest is this list:
 * a navigation to one of them must reach the network instead of being answered with st0's
 * index.html. Get it wrong and `/pl8` serves the editor's shell — a white page with st0's
 * router refusing an address it cannot parse.
 *
 * The same table as `apps/studio/docker/nginx.conf`'s locations and as the reserved repository
 * names in @studio/web-protocol/projects. Three copies, and this is the one a browser enforces.
 */
const OTHER_APPS = /^\/(pl8|k7|z0|api|auth)(\/|$)/;

/**
 * Building, rather than serving — read off the CLI because `defineAppConfig` hands back a plain
 * object and there is no `({ command })` to close over.
 *
 * It gates one thing: whether the worker CLAIMS the pages already open (see `clientsClaim`).
 */
const IS_BUILD = process.argv.includes("build");

// Unlike the other apps, st0's dev server does not always sit on a fixed
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
  // and without it an `upgrade` dies here — invisible behind the proxy, which routes /st0/api
  // straight to the backend, and fatal under `st0 --web` where this server is visited direct.
  // See packages/engine-registry/docs/proxy.md.
  wsPaths: ["/api/engine"],
  // `/auth` alongside the default `/api`, and both go to THIS app's backend: :8789 runs the
  // origin's OIDC flow, being the service with no path prefix. It was a hand-written proxy to
  // pl8's :8795 for as long as the médiathèque owned the flow; `proxyPaths` says it in one word
  // now, which is the shape every other SPA here already had.
  proxyPaths: ["/auth"],
  // The public dev host, which also pins HMR to :443 (the LAN proxy terminates
  // TLS there). Declared ONLY for the fixed-port case: under `st0 --web`
  // the server is on a free port and visited directly over plain http, where
  // both the allowlist entry and a 443 HMR socket would be wrong.
  host: process.env.STUDIO_WEB_PORT ? undefined : DEV_HOST,
  // No `base`: st0 is the studio's front door now, so its assets and its routes sit at `/` and
  // `import.meta.env.BASE_URL` is `/` — which is what puts this app's own API at `/api`. It was
  // `/st0/` until the médiathèque moved to `/pl8`; anything still linking there gets st0's SPA
  // and an address whose first segment reads as a repository name (see src/main.tsx).
  // Dev runs under WSL against /mnt/c, where inotify never fires.
  poll: true,
  extend: {
    // Compiles messages/<locale>.json into src/paraglide/.
    plugins: [
      frediverseParaglide(),
      VitePWA({
        /**
         * `prompt`, not `autoUpdate`, and the difference matters in a DAW.
         *
         * `autoUpdate` sets `skipWaiting` + `clientsClaim`, so a new worker takes over a tab
         * that is already open. Two things follow, and both are bad here: the page can be
         * reloaded out from under an edit, and — worse — a shell from build A stays running
         * while the precache is now build B, so the next lazily-imported chunk is a hashed file
         * that no longer exists. `prompt` leaves the new worker WAITING until every tab of this
         * origin is closed, which is the only moment a swap costs nothing.
         *
         * Nothing prompts, deliberately: there is no "reload now" affordance, because the honest
         * one would have to say "close every studio tab". The update simply lands next session.
         */
        registerType: "prompt",
        /**
         * The manifests are HAND-WRITTEN in `public/` and stay there.
         *
         * There are two of them and the plugin can only generate one — `manifest.webmanifest`
         * for the editor and `manifest-external.webmanifest` for the surfaces menu, which
         * `main.tsx` swaps the `<link>` to. Their relative `start_url` is load-bearing and
         * explained in docs/shell.md; letting the plugin write one would quietly re-introduce
         * the origin-absolute `/` that page is about.
         */
        manifest: false,
        // We register it ourselves, in main.tsx, where the other document-level decisions are.
        injectRegister: null,
        workbox: {
          // The built shell and its assets. Fonts come from Google's CDN and are cross-origin,
          // so they are not ours to precache; the browser's HTTP cache already holds them.
          globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
          // An SPA route (`/<dépôt>/<projet>/…`) has no file behind it, so a navigation is
          // answered with the shell — except for the four other apps on this origin.
          navigateFallback: "index.html",
          navigateFallbackDenylist: [OTHER_APPS],
          cleanupOutdatedCaches: true,
          /**
           * Claim the open pages — **in dev only**, and the asymmetry is the point.
           *
           * A browser offers to install an app only once a worker CONTROLS the page. Without
           * `clients.claim()` the first visit registers and activates one that controls nothing,
           * so the affordance appears on the SECOND navigation and not before — which reads
           * exactly like "it doesn't work", especially on a tablet, where reloading twice to
           * check is not a thing anybody does.
           *
           * Off in a build for the reason `registerType` spells out: claiming a tab that is
           * already open leaves a shell from build A running against build B's precache, and the
           * next lazily-imported chunk is a hashed file that no longer exists. In dev there are
           * no hashed assets and nothing to mismatch, so it costs nothing there.
           */
          clientsClaim: !IS_BUILD,
          skipWaiting: !IS_BUILD,
          /**
           * The editor's bundle is large and this is a local-first tool: the ceiling exists to
           * catch a runaway glob, not to bound a download anybody waits on.
           */
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        },
        /**
         * ON in dev, because otherwise there is no worker at all — and no worker means the
         * browser never offers to install.
         *
         * That is worth spelling out: the manifest, the icons and HTTPS are all in place on the
         * dev server, so everything LOOKS ready, and the install affordance simply never appears.
         * It was off here first, on the argument that a dev server serving yesterday's asset is a
         * bug rather than a feature — true, but it made the one thing this plugin is for
         * untestable anywhere except a production build.
         *
         * The dev worker precaches nothing: there are no hashed assets to precache before a build,
         * so it registers, claims the navigation fallback, and that is all. Vite's own transformed
         * modules are fetched past it. `type: "module"` because the dev worker is served as ESM,
         * unlike the bundled one.
         */
        devOptions: { enabled: true, type: "module", suppressWarnings: true },
      }),
    ],
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
