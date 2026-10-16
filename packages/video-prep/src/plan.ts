// plan.ts — what a video needs before the picture can use it, decided from its probed facts and
// nothing else: pure, so the rule is testable without a single file. Two independent answers:
// whether the browser can DECODE it at all (else an optimized copy at full resolution, which the
// export renders from too), and whether it is too heavy to PREVIEW (else a small proxy).
// See docs/videoPrep.md.

import type { VideoFacts } from "./probe";

/** The codecs every browser this app runs in decodes, 8-bit 4:2:0 only — ffprobe's names. */
export const PLAYABLE_CODECS = ["h264", "vp8", "vp9", "av1"] as const;

/** The pixel formats a browser decoder takes: 8-bit 4:2:0. A 10-bit or 4:2:2 stream of a playable codec still fails. */
export const PLAYABLE_PIX_FMTS = ["yuv420p", "yuvj420p"] as const;

/** The tallest picture previewed from its source; above it a proxy is made, since one 4K decoder can stall a lane. */
export const PREVIEW_MAX_HEIGHT = 1080;

/** What one file needs: an optimized copy (a stream copy when only the container is wrong), a proxy, or neither. */
export interface VideoPlan {
  optimized: "none" | "remux" | "transcode";
  proxy: boolean;
  /** Why, in words — what the verb says per clip. */
  reason: string;
}

// A container a browser opens: mp4 and webm everywhere; .mov and .mkv only by luck of the browser.
const playableContainer = (c: string): boolean =>
  /\bmp4\b/.test(c) || /\bwebm\b/.test(c);

/** The plan for one probed video. */
export function planVideo(f: VideoFacts): VideoPlan {
  const codecOk = (PLAYABLE_CODECS as readonly string[]).includes(f.codec);
  const pixOk = (PLAYABLE_PIX_FMTS as readonly string[]).includes(f.pixFmt);
  const proxy = f.height > PREVIEW_MAX_HEIGHT;
  const size = `${f.width}×${f.height}`;
  if (!codecOk || !pixOk) {
    const what = !codecOk
      ? f.codec || "an unknown codec"
      : `${f.codec} in ${f.pixFmt}`;
    return {
      optimized: "transcode",
      proxy,
      reason: `${what} is not something a browser decodes — an optimized copy at ${size}${proxy ? ", and a proxy to preview" : ""}`,
    };
  }
  // A mp4 inside a .mov is the commonest case of this: the stream is fine, only the box is not.
  if (!playableContainer(f.container))
    return {
      optimized: "remux",
      proxy,
      reason: `${f.codec} is playable but its container is not — copied into mp4 without re-encoding${proxy ? ", and a proxy to preview" : ""}`,
    };
  if (proxy)
    return {
      optimized: "none",
      proxy: true,
      reason: `${size} is heavier than the preview needs — a proxy to preview, the export reads the source`,
    };
  return { optimized: "none", proxy: false, reason: "ready as it is" };
}
