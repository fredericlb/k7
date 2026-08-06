// Waveform.tsx — a deck's waveform, PLAYHEAD-CENTRIC: the song slides under a fixed line in
// the middle, with the beats in yellow and the transients in grey. Canvas, driven by its own
// animation frame off the playhead ref — never by React state. See ../../docs/waveform.md.

import { useEffect, useRef } from "react";
import type { Playhead } from "../useEngine";
import {
  beatsIn,
  bucketAt,
  type Envelope,
  transientsIn,
  window as viewWindow,
  WINDOW_SECONDS,
  xOf,
} from "../waveform";

/** Yellow for the grid, grey for what the engine actually heard. The beats are inferred and
 *  the transients are measured, so the louder colour goes to the thing you mix on. */
const BEAT = "#facc15";
const TRANSIENT = "rgba(148,163,184,0.55)";
const PLAYHEAD = "#f8fafc";

export function Waveform({
  envelope,
  playhead,
  playing,
  /** Said out loud while the engine is computing a sidecar — several seconds for a long
   *  track, and an empty box would read as "this song has no waveform". */
  analysing,
}: {
  envelope: Envelope | null;
  playhead: React.RefObject<Playhead>;
  playing: boolean;
  analysing: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      // The canvas is sized in CSS pixels and drawn in device pixels; doing it here rather
      // than on mount is what makes it survive a resize and a monitor change without a
      // ResizeObserver of its own.
      const ratio = globalThis.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      if (
        el.width !== Math.round(w * ratio) ||
        el.height !== Math.round(h * ratio)
      ) {
        el.width = Math.round(w * ratio);
        el.height = Math.round(h * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Where we are NOW: the last push plus however long ago it was, but only while
      // running. Stopped, an extrapolation would slide a waveform nobody is playing.
      const p = playhead.current;
      const at = playing
        ? p.seconds + Math.max(0, (performance.now() - p.at) / 1000)
        : p.seconds;

      const mid = Math.round(h / 2) + 0.5;
      if (!envelope) {
        ctx.fillStyle = "rgba(148,163,184,0.35)";
        ctx.fillRect(0, mid - 0.5, w, 1);
        return;
      }

      const [from, to] = viewWindow(at);
      const xPx = (s: number) => xOf(s, at) * w;

      // --- the envelope, one column per pixel -----------------------------------------
      ctx.fillStyle = "rgba(148,163,184,0.85)";
      for (let px = 0; px < w; px++) {
        const seconds = from + (px / w) * WINDOW_SECONDS;
        const i = bucketAt(envelope, seconds);
        if (i === null) continue; // before the start or past the end: drawn as nothing
        const amp = envelope.peak[i] ?? 0;
        const half = Math.max(0.5, amp * (h / 2 - 1));
        ctx.fillRect(px, mid - half, 1, half * 2);
      }

      // --- the transients, behind the beats -------------------------------------------
      ctx.fillStyle = TRANSIENT;
      for (const t of transientsIn(envelope, from, to))
        ctx.fillRect(Math.round(xPx(t)), 0, 1, h);

      // --- the beats, on top, because the grid is what you line up ---------------------
      ctx.fillStyle = BEAT;
      for (const b of beatsIn(envelope, from, to))
        ctx.fillRect(Math.round(xPx(b)), 0, 1, h);

      // --- the playhead, dead centre and never anywhere else --------------------------
      ctx.fillStyle = PLAYHEAD;
      ctx.fillRect(Math.round(w / 2), 0, 1, h);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // `playhead` is a ref and `envelope`/`playing` are read fresh on each frame through the
    // closure this effect rebuilds — so the loop restarts only when one of them changes.
  }, [envelope, playhead, playing]);

  return (
    <div className="relative h-20 w-full overflow-hidden rounded-md bg-muted/40">
      <canvas ref={canvas} className="h-full w-full" />
      {analysing ? (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          analyse du morceau…
        </span>
      ) : null}
      {envelope && !envelope.bpm ? (
        // No tempo means no grid, and that is worth saying: yellow lines missing could
        // otherwise read as a bug rather than as "the engine found no tempo".
        <span className="absolute right-2 top-1 text-[10px] text-muted-foreground">
          tempo inconnu
        </span>
      ) : null}
      {envelope?.bpm ? (
        <span className="absolute right-2 top-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {envelope.bpm.toFixed(1)} BPM
        </span>
      ) : null}
    </div>
  );
}
