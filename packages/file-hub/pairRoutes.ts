// pairRoutes.ts — signing a machine (the tray, the phones) in to its ONE server: the page starts it here, opens the URL
// it gets in the system browser, and waits here for the ending; a server refuses them all. The server signs the person
// in and sends a one-use code back to `pairReturnHandler`, which trades it with the verifier kept here for the token.
// The link replaces any other, whose token is handed back to its server. See docs/syncRelay.md, "Signing in is pairing".

import { mkdirSync } from "node:fs";
import { APP_SCHEMES } from "@studio/web-protocol/handoff";
import {
  normalizeServer,
  SYNC_DEVICE_SELF_ROUTE,
  SYNC_PAIR_REDEEM_ROUTE,
  SYNC_PAIR_RETURN_PATH,
  SYNC_RELAY_PATH,
  syncPairUrl,
} from "@studio/web-protocol/pairing";
import express, { type Request, type RequestHandler, Router } from "express";
import { accountKey } from "./instances.ts";
import { challengeOf, newVerifier } from "./pairCodes.ts";
import type { PairingStore, PairRecord } from "./pairingStore.ts";
import {
  forgetRemote,
  originOfRelay,
  readRemotes,
  type SyncRemote,
  writeRemote,
} from "./syncRemote.ts";

/** What a server answers a request to add one: it is the server, and adds none (docs/syncRelay.md, "A server"). */
export const SERVER_ADDS_NONE =
  "This is a k7 server: it does not connect to other servers. Add servers from k7 on your computer or phone.";

/** What the pairing routes need of the hub. */
export interface PairContext {
  store: PairingStore;
  userOf: (req: Request) => string;
  accountDir: (slug: string) => string;
  /** Restart the account's file service, so it dials the relay just paired. */
  restart: (user: string) => Promise<unknown>;
  /** Where the browser comes back: this machine's loopback port. */
  returnTo: (req: Request) => string;
  /** A machine's hub; a server's refuses every route here. */
  machine: boolean;
  /** The host this backend is reached at, which it cannot pair with. */
  selfHost: (req: Request) => string;
  /** The saved servers changed: the engine follows the active one (docs/syncRelay.md, "The engine follows the account"). */
  engineFollows?: (before: SyncRemote[], after: SyncRemote[]) => void;
  /** How this backend reaches a server; the global fetch unless a test hands one in. */
  fetch?: typeof fetch;
}

/** The longest one GET /:state holds before answering a pairing still waiting. */
const LONG_POLL_MS = 25_000;
/** How long a server has to answer a trade or a revoke. */
const SERVER_MS = 15_000;

/** The relay at a server's origin, where the person named it: `https://app.k7.rocks` → `wss://app.k7.rocks/api/sync`. */
export const relayOf = (origin: string): string =>
  `${origin.replace(/^http/, "ws")}${SYNC_RELAY_PATH}`;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/** Hand a link's token back to its server, so the device is listed there no more; a server away keeps it, harmlessly. */
export async function revokeLink(
  link: SyncRemote,
  f: typeof fetch = fetch,
): Promise<void> {
  await f(`${originOfRelay(link.url)}${SYNC_DEVICE_SELF_ROUTE}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${link.token}` },
    signal: AbortSignal.timeout(SERVER_MS),
  }).catch(() => {});
}

/** Store `token` as the account's one link, the others forgotten and handed back to their servers. */
async function storeLink(
  c: PairContext,
  email: string,
  origin: string,
  identity: string,
  token: string,
): Promise<"paired" | "notStored"> {
  const home = c.accountDir(accountKey(email));
  try {
    if (!token) throw new Error("no token");
    mkdirSync(home, { recursive: true });
    const before = readRemotes(home);
    forgetRemote(home);
    // The relay is reached where the person named the server, whatever host a proxy showed the origin.
    writeRemote(home, {
      url: relayOf(origin),
      token,
      user: email,
      as: identity,
    });
    for (const old of before) void revokeLink(old, c.fetch);
    await c.restart(email);
    // The new server is the active one: the engine leaves the one it was on for it.
    c.engineFollows?.(before, readRemotes(home));
    return "paired";
  } catch {
    return "notStored";
  }
}

/** What an app is told of a sign-in; the token rides along once paired, for the phone's supervisor. */
function viewOf(c: PairContext, r: PairRecord) {
  const [link] =
    r.phase === "paired" ? readRemotes(c.accountDir(accountKey(r.email))) : [];
  return {
    state: r.state,
    email: r.email,
    origin: r.origin,
    host: hostOf(r.origin),
    phase: r.phase,
    until: r.until,
    browserAs: r.browserAs ?? null,
    // For the phone's supervisor, whose engine is listed at the server with its token.
    token: link?.token ?? null,
  };
}

/** Where the server sends its code: this machine's loopback port, or a phone app's own scheme when it asks for one. */
function backOf(c: PairContext, req: Request): string {
  const scheme = String(req.body?.scheme ?? "");
  if (APP_SCHEMES.includes(scheme)) return `${scheme}://pair`;
  return `${c.returnTo(req)}${SYNC_PAIR_RETURN_PATH}`;
}

