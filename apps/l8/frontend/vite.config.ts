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
  // No /auth here, matching m9: the shared OIDC flow lives on st0's backend now, and
  // the proxy's origin-wide /auth/* route claims those paths before this dev server ever
  // sees them. Proxying them to :8789 would only forward to a backend that mounts no
  // auth routes — a 404 that reads like a broken login rather than a misrouted one.
  // /api is proxied by default and carries the workspace/engine-registry calls.
  // The public dev host, which also pins HMR to :443 (the LAN proxy terminates
  // TLS there). Declared ONLY for the fixed-port case: under `l8 --web`
  // the server is on a free port and visited directly over plain http, where
  // both the allowlist entry and a 443 HMR socket would be wrong.
  host: process.env.STUDIO_WEB_PORT ? undefined : DEV_HOST,
  base: process.env.STUDIO_WEB_PORT ? undefined : "/l8/",
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
