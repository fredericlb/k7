// Timeline.tsx — the arrangement: one row per lane, clips placed by SECOND, a ruler, markers
// and a playhead. Where l8's timeline is musical, this one is wall-clock throughout, which is
// why it is a component of its own rather than a mode of that one — see ../../docs/views.md.
//
// Continuous interaction lives here (scrubbing, dragging a clip, trimming an edge); everything
// discrete is a click that calls back up to Studio, which owns the file writes.

import {
  GUTTER_DESKTOP,
  HATCH,
  MARKER_COLOR,
  ROW_H,
  RULER_H,
} from "@studio/ui-timeline/lanes";
import { useHZoom, usePanScroll } from "@studio/ui-timeline/panZoom";
import {
  chooseTick,
  formatClock,
  SECOND_TICKS,
  ticksUpTo,
} from "@studio/ui-timeline/ticks";
import type { WebVideoProject, WebVideoTrack } from "@studio/web-protocol";
import { Eye, EyeOff, Film, Shapes } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

/** Seconds per screen at zoom 1 — a whole minute, so a short cut opens fully visible. */
const FIT_SECONDS = 60;
/** Never draw a timeline shorter than this: an empty project still needs a ruler to click on. */
const MIN_SPAN = 10;
/** A clip with `length: 0` runs to the end of its source, which the browser has not measured
 *  here. Drawn this wide so it is visible and obviously provisional. */
const NATURAL_SECONDS = 4;

export interface ClipEdit {
  track: string;
  ref: string;
  field: "start" | "source_from" | "length";
  value: number;
}

/** A clip's drawn extent. `natural` marks the placeholder width of a length-0 placement. */
function extent(length: number): { width: number; natural: boolean } {
  return length > 0
    ? { width: length, natural: false }
    : { width: NATURAL_SECONDS, natural: true };
}

