// PianoRoll.tsx — a piano-roll view/editor of a MIDI clip, opening ZOOMED TO FIT its notes
// without being bounded by them: all 128 keys exist and the timeline runs past the content.
// Left-click-drag draws a note (press = pitch + start, release = end) via `sequence note
// new`; a pinch zooms time, a plain wheel and a middle-drag pan. Drawn by the Editor bottom
// panel and, when a clip is clicked, where the graph is (ClipView).

import { useEngineState } from "@studio/engine-browser/store";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { m } from "../paraglide/messages.js";
import type { WebClip, WebProject } from "../types";
import { useHZoom, usePanScroll } from "../usePanZoom";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pc = (k: number) => ((k % 12) + 12) % 12;
const noteName = (k: number) => `${NAMES[pc(k)]}${Math.floor(k / 12) - 1}`; // MIDI 60 => C4
const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(pc(k));

const N_NOTES = 128; // every possible MIDI note (0..127)
const PX_PER_BEAT = 24; // fallback beat width for the first, unmeasured frame only
const GUTTER = 44; // note-name column, px
const RULER_H = 18; // bar/beat ruler height, px
const KEYS = Array.from({ length: N_NOTES }, (_, i) => 127 - i); // high → low, top → bottom
const MARGIN = 0.2; // fraction of the content span shown as breathing room around the fit
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

