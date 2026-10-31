// directPair.ts — a machine signed in to the server's own identity provider pairs with no browser: its backend
// sends the provider's access token to the server's POST SYNC_PAIR_DIRECT_ROUTE, which asks the provider whose it
// is and mints a device token for that account, as the browser pairing does. Both halves are here.
// What a reader gets wrong: the token is a bearer for the PERSON at the provider, so the machine sends it only to
// the servers it trusts with it (`servers`), never to whatever address was typed. See docs/syncRelay.md.

import { SYNC_PAIR_DIRECT_ROUTE } from "@studio/web-protocol/pairing";
import type { Request, RequestHandler } from "express";
import type { DeviceTokens } from "./deviceTokens.ts";
import { accountKey } from "./instances.ts";
import { publicHost } from "./publicOrigin.ts";
import { SYNC_PATH } from "./syncRelay.ts";

/** What the server says to every refusal: the reason stays on the server. */
export const NOT_ACCEPTED =
  "This sign-in was not accepted for pairing. Pair through the browser instead.";

/** What the provider says of a token, read by the app that knows the provider (k7's backend). */
export interface ProviderWord {
  email: string;
  sub: string;
  /** The client the token was issued to, or null when the provider does not say. */
  clientId: string | null;
}

/** The server's half: which provider and clients it takes a token from. */
export interface DirectPairServer {
  issuer: string;
  /** The client ids whose tokens may pair; never empty, or the route is not mounted. */
  clients: string[];
  verify: (accessToken: string) => Promise<ProviderWord | null>;
  now?: () => number;
}

/** The machine's half: the session's token, and the servers it may be sent to. */
export interface DirectPairClient {
  /** The session's provider access token, or null: the local user, or a backend restarted since the sign-in. */
  tokenOf: (req: Request) => Promise<string | null>;
  issuer: string;
  /** Hosts trusted with the token. */
  servers: string[];
  fetch?: typeof fetch;
}

/** How many direct pairings one address may try in a window. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
/** How long the machine waits on the server before it falls back to the browser. */
const DIRECT_TIMEOUT_MS = 15_000;

/** The relay of the origin a request reached, as a WebSocket URL. */
export function relayUrlOf(req: Request): string {
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto === "https" ? "wss" : "ws"}://${publicHost(req)}${SYNC_PATH}`;
}

/** At most `limit` hits per key in `windowMs`; true when this one is let through. */
function rateLimiter(limit: number, windowMs: number, now: () => number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    if (hits.size > 10_000)
      for (const [k, v] of hits)
        if (v.every((h) => h <= t - windowMs)) hits.delete(k);
    const recent = (hits.get(key) ?? []).filter((h) => h > t - windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    hits.set(key, [...recent, t]);
    return true;
  };
}

/** The server's POST: a bearer access token from its own provider, issued to an allowed client, buys a device token. */
export function directPairHandler(
  s: DirectPairServer,
  devices: DeviceTokens,
): RequestHandler {
  const allow = rateLimiter(RATE_LIMIT, RATE_WINDOW_MS, s.now ?? Date.now);
  return (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const refuse = () => void res.status(401).json({ error: NOT_ACCEPTED });
    if (!allow(req.ip ?? ""))
      return void res
        .status(429)
        .json({ error: "Too many pairing attempts. Try again in a minute." });
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") ?? "");
    // The machine names its provider: a token from another one is not even sent on.
    if (!bearer || req.body?.issuer !== s.issuer) return refuse();
    void s.verify(bearer[1]).then(
      (word) => {
        if (
          !word?.email ||
          !word.clientId ||
          !s.clients.includes(word.clientId)
        )
          return refuse();
        const raw = typeof req.body?.name === "string" ? req.body.name : "";
        const name = raw.trim().slice(0, 80) || "a machine";
        const { device, token } = devices.mint(
          accountKey(word.email),
          name,
          word.sub,
        );
        res.json({
          token,
          device: device.id,
          url: relayUrlOf(req),
          identity: word.email,
        });
      },
      () => refuse(),
    );
  };
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/** Whether this session would try the direct route with `origin`: a trusted server, and a kept token. */
export async function canPairDirect(
  d: DirectPairClient | undefined,
  req: Request,
  origin: string,
): Promise<boolean> {
  if (!d?.servers.includes(hostOf(origin))) return false;
  return (await d.tokenOf(req)) !== null;
}

/** The machine's attempt: the device token and the account it is for, or null for the browser to take over. */
export async function pairDirect(
  d: DirectPairClient | undefined,
  req: Request,
  origin: string,
  name: string,
): Promise<{ token: string; identity: string } | null> {
  if (!d?.servers.includes(hostOf(origin))) return null;
  const accessToken = await d.tokenOf(req);
  if (!accessToken) return null;
  try {
    const r = await (d.fetch ?? fetch)(
      `${origin.replace(/\/+$/, "")}${SYNC_PAIR_DIRECT_ROUTE}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name, issuer: d.issuer }),
        // A redirect would carry the bearer to wherever it points.
        redirect: "error",
        signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
      },
    );
    if (!r.ok) return null;
    const a = (await r.json()) as { token?: unknown; identity?: unknown };
    if (typeof a.token !== "string" || !a.token) return null;
    if (typeof a.identity !== "string" || !a.identity) return null;
    return { token: a.token, identity: a.identity };
  } catch {
    return null;
  }
}
