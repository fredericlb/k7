// handoff.ts — a sign-in made in the system browser, carried into an app's own view by a one-use code. See ../docs/handoff.md.
// The code is useless alone: it is bound to a challenge, and only the app that opened the browser holds its verifier.
// What a reader gets wrong: a verifier is no proof of WHO redeems. Redeem also needs an app-made navigation, and never replaces another account.

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  type AuthHandle,
  isSameOriginRequest,
  type SessionUser,
  safeReturnTarget,
} from "@frediverse/oidc";
import {
  APP_SCHEME,
  HANDOFF_ISSUE,
  HANDOFF_REDEEM,
  isHandoffReturn,
  LOCAL_SIGN_IN,
} from "@studio/web-protocol/handoff";
import { isLoopbackReturn } from "@studio/web-protocol/pairing";
import express, { type Express, type Request, type Response } from "express";
import { isLoopbackRequest } from "./loopback.ts";

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

/** A code's body: the user, the challenge, its expiry, the session's own stamps, and a nonce. */
interface CodeBody {
  u: SessionUser;
  c: string;
  e: number;
  i?: number;
  x?: number;
  n?: string;
}

/** What a redeemed code opens: the user, and the stamps of the session it was issued from. */
export interface OpenedCode {
  user: SessionUser;
  stamps?: { iat: number; exp: number };
  expires: number;
}

type Auth = Pick<AuthHandle, "startSession" | "sessionUser" | "sessionStamps">;

const b64 = (b: Buffer | string): string =>
  Buffer.from(b).toString("base64url");
const field = (src: Record<string, unknown>, k: string): string =>
  typeof src[k] === "string" ? (src[k] as string) : "";
const query = (req: Request, k: string): string =>
  field(req.query as Record<string, unknown>, k);
const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );

/** `S256`, as PKCE spells it: what the app sends is the hash of what it keeps. */
export const challengeOf = (verifier: string): string =>
  b64(createHash("sha256").update(verifier).digest());

export function signCode(key: string, body: CodeBody): string {
  const payload = b64(JSON.stringify(body));
  return `${payload}.${b64(createHmac("sha256", key).update(payload).digest())}`;
}

/** What a code carries, or null when it is forged, expired, or redeemed without its verifier. */
export function openCode(
  key: string,
  code: string,
  verifier: string,
  now = Date.now(),
): OpenedCode | null {
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
  const stamps =
    typeof body.i === "number" && typeof body.x === "number"
      ? { iat: body.i, exp: body.x }
      : undefined;
  return { user: body.u, stamps, expires: body.e };
}

/** Codes already redeemed, by hash, until they would have expired anyway. */
export function redeemedCodes(): (code: string, expires: number) => boolean {
  const seen = new Map<string, number>();
  return (code, expires) => {
    const now = Date.now();
    for (const [h, e] of seen) if (e < now) seen.delete(h);
    const hash = createHash("sha256").update(code).digest("hex");
    if (seen.has(hash)) return false;
    seen.set(hash, expires);
    return true;
  };
}

/** Whether a navigation was made by the app itself (or this origin), not by a link on another site. */
export function isAppNavigation(req: Request): boolean {
  const site = req.get("sec-fetch-site");
  if (site !== undefined) return site === "none" || site === "same-origin";
  // A WebView that sends no Sec-Fetch-Site still names the app it runs in, which no page can forge.
  return req.get("x-requested-with") === APP_SCHEME;
}

/** Where the code would go, in words the person can check. */
function destination(redirect: string): string {
  if (isLoopbackReturn(redirect))
    return `the k7 app on this computer (${new URL(redirect).host})`;
  return "the k7 app on this phone";
}

function page(res: Response, status: number, body: string): void {
  res
    .status(status)
    .setHeader("Cache-Control", "no-store")
    .setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    )
    .setHeader("X-Frame-Options", "DENY")
    .type("html")
    .send(`<!doctype html><meta charset="utf-8"><title>k7</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:28rem;padding:1rem">${body}</main>`);
}

