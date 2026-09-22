/* Public pages: the nametag is the whole address, no session needed — apps/k7/docs/ownership.md. */

import { streamFile, wrap } from "@frediverse/http";
import { Router } from "express";
import * as store from "../store.ts";

export const publicPagesRouter = Router();

publicPagesRouter.get(
  "/:nametag",
  wrap(async (req, res) => {
    const page = await store.getPageByNametag(req.params.nametag);
    if (!page) return res.status(404).json({ error: "not found" });
    const { ownerId, ...pub } = page;
    res.json(pub);
  }),
);

// Scoped through the page rather than releasesRouter: a release only plays if the
// nametag's own list still names it, so pulling it off a page also pulls the audio.
publicPagesRouter.get(
  "/:nametag/releases/:rid/versions/:vid/audio",
  wrap(async (req, res) => {
    const page = await store.getPageByNametag(req.params.nametag);
    if (!page?.releaseIds.includes(req.params.rid))
      return res.status(404).json({ error: "not found" });
    const info = await store.ensureVersionAudioCached(
      req.params.rid,
      req.params.vid,
    );
    if (!info) return res.status(404).json({ error: "no audio" });
    streamFile(req, res, info.filePath, info.mime);
  }),
);
