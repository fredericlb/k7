// routes.ts — `/api/cameras`: the account's cameras that are on, and the ticket that opens the
// signalling socket as a camera or a viewer. Session-guarded, both: the ticket is how the guard
// reaches an upgrade, which Express never sees. See ../../docs/cameras.md.

import type { RTCIceServerLike } from "@studio/web-protocol/cameras";
import { type Request, type RequestHandler, Router } from "express";
import type { CameraHub } from "./hub.ts";
import type { Tickets } from "./ticket.ts";

export function camerasRouter(opts: {
  hub: CameraHub;
  tickets: Tickets;
  iceServers: RTCIceServerLike[];
  requireAuth: RequestHandler;
  accountOf: (req: Request) => string | null;
}): Router {
  const r = Router();
  r.use(opts.requireAuth);
  r.get("/", (req, res) => {
    const account = opts.accountOf(req);
    if (!account) return void res.status(401).json({ error: "no account" });
    res.json(opts.hub.list(account));
  });
  r.post("/ticket", (req, res) => {
    const account = opts.accountOf(req);
    if (!account) return void res.status(401).json({ error: "no account" });
    res.json({
      ticket: opts.tickets.issue(account),
      iceServers: opts.iceServers,
    });
  });
  return r;
}
