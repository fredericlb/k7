// pairRoutes.ts — pairing a LOCAL account with a remote origin, for the desktop and the phones alike: the app asks
// here whether to offer it, starts it, opens the URL it gets in the system browser, and waits here for the ending.
// The browser comes back to THIS backend's loopback port (`pairReturnHandler`), with no session: the state is the
// gate. See docs/syncRelay.md, "Pairing through the browser".

import { mkdirSync } from "node:fs";
import {
  normalizeServer,
  SYNC_PAIR_RETURN_PATH,
  SYNC_RELAY_PATH,
  syncPairUrl,
} from "@studio/web-protocol/pairing";
import express, { type Request, type RequestHandler, Router } from "express";
import { accountKey } from "./instances.ts";
import type { PairingStore, PairRecord } from "./pairingStore.ts";
import { readRemotes, writeRemote } from "./syncRemote.ts";

/** What the pairing routes need of the hub. */
export interface PairContext {
  store: PairingStore;
  userOf: (req: Request) => string;
  /** The machine's local user, who has no account at any origin. */
  isLocal: (req: Request) => boolean;
  accountDir: (slug: string) => string;
  /** Restart the account's file service, so it dials the relay just paired. */
  restart: (user: string) => Promise<unknown>;
  /** This backend's own port on 127.0.0.1: where the browser comes back. */
  selfPort: () => number;
}

/** The longest one GET /:state holds before answering a pairing still waiting. */
const LONG_POLL_MS = 25_000;

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

/** What an app is told of a pairing; the token rides along once paired, for the phone's supervisor. */
function viewOf(c: PairContext, r: PairRecord) {
  const remote =
    r.phase === "paired"
      ? readRemotes(c.accountDir(accountKey(r.email))).find(
          (s) => hostOf(s.url) === hostOf(r.origin),
        )
      : undefined;
  return {
    state: r.state,
    email: r.email,
    origin: r.origin,
    host: hostOf(r.origin),
    main: r.main,
    phase: r.phase,
    until: r.until,
    browserAs: r.browserAs ?? null,
    token: remote?.token ?? null,
  };
}

export function pairRouter(c: PairContext): Router {
  const r = Router();
  r.use(express.json());
  const hostsOf = (email: string) =>
    new Set(
      readRemotes(c.accountDir(accountKey(email))).map((s) => hostOf(s.url)),
    );
  // Whether to offer a pairing with `?origin=`, and the account's pairing under way or ended unseen.
  r.get("/", (req, res) => {
    const email = c.userOf(req);
    if (!email)
      return void res.status(401).json({ error: "no user on the session" });
    const local = c.isLocal(req);
    const origin = normalizeServer(String(req.query.origin ?? ""));
    const mine = local ? null : c.store.ofAccount(email);
    res.json({
      email,
      local,
      paired: origin ? hostsOf(email).has(hostOf(origin)) : false,
      servers: hostsOf(email).size,
      pairing: mine ? viewOf(c, mine) : null,
    });
  });
  r.post("/", (req, res) => {
    const email = c.userOf(req);
    if (!email || c.isLocal(req))
      return void res.status(401).json({ error: "no account to pair" });
    const origin = normalizeServer(String(req.body?.origin ?? ""));
    if (!origin)
      return void res.status(400).json({ error: "origin is no k7 server" });
    if (hostsOf(email).has(hostOf(origin)))
      return void res.status(409).json({ error: "already paired there" });
    const name = String(req.body?.name ?? "").trim() || "a machine";
    // The first server paired is the main one whatever it was asked as.
    const main = req.body?.main !== false || hostsOf(email).size === 0;
    const p = c.store.begin(email, origin, main);
    const back = `http://127.0.0.1:${c.selfPort()}${SYNC_PAIR_RETURN_PATH}`;
    res.json({
      pairing: viewOf(c, p),
      url: syncPairUrl(origin, back, p.state, name),
    });
  });
  const ownedBy = (req: Request, state: string): PairRecord | null => {
    const p = c.store.get(state);
    return p && p.email === c.userOf(req) ? p : null;
  };
  // Held until the pairing ends, or `?wait=` ms (at most LONG_POLL_MS); 404 once it is forgotten.
  r.get("/:state", (req, res) => {
    if (!ownedBy(req, req.params.state))
      return void res.status(404).json({ error: "no such pairing" });
    const ms = Math.min(LONG_POLL_MS, Math.max(0, Number(req.query.wait) || 0));
    void c.store.wait(req.params.state, ms).then((p) => {
      if (!p) res.status(404).json({ error: "no such pairing" });
      else res.json({ pairing: viewOf(c, p) });
    });
  });
  // Cancel a pairing still waiting, or say its ending was told.
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

/** The page for a pairing that has ended, served again on a reload. */
function ending(r: PairRecord): { status: number; said: string } {
  const host = hostOf(r.origin);
  switch (r.phase) {
    case "paired":
      return {
        status: 200,
        said: `This device now syncs your workspaces with ${host}. You can go back to k7.`,
      };
    case "otherAccount":
      return {
        status: 409,
        said: `This browser is signed in to ${host} as ${r.browserAs || "another account"}, and k7 as ${r.email}, so nothing was paired. Go back to k7: it says what to do.`,
      };
    case "expired":
      return {
        status: 410,
        said: "This pairing waited too long. Go back to k7 to start it again.",
      };
    default:
      return {
        status: 500,
        said: "The pairing could not be stored on this device. Go back to k7.",
      };
  }
}

/** The return the origin redirects the browser to, mounted at SYNC_PAIR_RETURN_PATH with no session guard. */
export function pairReturnHandler(c: PairContext): RequestHandler {
  // One store per state at a time: a reload during the restart gets the same answer.
  const inflight = new Map<string, Promise<{ status: number; said: string }>>();
  const settle = async (
    p: PairRecord,
    q: URLSearchParams,
  ): Promise<{ status: number; said: string }> => {
    const identity = q.get("identity") ?? "";
    // The browser may be signed in to the origin as someone else: their token must not sync this account.
    if (identity !== p.email)
      return ending(
        c.store.settle(p.state, "otherAccount", identity) ?? {
          ...p,
          phase: "otherAccount",
        },
      );
    const token = q.get("token")?.trim() ?? "";
    try {
      if (!token) throw new Error("no token");
      const home = c.accountDir(accountKey(p.email));
      mkdirSync(home, { recursive: true });
      // The relay is reached where the person named the server, whatever host a proxy showed the origin.
      writeRemote(home, {
        url: relayOf(p.origin),
        token,
        user: p.email,
        main: p.main,
      });
      await c.restart(p.email);
      return ending(
        c.store.settle(p.state, "paired") ?? { ...p, phase: "paired" },
      );
    } catch {
      return ending(
        c.store.settle(p.state, "notStored") ?? { ...p, phase: "notStored" },
      );
    }
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
      answer = settle(p, q).finally(() => inflight.delete(state));
      inflight.set(state, answer);
    }
    void answer.then(send);
  };
}
