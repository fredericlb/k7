// remote.ts — `/pl8/*` against the configured server, when there is one. Two rules carry the
// whole file, and both are about what happens when things are NOT fine.
//
// 1. It never fails the connection. A network error falls back to the offline shim, because a
//    throw reaches the gate as an unexpected error, and the gate's probe on a service that is
//    up always answers `blocked` — the worst screen in the app (../../docs/pl8Shim.md).
// 2. The bearer is attached for a LOOPBACK caller only. It is the user's account credential,
//    and this server binds the LAN (../../docs/server.md).
//
// Hand-rolled over fetch rather than a proxy library: https and redirects come free, and
// "never fail" is written here instead of layered onto a library whose default is to be
// faithful. Responses are buffered, which suits pl8's JSON; a streaming route would want more.

import { serviceUrl } from "@studio/web-protocol/services";
import type { Express, Request, Response } from "express";
import { line } from "../logbus.ts";
import { isLoopback } from "./origin.ts";

export interface RemoteConfig {
  /** The studio ORIGIN, e.g. `https://studio.frediver.se`; null when unpaired. */
  serverUrl: string | null;
  serverToken: string | null;
}

/** Read fresh per request, so pairing takes effect without a restart. */
export type ReadRemote = () => RemoteConfig;

/** Headers we must not forward: the hop's own, and anything naming the local origin. */
/**
 * Bounded, or rule 1 is not true. An unreachable host usually fails at connect, but a
 * black-holed route does not: without this the request hangs, st0's fetch hangs with it, and
 * the screen waits forever instead of getting the offline answer.
 *
 * Generous rather than tight, because a real pl8 call is a real round trip. A large UPLOAD
 * through this proxy would still hit it — `/api/mediatek/song` is the one that would, and it
 * belongs to the médiathèque lot, which has to stream rather than buffer anyway.
 */
const TIMEOUT_MS = 15_000;

const DROP = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "cookie",
  "origin",
  "referer",
]);

function outgoing(req: Request, token: string | null): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (DROP.has(k.toLowerCase()) || v === undefined) continue;
    h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  // The page holds no cookie for the remote, by design: a bearer is what `bearerOrSession`
  // was built for, and it sidesteps third-party cookies entirely.
  if (token) h.set("authorization", `Bearer ${token}`);
  return h;
}

/**
 * Put the remote in front of the shim. Mounted BEFORE it, so the shim stays the answer for an
 * unpaired machine, for the LAN, and for anything the remote could not be asked.
 */
export function mountRemotePl8(
  app: Express,
  read: ReadRemote,
  fallback: (req: Request, res: Response) => void,
): void {
  app.use(/^\/pl8(\/.*)?$/, async (req, res, next) => {
    const { serverUrl, serverToken } = read();
    if (!serverUrl) return next(); // unpaired: the shim answers

    // The LAN gets the offline answers. A peer riding this would simply have the account, and
    // nothing about that shows — see origin.ts.
    if (!isLoopback(req)) return next();

    // `/pl8/...` on our origin is `<server>/pl8/...` on theirs, which serviceUrl already spells.
    const base = serviceUrl(serverUrl, "pl8");
    const target = base + req.originalUrl.slice("/pl8".length);

    try {
      const body =
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : JSON.stringify(req.body ?? {});
      const up = await fetch(target, {
        method: req.method,
        headers: outgoing(req, serverToken),
        ...(body === undefined ? {} : { body }),
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const buf = Buffer.from(await up.arrayBuffer());
      res.status(up.status);
      const type = up.headers.get("content-type");
      if (type) res.type(type);
      res.send(buf);
    } catch (e) {
      // Unreachable, DNS gone, TLS refused, or simply too slow — all of them mean "no server
      // right now", which is
      // what the shim already answers well. Logged, because a paired machine silently serving
      // offline answers would be its own kind of confusing.
      line("host", `${target} unreachable (${String(e)}) — answering offline`);
      fallback(req, res);
    }
  });
}
