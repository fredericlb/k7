// bodyLimits.ts — the one JSON parser every route shares, mounted before any guard, so its limit
// is what an UNAUTHENTICATED caller can make this process parse. Small by default; a route with a
// limit of its own is listed here, or parses ahead of this one (the AI organize, at 2 MB).
// The file hub's paths are never parsed: their bodies stream through to an account's file service,
// which holds the 8 MB limit; nor are the apps' uploads, streamed to disk. See ../docs/hardening.md.

import { FILE_HUB_INTERNAL, FILE_HUB_PATH } from "@studio/file-hub";
import express, { type RequestHandler } from "express";

/** What any route's JSON body may weigh unless it is listed below. */
const DEFAULT_JSON_LIMIT = "256kb";

/** Routes with a limit of their own: the public comment is smaller, a songbook entry's free text larger. */
const ROUTE_JSON_LIMITS: Record<string, string> = {
  "/api/public/share": "64kb",
  "/api/songs": "2mb",
};

/** Routes whose bodies this process never parses, since it only pipes them on. */
const STREAMED_THROUGH: readonly string[] = [
  FILE_HUB_PATH,
  FILE_HUB_INTERNAL,
  // The apps' builds, streamed to disk by ./appReleases/routes.ts.
  "/api/app-releases",
];

const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/** The shared parser: the default limit, a listed route's own, or none for a relayed one. */
export function jsonBodies(): RequestHandler {
  const fallback = express.json({ limit: DEFAULT_JSON_LIMIT });
  const routes = Object.entries(ROUTE_JSON_LIMITS).map(
    ([prefix, limit]) => [prefix, express.json({ limit })] as const,
  );
  return (req, res, next) => {
    if (STREAMED_THROUGH.some((p) => under(req.path, p))) return next();
    const own = routes.find(([p]) => under(req.path, p));
    (own ? own[1] : fallback)(req, res, next);
  };
}
