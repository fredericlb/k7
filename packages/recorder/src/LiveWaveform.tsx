import { useEffect, useRef, useState } from "react";
import type { DetectedEvent, Envelope, Metronome } from "./types";

/** A clock and a feed read every frame, so a running take scrolls without re-rendering its host. */
export interface LiveFeed {
  /** The time "now" is drawn at, in seconds on the envelope's timeline. */
  now(): number;
  /** Brings `envelope.samples` up to date before a frame is drawn. */
  pull?(): void;
}

interface Props {
  envelope: Envelope;
  /** "Now", when the host re-renders with it; `live` replaces it at frame rate. */
  elapsed?: number;
  live?: LiveFeed;
  threshold: number;
  events: DetectedEvent[];
  metronome?: Metronome | null;
  paused?: boolean;
  /** Playback position (sec) while listening back to a highlight, read every frame and drawn as a playhead. */
  playhead?: (() => number) | null;
  /** Time range (sec) framed while reviewing; cleared, the trailing window comes back. */
  focus?: { start: number; end: number } | null;
  /** Canvas height in px — smaller for the minimized recording bar. */
  height?: number;
}

const HEIGHT = 160;
const WINDOW_SEC = 12; // seconds of history visible at once
const EDGE_MARGIN = 4; // px kept clear at top/bottom so peaks don't touch the edge
const BEATS_PER_BAR = 4;
const BEAT_TICK_HEIGHT = 24; // light beat ticks are short; bar lines run full height

