// recorderSave.ts — send a recorded output to the médiathèque's `recordings/` zone: the engine's audio take, the
// browser's picture of RENDER (which the browser already joined to the sound), or both apart when it could not join
// them. Both files are on this machine — the engine wrote the take, the page uploaded its picture beside it — so this
// lives in the file service. What arrives from the browser is paths, so each is CHECKED against the project's own
// record directory before anything is opened. Rationale: packages/song/docs/outputRecording.md.

import { openAsBlob, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pushRecording } from "@studio/mediatek/remote";
import { isWithin } from "@studio/web-protocol/paths";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";

/** Is `file` inside `dir`? Resolved on both sides, so `..` cannot walk out of it. */
export function insideDir(dir: string, file: string): boolean {
  return !!dir && isWithin(resolve(dir), resolve(file));
}

export interface SaveTakeResult {
  /** Where it landed in the médiathèque — `recordings/2026-08-27/14-32-08.webm`; the first, when two were filed. */
  path: string;
  bytes: number;
}

/**
 * Push one recording: the audio take, the picture, or each of them when the browser sent both apart. `recordDir` is
 * the project's own, off the compiled document — the only directory either file may come out of, and the reason a
 * browser cannot name an arbitrary file. The picture is removed once filed: the page uploaded it for this alone.
 */
export async function saveTake(opts: {
  recordDir: string;
  /** The engine's take, absent when the browser joined it into the picture or the graph reaches no OUT. */
  file?: string;
  /** The browser's picture of RENDER, uploaded beside the takes. */
  video?: string;
  /** An optional name, which makes it a MOMENT rather than a bare capture (mediatek/docs/recordings.md). */
  label?: string;
}): Promise<SaveTakeResult> {
  const { recordDir, file, video, label } = opts;
  const sent = [file, video].filter((f): f is string => !!f);
  if (!sent.length) throw new Error("nothing was recorded");
  for (const f of sent)
    if (!insideDir(recordDir, f))
      throw new Error(
        `"${f}" is not one of this project's takes — a recording is saved from its own record directory`,
      );
  const base = mediatekBase();
  if (!base)
    throw new Error(
      "no médiathèque is configured on this machine, so there is nowhere to save a take",
    );
  let first: SaveTakeResult | null = null;
  for (const f of sent) {
    let at: Date;
    let bytes: number;
    try {
      // The take's own mtime, not now: a take saved an hour later belongs to the hour it was PLAYED.
      at = statSync(file ?? f).mtime;
      bytes = statSync(f).size;
    } catch (e) {
      throw new Error(`cannot read the take: ${(e as Error).message}`);
    }
    const res = await pushRecording(
      { base, token: mediatekToken() ?? undefined },
      {
        filename: basename(f),
        bytes: await openAsBlob(f),
        at,
        ...(label ? { label } : {}),
      },
    );
    first ??= { path: res.path, bytes };
  }
  if (video) rmSync(video, { force: true });
  return first as SaveTakeResult;
}
