// process.ts (routes) — run a chain over audio the CALLER sends, and hold the results for it to
// collect. Mounted before resolveWorkspace, like separate.ts: the model and the CPU are
// properties of the machine, and this caller has no workspace at all. See docs/processChain.md.

import {
  createWriteStream,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { wrap } from "@frediverse/http/route";
import { resolveChain } from "@studio/audio-passes/processChain";
import { emptyDoc } from "@studio/engine-protocol/build";
import { loadPreferences } from "@studio/song/preferences";
import {
  separateJob,
  startSeparate,
} from "@studio/stem-separation/separateJobs";
import { Router } from "express";
import { librariesAnchor } from "../librariesAnchor.ts";

export const processRouter: Router = Router();

/** The scratch directory a run owns, kept BY JOB ID rather than derived from it — docs/processChain.md. */
const dirs = new Map<string, string>();

/** An hour past the job registry's own five minutes, swept on each new run rather than on a timer. */
const KEEP_MS = 60 * 60 * 1000;
const seen = new Map<string, number>();

function sweep(): void {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, at] of seen) {
    if (at >= cutoff) continue;
    const dir = dirs.get(id);
    if (dir) rmSync(dir, { recursive: true, force: true });
    dirs.delete(id);
    seen.delete(id);
  }
}

/** Run a chain over the posted audio and answer with a job to poll — see docs/processChain.md. */
processRouter.post(
  "/process",
  wrap(async (req, res) => {
    sweep();
    // Named by the caller, or — absent — the one answer this MACHINE holds (docs/processChain.md).
    const ref =
      String(req.query.chain ?? "").trim() ||
      (loadPreferences().stemsChain ?? "");
    if (!ref)
      return res.status(409).json({
        error:
          "no chain named, and this machine separates nothing yet — pass ?chain=, or set one " +
          "once with `system stems <chaîne>` (the cog, I/O)",
      });
    // The extension is what ffmpeg reads the container from; a basename, so no path can escape.
    const name = basename(String(req.query.name ?? "source.wav")).trim();
    if (!name || name.startsWith("."))
      return res.status(400).json({ error: "name must be a plain filename" });

    const anchor = librariesAnchor(req.userEmail!);
    if (!anchor)
      return res.status(409).json({
        error:
          "this machine holds no libraries checkout for this account — open a project once, " +
          "or clone the libraries repository, and `@st0/…` will resolve",
      });

    let cold: ReturnType<typeof resolveChain>["cold"];
    let plugins: ReturnType<typeof resolveChain>["plugins"];
    try {
      ({ cold, plugins } = resolveChain(anchor, emptyDoc(), ref));
    } catch (e) {
      // Caller-fixable, every one, and the sentence carries the remedy.
      return res.status(400).json({ error: (e as Error).message });
    }
    if (!cold.length)
      return res.status(400).json({
        error:
          `'${ref}' does not separate — it puts the signal through ${plugins.length} module(s). ` +
          "/process runs a chain whose step is an offline module.",
      });

    // The mix, onto this machine's disk, streamed: a master must never be held whole in memory.
    const dir = mkdtempSync(join(tmpdir(), "studio-process-"));
    const source = join(dir, name);
    try {
      await pipeline(req, createWriteStream(source));
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      return res.status(400).json({
        error: `the body did not arrive whole: ${(e as Error).message}`,
      });
    }
    // An empty body is the one failure a stream reports as success; ffmpeg's answer to it names no caller.
    if (!statSync(source).size) {
      rmSync(dir, { recursive: true, force: true });
      return res
        .status(400)
        .json({ error: "the body was empty — nothing to process" });
    }

    const started = startSeparate({
      userEmail: req.userEmail!,
      source,
      model: cold[0].model,
      outDir: join(dir, "out"),
    });
    // A run already in flight for this exact work keeps ITS directory; this one's is dropped.
    if (dirs.has(started.id) && dirs.get(started.id) !== dir)
      rmSync(dir, { recursive: true, force: true });
    else dirs.set(started.id, dir);
    seen.set(started.id, Date.now());

    res.json(separateJob(started.id) ?? started);
  }),
);

/** Where a run got to. 404 for one this service has forgotten, exactly as `/separate/:id` does. */
processRouter.get(
  "/process/:id",
  wrap((req, res) => {
    const job = separateJob(req.params.id);
    if (!job) return res.status(404).json({ error: "unknown process job" });
    // Basenames: the caller has no business knowing this machine's scratch directory.
    res.json({ ...job, files: job.files.map((f) => basename(f)) });
  }),
);

/** One produced file: the name is checked against what the JOB produced, not against the directory. */
processRouter.get(
  "/process/:id/file",
  wrap((req, res) => {
    const job = separateJob(req.params.id);
    if (!job) return res.status(404).json({ error: "unknown process job" });
    const want = String(req.query.name ?? "");
    const hit = job.files.find((f) => basename(f) === want);
    if (!hit || !existsSync(hit))
      return res.status(404).json({ error: `this job produced no '${want}'` });
    res.sendFile(hit);
  }),
);

/** …and the caller saying it has them: the collector is the only one who knows the scratch is finished. */
processRouter.delete(
  "/process/:id",
  wrap((req, res) => {
    const dir = dirs.get(req.params.id);
    if (dir) rmSync(dir, { recursive: true, force: true });
    dirs.delete(req.params.id);
    seen.delete(req.params.id);
    res.json({ ok: true });
  }),
);
