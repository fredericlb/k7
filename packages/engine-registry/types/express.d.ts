import type { SessionUser } from "@frediverse/oidc";

// `/engine/select` reads WHO is claiming from the session and never from the body, so this
// package depends on the same augmentation its three hosts carry. Declared with the identical
// type on purpose: a structural stand-in would collide with theirs when the interfaces merge.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