export function pairRouter(c: PairContext): Router {
  const r = Router();
  r.use(express.json());
  // A server is the remote itself: it adds no server, and offers none.
  r.use((_req, res, next) => {
    if (c.machine) return next();
    res.status(403).json({ error: SERVER_ADDS_NONE });
  });
  r.get("/", (req, res) => {
    const email = c.userOf(req);
    if (!email)
      return void res.status(401).json({ error: "no user on the session" });
    const mine = c.store.ofAccount(email);
    res.json({
      email,
      links: readRemotes(c.accountDir(accountKey(email))).length,
      pairing: mine ? viewOf(c, mine) : null,
    });
  });
  // Start a sign-in: the URL to open in the system browser, from a click.
  r.post("/", (req, res) => {
    const email = c.userOf(req);
    if (!email)
      return void res.status(401).json({ error: "no user on the session" });
    const origin = normalizeServer(String(req.body?.origin ?? ""));
    if (!origin)
      return void res.status(400).json({ error: "origin is no k7 server" });
    if (hostOf(origin) === c.selfHost(req))
      return void res.status(400).json({ error: "that is this server" });
    const name = String(req.body?.name ?? "").trim() || "a machine";
    const verifier = newVerifier();
    const p = c.store.begin(email, origin, verifier);
    res.json({
      pairing: viewOf(c, p),
      url: syncPairUrl(origin, backOf(c, req), p.state, name, {
        challenge: challengeOf(verifier),
      }),
    });
  });
  const ownedBy = (req: Request, state: string): PairRecord | null => {
    const p = c.store.get(state);
    return p && p.email === c.userOf(req) ? p : null;
  };
  // Held until the sign-in ends, or `?wait=` ms (at most LONG_POLL_MS); 404 once it is forgotten.
  r.get("/:state", (req, res) => {
    if (!ownedBy(req, req.params.state))
      return void res.status(404).json({ error: "no such pairing" });
    const ms = Math.min(LONG_POLL_MS, Math.max(0, Number(req.query.wait) || 0));
    void c.store.wait(req.params.state, ms).then((p) => {
      if (!p) res.status(404).json({ error: "no such pairing" });
      else res.json({ pairing: viewOf(c, p) });
    });
  });
  // Cancel a sign-in still waiting, or say its ending was told.
  r.delete("/:state", (req, res) => {
    if (!ownedBy(req, req.params.state))
      return void res.status(404).json({ error: "no such pairing" });
    res.json({ forgot: c.store.forget(req.params.state) });
  });
  return r;
}

/** What the browser tab shows: `said` is plain text, escaped here. */
const page = (said: string): string =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>k7</title>
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;padding:24px"><p>${said.replace(
    /[&<>"']/g,
    (ch) => `&#${ch.charCodeAt(0)};`,
  )}</p>`;

/** The page for a sign-in that has ended, served again on a reload. */
function ending(r: PairRecord): { status: number; said: string } {
  const host = hostOf(r.origin);
  switch (r.phase) {
    case "paired":
      return {
        status: 200,
        said: `k7 here is signed in to ${host} as ${r.browserAs || r.email}. You can go back to k7.`,
      };
    case "expired":
      return {
        status: 410,
        said: "This sign-in waited too long. Go back to k7 to start it again.",
      };
    default:
      return {
        status: 500,
        said: "The sign-in could not be stored on this device. Go back to k7.",
      };
  }
}

/** Trade the server's code with the record's verifier; null when the server refused or could not be reached. */
async function redeem(
  c: PairContext,
  p: PairRecord,
  code: string,
): Promise<{ token: string; identity: string } | null> {
  const r = await (c.fetch ?? fetch)(`${p.origin}${SYNC_PAIR_REDEEM_ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, verifier: p.verifier }),
    redirect: "error",
    signal: AbortSignal.timeout(SERVER_MS),
  }).catch(() => null);
  if (!r?.ok) return null;
  const a = (await r.json().catch(() => null)) as {
    token?: unknown;
    identity?: unknown;
  } | null;
  if (typeof a?.token !== "string" || typeof a.identity !== "string")
    return null;
  return { token: a.token, identity: a.identity };
}

/** The return the server redirects the browser to, mounted at SYNC_PAIR_RETURN_PATH with no session guard. */
export function pairReturnHandler(c: PairContext): RequestHandler {
  // One trade per state at a time: a reload during the restart gets the same answer.
  const inflight = new Map<string, Promise<{ status: number; said: string }>>();
  const settle = async (
    p: PairRecord,
    code: string,
  ): Promise<{ status: number; said: string }> => {
    const got = code ? await redeem(c, p, code) : null;
    const phase = got
      ? await storeLink(c, p.email, p.origin, got.identity, got.token)
      : "notStored";
    const as = phase === "paired" ? got?.identity : undefined;
    return ending(
      c.store.settle(p.state, phase, as) ?? { ...p, phase, browserAs: as },
    );
  };
  return (req, res) => {
    const q = new URL(req.originalUrl, "http://127.0.0.1").searchParams;
    const state = q.get("state") ?? "";
    const p = state ? c.store.get(state) : null;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const send = (a: { status: number; said: string }) =>
      res.status(a.status).type("html").send(page(a.said));
    if (!p) return void send({ status: 404, said: "Not found" });
    if (p.phase !== "waiting") return void send(ending(p));
    let answer = inflight.get(state);
    if (!answer) {
      answer = settle(p, q.get("code") ?? "").finally(() =>
        inflight.delete(state),
      );
      inflight.set(state, answer);
    }
    void answer.then(send);
  };
}
