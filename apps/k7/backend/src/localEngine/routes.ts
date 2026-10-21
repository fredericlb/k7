// routes.ts — the machine's engine, for k7's own pages (/api/local/engine: the snapshot, pushed, and the commands a
// page may send) and for the tray that started this backend (/api/local/tray, under the bearer it handed over).
// Same origin and behind the session: the supervisor itself listens on no port. See ../../docs/localEngine.md.

import { createHash, timingSafeEqual } from "node:crypto";
import { type RequestHandler, Router } from "express";
import type { LocalEngine } from "./host.ts";
import { trayStatus } from "./trayStatus.ts";

/** What a page may ask; `weburi.add` hands the engine to an instance, so the page confirms it first. */
export const PAGE_COMMANDS = new Set([
  "engine.start",
  "engine.stop",
  "engine.restart",
  "audio.priority",
  "plugins.rescan",
  "instruments.download",
  "instruments.remove",
  "weburi.add",
  "weburi.remove",
]);

/** /api/local/engine, behind `requireAuth`. */
export function localEngineRouter(
  engine: LocalEngine,
  requireAuth: RequestHandler,
): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/", (_req, res) => {
    res.json(engine.state());
  });

  router.get("/events", (req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    const send = (s: unknown) => res.write(`data: ${JSON.stringify(s)}\n\n`);
    res.write("retry: 2000\n");
    send(engine.state());
    const off = engine.subscribe(send);
    const beat = setInterval(() => res.write(": hb\n\n"), 25_000);
    beat.unref?.();
    req.on("close", () => {
      clearInterval(beat);
      off();
    });
  });

  router.post("/cmd", (req, res) => {
    const { cmd, arg } = (req.body ?? {}) as { cmd?: unknown; arg?: unknown };
    if (typeof cmd !== "string" || !PAGE_COMMANDS.has(cmd))
      return void res.status(400).json({ error: "command not allowed" });
    if (arg !== undefined && typeof arg !== "string")
      return void res.status(400).json({ error: "arg must be a string" });
    engine.send(cmd, arg);
    res.json({ ok: true });
  });
  return router;
}

/** /api/local: mounted on a machine's own backend only, so its answering at all is what a page probes. */
export function localInfoRouter(
  engine: LocalEngine | null,
  version: string,
): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.json({ engine: engine !== null, version });
  });
  return router;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** /api/local/tray: the tray's status line, for the bearer it gave this backend at spawn; no bearer, no route. */
export function trayRouter(
  engine: LocalEngine | null,
  token: string | undefined,
): Router {
  const router = Router();
  const expected = token ? digest(token) : null;
  router.get("/", (req, res) => {
    const sent = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!expected || !sent || !timingSafeEqual(digest(sent), expected))
      return void res.status(401).json({ error: "unauthorized" });
    res.json(
      engine
        ? trayStatus(engine.state())
        : {
            icon: "error",
            line: "⚠ no engine on this machine",
            downloads: null,
          },
    );
  });
  return router;
}
