// auth.ts — `/auth/*` for a machine that may have no server. The rule is that `/auth/me`
// NEVER 401s: st0's AuthGate is the outermost gate, and a 401 there draws a sign-in card in
// front of an app that needs no signing in. A non-401 failure is worse — it draws the "auth is
// down" screen and blocks the whole tree. So this answers, always.
// See ../../docs/identity.md.

import type { Express } from "express";
import { asUser, currentIdentity } from "./identity.ts";

export interface AuthRoutes {
  /** Opened by `/auth/login`; the window's settings screen, once lot C has one. */
  onSignIn?: () => void;
}

export function mountLocalAuth(app: Express, opts: AuthRoutes = {}): void {
  app.get("/auth/me", (_req, res) => {
    res.json({ user: asUser(currentIdentity()) });
  });

  // Nothing reaches this: the frontend only follows `loginUrl` after /auth/me answers 401,
  // which cannot happen here. It exists so the route is not a 404 that lands on index.html —
  // a "sign in" that silently returned the app would be the more confusing failure.
  app.get("/auth/login", (req, res) => {
    opts.onSignIn?.();
    const back =
      typeof req.query.return_to === "string" ? req.query.return_to : "/";
    res.redirect(back.startsWith("/") ? back : "/");
  });

  // Signing out of a machine you are sitting at means nothing; lot C makes it drop the SERVER
  // token, which is the only credential there is to give up.
  app.post("/auth/logout", (_req, res) => {
    res.status(204).end();
  });
}
