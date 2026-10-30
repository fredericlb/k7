// proxy.ts — one request handed on to an account's file service: the identity headers a client
// sent are dropped, the hub's own (user, admin flag, the instance's secret) stamped on, and the
// answer piped back. See docs/fileHub.md.

import { request as httpRequest } from "node:http";
import { replayBody } from "@studio/engine-registry";
import {
  ADMIN_HEADER,
  ENGINE_TOKEN_HEADER,
  HUB_SECRET_HEADER,
  ORIGIN_HEADER,
  USER_HEADER,
} from "@studio/web-protocol";
import type { Request, Response } from "express";
import type { Instance } from "./instances.ts";
import { BodyTooLargeError } from "./librariesRoutes.ts";
import { publicOrigin } from "./publicOrigin.ts";

/** Headers a client may not choose: identity and the hub's own secret are the hub's to set. */
const DROPPED = new Set([
  "cookie",
  "authorization",
  "host",
  USER_HEADER,
  HUB_SECRET_HEADER,
  ENGINE_TOKEN_HEADER,
  ADMIN_HEADER,
  ORIGIN_HEADER,
]);

/** A body past the hub's own limit is the caller's 413; anything else is this side's 500. */
export const statusOf = (e: Error): number =>
  e instanceof BodyTooLargeError ? e.status : 500;

/** One request to the instance, the session's user, its admin flag and the hub's secret stamped on it. */
export function pipeTo(
  inst: Instance,
  user: string,
  admin: boolean,
  req: Request,
  res: Response,
): void {
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers))
    if (v !== undefined && !DROPPED.has(k.toLowerCase())) headers[k] = v;
  headers.host = `127.0.0.1:${inst.port}`;
  headers[USER_HEADER] = user;
  if (admin) headers[ADMIN_HEADER] = "1";
  headers[HUB_SECRET_HEADER] = inst.secret;
  headers[ORIGIN_HEADER] = publicOrigin(req);
  const body = replayBody(req);
  if (body) {
    headers["content-length"] = String(body.length);
    delete headers["transfer-encoding"];
  }
  const up = httpRequest(
    {
      host: "127.0.0.1",
      port: inst.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (upRes) => {
      res.status(upRes.statusCode ?? 502);
      for (const [k, v] of Object.entries(upRes.headers))
        if (v !== undefined && k.toLowerCase() !== "transfer-encoding")
          res.setHeader(k, v as string | string[]);
      upRes.pipe(res);
    },
  );
  // A client gone mid-download or mid-upload takes the upstream with it, or the hub-to-service socket stays open, paused.
  let gone = false;
  res.on("close", () => {
    gone = !res.writableFinished;
    if (gone) up.destroy();
  });
  up.on("error", (e) => {
    if (gone) return;
    // Past the headers a clean end would pass a cut-off body as a whole one: the browser must see the connection fail.
    if (res.headersSent) res.destroy();
    else res.status(502).json({ error: `file service: ${e.message}` });
  });
  if (body) up.end(body);
  else req.pipe(up);
}
