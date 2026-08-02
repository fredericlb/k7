import {
  type SessionUser as BaseSessionUser,
  isAdmin as isAdminOf,
} from "@frediverse/oidc";
import type { Request } from "express";
import type { AuthConfig } from "../config.ts";

// The session cookie's name. Shared with @frediverse/oidc's setupAuth (which
// issues it) and with ws.ts (which decodes it by hand on an upgrade).
export const SESSION_COOKIE_NAME = "bt_session";

/**
 * The authenticated principal, stored in the session cookie by
 * @frediverse/oidc's cookie-session. The shared package supplies
 * sub/email/name/groups; `kind` is ours:
 *   "user"          OIDC login
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

/** The current user, or null. The cookie is decoded by cookie-session upstream. */
export function currentUser(req: Request): SessionUser | null {
  const u = req.session?.user;
  return u ? (u as SessionUser) : null;
}

/** Log a principal in (the guest flows; OIDC logins go through setupAuth). */
export function setSessionUser(req: Request, u: SessionUser): void {
  req.session!.user = u;
}

/** Log out: nulling the session tells cookie-session to expire the cookie. */
export function clearSession(req: Request): void {
  req.session = null;
}
