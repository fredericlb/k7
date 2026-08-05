// mediatek.ts — the media library as THIS MACHINE holds it. The library itself is hosted
// now (see apps/st0/backend); what lives here is a cache the moteur plays from, so
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
import { slugify, workspaceRoot } from "../slug.ts";
import {
  CACHE_EXT,
  cachePath,
  ensureFileEnvelope,
  invalidateEnvelope,
} from "../waveformCache.ts";

export const mediatekRouter: Router = Router();

/**
 * Analyse one file of the hosted library: waveform envelope, transient onsets, tempo.
 *
 * This exists because **st0 cannot decode audio**. It is a Node + nginx container with no
 * engine, and the engine is what owns decoding — so the hosted library holds the bytes and
 * this machine, which has an engine, does the work and hands the result back.
 *
 * The round trip is: download into the local cache (where the moteur would play it from
 * anyway), run the engine, push the `{file}.cache` sidecar up beside the audio, and report
 * the tempo so the caller can seed `song.yaml` with it. The next machine to want this file
 * then finds a sidecar already there.
 *
 * `path` names a file in the LIBRARY, never a local one: `safePath` confines it, and the
 * download source is configuration rather than a parameter — the same rule `/mediatek/sync`
 * states, so a browser cannot point this machine's downloader somewhere else.
 */
const analyseBody = z.object({ path: z.string().min(1) });
mediatekRouter.post(
  "/mediatek/analyse",
  validate(analyseBody),
  wrap(async (req, res) => {
    const { path } = req.body as z.infer<typeof analyseBody>;
    const base = process.env.MEDIATEK_URL;
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

    const token = process.env.MEDIATEK_TOKEN;
    try {
      // Always re-fetched rather than trusted: the caller asks for this right after an upload,
      // and a cache entry from a previous version of the same path would be analysed instead.
      await remoteLibrary({ base, token }).download(path, dest);
    } catch (e) {
      // Logged HERE as well as answered: this is the machine that actually tried, and its log
      // is where somebody looks when a browser three hops away says the analysis failed.
      console.error(`analyse: could not fetch ${path}:`, (e as Error).message);
      return res.status(502).json({ error: (e as Error).message });
    }
    // The bytes changed under it; the memo is keyed on mtime but the fingerprint is the truth.
    invalidateEnvelope(dest);

    const env = await ensureFileEnvelope(dest, engineBin);
    try {
      // Beside the audio, in the library, so nobody computes it twice. Written as bytes through
      // the ordinary file route — the sidecar is just a file to the hosted service.
      await remoteWriter({ base, token }).put(
        `${path}${CACHE_EXT}`,
        readFileSync(cachePath(dest)),
      );
    } catch (e) {
      // The analysis is still good and the tempo still worth reporting: say what failed rather
      // than throwing away work the caller asked for.
      return res.status(502).json({
        error: `analysed, but could not store the cache: ${(e as Error).message}`,
        bpm: env.bpm,
      });
    }
    // …and the tempo, which only a folder holding a sidecar can carry. Best effort and
    // reported: a song whose bpm somebody already set answers `set: false`, which is not a
    // failure, and a library that refuses the write must not lose the cache we just stored.
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
    if (!family) return res.status(400).json({ error: FAMILY_ERROR });
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
    if (!family) return res.status(400).json({ error: FAMILY_ERROR });
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

/**
 * One cached file's BYTES.
 *
 * The catalogue says where a thing is; it never says what is in it. That was enough while
 * everything downstream either listed the cache or handed the moteur a path — but a browser
 * that has to read a module's `plugin:` block has neither a filesystem nor a way in. This
 * is that way in, and it is read-only: writing to the cache is what a sync is for, and a
 * route that let a caller edit it would produce files the next sync silently deletes.
 *
 * `safePath` confines every path to the cache root, lexically and via realpath — the same
 * guard the hosted service uses, since this one is now reachable from a second app.
 */
mediatekRouter.get(
  "/mediatek/file",
  wrap((req, res) => {
    const rel = String(req.query.path ?? "");
    if (!rel) return res.status(400).json({ error: "path is required" });
    try {
      // The mime is REQUIRED and was missing: streamFile sets it unconditionally, so
      // `undefined` threw inside res.setHeader and this route answered 500 for every file
      // it was asked for. A cache serves audio, video, YAML and JSON, so it is guessed
      // from the extension rather than pinned — and octet-stream is the honest default,
      // not a lie about the content.
      return streamFile(req, res, safePath(rel), mimeFor(rel));
    } catch (e) {
      // A path that escapes is the caller's mistake, not ours: 400, never 500.
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      return res.status(404).json({ error: (e as Error).message });
    }
  }),
);

/** Filter across families. What a query MEANS — including why `limit` is clamped — belongs to
 *  the catalogue, not to either shell over it: see parseQuery. */
mediatekRouter.get(
  "/mediatek/search",
  wrap((req, res) => {
    res.json({ entries: search(parseQuery(req.query)) });
  }),
);