export function PianoRoll({
  project,
  clip,
  onClose,
  onCreateNote,
}: {
  project: WebProject;
  clip: WebClip;
  onClose: () => void;
  // Draw a note via `sequence note new`; absent, the roll is read-only (no known sequence to write to).
  onCreateNote?: (key: number, startBeat: number, endBeat: number) => void;
}) {
  // Playhead from the store (see WaveformView) so only the roll re-renders per frame.
  const playhead = useEngineState((s) => s.playhead);
  const notes = clip.notes;
  const barBeats = Math.max(1, project.timeSigNumerator || 4);

  const bodyRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setPane({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Wheel zooms the time axis; middle-drag pans (both axes). Bound once the body mounts.
  const [zoomX] = useHZoom(bodyRef, { gutter: GUTTER });
  usePanScroll(bodyRef);

  // --- content extents + the fit-with-margin the view opens on ----------------------
  const seqEnd = notes.reduce((mx, n) => Math.max(mx, n.time + n.duration), 0);
  const contentEnd = clip.length > 0 ? clip.length : Math.max(barBeats, seqEnd);
  const noteLo = notes.length ? Math.min(...notes.map((n) => n.key)) : 48; // C3
  const noteHi = notes.length ? Math.max(...notes.map((n) => n.key)) : 72; // C5

  // Pitch fit: the used range plus a 20% margin (>= 2 semitones), clamped to 0..127.
  const pitchSpan = Math.max(1, noteHi - noteLo + 1);
  const pMargin = Math.max(2, Math.round(MARGIN * pitchSpan));
  const fitLoK = Math.max(0, noteLo - pMargin);
  const fitHiK = Math.min(127, noteHi + pMargin);
  const fitRows = Math.max(1, fitHiK - fitLoK + 1);

  // Time fit is [0, contentEnd] + 20% right margin; the canvas runs past it, and adding notes renews the room.
  const fitBeatHi = Math.max(barBeats, contentEnd * (1 + MARGIN));
  const canvasBeats =
    Math.ceil((fitBeatHi + Math.max(8 * barBeats, contentEnd)) / barBeats) *
    barBeats;

  const availW = Math.max(0, pane.w - GUTTER);
  const availH = Math.max(0, pane.h - RULER_H);
  // Base scales: fitRows fill the height, [0,fitBeatHi] fills the width — then zoomX stretches the time axis past fit.
  const rowH = availH > 0 ? availH / fitRows : 12;
  const ppb0 = availW > 0 ? availW / fitBeatHi : PX_PER_BEAT;
  const ppb = ppb0 * zoomX;
  const laneW = canvasBeats * ppb;
  const gridH = N_NOTES * rowH;
  const keyTop = (k: number) => (127 - k) * rowH;
  const showLabels = rowH >= 9; // only label octave Cs when a row is tall enough

  // Frame the fit once measured, and again for a different clip. Adding notes keeps clip.id, so the view stays.
  const framedFor = useRef<string>("");
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || availH <= 0) return;
    if (framedFor.current === clip.id) return;
    framedFor.current = clip.id;
    el.scrollTop = (127 - fitHiK) * rowH; // top of the fit pitch range
    el.scrollLeft = 0; // content starts at beat 0
  }, [clip.id, availH, rowH, fitHiK]);

  const localBeat = (playhead * project.tempo) / 60 - clip.start;
  const playX =
    localBeat >= 0 && localBeat <= canvasBeats ? localBeat * ppb : -1;
  const bars = Array.from(
    { length: Math.floor(canvasBeats / barBeats) + 1 },
    (_, i) => i,
  );
  const beats = Array.from(
    { length: Math.floor(canvasBeats) },
    (_, b) => b,
  ).filter((b) => b % barBeats !== 0);

  // --- left-click-drag to draw a note ----------------------------------------------
  // A live draft while dragging: pitch fixed at the press row, time from press to cursor.
  const [draft, setDraft] = useState<{
    k: number;
    t0: number;
    t1: number;
  } | null>(null);
  const drag = useRef<{ k: number; t0: number } | null>(null);

  const atEvent = (e: PointerEvent | React.PointerEvent) => {
    const r = laneRef.current!.getBoundingClientRect();
    const beat = Math.max(0, (e.clientX - r.left) / ppb);
    const key = clamp(127 - Math.floor((e.clientY - r.top) / rowH), 0, 127);
    return { beat, key };
  };

  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !onCreateNote) return; // left-draw only; middle pans
    e.preventDefault();
    const { beat, key } = atEvent(e);
    drag.current = { k: key, t0: beat };
    setDraft({ k: key, t0: beat, t1: beat });
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      const { beat: b } = atEvent(ev);
      setDraft({ k: drag.current.k, t0: drag.current.t0, t1: b });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = drag.current;
      drag.current = null;
      setDraft(null);
      if (!d) return;
      const { beat: b } = atEvent(ev);
      const t0 = Math.min(d.t0, b);
      const t1 = Math.max(d.t0, b);
      // A plain click (no real drag) leaves the length to the command's default.
      onCreateNote(d.k, t0, t1 - t0 > 0.01 ? t1 : t0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const draftBox = draft
    ? {
        left: Math.min(draft.t0, draft.t1) * ppb,
        width: Math.max(3, Math.abs(draft.t1 - draft.t0) * ppb),
        top: keyTop(draft.k),
      }
    : null;

  return (
    // min-w-0, as in the timeline: the fixed-width grid must not become this flex child's minimum.
    <div className="flex h-full min-h-0 min-w-0 flex-col border-t-2 border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs">
        <span className="font-semibold text-primary">
          🎹 {clip.name || clip.id}
        </span>
        <span className="text-muted-foreground">
          {notes.length} notes · {Math.round(contentEnd)} beats
          {onCreateNote && (
            <span className="ml-2 text-muted-foreground/70">
              · drag to draw · pinch to zoom · middle-drag pan
            </span>
          )}
        </span>
        <button
          onClick={onClose}
          title={m["editor.closeHint"]()}
          className="ml-auto rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          close ✕
        </button>
      </div>

      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="relative font-mono"
          style={{ width: GUTTER + laneW, height: RULER_H + gridH }}
        >
          {/* bars + beats ruler */}
          <div
            className="sticky top-0 z-20 flex bg-background text-[10px] text-muted-foreground"
            style={{ height: RULER_H }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-b border-r border-border bg-background"
              style={{ width: GUTTER }}
            />
            <div
              className="relative border-b border-border"
              style={{ width: laneW }}
            >
              {beats.map((b) => (
                <div
                  key={`t${b}`}
                  className="absolute bottom-0 border-l border-border/25"
                  style={{ left: b * ppb, height: RULER_H / 2 }}
                />
              ))}
              {bars.map((bar) => (
                <div
                  key={bar}
                  className="absolute top-0 h-full border-l border-border/60 pl-0.5"
                  style={{ left: bar * barBeats * ppb }}
                >
                  {bar + 1}
                </div>
              ))}
            </div>
          </div>

          {/* piano gutter + note grid */}
          <div className="flex" style={{ height: gridH }}>
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-border bg-background"
              style={{ width: GUTTER }}
            >
              {KEYS.map((k) => (
                <div
                  key={k}
                  className={`flex items-center justify-end pr-1 text-[9px] text-muted-foreground ${isBlack(k) ? "bg-muted/50" : ""}`}
                  style={{ height: rowH, lineHeight: `${rowH}px` }}
                >
                  {showLabels && pc(k) === 0 ? (
                    <>
                      {noteName(k)} <span className="opacity-50">{k}</span>
                    </>
                  ) : (
                    ""
                  )}
                </div>
              ))}
            </div>
            <div
              ref={laneRef}
              className={`relative ${onCreateNote ? "cursor-crosshair" : ""}`}
              style={{ width: laneW }}
              onPointerDown={onLanePointerDown}
            >
              {KEYS.filter(isBlack).map((k) => (
                <div
                  key={`b${k}`}
                  className="absolute left-0 right-0 bg-muted/15"
                  style={{ top: keyTop(k), height: rowH }}
                />
              ))}
              {KEYS.filter((k) => pc(k) === 0).map((k) => (
                <div
                  key={`o${k}`}
                  className="absolute left-0 right-0 border-t border-border/30"
                  style={{ top: keyTop(k) }}
                />
              ))}
              {bars.map((bar) => (
                <div
                  key={bar}
                  className="absolute top-0 border-l border-border/50"
                  style={{ left: bar * barBeats * ppb, height: gridH }}
                />
              ))}
              {notes.map((n, i) => (
                <div
                  key={i}
                  title={`${noteName(n.key)} · ${n.time}–${n.time + n.duration}b`}
                  className="absolute rounded-[1px] bg-emerald-500/90"
                  style={{
                    top: keyTop(n.key),
                    height: Math.max(1, rowH - 1),
                    left: n.time * ppb,
                    width: Math.max(
                      2,
                      (n.duration > 0 ? n.duration : 0.25) * ppb,
                    ),
                  }}
                />
              ))}
              {draftBox && (
                <div
                  className="pointer-events-none absolute z-10 rounded-[1px] bg-emerald-300/80 outline outline-1 outline-emerald-200"
                  style={{
                    top: draftBox.top,
                    height: Math.max(1, rowH - 1),
                    left: draftBox.left,
                    width: draftBox.width,
                  }}
                />
              )}
              {playX >= 0 && (
                <div
                  className="pointer-events-none absolute top-0 z-10 w-px bg-white/80"
                  style={{ left: playX, height: gridH }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
