import type { SessionUser } from "@frediverse/oidc";

// The same augmentation the other frediverse backends carry: this is no Express app, but consuming @frediverse/oidc as raw source typechecks it here.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
