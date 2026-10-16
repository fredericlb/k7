// who.ts — the identity on a request, read from the `req.user` setupAuth (or a bearer token) attached.
// Three readers because the stores are keyed differently: by `sub` alone, by `sub` else the email, or by the email.

import type { Request } from "express";

/** The session's `sub`, or null. */
export const subOf = (req: Request): string | null => req.user?.sub || null;

/** The account a per-user record is keyed by: the `sub`, else the email for a session without one. */
export const subjectOf = (req: Request): string | null =>
  req.user?.sub ?? req.user?.email ?? null;

/** The session's email, or null. */
export const emailOf = (req: Request): string | null => req.user?.email ?? null;
