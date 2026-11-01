// pairSignIn.ts — a server's half of a machine's sign-in: the person has just signed in here, so a one-use code goes
// back to the machine with no page to confirm; the machine's backend trades it, with its verifier, for the device token.
// Signing out, the machine hands the token back by that token. The fresh sign-in is the backend's gate's to demand.
// See docs/syncRelay.md, "Signing in is pairing".

import { isHandoffReturn } from "@studio/web-protocol/handoff";
import express, { type RequestHandler, Router } from "express";
import type { DeviceTokens } from "./deviceTokens.ts";
import { relayUrlOf } from "./directPair.ts";
import { accountKey } from "./instances.ts";
import type { PairCodes, PairGrant } from "./pairCodes.ts";

/** Send a code for `grant` to the machine's return; 400 when the return or the challenge is not one. */
export function sendPairCode(
  codes: PairCodes,
  grant: PairGrant,
  q: { return: string; state: string; challenge: string },
): { status: number; location?: string; error?: string } {
  // A loopback port, or one of the phone apps' schemes: where the code lands is the machine itself.
  if (!isHandoffReturn(q.return))
    return { status: 400, error: "return must be loopback or the app" };
  const code = codes.issue(grant, q.challenge);
  if (!code) return { status: 400, error: "challenge must be S256" };
  const target = new URL(q.return);
  target.searchParams.set("code", code);
  if (q.state) target.searchParams.set("state", q.state);
  return { status: 303, location: target.toString() };
}

/** POST `{code, verifier}` → the device token, minted now for the person the code stands for. */
export function redeemRouter(codes: PairCodes, devices: DeviceTokens): Router {
  const r = Router();
  r.post("/", express.json({ limit: "4kb" }), (req, res) => {
    const code = String(req.body?.code ?? "");
    const verifier = String(req.body?.verifier ?? "");
    const grant = code && verifier ? codes.redeem(code, verifier) : null;
    if (!grant)
      return void res.status(401).json({ error: "no such code, or not yours" });
    const { device, token } = devices.mint(
      accountKey(grant.user),
      grant.name,
      grant.sub,
    );
    res.json({
      token,
      device: device.id,
      url: relayUrlOf(req),
      identity: grant.user,
    });
  });
  return r;
}

/** DELETE with `Authorization: Bearer <token>`: the device that token names is revoked, and nothing else is. */
export function selfRevokeHandler(devices: DeviceTokens): RequestHandler {
  return (req, res) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const who = token ? devices.verify(token) : null;
    if (!who) return void res.status(401).json({ error: "no such device" });
    res.json({ removed: devices.revoke(who.slug, who.id) });
  };
}
