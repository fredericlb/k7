/* What the page needs but cannot derive from its own address. The library is served by the same
   origin now, so its base is "" and the page's `${base}/api/...` stays same-origin. See ../../../ui-rehearsal/docs/audio.md. */

import { wrap } from "@frediverse/http";
import { Router } from "express";

export const configRouter = Router();

configRouter.get(
  "/",
  wrap(async (_req, res) => {
    res.json({ mediatekUrl: "" });
  }),
);
