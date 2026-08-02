// mediatek.ts — the media library as THIS MACHINE holds it. The library itself is hosted
// now (see apps/mediatek/backend); what lives here is a cache the moteur plays from, so
// these routes report what is cached and pull down what is missing. Mounted BEFORE
// resolveWorkspace: a cache is per machine, like /workspaces is per user.

import { validate, wrap } from "@frediverse/http/route";
import { markSynced, syncFamily } from "@studio/mediatek/cache";
import { listFamily, search, summary } from "@studio/mediatek/catalogue";
import { uploadWorkspace } from "@studio/mediatek/ingest";
import { exists, mediatekDir } from "@studio/mediatek/layout";
import { remoteLibrary, remoteWriter } from "@studio/mediatek/remote";
import { revisions } from "@studio/mediatek/revision";
import { FAMILIES, type Family } from "@studio/mediatek/types";
import { Router } from "express";
import { z } from "zod";
import { slugify, workspaceRoot } from "../slug.ts";

export const mediatekRouter: Router = Router();

const asFamily = (v: unknown): Family | undefined =>
  FAMILIES.includes(v as Family) ? (v as Family) : undefined;

/** What this machine holds, and where. Not the catalogue — that is the hosted service's
 *  answer; this is the cache's. `present: false` is normal, never a 404. */
mediatekRouter.get(
  "/mediatek",
  wrap((_req, res) => {
    res.json({ ...summary(), root: mediatekDir(), cached: true });
  }),
);

/** Pull one family's cache in line with the hosted library.
 *
 * Configured, not requested: the caller says WHICH family, never where to fetch from, so a
 * browser cannot point this machine's downloader at somewhere else. */
mediatekRouter.post(
  "/mediatek/sync",
  wrap(async (req, res) => {
    const family = asFamily(req.body?.family);
    if (!family)
      return res
        .status(400)
        .json({ error: `family must be one of: ${FAMILIES.join(", ")}` });
    const base = process.env.MEDIATEK_URL;
    if (!base)
      return res
        .status(503)
        .json({ error: "no hosted library configured (MEDIATEK_URL)" });
    const source = remoteLibrary({ base, token: process.env.MEDIATEK_TOKEN });
    try {
      const report = await syncFamily(source, family);
      // Only a clean sync counts as caught up — otherwise the missing files are never retried.
      if (!report.failed.length)
        markSynced(family, (await source.revisions())[family]);
      res.json(report);
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  }),
);

/** Every family's change token in one call, so a surface polls this and refetches only
 *  the listing that actually moved. The whole reason the tokens are per family. */
mediatekRouter.get(
  "/mediatek/revision",
  wrap((_req, res) => {
    if (!exists()) return res.json({ present: false, revisions: {} });
    res.json({ present: true, revisions: revisions() });
  }),
);

/** One family's entries, stamped with the token they were read at. */
mediatekRouter.get(
  "/mediatek/list",
  wrap((req, res) => {
    const family = asFamily(req.query.family);
    if (!family)
      return res
        .status(400)
        .json({ error: `family must be one of: ${FAMILIES.join(", ")}` });
    res.json(listFamily(family));
  }),
);

/**
 * Push a workspace's `_modules` / `_library` / `_ui` UP to the hosted library.
 *
 * It used to copy them into the local folder. That folder is a CACHE now: anything put
 * there by hand is absent from the owner's manifest, and the next sync would delete it —
 * so the same button had to become an upload or stop existing.
 *
 * The workspace is resolved from the AUTHENTICATED user, not from anything the caller
 * sends beyond a name, so this cannot be pointed at somebody else's folder.
 */
const importBody = z.object({ workspace: z.string().min(1) });
mediatekRouter.post(
  "/mediatek/import",
  validate(importBody),
  wrap(async (req, res) => {
    const { workspace } = req.body as z.infer<typeof importBody>;
    let root: string;
    try {
      root = workspaceRoot(slugify(req.userEmail!), workspace);
    } catch (e) {
      // assertWorkspaceName refuses anything that isn't one plain path segment.
      return res.status(400).json({ error: (e as Error).message });
    }
    const base = process.env.MEDIATEK_URL;
    if (!base)
      return res
        .status(503)
        .json({ error: "no hosted library configured (MEDIATEK_URL)" });
    try {
      res.json(
        await uploadWorkspace(
          remoteWriter({ base, token: process.env.MEDIATEK_TOKEN }),
          root,
        ),
      );
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  }),
);

/** Filter across families. `limit` is clamped rather than trusted: this walks an array
 *  in memory, but an unbounded one asked for by a caller is still a caller's decision
 *  about our memory. */
mediatekRouter.get(
  "/mediatek/search",
  wrap((req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(Math.floor(rawLimit), 1000)
        : undefined;
    res.json({
      entries: search({
        family: asFamily(req.query.family),
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        kind: typeof req.query.kind === "string" ? req.query.kind : undefined,
        limit,
      }),
    });
  }),
);
