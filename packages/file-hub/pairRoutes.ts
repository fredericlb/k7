// pairRoutes.ts — saving a server for an account of a machine (the tray, the phones): the page asks here whether to
// offer it, starts it, opens the URL it gets in the browser, and waits here for the ending; a server refuses them all.
// The browser comes back to THIS backend's loopback port (`pairReturnHandler`) with no session: the state is the gate.
// The link takes the remote account the browser came back as, and becomes the active one. A signed-in account tries
// the server's direct route first (directPair.ts), and only opens the browser when it is refused.
// See docs/syncRelay.md, "Pairing through the browser" and "Pairing without the browser".

import { mkdirSync } from "node:fs";
import {
  normalizeServer,
  SYNC_PAIR_RETURN_PATH,
  SYNC_RELAY_PATH,
  syncPairUrl,
} from "@studio/web-protocol/pairing";
import express, { type Request, type RequestHandler, Router } from "express";
import {
  canPairDirect,
  type DirectPairClient,
  pairDirect,
} from "./directPair.ts";
import { accountKey } from "./instances.ts";
import type { PairingStore, PairRecord } from "./pairingStore.ts";
import {
  linkId,
  linkOf,
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
  /** The machine's local user, signed in nowhere: any account it links is one the server's page asks for. */
  isLocal: (req: Request) => boolean;
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
  /** The server's direct route, tried before the browser for a signed-in account; absent, the browser always. */
  direct?: DirectPairClient;
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

/** Store the token the origin minted for `identity` as the account's active link, as the browser's return does. */
async function storeLink(
  c: PairContext,
  email: string,
  origin: string,
  identity: string,
  token: string,
): Promise<"paired" | "alreadyLinked" | "notStored"> {
  const home = c.accountDir(accountKey(email));
  // That account on that server is linked already: the link it has stays as it is.
  if (linkOf(readRemotes(home), relayOf(origin), identity))
    return "alreadyLinked";
  try {
    if (!token) throw new Error("no token");
    mkdirSync(home, { recursive: true });
    const before = readRemotes(home);
    // The relay is reached where the person named the server, whatever host a proxy showed the origin.
    writeRemote(home, {
      url: relayOf(origin),
      token,
      user: email,
      as: identity,
    });
    await c.restart(email);
    // The new server is the active one: the engine leaves the one it was on for it.
    c.engineFollows?.(before, readRemotes(home));
    return "paired";
  } catch {
    return "notStored";
  }
}

/** What an app is told of a pairing; the token rides along once paired, for the phone's supervisor. */
function viewOf(c: PairContext, r: PairRecord) {
  const list =
    r.phase === "paired" ? readRemotes(c.accountDir(accountKey(r.email))) : [];
  const link = list.find(
    (s) => s.id === linkId(relayOf(r.origin), r.browserAs ?? r.email),
  );
  return {
    state: r.state,
    email: r.email,
    origin: r.origin,
    host: hostOf(r.origin),
    another: r.another === true,
    phase: r.phase,
    until: r.until,
    browserAs: r.browserAs ?? null,
    link: link?.id ?? null,
    // For the phone's supervisor, whose engine is listed at the active server with its token.
    token: link?.active ? link.token : null,
  };
}

export function pairRouter(c: PairContext): Router {
  const r = Router();
  r.use(express.json());
  // A server is the remote itself: it adds no server, and offers none.
  r.use((_req, res, next) => {
    if (c.machine) return next();
    res.status(403).json({ error: SERVER_ADDS_NONE });
  });
  const linksOf = (email: string) =>
    readRemotes(c.accountDir(accountKey(email)));
  const hostsOf = (email: string) =>
    new Set(linksOf(email).map((s) => hostOf(s.url)));
  // Whether to offer a pairing with `?origin=`, and the account's pairing under way or ended unseen.
  r.get("/", async (req, res) => {
    const email = c.userOf(req);
    if (!email)
      return void res.status(401).json({ error: "no user on the session" });
    const origin = normalizeServer(String(req.query.origin ?? ""));
    const mine = c.store.ofAccount(email);
    const local = c.isLocal(req);
    // The servers a click pairs with at once, so the page opens no tab for them (docs/syncRelay.md).
    const silent =
      !local && !!c.direct && (await c.direct.tokenOf(req)) !== null;
    res.json({
      email,
      local,
      paired: origin ? hostsOf(email).has(hostOf(origin)) : false,
      servers: hostsOf(email).size,
      links: linksOf(email).length,
      pairing: mine ? viewOf(c, mine) : null,
      direct:
        !!origin && !local && (await canPairDirect(c.direct, req, origin)),
      directHosts: silent ? (c.direct?.servers ?? []) : [],
    });
  });
  r.post("/", async (req, res) => {
    const email = c.userOf(req);
    if (!email)
      return void res.status(401).json({ error: "no user on the session" });
    // Another account on a server already linked: the server's page asks which one.
    const another = req.body?.another === true;
    const origin = normalizeServer(String(req.body?.origin ?? ""));
    if (!origin)
      return void res.status(400).json({ error: "origin is no k7 server" });
    if (hostOf(origin) === c.selfHost(req))
      return void res.status(400).json({ error: "that is this server" });
    if (!another && hostsOf(email).has(hostOf(origin))) {
      // Saved already: asked again for the active server, the engine is listed back there with its token.
      const [active] = linksOf(email);
      if (active && hostOf(active.url) === hostOf(origin))
        c.engineFollows?.([], [active]);
      return void res.status(409).json({ error: "already paired there" });
    }
    const name = String(req.body?.name ?? "").trim() || "a machine";
    // The local user has no account anywhere, so whichever it links is a choice the server's page asks for.
    const choose = another || c.isLocal(req);
    // A signed-in account proves itself to the server with its provider token: no browser, unless refused.
    const direct = choose
      ? null
      : await pairDirect(c.direct, req, origin, name);
    if (direct) {
      const p = c.store.begin(email, origin);
      const phase = await storeLink(
        c,
        email,
        origin,
        direct.identity,
        direct.token,
      );
      const ended = c.store.settle(p.state, phase, direct.identity) ?? p;
      return void res.json({ pairing: viewOf(c, ended), url: null });
    }
    const p = c.store.begin(email, origin, another);
    const back = `${c.returnTo(req)}${SYNC_PAIR_RETURN_PATH}`;
    res.json({
      pairing: viewOf(c, p),
      url: syncPairUrl(
        origin,
        back,
        p.state,
        name,
        choose ? { choose } : { as: email },
      ),
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
  const as = r.browserAs || r.email;
  switch (r.phase) {
    case "paired":
      return {
        status: 200,
        said: `k7 here now syncs your workspaces with ${host} as ${as}. You can go back to k7.`,
      };
    case "alreadyLinked":
    case "otherAccount":
      return {
        status: 409,
        said: `k7 here already syncs with ${host} as ${as}, so nothing changed. To add another account, sign in to ${host} as that one. Go back to k7.`,
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
    // The account the origin minted for, which its page let the person pick: the link's remote account.
    const identity = q.get("identity")?.trim() || p.email;
    const token = q.get("token")?.trim() ?? "";
    const phase = await storeLink(c, p.email, p.origin, identity, token);
    const as = phase === "notStored" ? undefined : identity;
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
      answer = settle(p, q).finally(() => inflight.delete(state));
      inflight.set(state, answer);
    }
    void answer.then(send);
  };
}
