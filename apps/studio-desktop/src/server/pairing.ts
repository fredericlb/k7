// pairing.ts — the loopback end of RFC 8252's shape: the system browser signs in on the
// SERVER's origin, and the token comes back to a port only this machine can be listening on.
//
// The desktop is deliberately NOT an OIDC client. The dance happens where it always did, so
// `redirectUriFor` derives the server's own origin, the IdP configuration is untouched, and
// `commons/packages/http/origin.ts`'s "the redirect_uri must be ABSOLUTE" never fires against
// us. What comes back is a studio token, which is what `bearerOrSession` was built for.
// See ../../docs/pairing.md.

import { randomBytes } from "node:crypto";
import { PAIR_RETURN_PATH } from "@studio/web-protocol/pairing";
import type { Express } from "express";
import { line } from "../logbus.ts";
import { isLoopback } from "./origin.ts";

/** One round trip, one token: a pairing that is not answered in this long is abandoned. */
const WINDOW_MS = 2 * 60_000;

interface Pending {
  state: string;
  until: number;
}

export interface PairingResult {
  token: string;
  /** The account's identity, so the workspaces can move with it — see identity.ts. */
  identity: string | null;
}

let pending: Pending | null = null;

/** Arm a pairing and answer the nonce to send. Arming twice abandons the first. */
export function armPairing(): string {
  const state = randomBytes(24).toString("base64url");
  pending = { state, until: Date.now() + WINDOW_MS };
  return state;
}

export function pairingReturnUrl(localUrl: string): string {
  return new URL(PAIR_RETURN_PATH, localUrl).toString();
}

/**
 * The route the browser is redirected to. Three things have to hold, and each is a way a link
 * somebody sent could otherwise plant a token: it must come from THIS machine, a pairing must
 * be armed and unexpired, and the state must match the nonce we generated.
 */
export function mountPairing(
  app: Express,
  onPaired: (r: PairingResult) => void,
): void {
  app.get(PAIR_RETURN_PATH, (req, res) => {
    const armed = pending;
    pending = null; // one shot, whatever happens next

    const refuse = (why: string) => {
      line("host", `pairing refused: ${why}`);
      res
        .status(400)
        .type("html")
        .send(`<!doctype html><title>studio</title><p>Pairing failed: ${why}.`);
    };

    if (!isLoopback(req)) return refuse("not from this machine");
    if (!armed) return refuse("nothing was waiting to be paired");
    if (Date.now() > armed.until) return refuse("it took too long");
    if (req.query.state !== armed.state)
      return refuse("the state did not match");

    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return refuse("the server sent no token");

    onPaired({
      token,
      identity:
        typeof req.query.identity === "string" ? req.query.identity : null,
    });
    line("host", "paired with the server");
    res
      .type("html")
      .send(
        "<!doctype html><title>studio</title><p>Paired. You can close this tab and go back to studio.",
      );
  });
}
