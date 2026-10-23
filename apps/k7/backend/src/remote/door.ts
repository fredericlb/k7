// door.ts — the server's side of a paired machine browsing it: a request under DOOR_PATH carrying a device token in
// DEVICE_HEADER is signed in, for itself alone, as the person the token names, then served by the ordinary routes.
// Only ALLOWED prefixes pass: an account's tokens, pairings and keys stay behind a real session. ../../docs/serverPicker.md.

import type { SessionUser } from "@frediverse/oidc";
import type { Request, RequestHandler } from "express";

/** Where a paired machine's backend sends what its page asked of this server. */
export const DOOR_PATH = "/api/device-door";

/** The device token, apart from `Authorization`, which carries the page's own file ticket or library bearer through. */
export const DEVICE_HEADER = "x-k7-device";

/** What a device may reach: the médiathèque, its hunt, the rehearsal recorder and the account's files — nothing that mints or pairs. */
export const ALLOWED = [
  "/api/mediatek",
  // Its person finding songs from their own page; the slskd settings it spends stay behind a session.
  "/api/hunt",
  "/api/shares",
  "/api/stems",
  "/api/favorites",
  "/api/preferences",
  "/api/engine-local",
  "/api/config",
  "/api/sessions",
  "/api/moments",
  "/api/releases",
  "/api/pages",
  "/api/public/pages",
  "/api/songs",
  "/api/singing",
  "/api/publications",
  "/api/files-hub",
  "/api/files",
];

/** Whether `path` (query included) is one of ALLOWED or below it. */
export function allowedPath(path: string): boolean {
  const bare = path.split("?")[0];
  // A dot segment, plain or encoded, could climb out of the prefix it names.
  if (/(^|\/)(\.|%2e){2}(\/|$)/i.test(bare)) return false;
  return ALLOWED.some((p) => bare === p || bare.startsWith(`${p}/`));
}

/** Mounted with no path, after the session middleware and before every route it lets through. */
export function deviceDoor(opts: {
  deviceUser: (token: string) => { email: string; person: string } | null;
  startSession: (req: Request, user: SessionUser) => void;
}): RequestHandler {
  return (req, res, next) => {
    if (!req.url.startsWith(`${DOOR_PATH}/`)) return next();
    const token = req.get(DEVICE_HEADER) ?? "";
    const who = token ? opts.deviceUser(token) : null;
    if (!who)
      return void res.status(401).json({
        error: "no device token this server knows: pair this machine again",
        reason: "repair",
      });
    const rest = req.url.slice(DOOR_PATH.length);
    if (!allowedPath(rest))
      return void res
        .status(403)
        .json({ error: "not reachable from a paired machine" });
    // A session for this request only: the paired machine drops the cookie it sets, and sends none.
    opts.startSession(req, {
      sub: who.person,
      email: who.email,
      name: who.email,
    });
    req.url = rest;
    req.originalUrl = rest;
    next();
  };
}
