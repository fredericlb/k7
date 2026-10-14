// handoff.ts — a sign-in made in the system browser, carried into an app's own view by a one-use code. See ../docs/handoff.md.
// The code is useless alone: it is bound to a challenge, and only the app that opened the browser holds its verifier.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type SessionUser, safeReturnTarget } from "@frediverse/oidc";
import {
  HANDOFF_ISSUE,
  HANDOFF_REDEEM,
  isHandoffReturn,
  LOCAL_SIGN_IN,
} from "@studio/web-protocol/handoff";
import type { Express, Request } from "express";

/** Long enough for a phone to switch apps, short enough that a leaked code is already dead. */
const CODE_TTL_MS = 120_000;

/** The desktop's signed-out user: the dev stub's identity, so its workspaces stay where they were. */
const LOCAL_USER: SessionUser = {
  sub: "dev-user",
  name: "Local user",
  email: "dev@example.com",
  groups: [],
  local: true,
};

interface CodeBody {
  u: SessionUser;
  c: string;
  e: number;
}

const b64 = (b: Buffer | string): string =>
  Buffer.from(b).toString("base64url");
const query = (req: Request, k: string): string =>
  typeof req.query[k] === "string" ? (req.query[k] as string) : "";

/** `S256`, as PKCE spells it: what the app sends is the hash of what it keeps. */
export const challengeOf = (verifier: string): string =>
  b64(createHash("sha256").update(verifier).digest());

export function signCode(key: string, body: CodeBody): string {
  const payload = b64(JSON.stringify(body));
  return `${payload}.${b64(createHmac("sha256", key).update(payload).digest())}`;
}

/** The user a code carries, or null when it is forged, expired, or redeemed without its verifier. */
export function openCode(
  key: string,
  code: string,
  verifier: string,
  now = Date.now(),
): SessionUser | null {
  const [payload, sig] = code.split(".");
  if (!payload || !sig) return null;
  const want = createHmac("sha256", key).update(payload).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let body: CodeBody;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (body.e < now || body.c !== challengeOf(verifier)) return null;
  return body.u;
}

export function mountHandoff(
  app: Express,
  opts: { secret: string; localUser: boolean },
): void {
  // Its own key, so a handoff code can never pass for a session cookie or an API token.
  const key = `${opts.secret}:handoff`;

  app.get(HANDOFF_ISSUE, (req, res) => {
    const redirect = query(req, "redirect");
    const challenge = query(req, "challenge");
    if (!isHandoffReturn(redirect) || !challenge)
      return res.status(400).send("bad handoff request");
    const user = req.session?.user as SessionUser | undefined;
    // Not signed in here yet (or only as the desktop's local user): sign in, and come back to this same address.
    if (!user || user.local)
      return res.redirect(
        `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`,
      );
    const code = signCode(key, {
      u: user,
      c: challenge,
      e: Date.now() + CODE_TTL_MS,
    });
    // The desktop asks the browser to forget: the session is the app's now, not the browser's.
    if (query(req, "forget") === "1") req.session = null;
    const to = new URL(redirect);
    to.searchParams.set("code", code);
    to.searchParams.set("state", query(req, "state"));
    res.redirect(to.toString());
  });

  app.get(HANDOFF_REDEEM, (req, res) => {
    const user = openCode(key, query(req, "code"), query(req, "verifier"));
    if (!user)
      return res.status(401).send("This sign-in link has expired. Try again.");
    // biome-ignore lint/style/noNonNullAssertion: setupAuth mounts the session middleware before this.
    req.session!.user = user;
    res.redirect(safeReturnTarget(query(req, "return_to") || "/", req));
  });

  if (!opts.localUser) return;
  // The desktop works signed out: an existing session is kept, an empty one becomes the local user.
  app.get(LOCAL_SIGN_IN, (req, res) => {
    // biome-ignore lint/style/noNonNullAssertion: setupAuth mounts the session middleware before this.
    const session = req.session!;
    if (!session.user) session.user = LOCAL_USER;
    res.redirect(safeReturnTarget(query(req, "return_to") || "/", req));
  });
}
