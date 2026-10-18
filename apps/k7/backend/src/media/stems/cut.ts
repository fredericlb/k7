// cut.ts — separating a song, driven from HERE and RUN on an engine's machine. The library holds the
// masters and owns the job; the account's file service says which model the cut runs, and the
// chosen engine's machine runs it over a jobs channel — the song and the model travel there, the
// stems come back into `stems/` beside the song. See ../../../docs/media/stems.md.

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { TunnelRoot } from "@studio/engine-tunnel/frames";
import { tunnelSpelling } from "@studio/engine-tunnel/job-spelling";
import { type JobSocket, requestJob } from "@studio/engine-tunnel/jobs-client";
import { safePath } from "@studio/mediatek/layout";
import { isAudio } from "@studio/mediatek/media";
import {
  INSTRUMENTAL,
  outputFile,
  STEMS_DIR,
  stemsComplete,
} from "@studio/song-schema/stems";
import type { SeparateJob } from "@studio/web-protocol";

export class CutError extends Error {}

/** The stems this song already has — asked of the FOLDER, since the files are the truth. */
function heldStems(song: string): string[] {
  const outDir = join(dirname(safePath(song)), STEMS_DIR);
  return existsSync(outDir) ? readdirSync(outDir).filter(isAudio) : [];
}

/** What a cut can be asked for: the four parts a deck plays, or the record without its voice. */
export type CutWant = "stems" | typeof INSTRUMENTAL;

/** Is this song already cut THE WAY THIS CALLER MEANS? An instrumental is not three stems of four. */
export function heldFor(song: string, want: CutWant): boolean {
  const held = heldStems(song);
  return want === INSTRUMENTAL
    ? held.includes(outputFile(INSTRUMENTAL))
    : stemsComplete(held);
}

/** What a cut needs from the rest of the server: the account's chain, and a way onto the engine's machine. */
export interface CutDeps {
  coldRun(
    user: string,
    chain: string,
    want: string,
  ): Promise<{ model: string; outputs: string[]; roots: TunnelRoot[] }>;
  jobsChannel(
    engineId: string,
    roots: TunnelRoot[],
  ): Promise<(JobSocket & { close(): void }) | null>;
}

/** Cut one song into stems and keep them in `stems/` under its folder — ../../../docs/media/stems.md. */
export async function cutStems(opts: {
  deps: CutDeps;
  engineId: string;
  userEmail: string;
  song: string;
  chain: string;
  /** What to bring back — the four stems unless the caller says otherwise. */
  want?: CutWant;
  onProgress?: (job: SeparateJob) => void;
}): Promise<{ ready: true; files: string[] }> {
  const { deps, engineId, userEmail, song, chain } = opts;
  const want = opts.want ?? "stems";
  const source = safePath(song);
  if (!existsSync(source)) throw new CutError(`${song} is not on this volume`);
  // COMPLETE, not merely present: a folder from before the aligned master cannot cancel — docs/stemSplit.md.
  if (heldFor(song, want)) return { ready: true, files: heldStems(song) };

  let run: Awaited<ReturnType<CutDeps["coldRun"]>>;
  try {
    run = await deps.coldRun(userEmail, chain, want);
  } catch (e) {
    throw new CutError((e as Error).message);
  }
  const ch = await deps.jobsChannel(engineId, run.roots);
  if (!ch)
    throw new CutError(
      "that engine is not connected to this server — its supervisor holds no tunnel here",
    );
  let job: SeparateJob;
  try {
    const body = {
      type: "separate",
      user: userEmail,
      source,
      model: run.model,
      outputs: run.outputs,
      // `dirname`, not a slice on "/": `safePath` answers in the platform's own separators.
      outDir: join(dirname(source), STEMS_DIR),
    };
    const reply = await requestJob(
      ch,
      // …which the machine maps only in the tunnel's spelling (packages/engine-tunnel/jobSpelling.ts).
      JSON.parse(tunnelSpelling(JSON.stringify(body), run.roots)),
      (r) => r.type === "separated",
      // Forwarded VERBATIM: this service is a pipe for the machine's progress, not a second opinion.
      (r) => opts.onProgress?.(r.job as SeparateJob),
    );
    job = reply.job as SeparateJob;
  } catch (e) {
    throw new CutError((e as Error).message);
  } finally {
    ch.close();
  }
  if (job.failed) throw new CutError(job.error ?? "the separation failed");
  return { ready: true, files: job.files.map((f) => basename(f)) };
}