/** An oscilloscope scrolling right to left, "now" pinned to the edge, WINDOW_SEC of history. */
export function LiveWaveform({
  envelope,
  elapsed = 0,
  live,
  threshold,
  events,
  metronome = null,
  paused = false,
  playhead = null,
  focus = null,
  height = HEIGHT,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  // Latest "now"/focus/playhead, read fresh by the animation loops.
  const nowRef = useRef(() => elapsed);
  nowRef.current = live ? () => live.now() : () => elapsed;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const playheadClock = useRef(playhead);
  playheadClock.current = playhead;

  // The range mapped across the canvas, eased toward the target so review zooms, not jumps.
  const viewRef = useRef({ start: elapsed - WINDOW_SEC, end: elapsed });
  const animating = useRef(false);
  const animRaf = useRef<number | null>(null);

  // The trailing window while recording, or the padded moment — never tighter — while reviewing.
  const computeTarget = () => {
    const f = focusRef.current;
    if (f) {
      const dur = Math.max(0, f.end - f.start);
      const pad = Math.max(0.5, dur * 0.12);
      let start = f.start - pad;
      let end = f.end + pad;
      if (end - start < WINDOW_SEC) {
        const mid = (start + end) / 2;
        start = mid - WINDOW_SEC / 2;
        end = mid + WINDOW_SEC / 2;
      }
      return { start, end };
    }
    const e = nowRef.current();
    return { start: e - WINDOW_SEC, end: e };
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.max(200, Math.floor(entries[0].contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The playhead is a DOM overlay, not canvas: a 60fps redraw stuttered the audio.
  const placeRef = useRef(() => {});
  placeRef.current = () => {
    const div = playheadRef.current;
    if (!div) return;
    const at = playheadClock.current?.();
    if (at == null) {
      div.style.display = "none";
      return;
    }
    const v = viewRef.current;
    const x = ((at - v.start) / Math.max(0.1, v.end - v.start)) * width;
    div.style.display = "";
    div.style.left = `${Math.max(0, Math.min(width, x))}px`;
  };

  // Every draw reads the props of the latest render, so the loops below never draw stale ones.
  const drawRef = useRef(() => {});
  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Resized only when the size moved: assigning even the same width reallocates the canvas, and this runs every frame.
    if (canvas.width !== width * dpr) canvas.width = width * dpr;
    if (canvas.height !== height * dpr) canvas.height = height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#1b1c22";
    ctx.fillRect(0, 0, width, height);

    const centerY = height / 2;
    const halfHeight = height / 2 - EDGE_MARGIN;
    // Snap to the trailing window, unless the zoom animation owns viewRef right now.
    if (!animating.current && !focus) viewRef.current = computeTarget();
    const view = viewRef.current;
    const windowSec = Math.max(0.1, view.end - view.start);
    const pxPerSec = width / windowSec;
    const timeToX = (t: number) => (t - view.start) * pxPerSec;
    const xToTime = (x: number) => view.start + x / pxPerSec;

    const n = envelope.samples.length;
    const dt = envelope.intervalMs / 1000;

    // Light smoothing to take the edge off single-sample spikes — computed per sample READ, so a frame costs the window's width, not the take's length.
    const R = 1;
    const smoothed = (i: number): number => {
      let sum = 0;
      let cnt = 0;
      for (let k = i - R; k <= i + R; k++) {
        if (k >= 0 && k < n) {
          sum += envelope.samples[k];
          cnt++;
        }
      }
      return cnt ? sum / cnt : 0;
    };

    const ampAt = (t: number): number => {
      if (n === 0 || t < 0) return 0;
      const c = t / dt;
      const i = Math.floor(c);
      const f = c - i;
      if (i >= n - 1) return smoothed(n - 1);
      const a = smoothed(Math.max(0, i));
      return a + (smoothed(i + 1) - a) * f;
    };

    // The beat grid, anchored where the metronome started; only visible beats are walked.
    if (metronome && metronome.bpm > 0) {
      const beatSec = 60 / metronome.bpm;
      let beat = Math.max(
        0,
        Math.floor((view.start - metronome.startSec) / beatSec),
      );
      for (
        let t = metronome.startSec + beat * beatSec;
        t <= view.end + 1e-6;
        t += beatSec, beat++
      ) {
        if (t < 0) continue;
        const x = Math.round(timeToX(t)) + 0.5;
        if (x < -1 || x > width + 1) continue;
        const isBar = beat % BEATS_PER_BAR === 0;
        ctx.strokeStyle = isBar
          ? "rgba(139, 92, 246, 0.45)"
          : "rgba(139, 92, 246, 0.22)";
        ctx.lineWidth = isBar ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, isBar ? height : BEAT_TICK_HEIGHT);
        ctx.stroke();
      }
    }

    // Detected-event bands, clipped to the visible window.
    ctx.fillStyle = "rgba(80, 200, 120, 0.2)";
    for (const ev of events) {
      const x0 = timeToX(ev.startSec);
      const x1 = timeToX(ev.endSec);
      if (x1 < 0 || x0 > width) continue;
      const cx0 = Math.max(0, x0);
      const cx1 = Math.min(width, x1);
      ctx.fillRect(cx0, 0, Math.max(1, cx1 - cx0), height);
    }

    // Center (zero) line.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(centerY) + 0.5);
    ctx.lineTo(width, Math.round(centerY) + 0.5);
    ctx.stroke();

    // Mirrored threshold lines (silence floor), above and below center.
    const threshY = Math.max(0, Math.min(1, threshold)) * halfHeight;
    ctx.strokeStyle = "rgba(255,90,90,0.6)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, centerY - threshY);
    ctx.lineTo(width, centerY - threshY);
    ctx.moveTo(0, centerY + threshY);
    ctx.lineTo(width, centerY + threshY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Oscilloscope trace: mirrored above/below center, scrolling with `elapsed`.
    const rgb = paused ? "165, 165, 178" : "139, 92, 246";
    const top = new Array<number>(width);
    const bottom = new Array<number>(width);
    for (let x = 0; x < width; x++) {
      const amp = Math.max(0, Math.min(1, ampAt(xToTime(x))));
      const h = amp * halfHeight;
      top[x] = centerY - h;
      bottom[x] = centerY + h;
    }

    ctx.beginPath();
    ctx.moveTo(0, top[0]);
    for (let x = 1; x < width; x++) ctx.lineTo(x, top[x]);
    for (let x = width - 1; x >= 0; x--) ctx.lineTo(x, bottom[x]);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `rgba(${rgb}, 0)`);
    grad.addColorStop(0.5, `rgba(${rgb}, 0.28)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
    ctx.beginPath();
    ctx.moveTo(0, top[0]);
    for (let x = 1; x < width; x++) ctx.lineTo(x, top[x]);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, bottom[0]);
    for (let x = 1; x < width; x++) ctx.lineTo(x, bottom[x]);
    ctx.stroke();

    // The "now" marker, at the right edge while recording and off-canvas once review zooms out.
    const nowX = timeToX(nowRef.current());
    if (nowX >= 0 && nowX <= width) {
      ctx.strokeStyle = "rgba(235,235,242,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const x = Math.min(width - 1, nowX);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    placeRef.current();
  };

  const scrolling = !!live && !paused;
  const hasPlayhead = playhead != null;

  // A prop that changed redraws once; the loop below takes over while something moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are what the draw reads.
  useEffect(() => {
    drawRef.current();
  }, [
    width,
    height,
    envelope,
    elapsed,
    threshold,
    events,
    metronome,
    paused,
    focus,
    hasPlayhead,
  ]);

  // A running take scrolls, and a preview moves its playhead, at frame rate without a render.
  useEffect(() => {
    if (!scrolling && !hasPlayhead) return;
    let raf = 0;
    const frame = () => {
      if (scrolling) {
        live?.pull?.();
        drawRef.current();
      } else placeRef.current();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [scrolling, hasPlayhead, live]);

  // Animate the view toward its target whenever review is entered or left.
  const focusKey = focus ? `${focus.start}:${focus.end}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the focus it was made from.
  useEffect(() => {
    animating.current = true;
    const step = () => {
      const tv = computeTarget();
      const v = viewRef.current;
      const k = 0.2; // easing factor per frame
      const start = v.start + (tv.start - v.start) * k;
      const end = v.end + (tv.end - v.end) * k;
      viewRef.current = { start, end };
      const done =
        Math.abs(start - tv.start) < 0.02 && Math.abs(end - tv.end) < 0.02;
      if (done) viewRef.current = tv;
      drawRef.current();
      if (done) {
        animating.current = false;
        return;
      }
      animRaf.current = requestAnimationFrame(step);
    };
    if (animRaf.current) cancelAnimationFrame(animRaf.current);
    animRaf.current = requestAnimationFrame(step);
    return () => {
      if (animRaf.current) cancelAnimationFrame(animRaf.current);
    };
  }, [focusKey]);

  return (
    <div ref={wrapRef} className="waveform-wrap">
      <canvas ref={canvasRef} style={{ width: "100%", height }} />
      <div
        ref={playheadRef}
        className="waveform-playhead"
        style={{ display: "none" }}
      />
    </div>
  );
}
