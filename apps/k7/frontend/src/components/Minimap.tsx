// Minimap.tsx — a compact, full-width overview of the arrangement, pinned above the
// command bar: one thin row per track showing its clips, plus the live playhead and
// the timeline caret. Clicking (or dragging across) scrubs the playhead to that
// position — the whole song is always mapped to the full width, so it never scrolls.

import { memo, useCallback, useMemo, useRef } from "react";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";
import { m } from "../paraglide/messages.js";
import { usePaneProjectDoc } from "../queries/projectDoc";
import { HATCH, projectRows, type RowKey, rowIndexOf } from "../rows";
import { useReloadKey } from "../state/shellStore";
import type { WebAutomationLane } from "../types";
import { UNCOLOURED } from "./ClipActivity";

const MAX_H = 80; // the minimap never grows past this
const ROW_MAX = 12; // per-track row height ceiling (few tracks shouldn't look bloated)
const NATURAL = 4; // beats drawn for a length-0 clip (matches the timeline)

// The entity open in the editor: a clip id outlines its placements, a track id lights the whole lane.
export interface MinimapItem {
  kind: "clip" | "track";
  id: string;
}

// Memoised: it sits under the shell, which re-renders for reasons that move none of its props.
export const Minimap = memo(function Minimap({
  automation,
  caret,
  highlight,
  onSeek,
}: {
  // Each lane's automation, by track id — taken for the reason the rows are built the same way: they must line up with the timeline's.
  automation?: Record<string, WebAutomationLane[]>;
  // The timeline caret. `beat < 0` means its row's LABEL is selected, so there is no column to mark.
  caret: { row: RowKey; beat: number } | null;
  // The clip/track open in the editor, outlined so you can see where it sits.
  highlight?: MinimapItem | null;
  onSeek: (seconds: number) => void;
}) {
  // The shared document at the shell's reload key — the one the timeline draws, so the two line up (queries/projectDoc.ts).
  const { doc: proj } = usePaneProjectDoc(useReloadKey());

  const barBeats = Math.max(1, proj?.timeSigNumerator || 4);
  // The song's extent (min 4 bars), rounded up to whole bars — mapped to full width.
  const totalBeats = useMemo(() => {
    let end = 16;
    for (const t of proj?.tracks ?? [])
      for (const c of t.clips)
        end = Math.max(end, c.start + (c.length > 0 ? c.length : NATURAL));
    return Math.ceil((end + 1) / barBeats) * barBeats;
  }, [proj, barBeats]);

  // The same rows the timeline draws, from the same track list, so the two line up.
  const rows = useMemo(
    () => (proj ? projectRows(proj, proj.tracks, [], automation) : []),
    [proj, automation],
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
      {/* one row per lane, clips positioned by beat; a group holds none, so it reads as a plain grey band over the tracks it owns */}
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
        ) : row.kind === "automation" ? (
          // An automation lane, as a thin mauve rule: a row the timeline shows and this one skips puts every lane below it out.
          <div
            key={`auto:${row.track.id}:${row.lane.param}`}
            title={`${row.track.name} — ${row.lane.param}`}
            className="absolute inset-x-0"
            style={{ top: ri * rowH, height: rowH }}
          >
            <div className="absolute inset-x-0 top-1/2 h-px bg-[#a889b5]/60" />
          </div>
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
                // A clip open in the editor gets an amber ring.
                className={`absolute rounded-[1px] ${rowH >= 4 ? "bottom-px top-px" : "inset-y-0"} ${
                  row.track.mute ? "opacity-40" : ""
                } ${hlClip && (c.id === hlClip || c.name === hlClip) ? "outline outline-1 outline-offset-1 outline-amber-400 brightness-125" : ""}`}
                style={{
                  left: pct(c.start),
                  width: `${((c.length > 0 ? c.length : NATURAL) / totalBeats) * 100}%`,
                  minWidth: 2,
                  // An uncoloured track takes the timeline's own fallback, so the two never disagree.
                  background: `color-mix(in srgb, ${row.track.color ?? UNCOLOURED} 70%, transparent)`,
                }}
              />
            ))}
          </div>
        ),
      )}

      {/* caret: a full-height guide down the column on a beat, and on a label the whole row lit, there being no column to point at. */}
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
          {/* the caret names its ROW, and nesting plus the live lanes reorder them, so find where that row is actually drawn */}
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
});

/** The live playhead, and the ONLY thing here that knows the transport — a leaf, and translated as the element's LEFT EDGE (docs/timeline.md). */
function MinimapPlayhead({
  totalBeats,
  tempo,
}: {
  totalBeats: number;
  tempo: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Per animation frame, written straight onto the node — 50 ms is a visible step on a bar this short (docs/playhead.md).
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const beat = (seconds * (tempo || 120)) / 60;
        const pct = Math.max(0, Math.min(100, (beat / totalBeats) * 100));
        el.style.transform = `translateX(${pct}%)`;
        el.style.visibility = "visible";
      },
      [totalBeats, tempo],
    ),
  );
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-0 left-0 w-full border-playhead border-l"
      // Hidden until the first callback says where it is: the position is written to the node, so a first paint would flash it at beat 0.
      style={{ willChange: "transform", visibility: "hidden" }}
    />
  );
}
