import type { SessionUser } from "@frediverse/oidc";

// @frediverse/oidc's requireAuth attaches the logged-in user to the request.
// Declared here (as radiok7/routine/labs each do) because the shape is per-app:
// this backend's own gate is authMiddleware, which uses res.locals instead.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
