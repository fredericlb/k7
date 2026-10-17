// admin.ts — who is an ADMIN of this origin: the session's `groups` claim against
// `$AUTH_ADMIN_GROUPS`, which empty admits nobody.

import { isAdmin } from "@frediverse/oidc";
import type { Request } from "express";

/** `$AUTH_ADMIN_GROUPS`, comma-separated, read per call so a test can set it. */
const adminGroups = (): string[] =>
  (process.env.AUTH_ADMIN_GROUPS ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

/** Whether the request's session user is in one of the admin groups; `groups` is all isAdmin reads. */
export const isAdminRequest = (req: Request): boolean =>
  isAdmin(req.user && { groups: req.user.groups }, adminGroups());
