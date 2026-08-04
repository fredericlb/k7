// router.ts — GET and PUT one user's preferences, over a PrefsStore. Mounted behind the
// host's own requireAuth: this router never authenticates, it only reads `req.user.sub`,
// which requireAuth guarantees. See docs/store.md.

import { validate, wrap } from "@frediverse/http/route";
import { Router } from "express";
import type { z } from "zod";
import type { PrefsStore } from "./store.ts";

/**
 * The routes over one store, validating writes against `schema`.
 *
 * The schema is the HOST's, not this package's: l8 and the médiathèque remember
 * different things, and a union of every service's fields here would be a shape no service
 * actually has.
 */
export function preferencesRouter<S extends z.ZodType>(
  store: PrefsStore<z.infer<S>>,
  schema: S,
): Router {
  const router = Router();

  router.get(
    "/preferences",
    wrap((req, res) => {
      // `{}` and not 404 for a user who has never saved: "no preferences yet" is the
      // ordinary first-login state, and a 404 would have every caller special-case it.
      const sub = (req as { user?: { sub?: string } }).user?.sub;
      if (!sub)
        return res.status(401).json({ error: "no user on the session" });
      res.json(store.read(sub) ?? {});
    }),
  );

  router.put(
    "/preferences",
    validate(schema),
    wrap((req, res) => {
      const sub = (req as { user?: { sub?: string } }).user?.sub;
      if (!sub)
        return res.status(401).json({ error: "no user on the session" });
      // Wholesale, not a merge: the browser holds the whole object and sends it back, so a
      // merge would make a field impossible to CLEAR — you could pick an engine and never
      // un-pick one.
      store.write(sub, req.body as z.infer<S>);
      res.json({ ok: true });
    }),
  );

  return router;
}
