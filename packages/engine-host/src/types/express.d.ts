import type { SessionUser } from "@frediverse/oidc";

// setupAuth's requireAuth attaches the logged-in user — the same augmentation the other
// frediverse backends carry. The supervisor is no Express app, but it calls into @frediverse/oidc
// for API tokens, and consuming that package as raw source means typechecking it here too.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
