import { fileURLToPath } from "node:url";
import { frediverseParaglide } from "@frediverse/i18n/vite";
import { defineAppConfig } from "@frediverse/vite-config";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import type { ConfigEnv } from "vite";
import {
  DEV_HOST,
  DOCS_DEV_HOST,
  LEGACY_DEV_HOSTS,
} from "../../../scripts/dev-hosts.mjs";
import { noticesPlugin } from "./notices/vitePlugin.ts";
import { entryPreloadPlugin } from "./preload/vitePlugin.ts";

/** The paths on this origin that are NOT k7's shell: the worker's scope is `/`, so only this list keeps a navigation to `/api` or `/app_downloads` off it. */
const OTHER_APPS = /^\/(api|auth|app_downloads)(\/|$)/;

/** The language every catalogue resolves the same way, so the rehearsal pages' and the plugins' follow k7's — docs/settings.md. */
const STRATEGY: ["localStorage", "baseLocale"] = ["localStorage", "baseLocale"];

/** One module per language for the dev server, which sends each module alone; one per message in a build, so each chunk carries only its own words (docs/settings.md). */
const outputFor = (command: ConfigEnv["command"]) =>
  command === "build" ? "message-modules" : "locale-modules";

/** The rehearsal pages' OWN catalogue, compiled where that package reads it: frediverseParaglide fixes the paths to this app's. */
// fileURLToPath, not `.pathname`: on Windows the latter is `/D:/…`, which a resolve turns into `D:\D:\…`.
const REHEARSAL_I18N = fileURLToPath(
  new URL("../../../packages/ui-rehearsal/", import.meta.url),
);

/** The builtin plugins' catalogue (the desk, the viewport), compiled where k7-plugins reads it — packages/k7-plugins/docs/i18n.md. */
const PLUGINS_I18N = fileURLToPath(
  new URL("../../../packages/k7-plugins/", import.meta.url),
);

// Unlike the other apps, k7's dev server has no fixed port: the backend URL it proxies to is env-driven, and always localhost.
const port = Number(process.env.STUDIO_WEB_PORT) || 5223;
const backendPort =
  Number(
    new URL(process.env.STUDIO_BACKEND_URL || "http://localhost:8789").port,
  ) || 8789;

export default ({ command }: ConfigEnv) => {
  const OUTPUT = outputFor(command);
  return defineAppConfig({
    dir: import.meta.url,
    // Dedicated port, and it has to stay unique: `strictPort` makes a clash a hard failure, and this was 5203, which frediprofile owns.
    port,
    backendPort,
    // `/auth` and the apps' download page alongside the default `/api`, all to THIS app's backend: :8789 runs the origin's OIDC flow, being the service with no prefix.
    proxyPaths: ["/auth", "/app_downloads"],
    // The engine relay, live sync's relay and the remote cameras' signalling: only a declared wsPath gets `ws: true` (packages/engine-registry/docs/proxy.md).
    wsPaths: ["/api/engine", "/api/sync", "/api/cameras"],
    // The public dev host, which also pins HMR to :443 — declared ONLY for the fixed-port case, a free port being visited over plain http.
    host: process.env.STUDIO_WEB_PORT ? undefined : DEV_HOST,
    // No `base`: k7 is the front door, so its assets and routes sit at `/`. Polling only when asked for (`$STUDIO_POLL`), for a tree native file events cannot see.
    poll: !!process.env.STUDIO_POLL,
    // The one thing about the shared service worker that is k7's: see OTHER_APPS above.
    pwaDenylist: [OTHER_APPS],
    extend: {
      // Compiled into src/paraglide/; no `preferredLanguage`, this app defaulting to ENGLISH — docs/settings.md.
      plugins: [
        frediverseParaglide({ strategy: STRATEGY, outputStructure: OUTPUT }),
        paraglideVitePlugin({
          project: `${REHEARSAL_I18N}project.inlang`,
          outdir: `${REHEARSAL_I18N}src/paraglide`,
          emitTsDeclarations: true,
          strategy: STRATEGY,
          outputStructure: OUTPUT,
        }),
        paraglideVitePlugin({
          project: `${PLUGINS_I18N}project.inlang`,
          outdir: `${PLUGINS_I18N}src/paraglide`,
          emitTsDeclarations: true,
          strategy: STRATEGY,
          outputStructure: OUTPUT,
        }),
        // The About page's third-party notices, a chunk of their own — docs/about.md.
        noticesPlugin(),
        // appMain's chunks named in the built page, so they arrive with the entry rather than after it — docs/shell.md.
        entryPreloadPlugin(),
      ],
      // The docs host and the former hosts still reach these servers — see scripts/dev-hosts.mjs.
      server: {
        allowedHosts: [DOCS_DEV_HOST, ...LEGACY_DEV_HOSTS],
        // HMR by NAME, so a page this Vite serves through another origin — the dev tray's 18789 — reaches it too (docs/dev.md).
        ...(process.env.STUDIO_WEB_PORT
          ? {}
          : { ws: { host: DEV_HOST, protocol: "wss", clientPort: 443 } }),
      },
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
};
