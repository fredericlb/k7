// recorderSave.ts — send a recorded output to the médiathèque's `recordings/` zone: the engine's audio take, the
// browser's picture of RENDER, or the two muxed into one video. Both files are on this machine — the engine wrote the
// take, the page uploaded its picture beside it — so this lives in the file service. What arrives from the browser is
// paths, so each is CHECKED against the project's own record directory before anything is opened.
// Rationale: packages/song/docs/outputRecording.md.

import { openAsBlob, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ffmpegBin, input, run } from "@studio/ffmpeg";
import { pushRecording } from "@studio/mediatek/remote";
import { isWithin } from "@studio/web-protocol/paths";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";

/** Is `file` inside `dir`? Resolved on both sides, so `..` cannot walk out of it. */
export function insideDir(dir: string, file: string): boolean {
  return !!dir && isWithin(resolve(dir), resolve(file));
}

export interface SaveTakeResult {
  /** Where it landed in the médiathèque — `recordings/2026-08-27/14-32-08.webm`. */
  path: string;
  bytes: number;
}

/** A mux of a long take is bounded, but generously: the picture is copied, only the sound is encoded. */
const MUX_TIMEOUT_MS = 30 * 60_000;

/** ffmpeg's arguments for `video`'s picture under `wav`'s sound, into `out`: the picture copied, the sound to Opus. */
export const muxArgs = (video: string, wav: string, out: string): string[] => [
  "-y",
  ...input(video),
  ...input(wav),
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-c:v",
  "copy",
  "-c:a",
  "libopus",
  "-b:a",
  "192k",
  out,
];

/**
 * Push one recording: the audio take, the picture, or both muxed. `recordDir` is the project's own, off the compiled
 * document — the only directory either file may come out of, and the reason a browser cannot name an arbitrary file.
 * The picture is removed once filed: the page uploaded it for this and nothing else.
 */
export async function saveTake(opts: {
  recordDir: string;
  /** The engine's take, absent for a project whose graph reaches RENDER and not OUT. */
  file?: string;
  /** The browser's picture of RENDER, uploaded beside the takes. */
  video?: string;
  /** An optional name, which makes it a MOMENT rather than a bare capture (mediatek/docs/recordings.md). */
  label?: string;
}): Promise<SaveTakeResult> {
  const { recordDir, file, video, label } = opts;
  if (!file && !video) throw new Error("nothing was recorded");
  for (const f of [file, video])
    if (f && !insideDir(recordDir, f))
      throw new Error(
        `"${f}" is not one of this project's takes — a recording is saved from its own record directory`,
      );
  const base = mediatekBase();
  if (!base)
    throw new Error(
      "no médiathèque is configured on this machine, so there is nowhere to save a take",
    );
  const muxed =
    file && video
      ? join(recordDir, `${basename(file).replace(/\.\w+$/, "")}.webm`)
      : null;
  try {
    if (muxed && file && video)
      await run(ffmpegBin(), muxArgs(video, file, muxed), {
        timeoutMs: MUX_TIMEOUT_MS,
        what: "joining the picture to the sound",
        why: "a recording with a picture is joined to its sound with ffmpeg. Install it, or point FFMPEG_BIN at it.",
      });
    const sent = muxed ?? video ?? (file as string);
    let at: Date;
    let bytes: number;
    try {
      // The take's own mtime, not now: a take saved an hour later belongs to the hour it was PLAYED.
      at = statSync(file ?? sent).mtime;
      bytes = statSync(sent).size;
    } catch (e) {
      throw new Error(`cannot read the take: ${(e as Error).message}`);
    }
    const res = await pushRecording(
      { base, token: mediatekToken() ?? undefined },
      {
        filename: basename(sent),
        bytes: await openAsBlob(sent),
        at,
        ...(label ? { label } : {}),
      },
    );
    if (video) rmSync(video, { force: true });
    return { path: res.path, bytes };
  } finally {
    if (muxed) rmSync(muxed, { force: true });
  }
}
