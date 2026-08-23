import {
  type SessionUser as BaseSessionUser,
  isAdmin as isAdminOf,
  sessionFromCookieHeader,
} from "@frediverse/oidc";
import type { Request } from "express";
import type { AuthConfig } from "../config.ts";

// Two cookies, ONE key, and only bt_session is ours to write — see ../../docs/auth.md.
export const SESSION_COOKIE_NAME = "bt_session";
export const STUDIO_COOKIE_NAME = "studio.sid";

/** The principal; `kind` is z0's own vocabulary, and there is no `exp` beside cookie-session's. */
export interface SessionUser extends BaseSessionUser {
  kind: "user" | "guest" | "guest_online";
}

let authConfig: AuthConfig | null = null;

/** Called once at boot so the authorization helpers know the admin groups. */
export function initSessionAuth(cfg: AuthConfig): void {
  if (!cfg.sessionSecret) throw new Error("SESSION_SECRET is required");
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

/** The account off `studio.sid`, VERIFIED never signed; `kind` is stamped here, not stored. */
export function studioUser(
  cookieHeader: string | undefined,
): SessionUser | null {
  const u = sessionFromCookieHeader(cookieHeader, {
    cookieName: STUDIO_COOKIE_NAME,
    secret: getAuthConfig().sessionSecret,
  });
  return u ? { ...u, kind: "user" } : null;
}

/** The account wins over the guest, and that ORDER is load-bearing — ../../docs/auth.md. */
export function currentUser(req: Request): SessionUser | null {
  const studio = studioUser(req.headers.cookie);
  if (studio) return studio;
  const u = req.session?.user;
  return u ? (u as SessionUser) : null;
}

/** Log a principal in — the guest flows only; the account login is pl8's. */
export function setSessionUser(req: Request, u: SessionUser): void {
  req.session!.user = u;
}

/** Log out: nulling the session tells cookie-session to expire the cookie. */
export function clearSession(req: Request): void {
  req.session = null;
}
