// devAdmin.ts — in a LOCAL dev session the stub "Dev User" is an admin: it is the only account there,
// and every admin surface (the libraries, the slskd settings) must be reachable to
// develop it. Done here, around `requireAuth`, because the commons stub signs it with no groups on
// purpose and that package is shared. Never on: a configured OIDC, or the tray's local user (../docs/hardening.md).

import type { RequestHandler } from "express";

/** The stub's subject, as `@frediverse/oidc` signs it in dev mode. */
export const DEV_SUB = "dev-user";

/** Is this backend running the dev stub on purpose — `STUDIO_DEV_AUTH=1` and no OIDC, the commons' own dev-mode test. */
export const devAuthOn = (env: Record<string, string | undefined>): boolean =>
  env.STUDIO_DEV_AUTH === "1" && (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID);

/** `requireAuth`, giving the dev stub every admin group of `$AUTH_ADMIN_GROUPS` when dev auth is on; else unchanged. */
export function withDevAdmin(
  requireAuth: RequestHandler,
  env: Record<string, string | undefined> = process.env,
): RequestHandler {
  if (!devAuthOn(env)) return requireAuth;
  const admin = (env.AUTH_ADMIN_GROUPS ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  // No admin group configured means no admin at all, the dev user included: said once rather than guessed.
  if (!admin.length) {
    console.warn(
      "⚠️  STUDIO_DEV_AUTH: AUTH_ADMIN_GROUPS is empty, so the dev user is no admin",
    );
    return requireAuth;
  }
  return (req, res, next) =>
    requireAuth(req, res, (err?: unknown) => {
      if (err) return next(err);
      const user = req.user as { sub?: string; groups?: string[] } | undefined;
      if (user?.sub === DEV_SUB)
        req.user = {
          ...user,
          groups: [...new Set([...(user.groups ?? []), ...admin])],
        } as typeof req.user;
      next();
    });
}
