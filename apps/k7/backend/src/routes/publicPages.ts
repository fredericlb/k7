/* Public pages: the nametag is the whole address, no session needed — apps/k7/docs/ownership.md. */

import { streamFile, wrap } from "@frediverse/http";
import { pageVersion } from "@k7/shared/pageVersion";
import { Router } from "express";
import * as store from "../store.ts";

export const publicPagesRouter = Router();

// Each release carries the ONE version the page plays: a hidden version never leaves the server.
publicPagesRouter.get(
  "/:nametag",
  wrap(async (req, res) => {
    const page = await store.getPageByNametag(req.params.nametag);
    if (!page) return res.status(404).json({ error: "not found" });
    const { ownerId, versionIds, releases, ...pub } = page;
    res.json({
      ...pub,
      versionIds: {},
      releases: releases.map((release) => {
        const { ownerId: _, ...r } = release as typeof release & {
          ownerId?: string;
        };
        const v = pageVersion(page, r);
        return {
          ...r,
          versions: v ? [v] : [],
          defaultVersionId: v?.id ?? null,
        };
      }),
    });
  }),
);

/** The version this page plays for this release, or null: a page names its audio, not the URL. */
async function playedVersion(nametag: string, rid: string, vid: string) {
  const page = await store.getPageByNametag(nametag);
  const release = page?.releases.find((r) => r.id === rid);
  if (!page || !release) return null;
  return pageVersion(page, release)?.id === vid ? vid : null;
}

// Scoped through the page, so pulling a release off a page also pulls its audio — docs/pages.md.
publicPagesRouter.get(
  "/:nametag/releases/:rid/versions/:vid/audio",
  wrap(async (req, res) => {
    const { nametag, rid, vid } = req.params;
    if (!(await playedVersion(nametag, rid, vid)))
      return res.status(404).json({ error: "not found" });
    const info = await store.ensureVersionAudioCached(rid, vid);
    if (!info) return res.status(404).json({ error: "no audio" });
    streamFile(req, res, info.filePath, info.mime);
  }),
);

publicPagesRouter.get(
  "/:nametag/releases/:rid/versions/:vid/envelope",
  wrap(async (req, res) => {
    const { nametag, rid, vid } = req.params;
    if (!(await playedVersion(nametag, rid, vid)))
      return res.status(404).json({ error: "not found" });
    const envelope = await store.versionEnvelope(rid, vid);
    if (!envelope) return res.status(404).json({ error: "no audio" });
    res.json(envelope);
  }),
);
