// Waveform.tsx — a deck's waveform, PLAYHEAD-CENTRIC: the song slides under a fixed line in
// the middle, with the beats in yellow and the transients in grey. Canvas, driven by its own
// animation frame off the deck's STEERED reader — never by React state. See ../../docs/waveform.md.

import { useEffect, useRef } from "react";
import type { DeckTempo } from "../deck";
import { bandsAt, columnColour } from "../spectrumColour";
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

/** What a column with no band analysis is drawn in — the envelope as it always was. */
const PLAIN = "rgb(148,163,184)";
/** Yellow for the inferred grid, grey for the measured transients — the louder colour is what you mix on. */
const BEAT = "#facc15";
/** The downbeat, a different HUE rather than a brighter yellow: at a glance you are counting bars. */
const BAR = "#f97316";
const TRANSIENT = "rgba(148,163,184,0.55)";
const PLAYHEAD = "#f8fafc";

/** How often a DRAG may move the record — a cadence the clip era set, see ../../docs/waveform.md. */
const SCRUB_MS = 120;

/** Drag the band to push the record: the audio slides under a fixed playhead, so LEFT is forward. */
function scrub(
  e: React.PointerEvent<HTMLDivElement>,
  onShove: (seconds: number) => void,
): void {
  const width = e.currentTarget.clientWidth;
  if (!(width > 0)) return;
  e.currentTarget.setPointerCapture(e.pointerId);
  // The anchor is the last x SENT FROM, never the previous frame: the throttle must not drop travel.
  let from = e.clientX;
  let last = 0;
  const secondsSince = (x: number) => ((from - x) / width) * WINDOW_SECONDS;
  const move = (ev: PointerEvent) => {
    const now = Date.now();
    if (now - last < SCRUB_MS) return;
    last = now;
    onShove(secondsSince(ev.clientX));
    from = ev.clientX;
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    // Whatever the throttle did not send: the position let go of has to be the one that plays.
    const rest = secondsSince(ev.clientX);
    if (rest !== 0) onShove(rest);
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
      const at = needle();

      const mid = Math.round(h / 2) + 0.5;
      if (!envelope) {
        ctx.fillStyle = "rgba(148,163,184,0.35)";
        ctx.fillRect(0, mid - 0.5, w, 1);
        return;
      }

      const [from, to] = viewWindow(at);
      const xPx = (s: number) => xOf(s, at) * w;

      // --- one column per pixel, COLOURED BY WHAT IS IN IT; no bands is plain grey (spectrumColour.ts) ---
      for (let px = 0; px < w; px++) {
        const seconds = from + (px / w) * WINDOW_SECONDS;
        const i = bucketAt(envelope, seconds);
        if (i === null) continue; // before the start or past the end: drawn as nothing
        const bands = bandsAt(envelope, i);
        ctx.fillStyle = bands ? columnColour(bands, PLAIN) : PLAIN;
        const amp = envelope.peak[i] ?? 0;
        const half = Math.max(0.5, amp * (h / 2 - 1));
        ctx.fillRect(px, mid - half, 1, half * 2);
      }

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
      onPointerDown={onShove ? (e) => scrub(e, onShove) : undefined}
      title={onShove ? "glisser pour pousser le disque" : undefined}
    >
      <canvas ref={canvas} className="h-full w-full" />
      {analysing ? (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          analyse du morceau…
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
