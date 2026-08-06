import {
  type SessionUser as BaseSessionUser,
  isAdmin as isAdminOf,
  sessionFromCookieHeader,
} from "@frediverse/oidc";
import type { Request } from "express";
import type { AuthConfig } from "../config.ts";

// Two cookies reach this backend, and only ONE of them is ours to write.
//
//   bt_session   the game's own — guests, who have no account at all. Issued
//                here by cookie-session, signed with SESSION_SECRET.
//   studio.sid   the studio account, minted by st0 at the origin root and
//                shared with l8 and m9. Read-only here.
//
// The account login stopped being z0's the day the IdP refused
// <origin>/z0/auth/callback: only the prefixless callback is registered, so a
// service under a path cannot run its own flow on this client. docs/auth.md.
export const SESSION_COOKIE_NAME = "bt_session";
export const STUDIO_COOKIE_NAME = "studio.sid";

/**
 * The authenticated principal, stored in the session cookie by
 * @frediverse/oidc's cookie-session. The shared package supplies
 * sub/email/name/groups; `kind` is ours:
 *   "user"          a studio account, read off st0's studio.sid
 *   "guest"         buzzer guest, session password, no subject
 *   "guest_online"  online guest, localStorage UUID as subject
 *
 * There is no `exp` any more: cookie-session stamps and enforces its own
 * expiry, so carrying a second one would just be a way to disagree with it.
 */
export interface SessionUser extends BaseSessionUser {
  kind: "user" | "guest" | "guest_online";
}

let authConfig: AuthConfig | null = null;

/** Called once at boot so the authorization helpers know the admin groups. */
export function initSessionAuth(cfg: AuthConfig): void {
  if (!cfg.sessionSecret) throw new Error("SESSION_SECRET is required");
  // A warning and not a throw: a guests-only evening needs no account at all,
  // and z0 must still boot somewhere st0 isn't deployed. But every ADMIN
  // surface — editor, presenter, monitor, remote — is unreachable like this,
  // so say it once, loudly, rather than answering 401 forever with no clue.
  if (!cfg.studioSessionSecret)
    console.warn(
      "⚠️  STUDIO_SESSION_SECRET is not set — nobody can sign in with a studio\n" +
        "    account (only guests). It is env.yaml `common`'s SESSION_SECRET,\n" +
        "    the one st0 signs studio.sid with. See apps/z0/docs/auth.md.",
    );
  authConfig = cfg;
}

export function getAuthConfig(): AuthConfig {
  if (!authConfig) throw new Error("session auth not initialised");
  return authConfig;
}

/** Case-insensitive group match, against this app's configured admin groups. */
export function isAdmin(u: SessionUser | null): boolean {
  return isAdminOf(u, getAuthConfig().adminGroups);
}

/**
 * The studio account, read off `studio.sid` — st0 signs it, we only verify.
 * `kind` is stamped here rather than stored: st0's session has no idea z0
 * exists, and the three kinds are z0's vocabulary alone.
 */
export function studioUser(
  cookieHeader: string | undefined,
): SessionUser | null {
  const secret = getAuthConfig().studioSessionSecret;
  if (!secret) return null;
  const u = sessionFromCookieHeader(cookieHeader, {
    cookieName: STUDIO_COOKIE_NAME,
    secret,
  });
  return u ? { ...u, kind: "user" } : null;
}

/**
 * The current principal, or null.
 *
 * The account wins over the guest, and the order is load-bearing: z0's
 * /auth/logout can only expire its OWN cookie, so a stale guest cookie
 * shadowing an account would be unloggable-out from here.
 */
export function currentUser(req: Request): SessionUser | null {
  const studio = studioUser(req.headers.cookie);
  if (studio) return studio;
  const u = req.session?.user;
  return u ? (u as SessionUser) : null;
}

/** Log a principal in — the guest flows only; the account login is st0's. */
export function setSessionUser(req: Request, u: SessionUser): void {
  req.session!.user = u;
}

/** Log out: nulling the session tells cookie-session to expire the cookie. */
export function clearSession(req: Request): void {
  req.session = null;
}
