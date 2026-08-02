import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";

// Unlike the other apps, lanes's dev server does not always sit on a fixed
// port: the backend URL it proxies to is env-driven with the repo defaults as the
// fallback. The backend URL it passes is always localhost, so taking the port
// off it is faithful.
const port = Number(process.env.LANES_WEB_PORT) || 5223;
const backendPort =
  Number(
    new URL(process.env.LANES_BACKEND_URL || "http://localhost:8789").port,
  ) || 8789;

export default defineAppConfig({
  dir: import.meta.url,
  // Dedicated port (radiok7 5173 / frotomaton 5183 / froutine 5193 /
  // frediprofile 5203 / labs 5213 taken). `defineAppConfig` sets `strictPort`,
  // so a clash is a hard failure rather than a silent renumber and this has to
  // stay unique — it was 5203, which frediprofile already owns, and whichever
  // dev server started second simply died.
  port,
  backendPort,
  // /auth is the shared OIDC flow (login/callback/logout/me); /api is proxied by
  // default and carries the workspace/engine-registry calls.
  proxyPaths: ["/auth"],
  // The .test host Caddy fronts, which also pins HMR to :443 (Caddy terminates
  // TLS there). Declared ONLY for the fixed-port case: under `lanes --web`
  // the server is on a free port and visited directly over plain http, where
  // both the allowlist entry and a 443 HMR socket would be wrong.
  host: process.env.LANES_WEB_PORT ? undefined : "studio.test",
  // Dev runs under WSL against /mnt/c, where inotify never fires.
  poll: true,
  extend: {
    // Compiles messages/<locale>.json into src/paraglide/.
    plugins: [frediverseParaglide()],
    // @lanes/ui-eyes, /ui-chains and /ui-editor are consumed as raw .ts
    // (no build step, like the rest of the brain). Vite usually skips
    // pre-bundling a linked workspace dep, but esbuild's dep scanner can grab
    // these and choke on the .ts extension in their exports maps — exclude them
    // so they're served as source like the rest of the app.
    optimizeDeps: {
      exclude: ["@lanes/ui-eyes", "@lanes/ui-chains", "@lanes/ui-editor"],
    },
  },
});
