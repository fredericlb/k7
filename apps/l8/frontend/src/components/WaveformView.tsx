// WaveformView.tsx — the audio-clip editor: a bottom split pane (opened with `e`
// on an audio clip, mirroring the MIDI piano roll) showing the clip's waveform
// with bar/beat gridlines aligned to the arrangement and a live playhead. The
// waveform itself is the shared @studio/ui-waveform Waveform (fed a dB envelope
// from the clip's samples); the notes/grid come from the backend (/api/waveform).

import { useEngineState } from "@studio/engine-browser/store";
import { useHZoom, usePanScroll } from "@studio/ui-timeline/panZoom";
import { Waveform } from "@studio/ui-waveform";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { clipEnvelopeKey } from "../clipEnvelope";
import { clipLoop, visibleRepeats } from "../clipLoop";
import { m } from "../paraglide/messages.js";
import type { WebClip, WebProject, WebWaveform } from "../types";

// What `api.waveform` defaults to. Stated here because it is part of the envelope's identity, and
// a key computed at one resolution for a fetch made at another would be a key that quietly lies.
const WAVEFORM_BUCKETS = 1000;

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
  // Slice-rack windows over the waveform (source seconds): one symbol's [from,to], so you see
  // where each sound sits. `color` is the slice's own hue (sliceSymbols.ts), shared with the
  // symbol's painted name in the editor; absent, the window is the colourless band a clip's
  // `from`/`to` draws — the two uses of this overlay that must not look alike.
  sliceRanges?: { symbol: string; from: number; to: number; color?: string }[];
  // With this, each window grows draggable edges that rewrite the symbol's from/to — only when its own file is open.
  onSliceEdit?: (symbol: string, from: number, to: number) => void;
  // Docked in the editor there is nothing to close (the strip lives and dies with the file), so the header drops it.
  onClose?: () => void;
}) {
  const [wf, setWf] = useState<WebWaveform | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wheel zooms past fit and middle-drag pans. No gutter here — the canvas fills the width — so the anchor uses 0.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoomX, setZoomX] = useHZoom(scrollRef, { gutter: 0 });
  usePanScroll(scrollRef);

  // The waveform fills the pane's height, so a short bottom strip never scrolls vertically. The
  // width comes along because the loop marks ask how many pixels a pass is worth before drawing
  // one line per repeat — see visibleRepeats.
  const [body, setBody] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBody({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  const bodyH = body.h;

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

  // The MATERIAL's identity, not the clip's: `clip trim` rewrites the window and leaves the id
  // alone, so depending on the id alone held this pane on the pre-trim picture. Same key as the
  // timeline's envelope cache — src/clipEnvelope.ts.
  const materialKey = clipEnvelopeKey(clip, project, WAVEFORM_BUCKETS);
  useEffect(() => {
    let cancelled = false;
    setWf(null);
    setError(null);
    // A different region opens at FIT, like the roll's: the zoom multiplier belonged to the clip
    // being left, and the pane's width is `zoomX * 100%` — so without this the next clip arrives
    // stretched to whatever the last one was examined at. A trim IS a different region, so it
    // re-fits too.
    setZoomX(1);
    api
      .waveform(clip.id, WAVEFORM_BUCKETS, whole)
      .then((w) => !cancelled && setWf(w))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [clip.id, materialKey, whole, setZoomX]);

  // One identity per decode: Waveform is memoised, and an inline literal here would be a new
  // object on every render of this pane, which is exactly what memo cannot see through.
  const envelope = useMemo(
    () => (wf ? { intervalMs: wf.intervalMs, samples: wf.rms } : null),
    [wf],
  );

  /**
   * The clip's loop, on this region's axis — and NOT in `whole` mode.
   *
   * A loop belongs to a PLACEMENT: `clipLoop` puts an audio window at 0 because the placed region
   * is drawn from the in-point, which is where the window starts. `whole` spans the source file
   * instead, so the same 0 would mark the head of the file rather than the loop, and every mark
   * would be wrong by the in-point. What that view is for is the material's own `from`/`to`, which
   * `sliceRanges` already draws.
   */
  const loop = whole ? null : clipLoop(clip);
  // Pixels one beat is drawn at: the content is `zoomX` times the pane, spanning the whole region.
  const pxPerBeat =
    wf && wf.clipBeats > 0 ? (body.w * zoomX) / wf.clipBeats : 0;

  return (
    <div className="flex h-full min-h-0 flex-col border-t-2 border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs">
        <span className="font-semibold text-primary">
          🔊 {clip.name || clip.id}
        </span>
        {wf && (
          <span className="text-muted-foreground">
            {wf.seconds.toFixed(2)}s · {wf.clipBeats.toFixed(2)} beats
            {/* What the marks add up to, said in words — the roll's header says the same. */}
            {loop && (
              <span className="ml-2 text-violet-400">
                · loop {+loop.win.toFixed(3)}b
                {loop.passes > 1 && ` × ${loop.passes}`}
              </span>
            )}
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
            {envelope && (
              <ClipWaveform
                envelope={envelope}
                duration={wf.seconds}
                height={bodyH || undefined}
                gridLines={wf.grid}
                tempo={project.tempo}
                clipStart={clip.start}
                clipBeats={wf.clipBeats}
              />
            )}
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
                      className={
                        r.color
                          ? "absolute inset-y-0 border-x"
                          : "absolute inset-y-0 border-x border-primary/70 bg-primary/10"
                      }
                      style={{
                        left: `${clampF * 100}%`,
                        width: `${width * 100}%`,
                        // The slice's own hue — border at full, fill at ~10% ("1A"), the same
                        // weight the colourless band carries.
                        ...(r.color
                          ? {
                              borderColor: r.color,
                              backgroundColor: `${r.color}1A`,
                            }
                          : {}),
                      }}
                    >
                      <span
                        className="absolute left-0.5 top-0.5 rounded bg-background/70 px-0.5 font-mono text-[10px] text-primary"
                        style={r.color ? { color: r.color } : undefined}
                      >
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
                            className={`pointer-events-auto absolute inset-y-0 left-0 -ml-1.5 w-3 cursor-ew-resize touch-none border-l-2 ${r.color ? "" : "border-primary/80 hover:bg-primary/30"} ${active && drag?.edge === "from" && !r.color ? "bg-primary/30" : ""}`}
                            style={
                              r.color ? { borderColor: r.color } : undefined
                            }
                          />
                          <div
                            title={`${r.symbol} — drag to set 'to'`}
                            onPointerDown={(e) => onHandleDown(r, "to", e)}
                            onPointerMove={onHandleMove}
                            onPointerUp={endHandleDrag}
                            onLostPointerCapture={endHandleDrag}
                            className={`pointer-events-auto absolute inset-y-0 right-0 -mr-1.5 w-3 cursor-ew-resize touch-none border-r-2 ${r.color ? "" : "border-primary/80 hover:bg-primary/30"} ${active && drag?.edge === "to" && !r.color ? "bg-primary/30" : ""}`}
                            style={
                              r.color ? { borderColor: r.color } : undefined
                            }
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
            {/* The LOOP: the window that repeats, and a line where each later pass begins.
                Positioned by BEAT fraction of the region — `clipBeats` spans it, the same axis
                the playhead is placed on — so the marks hold at any zoom.

                This is what explains the pane's width: the region spans the clip's placed length,
                and the material only fills the first pass (`regionWaveform` draws silence past
                the source window), so a 3× loop is one third of a picture and two thirds flat. */}
            {loop && wf.clipBeats > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                preserveAspectRatio="none"
              >
                <title>{`loop ${+loop.win.toFixed(3)} beats × ${loop.passes}`}</title>
                <rect
                  x={`${(loop.from / wf.clipBeats) * 100}%`}
                  y="0"
                  width={`${(loop.win / wf.clipBeats) * 100}%`}
                  height="100%"
                  fill="rgb(167,139,250)" // violet-400
                  fillOpacity={0.1}
                />
                {visibleRepeats(loop, pxPerBeat).map((b) => (
                  <line
                    key={`lr${b}`}
                    x1={`${(b / wf.clipBeats) * 100}%`}
                    y1="0"
                    x2={`${(b / wf.clipBeats) * 100}%`}
                    y2="100%"
                    stroke="rgb(167,139,250)"
                    strokeWidth={1}
                    strokeOpacity={0.3}
                  />
                ))}
                {[loop.from, loop.to].map((b, i) => (
                  <line
                    key={`le${b}-${i}`}
                    x1={`${(b / wf.clipBeats) * 100}%`}
                    y1="0"
                    x2={`${(b / wf.clipBeats) * 100}%`}
                    y2="100%"
                    stroke="rgb(167,139,250)"
                    strokeWidth={1.5}
                    strokeOpacity={0.8}
                  />
                ))}
              </svg>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The canvas, and the only thing in this pane that knows the transport.
 *
 * `currentTime` has to reach the canvas — the progress fill and the playhead are drawn on it —
 * so the subscription cannot leave for a sibling the way the timeline's did. What it CAN do is
 * stop dragging the rest of the pane with it: the slice windows, the transient markers and the
 * warp marks are all above this canvas and none of them move with the transport.
 */
function ClipWaveform({
  envelope,
  duration,
  height,
  gridLines,
  tempo,
  clipStart,
  clipBeats,
}: {
  envelope: { intervalMs: number; samples: number[] };
  duration: number;
  height?: number;
  gridLines: WebWaveform["grid"];
  tempo: number;
  clipStart: number;
  clipBeats: number;
}) {
  const playhead = useEngineState((s) => s.playhead);
  // The arrangement playhead in the clip's local seconds (−1 → outside this clip).
  const localBeat = (playhead * tempo) / 60 - clipStart;
  const currentTime =
    localBeat >= 0 && localBeat <= clipBeats ? (localBeat * 60) / tempo : -1;
  return (
    <Waveform
      envelope={envelope}
      duration={duration}
      height={height}
      currentTime={currentTime}
      gridLines={gridLines}
    />
  );
}
