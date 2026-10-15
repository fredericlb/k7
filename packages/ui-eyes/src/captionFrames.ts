// captionFrames.ts — a subtitle clip as the frames it shows: the cue at a source time, drawn ONCE
// into a viewport-sized canvas and uploaded as a still is. A cue is static while it is on, so each
// is set once however many frames show it. The defaults are a broadcast's: white, centred, near
// the bottom, a shadow unless a box is asked for. See song-video/docs/titles.md.

import type { SceneCaptions } from "./scene";
import { drawText } from "./text";

/** The cue showing at `t` seconds of the file, or -1 between cues. */
export function cueAt(captions: SceneCaptions, t: number): number {
  return captions.cues.findIndex((c) => t >= c.start && t < c.end);
}

export class CaptionFrames {
  private vw: number;
  private vh: number;
  private drawn = new Map<string, OffscreenCanvas>();

  constructor(vw: number, vh: number) {
    this.vw = vw;
    this.vh = vh;
  }

  /** The frame `captions` shows at `t` seconds of its file, or null between cues; `key` names the clip. */
  frame(
    key: string,
    captions: SceneCaptions,
    t: number,
  ): OffscreenCanvas | null {
    const i = cueAt(captions, t);
    if (i < 0) return null;
    const id = `${key}#${i}`;
    const hit = this.drawn.get(id);
    if (hit) return hit;
    const canvas = new OffscreenCanvas(this.vw, this.vh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const s = captions.style;
    const w = Math.round(this.vw * 0.8);
    const fontSize = s.fontSize ?? Math.round(this.vh * 0.05);
    const margin = s.margin ?? Math.round(this.vh * 0.06);
    const position = s.position ?? "bottom";
    drawText(ctx, {
      content: captions.cues[i]?.text ?? "",
      font: s.font ?? "sans-serif",
      fontSize,
      color: s.color ?? "#ffffff",
      x: Math.round((this.vw - w) / 2),
      y:
        position === "top"
          ? margin
          : position === "middle"
            ? this.vh / 2
            : this.vh - margin,
      w,
      align: s.align ?? "center",
      anchor:
        position === "top"
          ? "top"
          : position === "middle"
            ? "middle"
            : "bottom",
      ...(s.background ? { background: s.background } : { shadow: true }),
    });
    this.drawn.set(id, canvas);
    return canvas;
  }
}