export function Timeline({
  project,
  playhead,
  onSeek,
  onSelect,
  selected,
  onEdit,
  onToggleHidden,
}: {
  project: WebVideoProject;
  playhead: number;
  onSeek: (sec: number) => void;
  onSelect: (trackId: string) => void;
  selected: string | null;
  /** A finished drag. Applied by the caller, which owns the file. */
  onEdit: (e: ClipEdit) => void;
  onToggleHidden: (trackId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom] = useHZoom(scrollRef, { gutter: GUTTER_DESKTOP, max: 64 }, [
    project.videoTracks.length,
  ]);
  usePanScroll(scrollRef, [project.videoTracks.length]);

  // The span drawn: the cut plus a tail, so there is always somewhere to drag a clip TO.
  const span = Math.max(MIN_SPAN, project.duration * 1.2);
  const [width, setWidth] = useState(900);
  const pxPerSec = ((width - GUTTER_DESKTOP) / FIT_SECONDS) * zoom;
  const step = chooseTick(SECOND_TICKS, pxPerSec);
  const ticks = useMemo(() => ticksUpTo(span, step), [span, step]);
  const laneW = span * pxPerSec;

  // Measured rather than assumed: the pane is one half of a split the user drags.
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (el) setWidth(el.clientWidth);
  }, []);

  const x = (sec: number) => sec * pxPerSec;

  /** A pointer x on the lane area -> a second. Negative in the gutter, which callers ignore. */
  const secAt = (clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return (el.scrollLeft + clientX - r.left - GUTTER_DESKTOP) / pxPerSec;
  };

  // --- dragging a clip -------------------------------------------------------
  // One pointer capture for the three gestures, told apart by where the press landed: the body
  // MOVES the placement, the left edge trims its head (which moves `start` and `source_from`
  // together, so the shot does not slide under the trim), the right edge sets its length.
  const dragRef = useRef<{
    track: string;
    ref: string;
    mode: "move" | "in" | "out";
    grabSec: number;
    start: number;
    sourceFrom: number;
    length: number;
  } | null>(null);
  const [ghost, setGhost] = useState<{
    track: string;
    ref: string;
    start: number;
    width: number;
  } | null>(null);

  const onClipDown = (
    e: React.PointerEvent,
    track: WebVideoTrack,
    clip: WebVideoTrack["clips"][number],
    mode: "move" | "in" | "out",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      track: track.id,
      ref: clip.id,
      mode,
      grabSec: secAt(e.clientX),
      start: clip.start,
      sourceFrom: clip.sourceFrom,
      length: clip.length,
    };
    onSelect(track.id);
  };

  const onClipMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = secAt(e.clientX) - d.grabSec;
    const drawn = extent(d.length).width;
    if (d.mode === "move")
      setGhost({
        track: d.track,
        ref: d.ref,
        start: Math.max(0, d.start + delta),
        width: drawn,
      });
    else if (d.mode === "in") {
      const trim = Math.max(-d.sourceFrom, Math.min(delta, drawn - 0.04));
      setGhost({
        track: d.track,
        ref: d.ref,
        start: Math.max(0, d.start + trim),
        width: drawn - trim,
      });
    } else
      setGhost({
        track: d.track,
        ref: d.ref,
        start: d.start,
        width: Math.max(0.04, drawn + delta),
      });
  };

  const onClipUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGhost(null);
    if (!d) return;
    const delta = secAt(e.clientX) - d.grabSec;
    if (Math.abs(delta) < 0.01) return; // a click, not a drag — selection already happened
    const drawn = extent(d.length).width;
    if (d.mode === "move")
      onEdit({
        track: d.track,
        ref: d.ref,
        field: "start",
        value: Math.max(0, d.start + delta),
      });
    else if (d.mode === "in") {
      // Both, in one gesture: the head moves on the timeline AND further into the source, so
      // the frame under the new edge is the frame that was there before the trim.
      const trim = Math.max(-d.sourceFrom, Math.min(delta, drawn - 0.04));
      onEdit({
        track: d.track,
        ref: d.ref,
        field: "source_from",
        value: d.sourceFrom + trim,
      });
      onEdit({
        track: d.track,
        ref: d.ref,
        field: "start",
        value: Math.max(0, d.start + trim),
      });
      // A length-0 placement has no head to trim without also pinning its extent, or the trim
      // would be undone by the source's own length on the next compile.
      if (d.length === 0)
        onEdit({
          track: d.track,
          ref: d.ref,
          field: "length",
          value: drawn - trim,
        });
    } else
      onEdit({
        track: d.track,
        ref: d.ref,
        field: "length",
        value: Math.max(0.04, drawn + delta),
      });
  };

  return (
    <div ref={measure} className="flex h-full min-h-0 w-full flex-col">
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto bg-background"
        onPointerMove={onClipMove}
        onPointerUp={onClipUp}
        onPointerCancel={onClipUp}
      >
        <div style={{ width: GUTTER_DESKTOP + laneW }}>
          {/* --- the ruler: click anywhere on it to move the playhead ------------- */}
          <div
            className="sticky top-0 z-20 flex border-b border-border bg-background"
            style={{ height: RULER_H }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-border bg-background"
              style={{ width: GUTTER_DESKTOP }}
            />
            <button
              type="button"
              aria-label="scrub"
              className="relative flex-1 cursor-text"
              onPointerDown={(e) => onSeek(Math.max(0, secAt(e.clientX)))}
            >
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-0 h-full select-none border-l border-border pl-1 font-mono text-[10px] text-muted-foreground"
                  style={{ left: x(t) }}
                >
                  {formatClock(t, step)}
                </span>
              ))}
              {project.markers.map((m) => (
                <span
                  key={m.tc}
                  className="absolute top-0 h-full select-none pl-1 font-mono text-[10px]"
                  style={{ left: x(m.sec), color: MARKER_COLOR }}
                  title={`${m.name} — ${m.tc}`}
                >
                  ▏{m.name}
                </span>
              ))}
            </button>
          </div>

          {/* --- one row per lane, bottom of the draw stack FIRST ----------------- */}
          {project.videoTracks.map((t) => (
            <div
              key={t.id}
              className={`relative flex border-b border-border/60 ${
                selected === t.id ? "bg-accent/20" : ""
              }`}
              style={{ height: ROW_H }}
            >
              <div
                className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border bg-background px-2"
                style={{ width: GUTTER_DESKTOP }}
              >
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  title={t.mute ? "cachée — afficher" : "visible — cacher"}
                  onClick={() => onToggleHidden(t.id)}
                >
                  {t.mute ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
                {t.kind === "shape" ? (
                  <Shapes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <button
                  type="button"
                  className={`min-w-0 flex-1 truncate text-left text-xs ${
                    t.mute ? "text-muted-foreground/60" : ""
                  }`}
                  title={`${t.name} — ${t.kind === "shape" ? "formes" : "images"}`}
                  onClick={() => onSelect(t.id)}
                >
                  {t.name}
                </button>
              </div>

              <div className="relative flex-1">
                {/* A shape lane holds no placements — hatched, because "empty" and "cannot hold
                    a clip" look the same otherwise. */}
                {t.kind === "shape" ? (
                  <div
                    className="absolute inset-0 text-muted-foreground/30"
                    style={{ backgroundImage: HATCH }}
                    title={`${t.shapes.length} forme(s) — dessinées en continu`}
                  />
                ) : (
                  t.clips.map((c, i) => {
                    const g =
                      ghost && ghost.track === t.id && ghost.ref === c.id
                        ? ghost
                        : null;
                    const { width: w, natural } = extent(c.length);
                    const left = x(g ? g.start : c.start);
                    const wpx = x(g ? g.width : w);
                    return (
                      <div
                        // A ref can be placed twice on one lane, so the index is part of the key.
                        key={`${c.id}:${i}`}
                        className={`absolute top-[3px] flex items-center overflow-hidden rounded-sm border text-[10px] ${
                          natural
                            ? "border-dashed border-amber-500/70 bg-amber-500/10"
                            : "border-sky-500/70 bg-sky-500/20"
                        } ${t.mute ? "opacity-40" : ""}`}
                        style={{
                          left,
                          width: Math.max(6, wpx),
                          height: ROW_H - 7,
                        }}
                        title={
                          natural
                            ? `${c.id} — length: 0, jusqu'à la fin de la source (largeur indicative)`
                            : `${c.id} — ${formatClock(c.start, 0.04)} → ${formatClock(c.start + c.length, 0.04)}, source +${c.sourceFrom.toFixed(2)}s`
                        }
                        onPointerDown={(e) => onClipDown(e, t, c, "move")}
                      >
                        <span
                          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-foreground/20"
                          onPointerDown={(e) => onClipDown(e, t, c, "in")}
                        />
                        <span className="truncate px-2 font-mono">{c.id}</span>
                        <span
                          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-foreground/20"
                          onPointerDown={(e) => onClipDown(e, t, c, "out")}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}

          {project.videoTracks.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">
              Ce montage n'a aucune piste. Ajoutez un fichier sous{" "}
              <code>video_tracks/</code> et nommez-le dans{" "}
              <code>project.layers</code>.
            </div>
          )}
        </div>

        {/* The playhead, over everything, drawn from the ruler down. Its own element rather
            than a per-row line: one absolutely-positioned rule cannot fall out of step with
            itself. */}
        <div
          className="pointer-events-none absolute top-0 z-30 w-px bg-red-500"
          style={{
            left: GUTTER_DESKTOP + x(playhead),
            height: RULER_H + project.videoTracks.length * ROW_H,
          }}
        />
      </div>
    </div>
  );
}
