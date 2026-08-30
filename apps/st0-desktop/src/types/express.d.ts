import type { SessionUser } from "@frediverse/oidc";

// The same augmentation every frediverse backend carries: @studio/engine-registry's router
// reads `req.user`, and this app mounts that router too.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
