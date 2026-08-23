import type { SessionUser } from "@frediverse/oidc";

// Declared per app, because this backend's own gate is authMiddleware, which uses res.locals.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
