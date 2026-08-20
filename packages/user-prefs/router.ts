// router.ts — GET and PUT one user's preferences, over a PrefsStore. Mounted behind the
// host's own requireAuth: this router never authenticates, it only reads `req.user.sub`,
// which requireAuth guarantees. See docs/store.md.

import { wrap } from "@frediverse/http/route";
import { Router } from "express";
import type { z } from "zod";
import type { PrefsStore } from "./store.ts";

/**
 * The top-level fields a schema DROPPED — sent, valid, and not in what came out.
 *
 * A zod object strips what it does not declare, silently and by default, so a service whose
 * schema has fallen behind its frontend answers `{ok:true}` and stores less than it was handed.
 * st0 lost the whole command layer that way: renaming commands worked, saving said it had, and a
 * reload showed the catalogue's own names again — the schema still described the day it held one
 * field. Nothing anywhere said so, which is what makes this worth a check rather than a comment.
 *
 * Answered as a list of names, because the useful sentence is "this service does not know
 * `commands`" and the fix is to declare it.
 */
export function droppedKeys(sent: unknown, kept: unknown): string[] {
  if (!sent || typeof sent !== "object") return [];
  if (!kept || typeof kept !== "object") return [];
  return Object.keys(sent).filter((k) => !(k in kept));
}

/**
 * The routes over one store, validating writes against `schema`.
 *
 * The schema is the HOST's, not this package's: st0 and the médiathèque remember
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

  // Parsed here rather than through `validate`, which replaces `req.body` with the stripped
  // result — and the two are exactly what has to be COMPARED (see droppedKeys).
  router.put(
    "/preferences",
    wrap((req, res) => {
      const sub = (req as { user?: { sub?: string } }).user?.sub;
      if (!sub)
        return res.status(401).json({ error: "no user on the session" });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: parsed.error.issues.map((i) => i.message).join("; "),
        });
      // Refused rather than stored short: a write that quietly keeps half of what it was given
      // is a preference that comes back wrong on the next load, with nothing to point at.
      const dropped = droppedKeys(req.body, parsed.data);
      if (dropped.length)
        return res.status(400).json({
          error: `this service does not store ${dropped.join(", ")} — declare it in its preferences schema`,
        });
      // Wholesale, not a merge: the browser holds the whole object and sends it back, so a
      // merge would make a field impossible to CLEAR — you could pick an engine and never
      // un-pick one.
      store.write(sub, parsed.data as z.infer<S>);
      res.json({ ok: true });
    }),
  );

  return router;
}
