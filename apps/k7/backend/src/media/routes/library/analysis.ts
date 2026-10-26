// analysis.ts — the library's MEASURING routes: the sweeps' state, one file analysed here, its
// envelope for a waveform, and the tempo and key a song carries — ../../../../docs/media/analysis.md.

import { DEFAULT_CACHE_CONTROL, notModified } from "@frediverse/http";
import { wrap } from "@frediverse/http/route";
import { NoFfmpegError } from "@studio/ffmpeg";
import { KEY_PATTERN } from "@studio/mediatek/types";
import { setSongBpm, setSongKey } from "@studio/mediatek/write";
import express, { Router } from "express";
import {
  AnalysisBusyError,
  analyseShared,
  ensureAnalysedShared,
} from "../../analysisGate.ts";
import { sweepState } from "../../analysisSweep.ts";
import {
  envelopeEtag,
  envelopeOf,
  envelopeVersion,
} from "../../envelopeMemo.ts";
import { streamSweepState } from "../../streamSweep.ts";
import { resolveReadable } from "./read.ts";
import { writeError } from "./write.ts";

export const analysisRoutes: Router = Router();

/** What the background sweep is doing — the backlog it found, and whether it has a decoder at all. */
analysisRoutes.get(
  "/analysis",
  wrap((_req, res) => {
    res.json(sweepState());
  }),
);

/** What the stream sweep is doing — ../../../../docs/media/derivedStream.md. */
analysisRoutes.get("/stream-copies", (_req, res) => {
  res.json(streamSweepState());
});

/** Measure one file HERE, where the bytes and ffmpeg are, and write its `.cache` sidecar — packages/audio-analysis/docs/analysis.md. */
analysisRoutes.post(
  "/analyse",
  express.json(),
  wrap(async (req, res) => {
    const path = String(req.body?.path ?? "");
    const source = resolveReadable(path, res, "present");
    if (!source) return;

    let env: Awaited<ReturnType<typeof analyseShared>>;
    try {
      env = await analyseShared(source);
    } catch (e) {
      // A missing decoder is this deployment's to fix, and it is not the caller's request that is wrong.
      if (e instanceof NoFfmpegError || e instanceof AnalysisBusyError)
        return res.status(503).json({ error: e.message });
      return res.status(422).json({ error: (e as Error).message });
    }

    // …and the tempo, best effort and reported: `set: false` is not a failure.
    let bpmSet = false;
    const folder = path.split("/").slice(0, -1).join("/");
    if (env.bpm > 0 && folder)
      try {
        bpmSet = await setSongBpm(folder, env.bpm);
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

/** A file's measured shape for a waveform: the cached sidecar while the file has not moved, else one fresh analysis. */
analysisRoutes.get(
  "/envelope",
  wrap(async (req, res) => {
    const source = resolveReadable(
      String(req.query.path ?? ""),
      res,
      "present",
    );
    if (!source) return;

    try {
      // A browser holding this version's answer is told so before anything is read or computed.
      const current = envelopeEtag(await envelopeVersion(source));
      if (notModified(req, current)) {
        res.setHeader("ETag", current);
        res.setHeader("Cache-Control", DEFAULT_CACHE_CONTROL);
        return res.status(304).end();
      }
      const { body, etag } = await envelopeOf(source, async () => {
        const env = await ensureAnalysedShared(source);
        return {
          sampleRate: env.sampleRate,
          seconds: env.seconds,
          rms: env.rms,
          transients: env.transients,
          // The spectrum waveform's height and colour, the bands absent from a file analysed without them.
          peak: env.peak,
          low: env.low,
          mid: env.mid,
          high: env.high,
        };
      });
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", DEFAULT_CACHE_CONTROL);
      res.type("application/json").send(body);
    } catch (e) {
      if (e instanceof NoFfmpegError || e instanceof AnalysisBusyError)
        return res.status(503).json({ error: e.message });
      res.status(422).json({ error: (e as Error).message });
    }
  }),
);

/** Seed a detected tempo, from a caller that measured it elsewhere — mediatek's docs/songs.md. */
analysisRoutes.post(
  "/bpm",
  express.json(),
  wrap(async (req, res) => {
    const path = String(req.body?.path ?? "");
    const bpm = Number(req.body?.bpm);
    if (!path) return res.status(400).json({ error: "path required" });
    if (!Number.isFinite(bpm) || bpm <= 0)
      return res.status(400).json({ error: "bpm must be a positive number" });
    try {
      res.json({
        set: await setSongBpm(path, bpm, req.body?.force === true),
      });
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);

/** A song's KEY, a fact about the recording, typed rather than detected — docs/key-detection-plan.md. */
analysisRoutes.post(
  "/key",
  express.json(),
  wrap(async (req, res) => {
    const path = String(req.body?.path ?? "");
    const key = String(req.body?.key ?? "");
    if (!path) return res.status(400).json({ error: "path required" });
    // A refused SHAPE and a refused overwrite are different answers; only the first is a 400.
    if (!KEY_PATTERN.test(key.trim()))
      return res
        .status(400)
        .json({ error: "key must read like `C# minor` or `A major`" });
    try {
      res.json({
        set: await setSongKey(path, key, req.body?.force === true),
      });
    } catch (e) {
      if (writeError(e, res)) return;
      throw e;
    }
  }),
);
