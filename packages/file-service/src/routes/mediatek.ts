// mediatek.ts — the media library as THIS MACHINE holds it. The library itself is hosted
// now (see apps/k7/backend/src/media); what lives here is a cache the moteur plays from, so
// these routes report what is cached and pull down what is missing. Mounted BEFORE
// resolveWorkspace: a cache is per machine, like /workspaces is per user.

import { readFileSync } from "node:fs";
import { streamFile } from "@frediverse/http";
import { validate, wrap } from "@frediverse/http/route";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { markSynced, syncFamily } from "@studio/mediatek/cache";
import {
  listFamily,
  parseQuery,
  search,
  summary,
} from "@studio/mediatek/catalogue";
import { uploadWorkspace } from "@studio/mediatek/ingest";
import {
  exists,
  mediatekDir,
  PathEscapesError,
  readablePath,
  safePath,
} from "@studio/mediatek/layout";
import { mimeFor } from "@studio/mediatek/media";
import {
  pushSongBpm,
  remoteLibrary,
  remoteWriter,
} from "@studio/mediatek/remote";
import { revisions } from "@studio/mediatek/revision";
import { asFamily, FAMILY_ERROR } from "@studio/mediatek/types";
import { Router } from "express";
import { z } from "zod";
import { mediatekBase, mediatekToken } from "../mediatekLink.ts";
import { workspaceRoot } from "../slug.ts";
import {
  CACHE_EXT,
  cachePath,
  ensureFileEnvelope,
  invalidateEnvelope,
} from "../waveformCache.ts";

export const mediatekRouter: Router = Router();

/** Analyse one hosted file here, because the hosted library cannot decode audio — see docs/mediatekRoutes.md. */
const analyseBody = z.object({ path: z.string().min(1) });
mediatekRouter.post(
  "/mediatek/analyse",
  validate(analyseBody),
  wrap(async (req, res) => {
    const { path } = req.body as z.infer<typeof analyseBody>;
    const base = mediatekBase();
    if (!base)
      return res
        .status(503)
        .json({ error: "no hosted library configured (MEDIATEK_URL)" });
    const engineBin = findEngineBinary();
    if (!engineBin)
      return res.status(503).json({
        error: "no engine on this machine — nothing here can decode audio",
      });

    let dest: string;
    try {
      dest = safePath(path);
    } catch (e) {
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      throw e;
    }

    const token = mediatekToken() ?? undefined;
    try {
      // Always re-fetched rather than trusted: the caller asks for this right after an upload.
      await remoteLibrary({ base, token }).download(path, dest);
    } catch (e) {
      // Logged HERE as well as answered: this is the machine that actually tried.
      console.error(`analyse: could not fetch ${path}:`, (e as Error).message);
      return res.status(502).json({ error: (e as Error).message });
    }
    // The bytes changed under it; the memo is keyed on mtime but the fingerprint is the truth.
    invalidateEnvelope(dest);

    const env = await ensureFileEnvelope(dest, engineBin);
    try {
      // Beside the audio, in the library, so nobody computes it twice; a sidecar is just a file there.
      await remoteWriter({ base, token }).put(
        `${path}${CACHE_EXT}`,
        readFileSync(cachePath(dest)),
      );
    } catch (e) {
      // The analysis is still good: say what failed rather than throwing the work away.
      return res.status(502).json({
        error: `analysed, but could not store the cache: ${(e as Error).message}`,
        bpm: env.bpm,
      });
    }
    // …and the tempo, best effort and reported: `set: false` is not a failure (docs/mediatekRoutes.md).
    let bpmSet = false;
    const folder = path.split("/").slice(0, -1).join("/");
    if (env.bpm > 0 && folder)
      try {
        bpmSet = (await pushSongBpm({ base, token }, folder, env.bpm)).set;
      } catch {
        /* reported as `bpmSet: false` — the analysis itself stands */
      }
    res.json({
      bpm: env.bpm,
      bpmSet,
      transients: env.transients.length,
      seconds: env.seconds,
    });
  }),
);

/** What this machine holds and where — the cache's answer, not the catalogue's; `present: false` is normal. */
mediatekRouter.get(
  "/mediatek",
  wrap(async (_req, res) => {
    res.json({ ...(await summary()), root: mediatekDir(), cached: true });
  }),
);

/** Pull one family's cache in line with the hosted library; the caller says WHICH, never from where. */
mediatekRouter.post(
  "/mediatek/sync",
  wrap(async (req, res) => {
    const family = asFamily(req.body?.family);
    if (!family) return res.status(400).json({ error: FAMILY_ERROR });
    const base = mediatekBase();
    if (!base)
      return res
        .status(503)
        .json({ error: "no hosted library configured (MEDIATEK_URL)" });
    const source = remoteLibrary({ base, token: mediatekToken() ?? undefined });
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

/** Every family's change token in one call, so a surface refetches only the listing that moved. */
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
  wrap(async (req, res) => {
    const family = asFamily(req.query.family);
    if (!family) return res.status(400).json({ error: FAMILY_ERROR });
    res.json(await listFamily(family));
  }),
);

/** Push a workspace's `_modules` / `_library` / `_ui` UP to the hosted library — docs/mediatekRoutes.md. */
const importBody = z.object({ workspace: z.string().min(1) });
mediatekRouter.post(
  "/mediatek/import",
  validate(importBody),
  wrap(async (req, res) => {
    const { workspace } = req.body as z.infer<typeof importBody>;
    let root: string;
    try {
      root = workspaceRoot(workspace);
    } catch (e) {
      // assertWorkspaceName refuses anything that isn't one plain path segment.
      return res.status(400).json({ error: (e as Error).message });
    }
    const base = mediatekBase();
    if (!base)
      return res
        .status(503)
        .json({ error: "no hosted library configured (MEDIATEK_URL)" });
    try {
      res.json(
        await uploadWorkspace(
          remoteWriter({ base, token: mediatekToken() ?? undefined }),
          root,
        ),
      );
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  }),
);

/** One cached file's BYTES, read-only and confined by `readablePath` — see docs/mediatekRoutes.md. */
mediatekRouter.get(
  "/mediatek/file",
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path is required" });
    try {
      // The mime is REQUIRED: `streamFile` sets it unconditionally and `undefined` threw a 500.
      return streamFile(req, res, readablePath(rel), mimeFor(rel));
    } catch (e) {
      // A path that escapes is the caller's mistake, not ours: 400, never 500.
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      return res.status(404).json({ error: (e as Error).message });
    }
  }),
);

/** One cached song's WAVEFORM, as JSON rather than sidecar bytes — see docs/mediatekRoutes.md. */
mediatekRouter.get(
  "/mediatek/envelope",
  wrap(async (req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path is required" });
    let abs: string;
    try {
      abs = readablePath(rel); // the same confinement /mediatek/file uses
    } catch (e) {
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      return res.status(400).json({ error: (e as Error).message });
    }
    try {
      // Throws its own ENOENT for a file the cache has not got, so no separate existence check.
      return res.json(await ensureFileEnvelope(abs, findEngineBinary()));
    } catch (e) {
      const message = (e as Error).message;
      const code = (e as NodeJS.ErrnoException).code;
      return res
        .status(
          code === "ENOENT"
            ? 404
            : message.includes("engine binary")
              ? 503
              : 500,
        )
        .json({ error: message });
    }
  }),
);

/** Filter across families; what a query MEANS belongs to the catalogue, not to a shell over it. */
mediatekRouter.get(
  "/mediatek/search",
  wrap(async (req, res) => {
    res.json({ entries: await search(parseQuery(req.query)) });
  }),
);
