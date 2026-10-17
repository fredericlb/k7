// Waveform.tsx — a deck's waveform, PLAYHEAD-CENTRIC: the song slides under a fixed line in
// the middle, with the beats in yellow and the transients in grey. Canvas, driven by its own
// animation frame off the deck's STEERED reader — never by React state. See ../../docs/waveform.md.

import { usePointerFollow } from "@studio/ui-timeline/drag";
import { interpolated } from "@studio/ui-waveform/spectrum";
import { SpectrumStrip } from "@studio/ui-waveform/spectrum-strip";
import { useCallback, useEffect, useRef } from "react";
import { m } from "../../paraglide/messages.js";
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
let playhead = "";
/** The host's playhead colour from k7's tokens (index.css), read at the first draw rather than at import, when the sheet may not be in yet; a canvas cannot take `var()`. */
function playheadColour(): string {
  if (!playhead && typeof document !== "undefined")
    playhead = getComputedStyle(document.documentElement)
      .getPropertyValue("--color-playhead")
      .trim();
  return playhead || "#f4f3f8";
}

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
  follow: ReturnType<typeof usePointerFollow>,
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
    preview(null);
    if (offset === 0) return;
    // The one seek of the whole gesture — and the position is HELD until it lands, or the band
    // would snap back to where the record still is for the length of a round trip.
    hold(offset);
    onShove(offset);
  };
  // A cancel, or the view going away, stops the run and seeks nothing: the loop would otherwise run for good.
  follow(e, {
    move,
    end: up,
    cancel: () => {
      cancelAnimationFrame(frame);
      preview(null);
    },
  });
}

export function Waveform({
  envelope,
  needle,
  loop,
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
  /** This deck's stretch — unread by the drawing, whose grid comes from the envelope and position from `needle`. */
  tempo: DeckTempo | undefined;
  analysing: boolean;
  problem: string | null;
  /** How tall to draw, from `deskLayout` — the canvas's own observer picks the size up, so nothing else follows it. */
  height: number;
  /** Push the record by `seconds`, signed — absent, the band is not draggable. See ../../docs/waveform.md. */
  onShove?: (seconds: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  /** The track rasterised once per envelope and size — outside the effect, which a new loop restarts. */
  const strip = useRef<{
    key: string;
    env: Envelope;
    strip: SpectrumStrip;
  } | null>(null);
  const follow = usePointerFollow();
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
    // What the canvas shows now, as size and position: equal next frame, there is nothing to paint.
    let drawn = "";
    // Sized by an observer, never read in the frame: `clientWidth` there forces a layout per deck per frame.
    let w = el.clientWidth;
    let h = el.clientHeight;
    const sized = new ResizeObserver(([e]) => {
      w = Math.round(e.contentRect.width);
      h = Math.round(e.contentRect.height);
    });
    sized.observe(el);

    const draw = () => {
      frame = requestAnimationFrame(draw);
      // Sized in CSS pixels, drawn in device pixels.
      const ratio = globalThis.devicePixelRatio || 1;
      if (!w || !h) return;
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
      // A stopped deck draws the same picture every frame: drawn once, then left until something moves.
      const shown = `${w}|${h}|${ratio}|${at}`;
      if (shown === drawn) return;
      drawn = shown;
      if (
        el.width !== Math.round(w * ratio) ||
        el.height !== Math.round(h * ratio)
      ) {
        el.width = Math.round(w * ratio);
        el.height = Math.round(h * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const mid = Math.round(h / 2) + 0.5;
      if (!envelope) {
        ctx.fillStyle = "rgba(148,163,184,0.35)";
        ctx.fillRect(0, mid - 0.5, w, 1);
        return;
      }

      const [from, to] = viewWindow(at);
      const xPx = (s: number) => xOf(s, at) * w;

      // --- the SPECTRUM look, rasterised once into tiles and slid under the head (@studio/ui-waveform) ---
      const perPx = w / WINDOW_SECONDS;
      const key = `${w}|${h}|${ratio}`;
      if (strip.current?.key !== key || strip.current.env !== envelope) {
        const perSecond =
          envelope.seconds > 0 ? envelope.peak.length / envelope.seconds : 0;
        const amps = { ...envelope, amps: envelope.peak };
        const column = (g: number) => {
          const seconds = (g + 0.5) / perPx;
          // Before the start or past the end: drawn as nothing.
          if (bucketAt(envelope, seconds) === null) return null;
          return interpolated(amps, seconds * perSecond - 0.5);
        };
        const painter = new SpectrumStrip(column, h, ratio);
        strip.current = { key, env: envelope, strip: painter };
      }
      strip.current.strip.draw(ctx, from * perPx, w);

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
      ctx.fillStyle = playheadColour();
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
    return () => {
      cancelAnimationFrame(frame);
      sized.disconnect();
    };
    // The loop restarts only when the envelope, the reader or the loop changes — each kept stable by the caller.
  }, [envelope, needle, loop]);

  return (
    <div
      className={`relative w-full shrink-0 overflow-hidden rounded-md bg-muted/40 ${
        onShove ? "cursor-ew-resize touch-none" : ""
      }`}
      style={{ height: `${height}px` }}
      onPointerDown={
        onShove ? (e) => shuttle(follow, e, onShove, preview, land) : undefined
      }
      title={onShove ? m["wave.shuttle"]() : undefined}
    >
      <canvas ref={canvas} className="h-full w-full" />
      {analysing ? (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {m["wave.analysing"]()}
        </span>
      ) : null}
      {problem ? (
        // The reason, truncated to one line with the whole of it in the tooltip.
        <span
          className="absolute inset-x-2 top-1/2 -translate-y-1/2 truncate text-center text-[11px] text-destructive"
          title={problem}
        >
          {m["wave.none"]({ problem })}
        </span>
      ) : null}
      {envelope && !envelope.bpm ? (
        // No tempo means no grid, said out loud: missing yellow lines would otherwise read as a bug.
        <span className="absolute right-2 top-1 text-[10px] text-muted-foreground">
          {m["wave.noTempo"]()}
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
