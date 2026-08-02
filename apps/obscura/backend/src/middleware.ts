import type { NextFunction, Request, RequestHandler, Response } from "express";
import { currentUser, isAdmin, type SessionUser } from "./auth/session.ts";

// Paths reachable without a session (mirrors auth.go's isPublicPath): the
// hello probe, the whole /auth surface, public audio streaming, and the
// token-based session resolver (the SPA shows the session name on the gate
// before the visitor logs in).
export function isPublicPath(p: string): boolean {
  if (p === "/hello") return true;
  if (p === "/auth" || p.startsWith("/auth/")) return true;
  if (p.startsWith("/audio/")) return true;
  if (p.startsWith("/sessions/by-token/")) return true;
  // <audio> elements don't send credentials, and this only redirects to a
  // public Deezer preview URL.
  if (p.startsWith("/playlists/preview/")) return true;
  return false;
}

// Express keeps per-request state on res.locals; this mirrors Go's
// context.WithValue(ctxUserKey).
export function requestUser(res: Response): SessionUser | null {
  return (res.locals.user as SessionUser | undefined) ?? null;
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isPublicPath(req.path)) {
    next();
    return;
  }
  const u = currentUser(req);
  if (!u) {
    res.status(401).send("unauthorized");
    return;
  }
  res.locals.user = u;
  next();
}

export function adminOnly(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const u = requestUser(res) ?? currentUser(req);
    if (!u) {
      res.status(401).send("unauthorized");
      return;
    }
    if (!isAdmin(u)) {
      res.status(403).send("admin only");
      return;
    }
    handler(req, res, next);
  };
}

// Echo whichever Origin asked (mirrors main.go's cors.Options). Browsers
// reject `Access-Control-Allow-Origin: *` combined with credentials, and the
// frontends all send `credentials: "include"` — so reflect the actual Origin.
export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}
