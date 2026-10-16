// probe.ts — what a video file IS, asked of ffprobe: its first video stream's codec, size, pixel
// format and frame rate, and the file's duration. ffmpeg is the only thing here that opens every
// container a camera writes; without it the answer is a NoFfmpegError, never a guess.
// See docs/videoPrep.md.

import { ffprobeBin, input, NoFfmpegError, run } from "@studio/ffmpeg";

export { NoFfmpegError };

/** ffprobe or ffmpeg is absent: nothing can be said about the file, and nothing made from it. */
export const WHY =
  "getting a video ready for the picture needs ffmpeg. Install it on the machine the file service runs on.";

/** A video as the plan reads it; `codec` is ffprobe's name, `pixFmt` says the bit depth and the chroma. */
export interface VideoFacts {
  codec: string;
  width: number;
  height: number;
  pixFmt: string;
  fps: number;
  seconds: number;
  /** The container, by ffprobe's format name: "mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", … */
  container: string;
}

// "30000/1001" → 29.97; ffprobe states a rate as a fraction.
const rate = (r: unknown): number => {
  const [n, d] = String(r ?? "0/1")
    .split("/")
    .map(Number);
  return d ? (n as number) / d : Number(n) || 0;
};

/** ffprobe's arguments for `source`, pure so the whitelist on an uploaded file is testable. */
export const probeArgs = (source: string): string[] => [
  "-v",
  "error",
  "-select_streams",
  "v:0",
  "-show_entries",
  "stream=codec_name,width,height,pix_fmt,avg_frame_rate:format=duration,format_name",
  "-of",
  "json",
  ...input(source),
];

/** The facts of `source`'s first video stream, or null when it has none — an audio file, a still in a container. */
export async function probeVideo(source: string): Promise<VideoFacts | null> {
  const out = await run(ffprobeBin(), probeArgs(source), { why: WHY });
  const j = JSON.parse(out) as {
    streams?: Record<string, unknown>[];
    format?: Record<string, unknown>;
  };
  const s = j.streams?.[0];
  if (!s) return null;
  return {
    codec: String(s.codec_name ?? ""),
    width: Number(s.width) || 0,
    height: Number(s.height) || 0,
    pixFmt: String(s.pix_fmt ?? ""),
    fps: rate(s.avg_frame_rate),
    seconds: Number(j.format?.duration) || 0,
    container: String(j.format?.format_name ?? ""),
  };
}
