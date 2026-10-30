// ClipMiniRoll.tsx — a MIDI clip's notes as a mini piano-roll inside its lane block, drawn into one
// canvas. The one thing a reader would get wrong: there is ONE ResizeObserver for every mini-roll
// on the page, and a canvas is redrawn only when its box or its notes change (docs/timeline.md).

import { memo, useEffect, useMemo, useRef } from "react";
import type { WebNote } from "../types";

/** The notes a block draws, re-timed to clip-space: a looping clip tiles its window as the engine repeats it. */
export function placedNotes(
  notes: readonly WebNote[],
  spanBeats: number,
  loopStart: number,
  loopEnd: number,
): readonly WebNote[] {
  const loopLen = loopEnd > loopStart ? loopEnd - loopStart : 0;
  if (loopLen <= 0) return notes;
  const win = notes.filter((n) => n.time >= loopStart && n.time < loopEnd);
  const out: WebNote[] = [];
  for (let k = 0; k * loopLen < spanBeats; k++)
    for (const n of win)
      out.push({ ...n, time: n.time - loopStart + k * loopLen });
  return out;
}

const draws = new Map<Element, () => void>();
let observer: ResizeObserver | null = null;
/** Redraw `el` whenever its box changes, through the page's one observer. */
function watch(el: Element, draw: () => void): () => void {
  observer ??= new ResizeObserver((entries) => {
    for (const e of entries) draws.get(e.target)?.();
  });
  draws.set(el, draw);
  observer.observe(el);
  return () => {
    draws.delete(el);
    observer?.unobserve(el);
  };
}

/** The notes, y scaled to the clip's own range, in the colour of `tone`. */
export const ClipMiniRoll = memo(function ClipMiniRoll({
  notes,
  spanBeats,
  loopStart = 0,
  loopEnd = 0,
  tone = "text-foreground",
}: {
  notes: WebNote[];
  spanBeats: number;
  loopStart?: number;
  loopEnd?: number;
  /** The notes' colour class: over a waveform they need one that is not the waveform's. */
  tone?: string;
}) {
  const placed = useMemo(
    () =>
      notes.length && spanBeats > 0
        ? placedNotes(notes, spanBeats, loopStart, loopEnd)
        : [],
    [notes, spanBeats, loopStart, loopEnd],
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !placed.length) return;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const n of placed) {
      if (n.key < lo) lo = n.key;
      if (n.key > hi) hi = n.key;
    }
    const rows = hi - lo + 1;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(el.clientWidth * dpr);
      const h = Math.round(el.clientHeight * dpr);
      if (w <= 0 || h <= 0) return;
      if (el.width !== w) el.width = w;
      if (el.height !== h) el.height = h;
      // A software canvas, as the waveform's: see docs/timeline.md, "The page keeps few composited layers".
      const ctx = el.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = getComputedStyle(el).color;
      ctx.globalAlpha = 0.8;
      const noteH = Math.max(0.09, 1 / rows) * h;
      for (const n of placed) {
        const x = Math.min(1, n.time / spanBeats) * w;
        const nw = Math.max(0.008, Math.min(1, n.duration / spanBeats)) * w;
        ctx.fillRect(x, ((hi - n.key) / rows) * h, nw, noteH);
      }
    };
    return watch(el, draw);
  }, [placed, spanBeats]);
  if (!placed.length) return null;
  return (
    <canvas ref={canvas} className={`absolute inset-0 h-full w-full ${tone}`} />
  );
});
