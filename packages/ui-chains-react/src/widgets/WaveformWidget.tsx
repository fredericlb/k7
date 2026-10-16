// WaveformWidget.tsx — a live min/max envelope on a canvas, or a recorder's take growing as it
// rolls. Painted off refs fed by a raw store subscription, never by React state, so a 30 Hz
// frame re-renders nothing — docs/waveformWidget.md.

import type { WaveformEnvelope } from "@studio/engine-browser";
import { useEngineStoreOrNull } from "@studio/engine-browser/store";
import type { WebWidget } from "@studio/graph-model";
import { WOBBLE_FPS } from "@studio/ui-chains/cableCanvas";
import { GrowingDecimate } from "@studio/ui-chains/decimate";
import type { GraphNode } from "@studio/ui-chains/graph";
import { useEffect, useRef } from "react";
import { NOOP, useTakeReadout } from "../chainsStores";

// Module-level so "no envelope" is one identity: a fresh [] per read would look like a change every frame.
const NO_ENVELOPE: WaveformEnvelope[] = [];
// A waveform widget: a real-time min/max envelope on a <canvas>, off the frame's waveform map for this module.
export function WaveformWidget({
  n,
  w,
  style,
  onWatch,
}: {
  n: GraphNode;
  w: WebWidget;
  style: React.CSSProperties;
  /** Ask the engine to tap this module (or stop). Without it nothing is ever captured. */
  onWatch?: (pluginId: string, side: "input" | "output", on: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // A recorder node draws its TAKE, not a live tap: the whole of it, growing, off the state
  // frame's `recorders` rather than `waveform` — see engine/k7-runtime/docs/recorder.md.
  const isTake = w.source === "take";
  // Where to listen: this node's own plugin, or the tap it names — docs/waveformWidget.md.
  const tap = n.tap ?? (n.pluginId ? { id: n.pluginId, side: w.source } : null);
  // The waveform key is pluginId:side (e.g. "chain:module:output").
  const key = isTake
    ? null
    : tap?.id && tap.side
      ? `${tap.id}:${tap.side}`
      : null;
  const takeKey = isTake ? (n.pluginId ?? null) : null;

  // The envelope reaches the canvas through a REF off a RAW subscription — docs/waveformWidget.md.
  const store = useEngineStoreOrNull();
  // …and what a RECORDER's card says: a message when it holds nothing, else the take's clock.
  const readout = useTakeReadout(store, takeKey);
  // The message REPLACES the waveform rather than sitting over it, so the paint is told to stop.
  const blankRef = useRef(false);
  blankRef.current = readout.message !== undefined;
  const envelopeRef = useRef<WaveformEnvelope[]>(NO_ENVELOPE);
  const dirtyRef = useRef(true);
  // Set by the draw effect; the subscription below pokes it to restart a stopped loop.
  const wakeRef = useRef<() => void>(NOOP);

  useEffect(() => {
    if (!store || !key) return;
    // Read on subscribe too, so a widget repointed between two frames drops the previous picture.
    const read = (): void => {
      const env = store.getSnapshot().waveform[key] ?? NO_ENVELOPE;
      if (env === envelopeRef.current) return;
      // A module with no tap sends nothing, and empty-after-empty is not a repaint.
      if (env.length === 0 && envelopeRef.current.length === 0) return;
      envelopeRef.current = env;
      dirtyRef.current = true;
      wakeRef.current();
    };
    read();
    return store.subscribe(read);
  }, [store, key]);

  // …and the take's, which the STORE accumulates rather than this card: the whole picture arrives
  // in ONE frame when the socket connects, a second before this exists (engine-browser's
  // takeEnvelope.ts). Folding it here would miss that frame every time.
  const takeRef = useRef<unknown>(null);
  useEffect(() => {
    if (!store || !takeKey) return;
    const read = (): void => {
      const view = store.takeOf(takeKey);
      // The store hands back the SAME view while nothing moves, which is most frames; an append is a new view over the same, grown array.
      if (view === takeRef.current) return;
      takeRef.current = view;
      envelopeRef.current = view?.points ?? NO_ENVELOPE;
      dirtyRef.current = true;
      wakeRef.current();
    };
    read();
    return store.subscribe(read);
  }, [store, takeKey]);

  // The tap costs the ENGINE a plugin, so it is placed and removed with this widget —
  // docs/waveformWidget.md. A take needs none: the recorder is already in the chain.
  const id = isTake ? undefined : tap?.id;
  const side = tap?.side === "input" ? "input" : "output";
  useEffect(() => {
    if (!id || !onWatch) return;
    onWatch(id, side, true);
    return () => onWatch(id, side, false);
  }, [id, side, onWatch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The box comes from a ResizeObserver: measuring inside the draw flushes style every frame.
    let W = 0;
    let H = 0;
    let appliedDpr = 0;
    let raf = 0;
    let last = 0;
    const minDt = 1000 / WOBBLE_FPS;
    // A rolling take paints up to 30 times a second: only the points appended since the last paint are folded.
    const folded = new GrowingDecimate();

    const paint = (): void => {
      const dpr = window.devicePixelRatio || 1;
      if (
        appliedDpr !== dpr ||
        canvas.width !== W * dpr ||
        canvas.height !== H * dpr
      ) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        // setTransform, not scale: resizing resets the matrix, so scale() would compound.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        appliedDpr = dpr;
      }
      ctx.clearRect(0, 0, W, H);
      // Nothing to show and the card SAYS so — an empty waveform beside those words would read
      // as a broken meter rather than as an idle machine (takeClock.ts).
      if (blankRef.current) return;
      // A take is thousands of points against a card's ~120: decimated keeping the EXTREMES,
      // since averaging them away draws a quiet take (decimate.ts).
      const env = isTake
        ? folded.of(envelopeRef.current, Math.max(1, Math.round(W)))
        : envelopeRef.current;
      const mid = H / 2;
      if (env.length === 0) {
        // No data — draw a flat center line.
        ctx.strokeStyle = "rgba(200,160,106,0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(W, mid);
        ctx.stroke();
        return;
      }
      // Fill envelope: min..max → top..bottom (Y axis: 0 = top, H = bottom).
      ctx.fillStyle = "rgba(200,160,106,0.15)";
      ctx.beginPath();
      const step = W / Math.max(1, env.length - 1);
      // Top edge (max → upward from mid)
      for (let i = 0; i < env.length; i++) {
        const x = i * step;
        const y = mid - env[i].max * mid;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Bottom edge (min → downward from mid, reversed)
      for (let i = env.length - 1; i >= 0; i--) {
        const x = i * step;
        const y = mid - env[i].min * mid;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      // Center line (zero crossing)
      ctx.strokeStyle = "rgba(200,160,106,0.35)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(W, mid);
      ctx.stroke();
    };

    // Started by an envelope, stopped by stillness: a silent module schedules no frames at all.
    const tick = (now: number): void => {
      raf = 0;
      if (!dirtyRef.current || W <= 0 || H <= 0) return;
      if (now - last < minDt) {
        raf = requestAnimationFrame(tick);
        return;
      }
      last = now;
      dirtyRef.current = false;
      paint();
    };
    const wake = (): void => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      W = box.width;
      H = box.height;
      dirtyRef.current = true;
      wake();
    });
    ro.observe(canvas);
    wake(); // the observer's first callback is async; a mounted widget still owes one paint

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      wakeRef.current = NOOP;
    };
    // `isTake` is read in the draw and is a property of the WIDGET, which does not change under
    // a mounted canvas — the empty list is the loop's own, as docs/waveformWidget.md describes.
  }, [isTake]);

  // The canvas is painted off refs, so the message appearing has to ask for a frame itself.
  const blank = readout.message !== undefined;
  useEffect(() => {
    dirtyRef.current = true;
    wakeRef.current();
  }, [blank]);

  return (
    <div className="dgx-w dgx-wave" style={style}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {readout.message !== undefined && (
        <span className="dgx-wave-msg">{readout.message}</span>
      )}
      {readout.elapsed !== undefined && (
        <span className="dgx-wave-clock">{readout.elapsed}</span>
      )}
    </div>
  );
}
