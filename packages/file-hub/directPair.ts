// directPair.ts — a server's POST SYNC_PAIR_DIRECT_ROUTE: a provider access token in, a device token out, for the
// account the provider says it is. Only machines running an older k7 call it: today's sign in through the browser
// (pairSignIn.ts). Mounted only when PAIR_CLIENTS names a client. See docs/syncRelay.md, "Pairing without the browser".

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

/** How many direct pairings one address may try in a window. */
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

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
    const refuse = (why: string) => {
      console.log(`sync | direct pairing refused: ${why}`);
      res.status(401).json({ error: NOT_ACCEPTED });
    };
    if (!allow(req.ip ?? ""))
      return void res
        .status(429)
        .json({ error: "Too many pairing attempts. Try again in a minute." });
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") ?? "");
    // The machine names its provider: a token from another one is not even sent on.
    if (!bearer) return refuse("no bearer");
    if (req.body?.issuer !== s.issuer)
      return refuse(`issuer ${String(req.body?.issuer)} is not ${s.issuer}`);
    void s.verify(bearer[1]).then(
      (word) => {
        if (!word?.email) return refuse("the provider did not vouch for it");
        if (!word.clientId || !s.clients.includes(word.clientId))
          return refuse(`client ${word.clientId ?? "unnamed"} not allowed`);
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
      () => refuse("the provider could not be asked"),
    );
  };
}
