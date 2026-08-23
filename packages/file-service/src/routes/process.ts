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

/**
 * The scratch directory a run owns — the mix that arrived, and the files it produced.
 *
 * Kept BY JOB ID rather than derived from it, because `startSeparate` hashes the work to decide
 * the id and hands back the run already in flight when there is one. Two callers asking for the
 * same cut therefore share a directory, which is right: it is the same files.
 */
const dirs = new Map<string, string>();

/** An hour past the job registry's own five minutes: a caller that polls, then collects, must
 *  find the bytes still there. Swept on each new run rather than on a timer nobody unrefs. */
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

/**
 * Run a chain over the posted audio and answer with a job to poll.
 *
 * The BYTES come in the request body, streamed to disk rather than buffered: the caller is
 * pl8, which holds the masters, and a master is routinely tens of megabytes. Nothing here reads
 * the médiathèque — there is no cache on this machine any more, and the file that arrives is the
 * only copy this service ever sees.
 *
 * `?chain=` names a chain of the account's LIBRARY (`@st0/stems`). It is resolved against a
 * libraries checkout and not against a project, because the caller has no project: see
 * `librariesAnchor` for why any workspace's checkout is the same answer.
 *
 * A chain either separates or bounces (`resolveChain` refuses one that does both). Only the
 * separating half is wired here so far; a bouncing chain is refused BY NAME rather than
 * silently producing nothing.
 */
processRouter.post(
  "/process",
  wrap(async (req, res) => {
    sweep();
    // Named by the caller, or — absent — the one answer this MACHINE holds. `/stems` never let
    // the caller name one at all, on the argument that which module separates and which model it
    // wants is settled once per machine by `system stems` and asking again at every use is asking
    // the same person the same question. That still holds, so it is the default rather than the
    // rule: pl8 knows which song, this machine knows how it cuts.
    const ref =
      String(req.query.chain ?? "").trim() ||
      (loadPreferences().stemsChain ?? "");
    if (!ref)
      return res.status(409).json({
        error:
          "no chain named, and this machine separates nothing yet — pass ?chain=, or set one " +
          "once with `system stems <chaîne>` (the cog, I/O)",
      });
    // The name decides the extension, and the extension is what ffmpeg reads the container from.
    // A basename, so a caller cannot write outside the scratch directory by naming a path.
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
      // Caller-fixable, every one: a name that is no chain, a step this machine cannot load, a
      // model nobody downloaded. The sentence carries the remedy, so the status only has to say
      // whose fault it is.
      return res.status(400).json({ error: (e as Error).message });
    }
    if (!cold.length)
      return res.status(400).json({
        error:
          `'${ref}' does not separate — it puts the signal through ${plugins.length} module(s). ` +
          "/process runs a chain whose step is an offline module.",
      });

    // The mix, onto this machine's disk. Streamed for the reason `remoteLibrary.download` gives:
    // a master must never be held whole in memory on the way through.
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
    // An empty body is the one failure a stream reports as success, and it is exactly what a
    // caller sending the wrong field produces. Caught here rather than in ffmpeg, whose answer
    // to it is a decode error naming a file the caller never heard of.
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
    // A run already in flight for this exact work keeps ITS directory; this one's is dropped
    // rather than left behind — the id hashes the source path, so a second identical request
    // arrives with a different temp path and can only be a retry.
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
    // Basenames, not the paths they sit at: the caller stores these itself and has no business
    // knowing this machine's scratch directory.
    res.json({ ...job, files: job.files.map((f) => basename(f)) });
  }),
);

/**
 * One produced file, for the caller to store.
 *
 * The name is checked against what the JOB produced rather than against the directory, so a
 * traversal has nothing to reach even if `basename` were ever loosened: the only strings that
 * answer here are ones this service wrote down itself.
 */
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

/** …and the caller saying it has them. Dropped now rather than at the sweep, because these are
 *  hundreds of megabytes of scratch and the collector is the only one who knows it is finished. */
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
