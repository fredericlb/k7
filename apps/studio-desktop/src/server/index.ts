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
import { serveFromVite } from "./devProxy.ts";
import { serveFrontend } from "./frontend.ts";
import { firstFreePort } from "./port.ts";

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
}

export interface LocalServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * The registry is OURS and is never proxied: the engine it lists is on this machine, and the
 * direct loopback probe always wins. The slug is `studio-desktop`, not `st0` — a hosted st0
 * backend writes `~/.studio/web-endpoints/st0.json`, and two writers of one file would take
 * turns being the registry the supervisor heartbeats to.
 */
const SERVICE = "studio-desktop";

export async function startLocalServer(
  opts: LocalServerOptions,
): Promise<LocalServer> {
  const app = express();
  app.use(express.json({ limit: ENGINE_BODY_LIMIT }));

  // BEFORE the SPA, always: a route that falls through to the catch-all answers index.html,
  // and a fetch expecting JSON would parse a page.
  mountLocalAuth(app);
  // LOT B3 mounts the pl8 shim here, for the same reason.

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
