/* What the page needs but cannot derive from its own address — right now, only which pl8 this
   backend was configured to talk to (MEDIATEK_URL). See ../../docs/audio.md. */

import { wrap } from "@frediverse/http";
import { Router } from "express";
import { env } from "../env.ts";

export const configRouter = Router();

configRouter.get(
  "/",
  wrap(async (_req, res) => {
    res.json({ mediatekUrl: env.mediatek.base });
  }),
);
