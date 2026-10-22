// devFrontend.ts — in dev, the page comes from a running Vite instead of frontend/dist: every request the SPA
// serving would answer is streamed to that server and back, so the tray's 127.0.0.1:18789 gets HMR on its own
// origin. What a reader gets wrong: only `K7_DEV_FRONTEND` turns it on, and only the dev tray sets it (../../../../docs/dev.md).

import { request } from "node:http";
import type { NextFunction, Request, Response } from "express";

/** What stays this backend's even in dev — the routes the built SPA's fallback leaves alone too. */
const OWN = /^\/(api|auth)(\/|$)/;

/** Pass every page request through to the Vite at `base`; its absence is a 502 that names the resource. */
export function devFrontend(base: string) {
  const target = new URL(base);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (OWN.test(req.path)) {
      next();
      return;
    }
    const up = request(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: req.originalUrl,
        // Vite answers the hosts it knows, and localhost is one of them.
        headers: { ...req.headers, host: target.host },
      },
      (vite) => {
        res.writeHead(vite.statusCode ?? 502, vite.headers);
        vite.pipe(res);
      },
    );
    // A Vite that never answers must not hold the page forever; HMR is a websocket of its own, not this.
    up.setTimeout(15_000, () => up.destroy(new Error("no answer in 15 s")));
    up.on("error", (e) => {
      if (res.headersSent) return void res.end();
      res
        .status(502)
        .type("text/plain")
        .send(
          `no dev frontend at ${base} (${e.message}) — start the k7-frontend resource`,
        );
    });
    req.pipe(up);
  };
}
