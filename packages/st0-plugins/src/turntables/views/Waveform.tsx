// Waveform.tsx — a deck's waveform, PLAYHEAD-CENTRIC: the song slides under a fixed line in
// the middle, with the beats in yellow and the transients in grey. Canvas, driven by its own
// animation frame off the deck's STEERED reader — never by React state. See ../../docs/waveform.md.

import { interpolated, spectrumColumns } from "@studio/ui-waveform/spectrum";
import { useCallback, useEffect, useRef } from "react";
import type { DeckTempo } from "../deckVocabulary";
import { shuttleRate } from "../shuttle";
import {
  barsIn,
  beatsIn,
  bucketAt,
  type Envelope,
  mmss,
  transientsIn,
  window as viewWindow,
  WINDOW_SECONDS,
  xOf,
} from "../waveform";

/** Yellow for the inferred grid, grey for the measured transients — the louder colour is what you mix on. */
const BEAT = "#facc15";
/** The downbeat, a different HUE rather than a brighter yellow: at a glance you are counting bars. */
const BAR = "#f97316";
const TRANSIENT = "rgba(148,163,184,0.55)";
const PLAYHEAD = "#f8fafc";

/** How long the landed position is held after a release, while the engine catches up. */
const HOLD_MS = 700;
/** …and how close the needle has to get for the hold to be let go of early. */
const HOLD_EPS = 0.08;

/** Drag the band to SHUTTLE the record: the distance held is a SPEED, not a step.
 *
 * Left runs forward, right rewinds, and the further out the faster (`shuttleRate`). Nothing is
 * seeked while the hand is down — the offset is integrated here and drawn, and ONE seek goes out
 * on release. See ../../docs/waveform.md. */
