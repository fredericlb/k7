// remote.ts — `/pl8/*` against the configured server. Two rules, both about what happens when
// things are NOT fine: it never fails the connection (a throw reaches the gate as the CORS
// screen — ../../docs/pl8Shim.md), and the bearer is attached for a LOOPBACK caller only
// (it is the account credential, and this server binds the LAN — ../../docs/server.md).
// Hand-rolled over fetch so "never fail" is written here rather than layered onto a library
// whose default is to be faithful; responses are buffered, which suits pl8's JSON.
// What a second device may read, and why it must: ../../docs/externals.md.

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

/**
 * The two routes a SECOND DEVICE may see through the proxy, and the reason is correctness
 * rather than convenience.
 *
 * `externalHref` picks a project's address from the register — `/<repo>/<projet>` when the
 * repository is registered, `@local/…` otherwise — and its own comment says why: "so the
 * tablet and the laptop claim the same song". Give the laptop the real register and the tablet
 * an empty one and they compute different addresses, hence different `projectClaimKey`s, hence
 * two claims on one project: the laptop gets `ProjectTakenOver` and, since that screen has no
 * Retry by design, the song flickers between two people.
 *
 * So the LAN gets the register, READ ONLY and with `uri` blanked. That field is the git host,
 * port and path, and `launch.md` already keeps it out of addresses for the same reason it is
 * kept out of here. Everything else — writes, shares, the key, the médiathèque — stays the
 * shim's 503, and the bearer never leaves the loopback path.
 */
const LAN_READABLE = new Set([
  "/pl8/api/projects",
  "/pl8/api/projects/revision",
]);

/** Exported for the test: the whole LAN policy in one predicate. */
export function lanMayRead(method: string, path: string): boolean {
  return method === "GET" && LAN_READABLE.has(path);
}

/** Blank what the LAN has no business reading, leaving the shape the frontend expects. */
export function redactForLan(body: Buffer): Buffer {
  try {
    const doc = JSON.parse(body.toString("utf8")) as {
      repos?: { uri?: string }[];
    };
    if (Array.isArray(doc.repos)) {
      for (const r of doc.repos) r.uri = "";
    }
    return Buffer.from(JSON.stringify(doc), "utf8");
  } catch {
    // Not the shape we expected: answer nothing rather than pass an unread body to the LAN.
    return Buffer.from(
      JSON.stringify({ repos: [], revision: "offline" }),
      "utf8",
    );
  }
}

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

    // The LAN gets the offline answers, except for the register it needs to agree with this
    // machine about a project's address. A peer riding the rest would simply have the account,
    // and nothing about that shows — see origin.ts.
    // originalUrl, never `req.path`: inside an `app.use` mount express strips the matched
    // prefix, so `req.path` is a DIFFERENT string from the one this handler forwards — and a
    // policy checked against one while the request goes to the other is no policy at all.
    const path = req.originalUrl.split("?")[0] ?? "";
    const lan = !isLoopback(req);
    if (lan && !lanMayRead(req.method, path)) return next();

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
      const raw = Buffer.from(await up.arrayBuffer());
      const buf = lan ? redactForLan(raw) : raw;
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
