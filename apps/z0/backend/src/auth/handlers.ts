import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { gameState } from "../gameState.ts";
import {
  clearSession,
  currentUser,
  isAdmin,
  type SessionUser,
  setSessionUser,
} from "./session.ts";

// POST /auth/logout — ours rather than @frediverse/oidc's, which answers
// {ok:true}; the SPAs expect a bare 204.
export function handleAuthLogout(req: Request, res: Response): void {
  clearSession(req);
  res.status(204).end();
}

const constantTimeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

// POST /auth/guest — session-scoped guest login for the buzzer SPA (auth.go's
// handleAuthGuest): validates the per-session password from Grist and issues a
// kind="guest" cookie. Gated on registration being open.
export function handleAuthGuest(req: Request, res: Response): void {
  const password = String(req.body?.password ?? "");
  const rawName = String(req.body?.name ?? "").trim();

  if (!gameState.sessionProgress) {
    res.status(503).send("no session loaded");
    return;
  }
  const expected = gameState.sessionProgress.guestPassword();
  if (expected === "") {
    res.status(403).send("guest login disabled for this session");
    return;
  }
  if (!gameState.registrationStarted || gameState.registrationComplete) {
    res.status(403).send("registration is not open");
    return;
  }
  if (!constantTimeEqual(password, expected)) {
    res.status(401).send("invalid password");
    return;
  }
  const name = rawName || "guest";
  const user: SessionUser = { kind: "guest", name };
  setSessionUser(req, user);
  res.json({ ok: true, kind: "guest", name });
}

// GET /auth/me — session introspection plus the public flags the SPAs need to
// render their login gates (auth.go's handleAuthMe).
export function handleAuthMe(req: Request, res: Response): void {
  const guestEnabled =
    gameState.sessionProgress !== null &&
    gameState.sessionProgress.guestPassword() !== "";
  const registrationOpen =
    gameState.registrationStarted && !gameState.registrationComplete;
  const u = currentUser(req);
  if (!u) {
    res.status(401).json({
      authenticated: false,
      guestEnabled,
      registrationOpen,
    });
    return;
  }
  res.json({
    authenticated: true,
    kind: u.kind,
    subject: u.sub ?? "",
    email: u.email ?? "",
    name: u.name ?? "",
    groups: u.groups ?? [],
    isAdmin: isAdmin(u),
    guestEnabled,
    registrationOpen,
  });
}
