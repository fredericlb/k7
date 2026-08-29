// cut.ts — separating a song, HERE. pl8 holds the masters, so pl8 owns the job and now does the
// work too: it runs the model in a worker thread and the stems are written straight into the
// song's own folder. Nothing is posted anywhere and nothing is collected back.
// See ../../docs/stems.md.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { safePath } from "@studio/mediatek/layout";
import { isAudio } from "@studio/mediatek/media";
import { STEMS_DIR, stemsComplete } from "@studio/song-schema/stems";
import {
  separateJob,
  startSeparate,
} from "@studio/stem-separation/separateJobs";
import type { SeparateJob } from "@studio/web-protocol";
import { NoModelError, stemsModel } from "./model.ts";

/** In-process, so this is only how often the progress is REDRAWN, not a network round trip. */
const POLL_MS = 500;

export class CutError extends Error {}

/** The stems this song already has — asked of the FOLDER, since the files are the truth. */
export function heldStems(song: string): string[] {
  const outDir = join(dirname(safePath(song)), STEMS_DIR);
  return existsSync(outDir) ? readdirSync(outDir).filter(isAudio) : [];
}

/** Cut one song into stems and keep them in `stems/` under its folder — ../../docs/stems.md. */
export async function cutStems(opts: {
  userEmail: string;
  song: string;
  onProgress?: (job: SeparateJob) => void;
}): Promise<{ ready: true; files: string[] }> {
  const { userEmail, song } = opts;
  const source = safePath(song);
  if (!existsSync(source)) throw new CutError(`${song} is not on this volume`);

  // `dirname`, not a slice on "/": `safePath` answers in the platform's own separators.
  const outDir = join(dirname(source), STEMS_DIR);
  const held = heldStems(song);
  // COMPLETE, not merely present: a folder from before the aligned master cannot cancel — docs/stemSplit.md.
  if (stemsComplete(held)) return { ready: true, files: held };

  let model: string;
  try {
    model = stemsModel();
  } catch (e) {
    if (e instanceof NoModelError) throw new CutError(e.message);
    throw e;
  }

  // The worker writes the four stems into outDir itself, and creates it.
  let job = startSeparate({ userEmail, source, model, outDir });
  opts.onProgress?.(job);

  while (!job.done) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const now = separateJob(job.id);
    // A swept job is overwhelmingly one that LANDED, so ask the folder — ../../docs/stems.md.
    if (!now) {
      const done = heldStems(song);
      if (stemsComplete(done)) return { ready: true, files: done };
      throw new CutError(`the separation of ${song} was forgotten`);
    }
    job = now;
    opts.onProgress?.(job);
  }
  if (job.failed) throw new CutError(job.error ?? "the separation failed");
  return { ready: true, files: job.files };
}
