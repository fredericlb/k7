import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { DEV_HOST, LEGACY_DEV_HOSTS } from "../../../scripts/dev-hosts.mjs";

/** The paths on this origin that are NOT st0: the worker's scope is `/`, so only this list keeps a navigation to `/z0` off st0's shell. pl8 and k7 answer their own subdomains now, so they no longer need naming here. */
const OTHER_APPS = /^\/(z0|api|auth)(\/|$)/;

// Unlike the other apps, st0's dev server has no fixed port: the backend URL it proxies to is env-driven, and always localhost.
const port = Number(process.env.STUDIO_WEB_PORT) || 5223;
const backendPort =
  Number(
    new URL(process.env.STUDIO_BACKEND_URL || "http://localhost:8789").port,
  ) || 8789;

export default defineAppConfig({
  dir: import.meta.url,
  // Dedicated port, and it has to stay unique: `strictPort` makes a clash a hard failure, and this was 5203, which frediprofile owns.
  port,
  backendPort,
  // `/auth` alongside the default `/api`, both to THIS app's backend: :8789 runs the origin's OIDC flow, being the service with no prefix.
  proxyPaths: ["/auth"],
  // The public dev host, which also pins HMR to :443 — declared ONLY for the fixed-port case, a free port being visited over plain http.
  host: process.env.STUDIO_WEB_PORT ? undefined : DEV_HOST,
  // No `base`: st0 is the front door, so its assets and routes sit at `/`. Polling only when asked for (`$STUDIO_POLL`), for a tree native file events cannot see.
  poll: !!process.env.STUDIO_POLL,
  // The one thing about the shared service worker that is st0's: see OTHER_APPS above.
  pwaDenylist: [OTHER_APPS],
  extend: {
    // Compiled into src/paraglide/; no `preferredLanguage`, this app defaulting to ENGLISH — docs/settings.md.
    plugins: [
      frediverseParaglide({ strategy: ["localStorage", "baseLocale"] }),
    ],
    // The old name still reaches these servers — see scripts/dev-hosts.mjs.
    server: { allowedHosts: LEGACY_DEV_HOSTS },
    // The three @studio UI packages are consumed as raw .ts, and esbuild's dep scanner chokes on the extension in their exports maps.
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
