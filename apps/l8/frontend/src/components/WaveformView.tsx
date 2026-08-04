// WaveformView.tsx — the audio-clip editor: a bottom split pane (opened with `e`
// on an audio clip, mirroring the MIDI piano roll) showing the clip's waveform
// with bar/beat gridlines aligned to the arrangement and a live playhead. The
// waveform itself is the shared @studio/ui-waveform Waveform (fed a dB envelope
// from the clip's samples); the notes/grid come from the backend (/api/waveform).

import { useEngineState } from "@studio/engine-browser/store";
import { Waveform } from "@studio/ui-waveform";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import type { WebClip, WebProject, WebWaveform } from "../types";
import { useHZoom, usePanScroll } from "../usePanZoom";

export function WaveformView({
  project,
  clip,
  whole,
  sliceRanges,
  onSliceEdit,
  onClose,
}: {
  project: WebProject;
  clip: WebClip;
  // Span the whole SOURCE rather than the clip's placed region — how a clips/*.yaml shows its material, so the
  // pane fits the file end to end and `from`/`to` can be judged against all of it.
  whole?: boolean;
  // Slice-rack windows over the waveform (source seconds): one symbol's [from,to], so you see where each sound sits.
  sliceRanges?: { symbol: string; from: number; to: number }[];
  // With this, each window grows draggable edges that rewrite the symbol's from/to — only when its own file is open.
  onSliceEdit?: (symbol: string, from: number, to: number) => void;
  // Docked in the editor there is nothing to close (the strip lives and dies with the file), so the header drops it.
  onClose?: () => void;
}) {
  // The playhead comes from the store, so a frame re-renders the waveform rather than its whole editor pane.
  const playhead = useEngineState((s) => s.playhead);
  const [wf, setWf] = useState<WebWaveform | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wheel zooms past fit and middle-drag pans. No gutter here — the canvas fills the width — so the anchor uses 0.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoomX] = useHZoom(scrollRef, { gutter: 0 });
  usePanScroll(scrollRef);

  // The waveform fills the pane's height, so a short bottom strip never scrolls vertically.
  const [bodyH, setBodyH] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight));
    ro.observe(el);
    setBodyH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // --- slice-handle dragging -------------------------------------------------
  // The content layer the slices overlay; a handle's screen X maps to a source-second by its fraction across it.
  const contentRef = useRef<HTMLDivElement>(null);
  // The edge being dragged, with its LIVE [from,to] preview, so the window resizes before the edit lands.
  const [drag, setDrag] = useState<{
    symbol: string;
    edge: "from" | "to";
    from: number;
    to: number;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const roundSec = (s: number) => Math.round(s * 10000) / 10000; // 0.1 ms precision
  const MIN = 0.001; // keep from < to by at least a hair

  // Pointer x → source seconds. getBoundingClientRect already reflects the scroll, so it holds at any zoom.
  const secAt = (clientX: number): number | null => {
    const el = contentRef.current;
    if (!el || !wf || wf.seconds <= 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const frac = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(wf.seconds, frac * wf.seconds));
  };

  // POINTER CAPTURE on the handle: every move/up fires on it, so there is no listener race and the grab is instant.
  const onHandleDown = (
    r: { symbol: string; from: number; to: number },
    edge: "from" | "to",
    e: React.PointerEvent,
  ) => {
    if (!onSliceEdit) return;
    e.preventDefault();
    e.stopPropagation(); // don't start a pan/scrub on the waveform below
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = { symbol: r.symbol, edge, from: r.from, to: r.to };
    dragRef.current = d;
    setDrag(d);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const sec = secAt(e.clientX);
    if (sec == null) return;
    const nd =
      d.edge === "from"
        ? { ...d, from: Math.min(sec, d.to - MIN) }
        : { ...d, to: Math.max(sec, d.from + MIN) };
    dragRef.current = nd;
    setDrag(nd);
  };
  const endHandleDrag = () => {
    const d = dragRef.current;
    if (d && onSliceEdit)
      onSliceEdit(d.symbol, roundSec(d.from), roundSec(d.to));
    dragRef.current = null;
    setDrag(null);
  };

  useEffect(() => {
    let cancelled = false;
    setWf(null);
    setError(null);
    api
      .waveform(clip.id, undefined, whole)
      .then((w) => !cancelled && setWf(w))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [clip.id, whole]);

  // The arrangement playhead expressed in the clip's local seconds (−1 → off-screen).
  const localBeat = (playhead * project.tempo) / 60 - clip.start;
  const currentTime =
    wf && localBeat >= 0 && localBeat <= wf.clipBeats
      ? (localBeat * 60) / project.tempo
      : -1;

  return (
    <div className="flex h-full min-h-0 flex-col border-t-2 border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs">
        <span className="font-semibold text-primary">
          🔊 {clip.name || clip.id}
        </span>
        {wf && (
          <span className="text-muted-foreground">
            {wf.seconds.toFixed(2)}s · {wf.clipBeats.toFixed(2)} beats
          </span>
        )}
        {onClose && (
          <button
            onClick={onClose}
            title={m["editor.closeHint"]()}
            className="ml-auto rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            close ✕
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden"
      >
        {error ? (
          <div className="p-3 text-sm text-red-400">
            waveform unavailable — {error}
          </div>
        ) : !wf ? (
          <div className="p-3 text-sm text-muted-foreground">
            decoding audio…
          </div>
        ) : (
          // A relative wrapper so windows overlay by time-fraction; its width scales with zoom and the container scrolls.
          <div
            ref={contentRef}
            className="relative"
            style={{ width: `${zoomX * 100}%` }}
          >
            <Waveform
              envelope={{ intervalMs: wf.intervalMs, samples: wf.rms }}
              duration={wf.seconds}
              height={bodyH || undefined}
              currentTime={currentTime}
              gridLines={wf.grid}
            />
            {sliceRanges && wf.seconds > 0 && (
              // z-10 so windows and handles sit above the canvas, which captures the pointer for scrubbing.
              <div className="pointer-events-none absolute inset-0 z-10">
                {sliceRanges.map((r) => {
                  // The edge being dragged previews live; the rest read the file's values.
                  const eff =
                    drag && drag.symbol === r.symbol
                      ? { from: drag.from, to: drag.to }
                      : r;
                  const clampF = Math.max(
                    0,
                    Math.min(1, eff.from / wf.seconds),
                  );
                  const clampT = Math.max(0, Math.min(1, eff.to / wf.seconds));
                  const width = Math.max(0, clampT - clampF);
                  const active = drag?.symbol === r.symbol;
                  return (
                    <div
                      key={r.symbol}
                      // A clip window with no `to:` written runs to the file's end, which only this side knows.
                      title={`${r.symbol} — ${eff.from.toFixed(3)}s to ${Number.isFinite(eff.to) ? `${eff.to.toFixed(3)}s` : "the end"}`}
                      className="absolute inset-y-0 border-x border-primary/70 bg-primary/10"
                      style={{
                        left: `${clampF * 100}%`,
                        width: `${width * 100}%`,
                      }}
                    >
                      <span className="absolute left-0.5 top-0.5 rounded bg-background/70 px-0.5 font-mono text-[10px] text-primary">
                        {r.symbol}
                      </span>
                      {onSliceEdit && (
                        <>
                          {/* Edge handles — drag to change from/to. A generous 12px-wide
                              `pointer-events-auto` grab zone (straddling the border) makes
                              them easy to catch; pointer CAPTURE keeps the drag on the
                              handle wherever the cursor goes. */}
                          <div
                            title={`${r.symbol} — drag to set 'from'`}
                            onPointerDown={(e) => onHandleDown(r, "from", e)}
                            onPointerMove={onHandleMove}
                            onPointerUp={endHandleDrag}
                            onLostPointerCapture={endHandleDrag}
                            className={`pointer-events-auto absolute inset-y-0 left-0 -ml-1.5 w-3 cursor-ew-resize touch-none border-l-2 border-primary/80 hover:bg-primary/30 ${active && drag?.edge === "from" ? "bg-primary/30" : ""}`}
                          />
                          <div
                            title={`${r.symbol} — drag to set 'to'`}
                            onPointerDown={(e) => onHandleDown(r, "to", e)}
                            onPointerMove={onHandleMove}
                            onPointerUp={endHandleDrag}
                            onLostPointerCapture={endHandleDrag}
                            className={`pointer-events-auto absolute inset-y-0 right-0 -mr-1.5 w-3 cursor-ew-resize touch-none border-r-2 border-primary/80 hover:bg-primary/30 ${active && drag?.edge === "to" ? "bg-primary/30" : ""}`}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Transient markers: dashed yellow vertical bars at detected transient onsets.
                Drawn as an SVG overlay so they scale with the zoom like gridlines and
                slices. Only rendered when transients exist. */}
            {wf.transients.length > 0 && wf.seconds > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
              >
                {wf.transients.map((t, i) => {
                  const x = Math.max(0, Math.min(1, t / wf.seconds)) * 100;
                  return (
                    <line
                      key={i}
                      x1={`${x}%`}
                      y1="0"
                      x2={`${x}%`}
                      y2="100%"
                      stroke="#facc15" // yellow-400
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      strokeOpacity={0.3}
                    />
                  );
                })}
              </svg>
            )}
            {/* Stretch marks: for each warp marker a dashed line at the source point
                (original) and a blue line at its beat (target), with an arrow from one
                to the other. Positioned as a fraction of the region — same axis as the
                slices and grid — so they track the zoom. */}
            {wf.warpMarks.length > 0 && wf.seconds > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
              >
                <defs>
                  <marker
                    id="warpArrow"
                    markerWidth={7}
                    markerHeight={7}
                    refX={6}
                    refY={3.5}
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0,0 L7,3.5 L0,7 Z" fill="rgb(96,165,250)" />
                  </marker>
                </defs>
                {wf.warpMarks.map((mk, i) => {
                  const o =
                    Math.max(0, Math.min(1, mk.orig / wf.seconds)) * 100;
                  const t =
                    Math.max(0, Math.min(1, mk.target / wf.seconds)) * 100;
                  return (
                    <g key={i}>
                      <line
                        x1={`${o}%`}
                        y1="0"
                        x2={`${o}%`}
                        y2="100%"
                        stroke="rgba(235,235,242,0.6)"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={`${t}%`}
                        y1="0"
                        x2={`${t}%`}
                        y2="100%"
                        stroke="rgb(96,165,250)"
                        strokeWidth={1.5}
                      />
                      {Math.abs(t - o) > 0.4 && (
                        <line
                          x1={`${o}%`}
                          y1={12}
                          x2={`${t}%`}
                          y2={12}
                          stroke="rgb(96,165,250)"
                          strokeWidth={1.5}
                          markerEnd="url(#warpArrow)"
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
