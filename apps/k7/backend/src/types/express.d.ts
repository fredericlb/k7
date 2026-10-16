// express.d.ts — `req.user` is @frediverse/http's AuthUser, which owns the Express augmentation;
// this adds the session's `groups` claim to it, since a second `Request.user` declaration would conflict.

import "@frediverse/http";

declare module "@frediverse/http" {
  interface AuthUser {
    groups?: string[];
  }
}
