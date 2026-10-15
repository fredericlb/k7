import type { SessionUser } from "@frediverse/oidc";

// Importing @frediverse/oidc typechecks its source, which reads the Request.user its consumers declare.
declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
