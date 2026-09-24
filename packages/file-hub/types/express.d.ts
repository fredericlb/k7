import type { SessionUser } from "@frediverse/oidc";

// The same augmentation its three hosts carry, with the identical type on purpose: a structural stand-in would collide when the interfaces merge.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
