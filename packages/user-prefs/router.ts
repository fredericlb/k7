// router.ts — GET and PUT one user's preferences, over a PrefsStore. Mounted behind the
// host's own requireAuth: this router never authenticates, it only reads `req.user.sub`,
// which requireAuth guarantees. See docs/store.md.

import { wrap } from "@frediverse/http/route";
import { Router } from "express";
import type { z } from "zod";
import type { PrefsStore } from "./store.ts";

/** The top-level fields a schema DROPPED — sent, valid, and not in what came out; see docs/store.md. */
export function droppedKeys(sent: unknown, kept: unknown): string[] {
  if (!sent || typeof sent !== "object") return [];
  if (!kept || typeof kept !== "object") return [];
  return Object.keys(sent).filter((k) => !(k in kept));
}

/** The routes over one store, validating writes against the HOST's schema — see docs/store.md. */
export function preferencesRouter<S extends z.ZodType>(
  store: PrefsStore<z.infer<S>>,
  schema: S,
): Router {
  const router = Router();

  router.get(
    "/preferences",
    wrap((req, res) => {
      // `{}` and not 404 for a user who has never saved — the ordinary first-login state.
      const sub = (req as { user?: { sub?: string } }).user?.sub;
      if (!sub)
        return res.status(401).json({ error: "no user on the session" });
      res.json(store.read(sub) ?? {});
    }),
  );

  // Parsed here, not through `validate`: it replaces `req.body`, and the two must be COMPARED.
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
      // Refused rather than stored short, which nothing downstream would notice (docs/store.md).
      const dropped = droppedKeys(req.body, parsed.data);
      if (dropped.length)
        return res.status(400).json({
          error: `this service does not store ${dropped.join(", ")} — declare it in its preferences schema`,
        });
      // Wholesale, not a merge, which would make a field impossible to CLEAR (docs/store.md).
      store.write(sub, parsed.data as z.infer<S>);
      res.json({ ok: true });
    }),
  );

  return router;
}