function shuttle(
  e: React.PointerEvent<HTMLDivElement>,
  onShove: (seconds: number) => void,
  /** Draw at the live needle plus this many seconds; `null` hands the drawing back. */
  preview: (seconds: number | null) => void,
  /** …and hold it at an ABSOLUTE offset after the release, until the needle arrives. */
  hold: (seconds: number) => void,
): void {
  const width = e.currentTarget.clientWidth;
  if (!(width > 0)) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  const originX = e.clientX;
  let dx = 0;
  let offset = 0;
  let last = performance.now();
  let frame = requestAnimationFrame(function tick(now: number) {
    frame = requestAnimationFrame(tick);
    // Integrated on the VIEW's frames rather than on the pointer's: a hand held still keeps running.
    offset += shuttleRate(dx, width) * ((now - last) / 1000);
    last = now;
    preview(offset);
  });
  const move = (ev: PointerEvent) => {
    dx = ev.clientX - originX;
  };
  const up = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    preview(null);
    if (offset === 0) return;
    // The one seek of the whole gesture — and the position is HELD until it lands, or the band
    // would snap back to where the record still is for the length of a round trip.
    hold(offset);
    onShove(offset);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export function Waveform({
  envelope,
  needle,
  loop,
  /** This deck's stretch, for the beat grid — the POSITION now comes from `needle`, docs/turntable.md. */
  tempo,
  /** Said out loud while the engine computes a sidecar — an empty box would read as "no waveform". */
  analysing,
  /** Why there is none, when there will not be one — the strip cannot draw "failed" against "none". */
  problem,
  height,
  onShove,
}: {
  envelope: Envelope | null;
  /** This deck's needle in its RECORD — one reader for both ways of playing, see ../useDeckSet.ts. */
  needle: () => number;
  /** The running loop in SOURCE seconds, or null — drawn as a band, see ../../docs/loop.md. */
  loop?: { start: number; end: number } | null;
  tempo: DeckTempo | undefined;
  analysing: boolean;
  problem: string | null;
  /** How tall to draw, from `deskLayout` — `draw` reads `clientHeight` every frame, so nothing else follows it. */
  height: number;
  /** Push the record by `seconds`, signed — absent, the band is not draggable. See ../../docs/waveform.md. */
  onShove?: (seconds: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** What the hand has run up while it is down — REFS, like the needle, so a shuttle at 60 fps
   *  re-renders nothing: the canvas reads them in its own loop (../../docs/waveform.md). */
  const drag = useRef<number | null>(null);
  const hold = useRef<{ at: number; until: number } | null>(null);
  const preview = useCallback((seconds: number | null) => {
    drag.current = seconds;
  }, []);
  const land = useCallback(
    (seconds: number) => {
      hold.current = {
        at: needle() + seconds,
        until: performance.now() + HOLD_MS,
      };
    },
    [needle],
  );

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      // Sized in CSS pixels, drawn in device pixels — done per frame, so a resize needs no observer.
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

      // Where we are NOW: a stopped deck's needle simply does not move, whichever clock it is on.
      // …unless a hand is on the band. A DRAG draws the live needle plus what the shuttle has run
      // up, and a RELEASE holds the position it landed on until the engine's needle arrives there
      // — neither is a seek, and the ref is what keeps both off React. See ../../docs/waveform.md.
      const held = hold.current;
      const live = needle();
      let at = live + (drag.current ?? 0);
      if (held !== null) {
        if (
          Math.abs(live - held.at) < HOLD_EPS ||
          performance.now() > held.until
        )
          hold.current = null;
        else at = held.at;
      }

      const mid = Math.round(h / 2) + 0.5;
      if (!envelope) {
        ctx.fillStyle = "rgba(148,163,184,0.35)";
        ctx.fillRect(0, mid - 0.5, w, 1);
        return;
      }

      const [from, to] = viewWindow(at);
      const xPx = (s: number) => xOf(s, at) * w;

      // --- the SPECTRUM look, painted by the same function as every st0 waveform (@studio/ui-waveform) ---
      const perSecond =
        envelope.seconds > 0 ? envelope.peak.length / envelope.seconds : 0;
      const amps = { ...envelope, amps: envelope.peak };
      spectrumColumns(ctx, w, h, (px) => {
        const seconds = from + ((px + 0.5) / w) * WINDOW_SECONDS;
        // Before the start or past the end: drawn as nothing.
        if (bucketAt(envelope, seconds) === null) return null;
        return interpolated(amps, seconds * perSecond - 0.5);
      });

      // --- the loop, UNDER the grid: it is a region and the beats have to stay readable on it ---
      if (loop) {
        ctx.fillStyle = "rgba(245,158,11,0.18)";
        const a = xPx(loop.start);
        ctx.fillRect(a, 0, xPx(loop.end) - a, h);
        ctx.fillStyle = "rgba(245,158,11,0.9)";
        for (const edge of [loop.start, loop.end])
          ctx.fillRect(Math.round(xPx(edge)), 0, 1, h);
      }

      // --- the transients, behind the beats -------------------------------------------
      ctx.fillStyle = TRANSIENT;
      for (const t of transientsIn(envelope, from, to))
        ctx.fillRect(Math.round(xPx(t)), 0, 1, h);

      // --- the beats, on top, because the grid is what you line up ---------------------
      ctx.fillStyle = BEAT;
      for (const b of beatsIn(envelope, from, to))
        ctx.fillRect(Math.round(xPx(b)), 0, 1, h);

      // --- and the BARS over those, wider and drawn AFTER, so a downbeat is orange and not flanked ---
      ctx.fillStyle = BAR;
      for (const b of barsIn(envelope, from, to))
        ctx.fillRect(Math.round(xPx(b)) - 1, 0, 2, h);

      // --- the playhead, dead centre and never anywhere else --------------------------
      ctx.fillStyle = PLAYHEAD;
      ctx.fillRect(Math.round(w / 2), 0, 1, h);

      // --- elapsed and remaining: they also make MOVEMENT visible, which a quiet intro hides ---
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillStyle = "rgba(148,163,184,0.9)";
      ctx.textBaseline = "bottom";
      ctx.fillText(mmss(Math.max(0, at)), 4, h - 3);
      const left = mmss(Math.min(0, at - envelope.seconds));
      ctx.fillText(left, w - ctx.measureText(left).width - 4, h - 3);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
    // The loop restarts only when the envelope, the reader or the deck's stretch changes.
  }, [envelope, needle, tempo, loop]);

  return (
    <div
      className={`relative w-full shrink-0 overflow-hidden rounded-md bg-muted/40 ${
        onShove ? "cursor-ew-resize touch-none" : ""
      }`}
      style={{ height: `${height}px` }}
      onPointerDown={
        onShove ? (e) => shuttle(e, onShove, preview, land) : undefined
      }
      title={
        onShove
          ? "drag left to go forward, right to go back — further is faster"
          : undefined
      }
    >
      <canvas ref={canvas} className="h-full w-full" />
      {analysing ? (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          analysing the song…
        </span>
      ) : null}
      {problem ? (
        // The reason, truncated to one line with the whole of it in the tooltip.
        <span
          className="absolute inset-x-2 top-1/2 -translate-y-1/2 truncate text-center text-[11px] text-destructive"
          title={problem}
        >
          pas de forme d'onde : {problem}
        </span>
      ) : null}
      {envelope && !envelope.bpm ? (
        // No tempo means no grid, said out loud: missing yellow lines would otherwise read as a bug.
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
