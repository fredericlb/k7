/* Public pages: the nametag is the whole address, no session needed — ../../docs/ownership.md. */

import { streamFile, wrap } from "@frediverse/http";
import { pageChoices, pageVersion } from "@studio/rehearsal-shared/pageVersion";
import { Router } from "express";
import * as store from "../store.ts";

export const publicPagesRouter = Router();

// Each release carries the versions a visitor may pick, the page's own pick as its default.
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
        return {
          ...r,
          versions: pageChoices(page, r),
          defaultVersionId: pageVersion(page, r)?.id ?? null,
        };
      }),
    });
  }),
);

/** The release and version if this page offers them, null otherwise: a page names its audio. */
async function offered(nametag: string, rid: string, vid: string) {
  const page = await store.getPageByNametag(nametag);
  const release = page?.releases.find((r) => r.id === rid);
  if (!page || !release) return null;
  const version = pageChoices(page, release).find((v) => v.id === vid);
  return version ? { release, version } : null;
}

// Scoped through the page, so pulling a release off a page also pulls its audio — ../../docs/pages.md.
publicPagesRouter.get(
  "/:nametag/releases/:rid/versions/:vid/audio",
  wrap(async (req, res) => {
    const { nametag, rid, vid } = req.params;
    if (!(await offered(nametag, rid, vid)))
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
    if (!(await offered(nametag, rid, vid)))
      return res.status(404).json({ error: "not found" });
    const envelope = await store.versionEnvelope(rid, vid);
    if (!envelope) return res.status(404).json({ error: "no audio" });
    res.json(envelope);
  }),
);

// Only a release its owner marked downloadable; the switch is the whole permission.
publicPagesRouter.get(
  "/:nametag/releases/:rid/versions/:vid/download",
  wrap(async (req, res) => {
    const { nametag, rid, vid } = req.params;
    const found = await offered(nametag, rid, vid);
    if (!found?.release.canDownload)
      return res.status(404).json({ error: "not found" });
    const info = await store.ensureVersionAudioCached(rid, vid);
    if (!info) return res.status(404).json({ error: "no audio" });
    res.attachment(
      store.versionFileName(found.release, found.version, info.mime),
    );
    streamFile(req, res, info.filePath, info.mime);
  }),
);
