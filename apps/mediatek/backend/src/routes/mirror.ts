// mirror.ts — the one route that pulls another system's material in. Kept apart from
// library.ts because it is a different kind of thing: those routes serve what the library
// HAS, this one changes what it has, by reaching outside. See docs/mirror.md.

import { createGrist } from "@frediverse/db-grist";
import { wrap } from "@frediverse/http/route";
import { Router } from "express";
import { mirrorRadiok7 } from "../mirror/radiok7.ts";

export const mirrorRouter: Router = Router();

/** radiok7's Grist document, read-only from here. Separate env names from radiok7's own on
 *  purpose: this is a different service reading someone else's document, and sharing the
 *  variable would make "which document" depend on which container you happened to look at. */
const grist = createGrist({
  apiUrl: process.env.RADIOK7_GRIST_API_URL,
  docId: process.env.RADIOK7_GRIST_DOC_ID,
  apiKey: process.env.RADIOK7_GRIST_API_KEY,
});

/**
 * Pull radiok7's finished recordings in.
 *
 * A POST, and manual: a mirror that ran on a timer would need an answer to "what if it is
 * halfway through when someone opens the library", and there is nothing yet that wants one.
 * Running it twice is the cheap case by design, so a human clicking it twice costs nothing.
 */
mirrorRouter.post(
  "/radiok7",
  wrap(async (req, res) => {
    if (!grist.isConfigured())
      return res.status(503).json({
        error:
          "no radiok7 Grist configured (RADIOK7_GRIST_API_URL / _DOC_ID / _API_KEY)",
      });
    // Scoped to one owner when asked. radiok7's rows carry an OwnerId, and pulling every
    // band's recordings into one library because the parameter was forgotten is the kind
    // of mistake that is easier to prevent than to undo.
    const ownerId =
      typeof req.query.owner === "string" ? req.query.owner : undefined;
    try {
      res.json(await mirrorRadiok7(grist, { ownerId }));
    } catch (e) {
      // 502: the failure is upstream's, and saying 500 would send someone reading OUR logs.
      res.status(502).json({ error: (e as Error).message });
    }
  }),
);
