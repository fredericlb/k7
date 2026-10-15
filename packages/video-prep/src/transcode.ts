// transcode.ts — the copies a plan asks for, made with ffmpeg into a `.part` file renamed over the
// destination only when it finished, so an interrupted run leaves nothing a compile would take
// for a finished copy. Every copy is VIDEO only: a shot's sound is the engine's, extracted apart.
// See docs/videoPrep.md.

import { renameSync, rmSync } from "node:fs";
import { run } from "./probe";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

/** What to make: the optimized copy (a stream copy, or a full re-encode) or the preview proxy. */
export type CopyKind = "remux" | "transcode" | "proxy";

/** The proxy's height; its width follows the source's aspect, rounded to an even number. */
export const PROXY_HEIGHT = 720;

/** ffmpeg's arguments for one copy, pure so the choices are testable. */
export function copyArgs(
  kind: CopyKind,
  source: string,
  dest: string,
): string[] {
  const head = ["-v", "error", "-y", "-i", source, "-map", "0:v:0", "-an"];
  // A keyframe every second, so a scrub lands on a frame without decoding back to a distant one.
  const scrubbable = ["-g", "30", "-keyint_min", "30", "-sc_threshold", "0"];
  // 8-bit 4:2:0 H.264 is the one stream every browser decodes; +faststart lets it play before it is all read.
  const h264 = [
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
  ];
  switch (kind) {
    case "remux":
      return [
        ...head,
        "-c:v",
        "copy",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        dest,
      ];
    case "transcode":
      return [
        ...head,
        ...h264,
        "-preset",
        "medium",
        "-crf",
        "18",
        ...scrubbable,
        "-f",
        "mp4",
        dest,
      ];
    case "proxy":
      return [
        ...head,
        "-vf",
        `scale=-2:${PROXY_HEIGHT}`,
        ...h264,
        "-preset",
        "veryfast",
        "-crf",
        "26",
        ...scrubbable,
        "-f",
        "mp4",
        dest,
      ];
  }
}

/** Make one copy of `source` at `dest`; the destination exists only once ffmpeg finished. */
export async function makeCopy(
  kind: CopyKind,
  source: string,
  dest: string,
): Promise<void> {
  const part = `${dest}.part`;
  try {
    await run(FFMPEG, copyArgs(kind, source, part));
    renameSync(part, dest);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
}

/** Where a copy of `source` is written: beside it, under a name no clip of its own is likely to hold. */
export const copyPathOf = (
  source: string,
  kind: "optimized" | "proxy",
): string => source.replace(/\.[^./]+$/, `.${kind}.mp4`);
