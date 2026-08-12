// Minimap.tsx — a compact, full-width overview of the arrangement, pinned above the
// command bar: one thin row per track showing its clips, plus the live playhead and
// the timeline caret. Clicking (or dragging across) scrubs the playhead to that
// position — the whole song is always mapped to the full width, so it never scrolls.

import { useEngineState } from "@studio/engine-browser/store";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";
import { HATCH, projectRows, type RowKey, rowIndexOf } from "../rows";
import type { WebProject, WebTrack } from "../types";

const MAX_H = 80; // the minimap never grows past this
const ROW_MAX = 12; // per-track row height ceiling (few tracks shouldn't look bloated)
const NATURAL = 4; // beats drawn for a length-0 clip (matches the timeline)

// The entity open in the editor: a clip id outlines its placements, a track id lights the whole lane.
export interface MinimapItem {
  kind: "clip" | "track";
  id: string;
}

export function Minimap({
  reloadKey,
  orbit,
  caret,
  highlight,
  onSeek,
}: {
  reloadKey: number;
  orbit: WebTrack[]; // the live Strudel lanes — see the rows note below
  // The timeline caret. `beat < 0` means its row's LABEL is selected, so there is no column to mark.
  caret: { row: RowKey; beat: number } | null;
  // The clip/track open in the editor, outlined so you can see where it sits.
  highlight?: MinimapItem | null;
  onSeek: (seconds: number) => void;
}) {
  const [proj, setProj] = useState<WebProject | null>(null);
  useEffect(() => {
    api
      .projectDoc()
      .then(setProj)
      .catch(() => setProj(null));
  }, [reloadKey]);

  const barBeats = Math.max(1, proj?.timeSigNumerator || 4);
  // The song's extent (min 4 bars), rounded up to whole bars — mapped to full width.
  const totalBeats = useMemo(() => {
    let end = 16;
    for (const t of proj?.tracks ?? [])
      for (const c of t.clips)
        end = Math.max(end, c.start + (c.length > 0 ? c.length : NATURAL));
    return Math.ceil((end + 1) / barBeats) * barBeats;
  }, [proj, barBeats]);

  // The same rows the timeline draws, from the same track list — dropping the live lanes also dropped any group
  // whose only members they were, and a 4-lane timeline showed up here as one.
  const rows = useMemo(
    () => (proj ? projectRows(proj, [...proj.tracks, ...orbit]) : []),
    [proj, orbit],
  );
  // Rows are fractional so every one fits inside MAX_H, however many there are.
  const rowH = rows.length ? Math.min(ROW_MAX, MAX_H / rows.length) : 0;
  const h = Math.max(16, rows.length * rowH);

  const ref = useRef<HTMLDivElement>(null);
  const seekTo = (clientX: number) => {
    const el = ref.current;
    if (!el || !proj) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    onSeek((frac * totalBeats * 60) / (proj.tempo || 120));
  };

  const pct = (beat: number) =>
    `${Math.max(0, Math.min(100, (beat / totalBeats) * 100))}%`;

  if (!proj || rows.length === 0) return null; // nothing to overview yet

  const caretRow = caret ? rowIndexOf(rows, caret.row) : -1;
  const onLabel = !!caret && caret.beat < 0; // the row is selected, not a beat
  const hlTrack = highlight?.kind === "track" ? highlight.id : null;
  const hlClip = highlight?.kind === "clip" ? highlight.id : null;

  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) seekTo(e.clientX); // drag to scrub
      }}
      title={m["minimap.movePlayhead"]()}
      className="relative w-full shrink-0 cursor-pointer select-none overflow-hidden border-t border-border bg-card/30"
      style={{ height: h }}
    >
      {/* one row per lane, clips positioned by beat — a group holds no clips, so it
          reads as a plain grey band over the tracks it owns */}
      {rows.map((row, ri) =>
        row.kind === "group" ? (
          <div
            key={`group:${row.group.id}`}
            title={`${row.group.name} — a group; holds no clips of its own`}
            className="absolute inset-x-0 bg-muted-foreground/25"
            style={{ top: ri * rowH, height: rowH }}
          />
        ) : row.kind === "video" ? (
          // A video lane as one violet band: at a few px per row, per-placement detail would be sub-pixel noise.
          <div
            key={`video:${row.track.id}`}
            title={`${row.track.name} — a video lane`}
            className="absolute inset-x-0 bg-violet-500/40"
            style={{ top: ri * rowH, height: rowH }}
          />
        ) : row.track.generated ? (
          // A generated lane is hatched like the timeline's: its look-ahead clips would flicker as playback runs.
          <div
            key={row.track.id}
            title={`${row.track.name} — generated by an algo pattern; can't hold clips`}
            className="absolute inset-x-0 text-muted-foreground/30"
            style={{ top: ri * rowH, height: rowH, backgroundImage: HATCH }}
          />
        ) : (
          <div
            key={row.track.id}
            className={`absolute inset-x-0 ${hlTrack === row.track.id ? "bg-amber-400/15 outline outline-1 -outline-offset-1 outline-amber-400" : ""}`}
            style={{ top: ri * rowH, height: rowH }}
          >
            {row.track.clips.map((c, i) => (
              <div
                // Same ref can be placed more than once, so id alone collides — key by placement (id + index), as the timeline does.
                key={`${c.id}-${i}`}
                // The type default only where no track colour is authored; a clip open in the editor gets an amber ring.
                className={`absolute rounded-[1px] ${rowH >= 4 ? "bottom-px top-px" : "inset-y-0"} ${row.track.color ? "" : c.type === "midi" ? "bg-emerald-500/70" : "bg-sky-500/70"} ${
                  row.track.mute ? "opacity-40" : ""
                } ${hlClip && (c.id === hlClip || c.name === hlClip) ? "outline outline-1 outline-offset-1 outline-amber-400 brightness-125" : ""}`}
                style={{
                  left: pct(c.start),
                  width: `${((c.length > 0 ? c.length : NATURAL) / totalBeats) * 100}%`,
                  minWidth: 2,
                  background: row.track.color
                    ? `color-mix(in srgb, ${row.track.color} 70%, transparent)`
                    : undefined,
                }}
              />
            ))}
          </div>
        ),
      )}

      {/* caret. On a beat: a full-height guide down the column plus a module on its
          own row. On a label: no column to point at — the whole row lights up
          instead, which is what "this row is selected" looks like from up here. */}
      {caret && caretRow >= 0 && onLabel && (
        <div
          className="pointer-events-none absolute inset-x-0 bg-primary/40 outline outline-1 -outline-offset-1 outline-primary"
          style={{ top: caretRow * rowH, height: rowH }}
        />
      )}
      {caret && !onLabel && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-primary/70"
            style={{ left: pct(caret.beat) }}
          />
          {/* the caret names its ROW; nesting and the live lanes reorder them, so
              find where that row is actually drawn */}
          {caretRow >= 0 && (
            <div
              className="pointer-events-none absolute bg-primary"
              style={{
                left: pct(caret.beat),
                top: caretRow * rowH,
                width: 3,
                height: rowH,
              }}
            />
          )}
        </>
      )}

      <MinimapPlayhead totalBeats={totalBeats} tempo={proj.tempo} />
    </div>
  );
}

/**
 * The live playhead, and the ONLY thing here that knows the transport.
 *
 * The subscription sits in this leaf rather than in the body above, which is the rule the
 * timeline already follows (`TimelineTab`'s `Playhead`): the body draws one div per row and one
 * per CLIP, and reading the playhead up there reconciled all of them 20 times a second to move
 * a single line. See `docs/timeline.md`.
 *
 * The line is the element's LEFT EDGE — the box is full width and gets translated, because a
 * percentage translate is a percentage of the element's own width, which is the minimap's only
 * when the element spans it. Worth the indirection: the transport then moves this without a
 * layout, and the row already clips.
 */
function MinimapPlayhead({
  totalBeats,
  tempo,
}: {
  totalBeats: number;
  tempo: number;
}) {
  const playhead = useEngineState((s) => s.playhead);
  const beat = (playhead * (tempo || 120)) / 60;
  const pct = Math.max(0, Math.min(100, (beat / totalBeats) * 100));
  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 w-full border-white border-l"
      style={{ transform: `translateX(${pct}%)`, willChange: "transform" }}
    />
  );
}
