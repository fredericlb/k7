// admin.ts — who is an ADMIN of this origin: the session's `groups` claim against
// `$AUTH_ADMIN_GROUPS`, which empty admits nobody. The same variable, and the same reading, as z0's.

import { isAdmin, type SessionUser } from "@frediverse/oidc";

/** `$AUTH_ADMIN_GROUPS`, comma-separated, read per call so a test can set it. */
export const adminGroups = (): string[] =>
  (process.env.AUTH_ADMIN_GROUPS ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

/** Whether the request's session user is in one of the admin groups. */
export const isAdminRequest = (req: unknown): boolean =>
  isAdmin((req as { user?: SessionUser }).user, adminGroups());
