import type { SessionUser } from "@frediverse/oidc";

// setupAuth's requireAuth attaches the logged-in user — the same augmentation the other frediverse backends carry.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
