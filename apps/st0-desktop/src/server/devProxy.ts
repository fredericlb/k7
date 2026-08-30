// devProxy.ts — dev only: pass `/` through to vite so the window runs the SAME origin contract
// as a packaged build while the frontend hot-reloads. Hand-rolled over node:http rather than a
// dependency, because this is one upstream, no rewriting and no auth — see ../../docs/server.md
// for why the REMOTE proxy is a different question.
//
// Everything the app answers itself (/api, /auth, /pl8) is mounted BEFORE this, so only what
// belongs to the SPA reaches it.

import { request as httpRequest, type Server } from "node:http";
import type { Duplex } from "node:stream";
import type { Express, Request, Response } from "express";

/** Forward one request to `upstream`, headers and body streamed through untouched. */
function pass(upstream: URL, req: Request, res: Response): void {
  const out = httpRequest(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.originalUrl,
      method: req.method,
      headers: { ...req.headers, host: upstream.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  out.on("error", () => {
    // Vite not up yet is the ordinary case during a session start, not a crash.
    if (!res.headersSent) res.status(502).type("text").send("vite is not up");
  });
  req.pipe(out);
}

/** Serve the SPA from a running vite, WebSocket upgrades included — without them there is no HMR. */
export function serveFromVite(
  app: Express,
  server: Server,
  viteUrl: string,
): void {
  const upstream = new URL(viteUrl);

  server.on("upgrade", (req, socket: Duplex, head) => {
    const out = httpRequest({
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.url,
      headers: { ...req.headers, host: upstream.host },
      method: "GET",
    });
    out.on("upgrade", (upRes, upSocket, upHead) => {
      const lines = Object.entries(upRes.headers).map(
        ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`,
      );
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${lines.join("\r\n")}\r\n\r\n`,
      );
      if (upHead?.length) socket.unshift(upHead);
      upSocket.pipe(socket).pipe(upSocket);
    });
    out.on("error", () => socket.destroy());
    if (head?.length) out.write(head);
    out.end();
  });

  app.use((req, res) => pass(upstream, req, res));
}
