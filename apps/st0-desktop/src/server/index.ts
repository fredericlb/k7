// index.ts — the app's own HTTP origin. This is what makes the desktop build cost st0's
// frontend almost no changes: served from a real `http://` origin, `serviceUrl(origin, "pl8")`
// stays true verbatim, the session cookie stays first-party, `/assets/…` resolves, and
// 127.0.0.1 is a secure context so crypto.subtle is there. Under `app://` every one of those
// would have needed a seam. See ../../docs/server.md.

import type { Server } from "node:http";
import {
  ENGINE_BODY_LIMIT,
  engineErrorHandler,
  mountEngineRegistry,
} from "@studio/engine-registry";
import express from "express";
import { line } from "../logbus.ts";
import { mountLocalAuth } from "./auth.ts";
import { attachCameraRtc } from "./cameraRtc.ts";
import { type DesktopHooks, mountDesktopApi } from "./desktop.ts";
import { serveFromVite } from "./devProxy.ts";
import { serveFrontend } from "./frontend.ts";
import { mountMediatekCache, type ReadCache } from "./mediatek.ts";
import { mountPairing, type PairingResult } from "./pairing.ts";
import { mountPl8Shim, pl8Offline } from "./pl8Shim.ts";
import { firstFreePort } from "./port.ts";
import { mountRemotePl8, type ReadRemote } from "./remote.ts";

export interface LocalServerOptions {
  /** From settings; taken as a starting point, since something else may hold it. */
  port: number;
  /** st0's built dist, or null in dev — then `viteUrl` serves the SPA instead. */
  distDir: string | null;
  viteUrl?: string;
  /**
   * `0.0.0.0` so a second device on the LAN can reach a surface, like the file service already
   * does. What must NOT cross that boundary is guarded per-route, not by the bind — see origin.ts.
   */
  host?: string;
  /**
   * Read fresh per request, so pairing takes effect without a restart. Absent means unpaired,
   * which is the state a machine starts in and the one every test wants.
   */
  remote?: ReadRemote;
  onPaired?: (r: PairingResult) => void;
  /** The machine's own médiathèque, for when there is no server to ask. Absent = no cache. */
  cache?: ReadCache;
  /** What this machine answers for itself with no server: the libraries pointer and its key. */
  /** The settings screen's two routes; absent leaves st0 with no desktop to detect. */
  desktop?: DesktopHooks;
}

export interface LocalServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * The registry is OURS and is never proxied: the engine it lists is on this machine, and the
 * direct loopback probe always wins. The slug is `st0-desktop`, not `st0` — a hosted st0
 * backend writes `~/.studio/web-endpoints/st0.json`, and two writers of one file would take
 * turns being the registry the supervisor heartbeats to.
 */
const SERVICE = "st0-desktop";

export async function startLocalServer(
  opts: LocalServerOptions,
): Promise<LocalServer> {
  const app = express();
  app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

  // BEFORE the SPA, always: a route that falls through to the catch-all answers index.html,
  // and a fetch expecting JSON would parse a page.
  mountLocalAuth(app);
  if (opts.desktop) mountDesktopApi(app, opts.desktop);
  mountPairing(app, opts.onPaired ?? (() => {}));
  // The remote goes FIRST and the shim behind it: the shim stays the answer for an unpaired
  // machine, for the LAN, and for anything the remote could not be asked.
  mountRemotePl8(
    app,
    opts.remote ?? (() => ({ serverUrl: null, serverToken: null })),
    pl8Offline,
  );
  // Behind the remote and in front of the shim: with a server, the server wins; without one,
  // the panel browses what this machine has rather than nothing.
  if (opts.cache) mountMediatekCache(app, opts.cache);
  mountPl8Shim(app);

  // No requireAuth: this origin serves one person, at their own machine. The engine token is
  // still what guards the engine, exactly as it does for a browser.
  const engine = mountEngineRegistry(app, {
    service: SERVICE,
    requireAuth: (_req, _res, next) => next(),
  });

  app.use(engineErrorHandler);

  const port = await firstFreePort(opts.port);
  const host = opts.host ?? "0.0.0.0";

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(port, host, () => resolve(s));
  });

  // AFTER listen, because the dev passthrough needs the server to hook `upgrade` for HMR.
  if (opts.distDir) serveFrontend(app, opts.distDir);
  else if (opts.viteUrl) serveFromVite(app, server, opts.viteUrl);
  else
    line(
      "host",
      "no st0 dist and no vite — the window will have nothing to load",
    );

  // The address the supervisor and a second device use: loopback for `advertiseRegistry`,
  // since that file is read on this machine only.
  const url = `http://127.0.0.1:${port}`;
  engine.serve(server, url);
  // Beside the engine relay and on the same server: a lens this machine has, for a device that
  // may not open one of its own (docs/camera.md).
  attachCameraRtc(server, engine.registry);
  line("host", `serving st0 on ${url} (bound ${host})`);

  return {
    url,
    port,
    close: () =>
      new Promise((resolve) => {
        // Keep-alive sockets are the norm here — a browser holds one, and so does a tablet on
        // the LAN. Without this, close() waits for them to drain and Quit hangs on a device
        // that is merely idle rather than gone.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