function confirmPage(
  res: Response,
  user: SessionUser,
  p: Record<string, string>,
): void {
  const who = escapeHtml(String(user.email || user.name || user.sub || ""));
  const hidden = Object.entries(p)
    .map(
      ([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`,
    )
    .join("");
  page(
    res,
    200,
    `<h1 style="font-size:1.25rem">Sign in k7 on this device?</h1>
<p>${escapeHtml(destination(p.redirect))} asks to be signed in as <b>${who}</b>.</p>
<p>Continue only if you just pressed Sign in in that app.</p>
<form method="post" action="${HANDOFF_ISSUE}">${hidden}
<button type="submit" style="font:inherit;padding:.5rem 1rem">Sign in</button></form>`,
  );
}

export function mountHandoff(
  app: Express,
  opts: { secret: string; localUser: boolean; auth: Auth },
): void {
  const { auth } = opts;
  // Its own key, so a handoff code can never pass for a session cookie or an API token.
  const key = `${opts.secret}:handoff`;
  const firstRedeem = redeemedCodes();

  // The browser's half, step one: sign in if needed, then ask the person before any code leaves.
  app.get(HANDOFF_ISSUE, (req, res) => {
    const redirect = query(req, "redirect");
    const challenge = query(req, "challenge");
    if (!isHandoffReturn(redirect) || !challenge)
      return res.status(400).send("bad handoff request");
    const user = auth.sessionUser(req);
    // Not signed in here yet (or only as the desktop's local user): sign in, and come back to this same address.
    if (!user || user.local)
      return res.redirect(
        `/auth/login?return_to=${encodeURIComponent(req.originalUrl)}`,
      );
    confirmPage(res, user, {
      redirect,
      challenge,
      state: query(req, "state"),
      forget: query(req, "forget") === "1" ? "1" : "",
    });
  });

  // Step two, the confirmation's POST: only from this origin's own page.
  app.post(
    HANDOFF_ISSUE,
    express.urlencoded({ extended: false, limit: "4kb" }),
    (req, res) => {
      if (!isSameOriginRequest(req))
        return res.status(403).send("cross-site request refused");
      const form = (req.body ?? {}) as Record<string, unknown>;
      const redirect = field(form, "redirect");
      const challenge = field(form, "challenge");
      if (!isHandoffReturn(redirect) || !challenge)
        return res.status(400).send("bad handoff request");
      const user = auth.sessionUser(req);
      const stamps = auth.sessionStamps(req);
      if (!user || user.local || !stamps)
        return res.status(401).send("Sign in first.");
      const code = signCode(key, {
        u: user,
        c: challenge,
        e: Date.now() + CODE_TTL_MS,
        i: stamps.iat,
        x: stamps.exp,
        n: b64(randomBytes(9)),
      });
      // The desktop asks the browser to forget: the session is the app's now, not the browser's.
      if (field(form, "forget") === "1") req.session = null;
      const to = new URL(redirect);
      to.searchParams.set("code", code);
      to.searchParams.set("state", field(form, "state"));
      res.redirect(303, to.toString());
    },
  );

  // The app's half: its own view trades the code and its verifier for a session.
  app.get(HANDOFF_REDEEM, (req, res) => {
    // A link on another site is a login CSRF: only the app's own navigation (Sec-Fetch-Site: none) may redeem.
    if (!isAppNavigation(req))
      return page(
        res,
        403,
        "<p>This sign-in link must be opened by the k7 app.</p>",
      );
    const opened = openCode(key, query(req, "code"), query(req, "verifier"));
    if (!opened)
      return res.status(401).send("This sign-in link has expired. Try again.");
    const current = auth.sessionUser(req);
    if (current && !current.local && current.sub !== opened.user.sub)
      return page(
        res,
        409,
        "<p>Another account is signed in here. Sign out first, then sign in again.</p>",
      );
    if (!firstRedeem(query(req, "code"), opened.expires))
      return res.status(401).send("This sign-in link was already used.");
    auth.startSession(req, opened.user, opened.stamps);
    res.redirect(safeReturnTarget(query(req, "return_to") || "/", req));
  });

  if (!opts.localUser) return;
  // The desktop works signed out: an existing session is kept, an empty one becomes the local user.
  app.get(LOCAL_SIGN_IN, (req, res) => {
    // A session for the asking: only this machine's own window may ask, by address and by name.
    if (!isLoopbackRequest(req))
      return res
        .status(403)
        .send("The local user signs in on this machine only.");
    if (!auth.sessionUser(req)) auth.startSession(req, LOCAL_USER);
    res.redirect(safeReturnTarget(query(req, "return_to") || "/", req));
  });
}
