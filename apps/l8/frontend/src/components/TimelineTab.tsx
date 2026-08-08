// TimelineTab.tsx — a keyboard-driven arrangement: one lane per track, clips positioned by
// beat, a live playhead, and a caret moved with hjkl/arrows. Only CONTINUOUS interaction
// lives here (the caret, growing the `v` rectangle, dragging a clip); every discrete action
// is a key binding naming a command, run from the shell via this component's imperative
// handle. See docs/timeline.md.

import { cn } from "@frediverse/ui/lib/utils";
import { arrayEq, useEngineState } from "@studio/engine-browser/store";
import { beatsToPosition } from "@studio/song/timecode";
import { trackLabel } from "@studio/song/trackKind";
import {
  GUTTER_DESKTOP,
  GUTTER_MOBILE,
  MARKER_COLOR,
  ROW_H,
} from "@studio/ui-timeline/lanes";
import { useHZoom, usePanScroll } from "@studio/ui-timeline/panZoom";
import {
  labelled,
  labelMinPx,
  labelStride,
  nearestTick,
  subdivideBeats,
} from "@studio/ui-waveform";
import {
  Music,
  Repeat,
  Snowflake,
  StretchVertical,
  Timer,
  Volume2,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import type { MenuCtx } from "../contextMenu";
import { blurOnClick } from "../keys";
import {
  findRow,
  HATCH,
  isCellRow,
  projectRows,
  type Row,
  type RowKey,
  type RowTarget,
  rowIndexOf,
  rowKey,
  rowTarget,
  stepRow,
} from "../rows";
import { TrackIcon, trackIcon } from "../trackIcons";
import type { WebProject, WebTrack } from "../types";
import { useIsMobile } from "../useIsMobile";
import { ClipContent } from "./ClipContent";
import type { EditTarget } from "./EditorPanel";

// Fallback beat width, used only before the pane is measured — after that the view's range fills it exactly.
const PX_PER_BEAT = 24;
// The gutter, the row height and the marker colour come from @studio/ui-timeline (see the
// import above). They were redeclared here with the same values when the package was
// extracted, which is the drift lanes.ts's own header warns about: two surfaces disagreeing
// about the gutter is a click landing one column off, read as a rounding bug and not one.
// Extra lane height when EXPANDED, so a clip can draw its content. Groups stay ROW_H — they hold no clips.
const EXPAND_EXTRA = 40;
const NATURAL = 4; // beats drawn for a length-0 clip
const VU_MIN_DB = -60; // name-header VU meter: dB mapped to an empty header fill
const VU_MAX_DB = 6; // dB mapped to a full-width header fill

// A selected label wears the caret cell's fill + outline: it IS the caret, parked on the row instead of the lane.
const LABEL_SELECTED =
  "bg-primary/25 outline outline-1 -outline-offset-1 outline-primary";

// `beat: LABEL` puts the caret on the row's label — the only position a group or generated lane can take.
export const LABEL = -1;

// A tick's weight and its number: a bar keeps its own, a beat inside one is numbered within
// the bar (5.2, 5.3…), and anything finer is a line with no number at all. At module level
// because two things now ask — the ruler and the lanes' grid — and they must read one answer.
const tickAt = (b: number, barBeats: number) => {
  const bar = Math.abs(b / barBeats - Math.round(b / barBeats)) < 1e-6;
  const onBeat = Math.abs(b - Math.round(b)) < 1e-6;
  return {
    bar,
    onBeat,
    label: bar
      ? String(Math.round(b / barBeats) + 1)
      : onBeat
        ? `${Math.floor(b / barBeats) + 1}.${Math.round(b % barBeats) + 1}`
        : "",
  };
};

/**
 * The two things on this surface that move at ENGINE frame rate, each subscribing for itself.
 *
 * They are separate components for one reason: a `useEngineState` subscription re-renders the
 * component that holds it, so whoever holds it decides how much of the screen a frame costs.
 * Held by TimelineTab, one selector re-rendered the whole arrangement ~23 times a second —
 * see docs/timeline.md for what that measured. Held here, a frame rewrites one absolutely
 * positioned div and nothing else: no lane, no clip, no ruler tick is touched.
 *
 * Everything they need to place themselves arrives as a NUMBER, so React's own bailout does
 * the rest — a parent re-render with an unchanged view window re-renders neither of them.
 */
function Playhead({
  tempo,
  beatLo,
  beatHi,
  ppb,
  left0,
  height,
}: {
  tempo: number;
  beatLo: number;
  beatHi: number;
  ppb: number;
  left0: number; // the lane's left edge — the gutter's width
  height: number;
}) {
  const playhead = useEngineState((s) => s.playhead);
  const beat = (playhead * tempo) / 60;
  // Hidden outright when the transport is outside the zoomed range, rather than pinned to an
  // edge it isn't actually at.
  if (beat < beatLo || beat > beatHi) return null;
  return (
    <div
      className="pointer-events-none absolute top-0 z-20 w-px bg-white/80"
      style={{ left: left0 + (beat - beatLo) * ppb, height }}
    />
  );
}

// dB → how much of the header the bar fills.
const vuFill = (db: number | undefined) =>
  Math.max(
    0,
    Math.min(1, ((db ?? -Infinity) - VU_MIN_DB) / (VU_MAX_DB - VU_MIN_DB)),
  ) * 100;

/**
 * One lane's meters: the output level across the name header, and — when armed — the input
 * level as a thin bar on its bottom edge.
 *
 * Selects a single number out of the frame, so the store's default `Object.is` already stops
 * a re-render when this lane's level is unchanged; a silent track costs nothing while a loud
 * one plays. The dB is rounded first, because a bar 0.4 dB different is the same bar on
 * screen and re-rendering for it would be paying for a pixel nobody can see.
 */
function LaneMeter({ index, armed }: { index: number; armed: boolean }) {
  const out = useEngineState((s) => Math.round(s.levels[index] ?? -Infinity));
  const input = useEngineState((s) =>
    armed ? Math.round(s.inputLevels[index] ?? -Infinity) : -Infinity,
  );
  return (
    <>
      {/* live VU: a faint green fill across the name header, its width the track's output
          level. Behind the label — the content spans are `relative`, so they paint over
          this absolutely-placed bar. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-emerald-500/20"
        style={{ width: `${vuFill(out)}%` }}
      />
      {/* armed input meter: a thin red bar pinned to the bottom edge, its fill the live
          input level. The faint track shows the bar's extent even at silence, so an
          armed-but-quiet input still reads as armed. */}
      {armed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-red-500/20">
          <div
            className="h-full bg-red-500"
            style={{ width: `${vuFill(input)}%` }}
          />
        </div>
      )}
    </>
  );
}

// Every tick drawn between the view's edges, from the ruler's ORIGIN rather than from the
// first visible one — the ruler and the grid both walk this, and computing it twice from one
// formula is what stops them drifting apart as you pan.
const tickBeats = (
  beatLo: number,
  lastBeat: number,
  unit: number,
): number[] => {
  const out: number[] = [];
  for (let b = Math.ceil(beatLo / unit - 1e-9) * unit; b <= lastBeat; b += unit)
    out.push(b);
  return out;
};

/**
 * The two tick layers, memoised — together the most numerous elements on the surface.
 *
 * They are a pure function of the VIEW WINDOW, and every prop here is a number, so React's
 * shallow compare settles it: a re-render of the timeline for any other reason (a caret move,
 * a poll landing, a meter changing) leaves both untouched. That matters more than their render
 * cost, which is small: they were the bulk of the DOM the profile caught React rewriting —
 * `updateProperties` was 12 % of the whole capture, and a tick's `style` object is new on every
 * render, so all three of its properties were written again each time. See docs/timeline.md.
 */
const Grid = memo(function Grid({
  beatLo,
  lastBeat,
  unit,
  barBeats,
  ppb,
  laneW,
  left0,
  top,
  height,
}: {
  beatLo: number;
  lastBeat: number;
  unit: number;
  barBeats: number;
  ppb: number;
  laneW: number;
  left0: number;
  top: number;
  height: number;
}) {
  return (
    <>
      {tickBeats(beatLo, lastBeat, unit).map((b) => {
        const left = (b - beatLo) * ppb;
        // A tick at the lane's right edge is a 1px border past the end of the box, and one
        // pixel of horizontal scroll in a view that fits its pane exactly.
        if (left >= laneW) return null;
        const { bar, onBeat } = tickAt(b, barBeats);
        return (
          <div
            key={`grid:${b}`}
            className={cn(
              "pointer-events-none absolute border-l border-dashed",
              // The ruler's three weights, one step fainter: down here they cross the
              // material rather than sitting in a header of their own.
              bar
                ? "border-border/40"
                : onBeat
                  ? "border-border/25"
                  : "border-border/10",
            )}
            style={{ left: left0 + left, top, height }}
          />
        );
      })}
    </>
  );
});

const RulerTicks = memo(function RulerTicks({
  beatLo,
  lastBeat,
  unit,
  barBeats,
  ppb,
  barStride,
}: {
  beatLo: number;
  lastBeat: number;
  unit: number;
  barBeats: number;
  ppb: number;
  barStride: number;
}) {
  return (
    <>
      {tickBeats(beatLo, lastBeat, unit).map((b) => {
        // Three weights, so the bar line still reads as the bar once beats are drawn between
        // them: a bar, a whole beat, anything finer. Strided on the tick's index from the
        // ORIGIN, or the surviving labels would change as scrolling moved the first one.
        const { bar, onBeat, label } = tickAt(b, barBeats);
        return (
          <div
            key={b}
            className={cn(
              "pointer-events-none absolute top-0 h-full border-l pl-1",
              bar
                ? "border-border/50 text-muted-foreground"
                : onBeat
                  ? "border-border/30 text-muted-foreground/60"
                  : "border-border/15",
            )}
            style={{ left: (b - beatLo) * ppb }}
          >
            {labelled(Math.round(b / unit), barStride) ? label : ""}
          </div>
        );
      })}
    </>
  );
});

interface Caret {
  row: RowKey; // identity, not an index — the orbit lanes renumber the rows
  beat: number; // >= 0 a beat cell; LABEL the row's label
}

// The `v` selection: a vim-style anchor + head, both holding a real beat (a rectangle is a region of the lane).
interface Cell {
  row: RowKey;
  beat: number;
}
interface Selection {
  anchor: Cell;
  head: Cell;
}

// Move mode: a clip picked up with `m`, pinned by track + ORIGINAL start, nudged by the keys until enter commits.
interface Move {
  trackId: string;
  clipId: string;
  origStart: number; // beats — where the ghost sits and the `from` timecode is read
  length: number; // beats (0 == natural) — the block/ghost width
  name: string;
  offset: number; // beats added to origStart; 0 the instant it's picked up
  // The lane it is over — only ever another track holding the same kind of material. The keyboard never changes it.
  toTrackId: string;
  // A pointer drag is live: it commits on release, and must not also be cancelled by the keymap's handlers.
  dragging?: boolean;
  // Released and written, waiting for the reload to show it. The clip keeps drawing where it was
  // DROPPED until the project comes back, or it would snap home for the length of a round trip
  // and jump forward again. Not modal: the keys are yours again the moment you let go.
  pending?: boolean;
}

// One zoom: the beat range and the run of rows. Rows by identity, range against the FULL list — see docs/timeline.md.
interface Viewport {
  beatStart: number;
  beatEnd: number; // inclusive
  rowFrom: RowKey;
  rowTo: RowKey;
}

// What the shell drives from the keymap (select / zoom / zoom out / reset) — the state stays here, with the rows.
export interface TimelineHandle {
  toggleSelect: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  seekToCaret: () => void;
  toggleLoop: () => void;
  startMove: () => void;
}

export function TimelineTab({
  active,
  reloadKey,
  orbit,
  setStatus,
  onEditTarget,
  onCaret,
  onView,
  onContextMenu,
  onSeek,
  onSetLoop,
  onMoveEvent,
  onResizeEvent,
  feedMove,
  feedTimecode,
  onFocusRow,
  trackControls,
  onTrackToggle,
  ref,
}: {
  active: boolean;
  reloadKey: number;
  // The live pattern lanes, polled by the shell: one poll feeds both this and the minimap, so they can't disagree.
  orbit: WebTrack[];
  setStatus: (s: string) => void;
  onEditTarget: (t: EditTarget | null) => void; // the clip under the caret, for the Editor panel
  // The caret: its position (the minimap draws it) and the track it is on (m/s act on that track by name).
  onCaret: (c: Caret & { trackId: string | null }) => void;
  // Whether a selection or zoom is live, so z / shift+z / 0 can be conditional bindings rather than dead commands.
  onView: (v: { selecting: boolean; zoomed: boolean; loop: boolean }) => void;
  // Right-click: report what is under the cursor and where, so the shell can open its menu (see contextMenu.ts).
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  // Move the transport, in seconds — the same engine seek the minimap's click uses.
  onSeek?: (seconds: number) => void;
  // Set/clear the transport loop region, in seconds (Shift+L → toggleLoop below).
  onSetLoop?: (start: number, end: number, enabled: boolean) => void;
  // Commit a move as `event move <track> <from> <to>`; a 4th arg moves lanes, which the brain re-checks its side.
  /** An edge handle was dragged: re-time the event at `fromTc` to span newStart..newEnd. */
  onResizeEvent?: (
    trackId: string,
    fromTc: string,
    newStartTc: string,
    newEndTc: string,
  ) => void;
  onMoveEvent?: (
    trackId: string,
    fromTc: string,
    toTc: string,
    toTrackId?: string,
  ) => void;
  // Present only while the command bar is filling `event move`: the drag then ANSWERS the bar
  // instead of committing, `live` on every frame and once more on release. The shell decides
  // which command that is; this only reports the numbers it already knows. See docs/timeline.md.
  feedMove?: (
    trackId: string,
    fromTc: string,
    toTc: string,
    toTrackId: string | undefined,
    live: boolean,
  ) => void;
  // Present only while the bar's OPEN field is asking for a timecode: a click on the ruler
  // answers it there and then, instead of seeking. Nothing else on the timeline changes.
  feedTimecode?: (tc: string, live: boolean) => void;
  // A header was DOUBLE-clicked: point the shell's other panes at this row. Selecting it is
  // this component's own business (the caret); following it is not — see docs/timeline.md.
  onFocusRow?: (target: RowTarget) => void;
  // Per-track mute/solo/arm by track id — the same state the graph's track nodes draw, so the two stay in lockstep.
  trackControls?: Record<string, { mute: number; solo: number; arm: number }>;
  onTrackToggle?: (id: string, control: "mute" | "solo" | "arm") => void;
  ref?: React.Ref<TimelineHandle>;
}) {
  // The ONE live value the body itself needs, and it changes on a keystroke rather than on a
  // frame. Everything else the engine sends is drawn by Playhead and LaneMeter, which
  // subscribe for themselves: this component held a `s => s` selector, and since the store
  // hands out a fresh snapshot ~20x/s, that re-rendered the entire arrangement at frame rate
  // whether or not anything in it had changed. docs/timeline.md has the profile.
  const armedIds = useEngineState((s) => s.armed, arrayEq);
  const [proj, setProj] = useState<WebProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caret, setCaret] = useState<Caret>({ row: "", beat: 0 });
  const [sel, setSel] = useState<Selection | null>(null);
  // Expanded: taller lanes showing each clip's content. A per-session view toggle, not a saved preference.
  const [expanded, setExpanded] = useState(false);
  // The name of the marker the cursor is over, shown in the header while hovering.
  const [hoverMarker, setHoverMarker] = useState<string | null>(null);
  // The zoom stack: [] is the song at rest, the last entry is what's drawn.
  const [zoom, setZoom] = useState<Viewport[]>([]);
  // The transport loop as an inclusive beat range, or null. The engine enforces the wrap; this only draws the band.
  const [loop, setLoop] = useState<{ lo: number; hi: number } | null>(null);
  // The clip being moved. A ref shadows it so the key handler reads the live value without re-binding on each nudge.
  const [move, setMove] = useState<Move | null>(null);
  const moveRef = useRef<Move | null>(move);
  moveRef.current = move;
  // Read by the pointer-drag callbacks, which are defined above both — a drop uses the same commit enter does.
  const projRef = useRef<WebProject | null>(null);
  projRef.current = proj;
  const commitMoveRef = useRef<() => void>(() => {});

  useEffect(() => {
    api
      .projectDoc()
      .then((p) => {
        setProj(p);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [reloadKey]);

  // A committed move stops being drawn once the project it wrote has come back — which is also
  // the right answer when the command FAILED: the clip returns to where the file still says it
  // is, rather than sitting at a position nothing on disk agrees with.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `proj` IS the signal — a new doc arrived.
  useEffect(() => {
    setMove((m) => (m?.pending ? null : m));
    setResize((r) => (r?.pending ? null : r));
  }, [proj]);

  const barBeats = Math.max(1, proj?.timeSigNumerator || 4);
  const nTracks = proj?.tracks.length ?? 0;
  // The song's tracks plus any live pattern lanes, and the rows they draw as (groups with members nested under).
  const allTracks = useMemo(
    () =>
      orbit.length ? [...(proj?.tracks ?? []), ...orbit] : (proj?.tracks ?? []),
    [proj, orbit],
  );
  const rows = useMemo(
    () => (proj ? projectRows(proj, allTracks) : []),
    [proj, allTracks],
  );
  const clipEnd = (c: { start: number; length: number }) =>
    c.start + (c.length > 0 ? c.length : NATURAL);
  // The song's extent in whole bars (min 4) — what the caret moves within. Pattern lanes deliberately don't extend it.
  const contentBeats = useMemo(() => {
    let end = 16;
    for (const t of proj?.tracks ?? [])
      for (const c of t.clips) end = Math.max(end, clipEnd(c));
    return Math.ceil((end + 1) / barBeats) * barBeats;
  }, [proj, barBeats]);

  // --- the zoom: which rows and which beats the view is narrowed to ----------------

  const view = zoom.length ? zoom[zoom.length - 1] : null;

  // A zoom whose rows are gone describes a view that no longer exists: pop it, a level at a time.
  useEffect(() => {
    if (!rows.length) return;
    setZoom((z) => {
      let out = z;
      while (
        out.length &&
        !(
          findRow(rows, out[out.length - 1].rowFrom) &&
          findRow(rows, out[out.length - 1].rowTo)
        )
      )
        out = out.slice(0, -1);
      return out.length === z.length ? z : out; // same array unless something popped
    });
  }, [rows]);

  // The rows on screen. Zoomed runs are contiguous, so a slice suffices. Everything downstream reads this.
  const visRows: Row[] = useMemo(() => {
    if (!view) return rows;
    const a = rowIndexOf(rows, view.rowFrom);
    const b = rowIndexOf(rows, view.rowTo);
    if (a < 0 || b < 0) return rows; // mid-pop (see above) — show everything for the frame
    return rows.slice(Math.min(a, b), Math.max(a, b) + 1);
  }, [rows, view]);

  // The caret walks every drawn row, but holds a BEAT only on rows that can carry a clip (see docs/timeline.md).
  const rowsRef = useRef(visRows);
  rowsRef.current = visRows;

  // The beat range on screen, and the only bounds the caret and selection know: the song, or the zoomed rectangle.
  const beatLo = view ? view.beatStart : 0;
  const beatHi = view ? view.beatEnd : contentBeats - 1;

  // Measure the pane so the beat range fills it exactly. Keyed on `proj` — before it loads there is no pane to observe.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Shadows the module constants below, so layout, zoom maths and playhead offset all follow one value.
  const isMobile = useIsMobile();
  const GUTTER = isMobile ? GUTTER_MOBILE : GUTTER_DESKTOP;
  const [paneW, setPaneW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPaneW(el.clientWidth));
    ro.observe(el);
    setPaneW(el.clientWidth);
    return () => ro.disconnect();
  }, [proj]);

  // Wheel zooms past fit and middle-drag pans; the gutter is the fixed name column and does not scale.
  const [zoomX, , zoomAtX] = useHZoom(scrollRef, { gutter: GUTTER }, [proj]);
  usePanScroll(scrollRef, [proj]);

  // Keep the scroll offset across a pane switch — a display:none box has no layout to hold it. See docs/timeline.md.
  const savedScroll = useRef({ left: 0, top: 0 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remember = () => {
      if (el.clientWidth)
        savedScroll.current = { left: el.scrollLeft, top: el.scrollTop };
    };
    el.addEventListener("scroll", remember, { passive: true });
    const ro = new ResizeObserver(() => {
      const { left, top } = savedScroll.current;
      if (!el.clientWidth || (!left && !top)) return;
      if (el.scrollLeft === 0 && el.scrollTop === 0) {
        el.scrollLeft = left;
        el.scrollTop = top;
      }
    });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", remember);
      ro.disconnect();
    };
  }, []);

  // Keep the caret somewhere it can actually be: rows come and go, and not every row can hold a beat.
  const clampCaret = useCallback(
    (c: Caret): Caret => {
      // Prefer the first row that can hold a BEAT — visRows[0] would open on a group header on many songs.
      const row =
        findRow(visRows, c.row) ?? visRows.find(isCellRow) ?? visRows[0];
      if (!row) return { row: "", beat: LABEL };
      // Left off the view's first beat selects the row: beatLo is that edge whether it is beat 1 or a zoom's start.
      const beat = !isCellRow(row) // a group / generated lane is label-only
        ? LABEL
        : c.beat < beatLo
          ? LABEL
          : Math.min(c.beat, beatHi);
      return { row: rowKey(row), beat };
    },
    [visRows, beatLo, beatHi],
  );

  // Settle the caret whenever the rows change or a zoom moves the walls in around it.
  useEffect(() => {
    if (visRows.length) setCaret((c) => clampCaret(c));
  }, [visRows, clampCaret]);

  const caretRow = useMemo(
    () => findRow(visRows, caret.row),
    [visRows, caret.row],
  );

  // The clip under the caret — what the Editor panel edits. A selected label is not a hovered clip, so it clears.
  const clipUnderCaret = useMemo(() => {
    if (caret.beat === LABEL || caretRow?.kind !== "track") return null;
    return (
      caretRow.track.clips.find(
        (c) =>
          caret.beat >= c.start &&
          caret.beat < c.start + (c.length > 0 ? c.length : NATURAL),
      ) ?? null
    );
  }, [caretRow, caret.beat]);
  useEffect(() => {
    if (!active) return;
    onEditTarget(
      proj && clipUnderCaret
        ? { kind: "clip", project: proj, clip: clipUnderCaret }
        : null,
    );
  }, [active, proj, clipUnderCaret, onEditTarget]);

  // What m/s aim at from here — a lane's track, a header's group, a pattern lane's GROUP. See docs/timeline.md.
  const caretTrackId = useMemo(() => {
    const target = caretRow && rowTarget(caretRow);
    return target ? target.id : null;
  }, [caretRow]);
  useEffect(() => {
    onCaret({ ...caret, trackId: caretTrackId });
  }, [caret, caretTrackId, onCaret]);

  // Click a header: the row itself is selected — the caret parked on its label, the position
  // `h` off the view's first beat already puts it in. A live rectangle is dropped, because its
  // head is somewhere else and a click that left one standing would draw two selections.
  const selectRow = useCallback((row: Row) => {
    setSel(null);
    setCaret({ row: rowKey(row), beat: LABEL });
  }, []);

  // Double-click a header: the shell points its other panes at the row. Nothing is written.
  const focusRow = useCallback(
    (row: Row) => {
      const target = rowTarget(row);
      if (target) onFocusRow?.(target);
    },
    [onFocusRow],
  );

  // The gutter is the row's handle, on all three kinds of row. Paired with `select-none` in
  // the class list: a double-click would otherwise take the track's name as a word selection
  // and leave it highlighted behind the caret's own mark.
  const gutterProps = useCallback(
    (row: Row) => ({
      onClick: () => selectRow(row),
      onDoubleClick: () => focusRow(row),
    }),
    [selectRow, focusRow],
  );

  // How a lane READS: muted, its group muted, or soloed away — mirroring withGroupMix and the engine's solo rule.
  const groupById = useMemo(
    () => new Map((proj?.groups ?? []).map((g) => [g.id, g])),
    [proj],
  );
  const effOf = useCallback(
    (t: WebTrack) => {
      const g = groupById.get(t.group);
      return { mute: t.mute || !!g?.mute, solo: t.solo || !!g?.solo };
    },
    [groupById],
  );
  // Solo is mixer-wide, so the live pattern lanes count too: a soloed one silences the authored tracks.
  const anySolo = useMemo(
    () => allTracks.some((t) => effOf(t).solo),
    [allTracks, effOf],
  );
  const silent = useCallback(
    (t: WebTrack) => {
      const e = effOf(t);
      return e.mute || (anySolo && !e.solo);
    },
    [effOf, anySolo],
  );

  // One row up/down: every row when a label is selected, only clip-holding lanes otherwise. Stays put at the ends.
  const step = useCallback(
    (c: Caret, delta: number): Caret =>
      clampCaret({
        ...c,
        row: stepRow(
          rowsRef.current,
          c.row,
          delta,
          c.beat === LABEL ? undefined : isCellRow,
        ),
      }),
    [clampCaret],
  );

  // The selection's head: unlike the caret it holds a real beat and walks EVERY row, groups and pattern lanes too.
  const clampCell = useCallback(
    (c: Cell): Cell => {
      const row = findRow(visRows, c.row) ?? visRows[0];
      if (!row) return c;
      return {
        row: rowKey(row),
        beat: Math.max(beatLo, Math.min(c.beat, beatHi)),
      };
    },
    [visRows, beatLo, beatHi],
  );

  // A ref so the key handler can branch on "is a selection live" without rebinding the listener on every head move.
  const selRef = useRef<Selection | null>(sel);
  selRef.current = sel;

  const moveHead = useCallback(
    (dBeat: number, dRow: number) =>
      setSel((s) =>
        s
          ? {
              ...s,
              head: clampCell({
                row: dRow
                  ? stepRow(rowsRef.current, s.head.row, dRow)
                  : s.head.row,
                beat: s.head.beat + dBeat,
              }),
            }
          : s,
      ),
    [clampCell],
  );

  // Nudge the pickup by `d` beats, kept inside the song. `offset` is relative to origStart, so the ghost never moves.
  const nudgeMove = useCallback(
    (d: number) =>
      setMove((m) =>
        m
          ? {
              ...m,
              offset:
                Math.max(
                  0,
                  Math.min(m.origStart + m.offset + d, contentBeats),
                ) - m.origStart,
            }
          : m,
      ),
    [contentBeats],
  );

  // --- dragging a clip with the mouse -------------------------------------------
  // The pointer half of Move mode: same state, same commitMove, and the same same-material rule on the target lane.
  const ppbRef = useRef(PX_PER_BEAT); // assigned during render, below
  const dragRef = useRef<{
    x: number;
    y: number;
    ppb: number;
    moved: boolean;
  } | null>(null);
  // Below this the gesture is a click, not a drag — same 4px the ruler's gestures use.
  const DRAG_SLOP = 4;

  // Hit-test the DOM for the lane under the cursor — rows have three heights, and a second copy would drift.
  const laneAtPoint = useCallback((cx: number, cy: number): WebTrack | null => {
    const el = document.elementFromPoint(cx, cy);
    const lane = el?.closest?.("[data-lane-track]");
    const id = lane?.getAttribute("data-lane-track");
    return id
      ? (projRef.current?.tracks.find((t) => t.id === id) ?? null)
      : null;
  }, []);

  const beginClipDrag = useCallback(
    (
      e: React.PointerEvent,
      track: WebTrack,
      c: WebProject["tracks"][0]["clips"][0],
    ) => {
      // LEFT button, the one you already have on the clip. Never a generated lane — it has no file.
      // A FROZEN lane is out too: its one clip is a render, not a placement, and there is no `clips:` entry in the
      // track's file for a move to rewrite. Its real material is still in there, waiting for the unfreeze.
      if (e.button !== 0 || track.generated || track.frozen) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        ppb: ppbRef.current,
        moved: false,
      };
      setSel(null);
      setMove({
        trackId: track.id,
        clipId: c.id,
        origStart: c.start,
        length: c.length,
        name: c.name || c.id,
        offset: 0,
        toTrackId: track.id,
        dragging: true,
      });
    },
    [],
  );

  // Resizing an event by its edge. Kept apart from the move drag: a move changes only
  // `start` and may change lane, a resize changes start AND length and never leaves the
  // lane. `edge` says which end is in hand; the other stays where it is.
  const [resize, setResize] = useState<{
    trackId: string;
    clipId: string;
    edge: "start" | "end";
    origStart: number; // beats, the placement's key — what the command addresses
    origEnd: number; // where it ended when grabbed — the ghost's right edge
    start: number;
    end: number;
    x: number; // pointer x at grab
    ppb: number;
    pending?: boolean; // released and written, still drawn until the reload — see Move.pending
  } | null>(null);
  const resizeRef = useRef<typeof resize>(null);
  resizeRef.current = resize;

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (r?.pending) return; // already written and only still drawn — a hover must not re-time it
    if (!r) return;
    // Whole beats, the same grid the move drag and the caret use.
    //
    // Measured from where the edge WAS when grabbed, never from where it is now: `d` is
    // an absolute offset from the grab point, so adding it to the live value re-applied
    // it on every pointermove and the edge ran away from the cursor in whichever
    // direction you moved. Both branches read origStart/origEnd for that reason.
    const d = Math.round((e.clientX - r.x) / r.ppb);
    // An edge may not cross the other: a zero or negative length is an event that exists
    // and plays nothing, and the command refuses it anyway.
    const next =
      r.edge === "start"
        ? {
            start: Math.max(0, Math.min(r.origEnd - 1, r.origStart + d)),
            end: r.origEnd,
          }
        : {
            start: r.origStart,
            end: Math.max(r.origStart + 1, r.origEnd + d),
          };
    if (next.start !== r.start || next.end !== r.end)
      setResize({ ...r, ...next });
  }, []);

  const commitResize = useCallback(() => {
    const r = resizeRef.current;
    if (r?.pending) return; // a second pointerup must not send the same edit twice
    if (!r || !proj) {
      setResize(null);
      return;
    }
    const num = proj.timeSigNumerator;
    const den = proj.timeSigDenominator;
    // A drag that ended where it started writes nothing — the same courtesy the move
    // drag extends, and it keeps a stray click on a handle out of the undo history.
    if (r.start === r.origStart && r.end === r.origEnd) {
      setResize(null);
      setStatus("resize cancelled — no change");
      return;
    }
    // Held until the reload, exactly as a committed move is: clearing here snapped the edge
    // back to where it was grabbed for the length of the round trip.
    setResize({ ...r, pending: true });
    onResizeEvent?.(
      r.trackId,
      beatsToPosition(r.origStart, num, den),
      beatsToPosition(r.start, num, den),
      beatsToPosition(r.end, num, den),
    );
  }, [proj, onResizeEvent, setStatus]);

  // A live prop read from pointer callbacks that must not re-bind on every frame — the same
  // shadowing commitMoveRef does, and for the same reason.
  const feedMoveRef = useRef(feedMove);
  feedMoveRef.current = feedMove;
  const feedTimecodeRef = useRef(feedTimecode);
  feedTimecodeRef.current = feedTimecode;

  // The move as `event move`'s four values. ONE place, so the frames of a live drag and its
  // release cannot disagree about which timecode is the `from` and which the `to`.
  const moveArgs = useCallback((m: Move) => {
    const p = projRef.current;
    if (!p) return null;
    const num = p.timeSigNumerator;
    const den = p.timeSigDenominator;
    return {
      trackId: m.trackId,
      fromTc: beatsToPosition(m.origStart, num, den),
      toTc: beatsToPosition(m.origStart + m.offset, num, den),
      toTrackId: m.toTrackId === m.trackId ? undefined : m.toTrackId,
    };
  }, []);

  const onClipDragMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      const m = moveRef.current;
      if (!d || !m?.dragging) return;
      // Past the slop this is a drag, not a right-click — remembered so the release can swallow the context menu.
      if (
        Math.abs(e.clientX - d.x) > DRAG_SLOP ||
        Math.abs(e.clientY - d.y) > DRAG_SLOP
      )
        d.moved = true;
      // Whole beats, the grid the caret already uses, clamped so a clip can't be dragged before the song's start.
      const offset = Math.max(
        -m.origStart,
        Math.round((e.clientX - d.x) / d.ppb),
      );
      const lane = laneAtPoint(e.clientX, e.clientY);
      const src = projRef.current?.tracks.find((t) => t.id === m.trackId);
      const toTrackId =
        lane && src && !lane.generated && lane.contentType === src.contentType
          ? lane.id
          : m.toTrackId;
      if (offset !== m.offset || toTrackId !== m.toTrackId) {
        const next = { ...m, offset, toTrackId };
        setMove(next);
        // …and if the bar is asking for this move, it reads the timecode under the pointer as
        // the drag happens. Nothing is validated: `live` says the gesture is still in hand.
        const feed = feedMoveRef.current;
        const a = feed ? moveArgs(next) : null;
        if (feed && a) feed(a.trackId, a.fromTc, a.toTc, a.toTrackId, true);
      }
    },
    [laneAtPoint, moveArgs],
  );

  const endClipDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Answering the bar is NOT committing. The line is filled and sits there waiting for enter,
    // so the drop writes nothing to disk — which is what makes the gesture safe to try.
    const feed = feedMoveRef.current;
    const m = moveRef.current;
    if (feed && m) {
      const a = moveArgs(m);
      if (a) feed(a.trackId, a.fromTc, a.toTc, a.toTrackId, false);
      setMove(null);
      setStatus("event move — enter runs it, esc drops the line");
      return;
    }
    commitMoveRef.current();
  }, [moveArgs, setStatus]);

  // Drop the clip as an `event move` between 1-based timecodes; a zero net move just cancels. See docs/timeline.md.
  const commitMove = useCallback(() => {
    const m = moveRef.current;
    if (!m || !proj) {
      setMove(null);
      return;
    }
    // A drop on another lane is a move even when the beat didn't change.
    if (Math.abs(m.offset) < 1e-6 && m.toTrackId === m.trackId) {
      setMove(null);
      setStatus("move cancelled — no change");
      return;
    }
    const num = proj.timeSigNumerator;
    const den = proj.timeSigDenominator;
    const fromTc = beatsToPosition(m.origStart, num, den);
    const toTc = beatsToPosition(m.origStart + m.offset, num, den);
    // HELD, not cleared. Clearing here drew the clip back at its old start for the whole
    // write-and-reload round trip, so a drop read as "it sprang back" and then jumped forward.
    // The effect below drops it once the project that contains the move has arrived.
    setMove({ ...m, dragging: false, pending: true });
    onMoveEvent?.(
      m.trackId,
      fromTc,
      toTc,
      m.toTrackId === m.trackId ? undefined : m.toTrackId,
    );
  }, [proj, onMoveEvent, setStatus]);
  commitMoveRef.current = commitMove;

  // Caret movement and growing the selection, and only that — every discrete action is a command bound in keys.ts.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      // Move mode is modal: keys are swallowed HARD (capture + stopImmediatePropagation), away from the shell.
      // A PENDING move is not being carried — it is already written and only still drawn, so it
      // must not swallow the keys for the length of a reload.
      if (moveRef.current && !moveRef.current.pending) {
        if (e.key === "ArrowLeft" || e.key === "j") nudgeMove(-1);
        else if (e.key === "ArrowRight" || e.key === "m") nudgeMove(1);
        else if (e.key === "Enter") commitMove();
        else if (e.key === "Escape") {
          setMove(null);
          setStatus("move cancelled");
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const selecting = !!selRef.current;
      // Escape drops the selection, and stops there. Without this it fell through to the
      // shell, which reads Escape as "back out of the fullscreen pane" — so the one key
      // everyone reaches for to undo a mistaken drag left the selection standing AND
      // threw you out of the timeline. Swallowed hard for the same reason move mode's is.
      if (selecting && e.key === "Escape") {
        const s = selRef.current;
        setSel(null);
        if (s) setCaret(clampCaret(s.head)); // the caret lands where the selection ended
        setStatus("selection cancelled");
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      let handled = true;
      // Left off beat 1 selects the label; right returns to the lane, unless the row has none (clampCaret pins it).
      if (e.key === "ArrowLeft" || e.key === "h")
        if (selecting) moveHead(-1, 0);
        else
          setCaret((c) =>
            clampCaret({ ...c, beat: Math.max(LABEL, c.beat - 1) }),
          );
      else if (e.key === "ArrowRight" || e.key === "l")
        if (selecting) moveHead(1, 0);
        else setCaret((c) => clampCaret({ ...c, beat: c.beat + 1 }));
      // Up/down walk the rows: all of them with a label selected, only beat-holding lanes when in the lane.
      else if (e.key === "ArrowUp" || e.key === "k")
        if (selecting) moveHead(0, -1);
        else setCaret((c) => step(c, -1));
      else if (e.key === "ArrowDown" || e.key === "j")
        if (selecting) moveHead(0, 1);
        else setCaret((c) => step(c, 1));
      else handled = false;
      if (handled) e.preventDefault();
    };
    // Capture phase, so move mode's enter/esc are intercepted before the shell's bubble-phase listener sees them.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, clampCaret, step, moveHead, nudgeMove, commitMove, setStatus]);

  // --- what the shell's select/zoom commands drive ---------------------------------

  useImperativeHandle(
    ref,
    (): TimelineHandle => ({
      // v: caret ⇄ rectangle. From a label it starts at the view's first beat — a label is not a position in the lane.
      toggleSelect: () => {
        const s = selRef.current;
        if (s) {
          setSel(null);
          setCaret(clampCaret(s.head));
          return;
        }
        if (!caretRow) return;
        const at = clampCell({
          row: caret.row,
          beat: caret.beat === LABEL ? beatLo : caret.beat,
        });
        setSel({ anchor: at, head: at });
      },
      // z: the rectangle becomes the view and is consumed — what you framed IS the timeline now.
      zoomIn: () => {
        const s = selRef.current;
        if (!s) {
          setStatus("no selection to zoom — press v first");
          return;
        }
        const a = rowIndexOf(visRows, s.anchor.row);
        const b = rowIndexOf(visRows, s.head.row);
        if (a < 0 || b < 0) return;
        setZoom((z) => [
          ...z,
          {
            beatStart: Math.min(s.anchor.beat, s.head.beat),
            beatEnd: Math.max(s.anchor.beat, s.head.beat),
            rowFrom: rowKey(visRows[Math.min(a, b)]),
            rowTo: rowKey(visRows[Math.max(a, b)]),
          },
        ]);
        setSel(null);
      },
      // shift+z: back out one level. A selection belongs to the view it was drawn in, so leaving that view drops it.
      zoomOut: () => {
        setSel(null);
        setZoom((z) => z.slice(0, -1));
      },
      // 0: all the way back to the song.
      zoomReset: () => {
        setSel(null);
        setZoom([]);
      },
      // t: seek the transport to the caret's beat. On a label there is nowhere to send it, so the key goes quiet.
      seekToCaret: () => {
        if (!proj || caret.beat === LABEL) return;
        onSeek?.((caret.beat * 60) / proj.tempo);
      },
      // shift+L: the selection becomes the loop region, spanning [lo, hi+1) so the last selected cell is inside it.
      toggleLoop: () => {
        const s = selRef.current;
        if (s && proj) {
          const lo = Math.min(s.anchor.beat, s.head.beat);
          const hi = Math.max(s.anchor.beat, s.head.beat);
          setLoop({ lo, hi });
          setSel(null);
          onSetLoop?.(
            (lo * 60) / proj.tempo,
            ((hi + 1) * 60) / proj.tempo,
            true,
          );
          return;
        }
        if (loop) {
          setLoop(null);
          onSetLoop?.(0, 0, false);
        }
      },
      // m on a clip: pick up the placement under the caret. Cancels any selection — the arrows can only drive one mode.
      startMove: () => {
        if (moveRef.current && !moveRef.current.pending) return; // already carrying one
        if (!caretRow || caretRow.kind !== "track" || caret.beat === LABEL)
          return;
        // A generated lane's clips are the scheduler's look-ahead, backed by no file — there is no `start:` to rewrite.
        if (caretRow.track.generated) return;
        const c = clipUnderCaret;
        if (!c) return;
        setSel(null);
        setMove({
          trackId: caretRow.track.id,
          clipId: c.id,
          origStart: c.start,
          length: c.length,
          name: c.name || c.id,
          offset: 0,
          toTrackId: caretRow.track.id,
        });
        setStatus(
          `moving ${c.name || c.id} — ←/→ or j/m nudge · enter commit · esc cancel`,
        );
      },
    }),
    [
      caret,
      caretRow,
      clampCaret,
      clampCell,
      beatLo,
      visRows,
      setStatus,
      proj,
      onSeek,
      loop,
      onSetLoop,
      clipUnderCaret,
    ],
  );

  useEffect(
    () => onView({ selecting: !!sel, zoomed: zoom.length > 0, loop: !!loop }),
    [sel, zoom, loop, onView],
  );

  // Leaving the tab drops the pickup, rather than stranding a move whose keys no longer reach it.
  useEffect(() => {
    if (!active) setMove(null);
  }, [active]);

  // The playhead does NOT touch the caret. They are two independent positions — where the
  // transport is, and where you are working — and the caret only ever moves because you moved
  // it. `t` still sends the transport to the caret; nothing sends the caret anywhere.
  // See docs/timeline.md.

  // The rectangle in on-screen rows, normalised so anchor-first and head-first draw the same box.
  const selBox = useMemo(() => {
    if (!sel) return null;
    const a = rowIndexOf(visRows, sel.anchor.row);
    const b = rowIndexOf(visRows, sel.head.row);
    if (a < 0 || b < 0) return null;
    return {
      rowLo: Math.min(a, b),
      rowHi: Math.max(a, b),
      beatLo: Math.min(sel.anchor.beat, sel.head.beat),
      beatHi: Math.max(sel.anchor.beat, sel.head.beat),
    };
  }, [sel, visRows]);

  useEffect(() => {
    if (!active) return;
    // Move mode owns the status line: where the clip started, where it sits now, and how to finish.
    if (move && proj) {
      const num = proj.timeSigNumerator;
      const den = proj.timeSigDenominator;
      const from = beatsToPosition(move.origStart, num, den);
      const to = beatsToPosition(move.origStart + move.offset, num, den);
      setStatus(
        `moving ${move.name}: ${from} → ${to} — ←/→ or j/m nudge · enter commit · esc cancel`,
      );
      return;
    }
    // Same for a resize — a drag with no numbers is a guess, and the span is the whole
    // point of the gesture.
    if (resize && proj) {
      const num = proj.timeSigNumerator;
      const den = proj.timeSigDenominator;
      setStatus(
        `resizing: ${beatsToPosition(resize.start, num, den)} → ${beatsToPosition(resize.end, num, den)} (${resize.end - resize.start} beats) — release to commit`,
      );
      return;
    }
    // A zoom is a mode you can forget you are in, so say so on every line and name the way out.
    const z = zoom.length
      ? ` · zoom ${zoom.length}: bars ${Math.floor(beatLo / barBeats) + 1}–${Math.floor(beatHi / barBeats) + 1}, ${visRows.length} rows (shift+z out · 0 reset)`
      : "";
    if (selBox) {
      setStatus(
        `selection: ${selBox.beatHi - selBox.beatLo + 1} beats × ${selBox.rowHi - selBox.rowLo + 1} rows — z zooms in · v cancels${z}`,
      );
      return;
    }
    if (!caretRow) {
      setStatus("");
      return;
    }
    if (caret.beat !== LABEL) {
      const name = caretRow.kind === "track" ? caretRow.track.name : "";
      setStatus(`caret: ${name}, beat ${caret.beat + 1}`);
      return;
    }
    // A label says what m/s will act on — on a pattern lane that is its group, so the redirect doesn't look like a miss.
    if (caretRow.kind === "group")
      setStatus(
        `selected: group ${caretRow.group.name} — m/s act on its members`,
      );
    else if (caretRow.track.generated)
      setStatus(
        caretTrackId
          ? `selected: ${caretRow.track.name} (live) — m/s act on group ${caretTrackId}`
          : `selected: ${caretRow.track.name} (live) — no group to mute`,
      );
    else setStatus(`selected: track ${caretRow.track.name}`);
  }, [
    active,
    caret.beat,
    caretRow,
    caretTrackId,
    setStatus,
    // The readout also reflects the selection and zoom, which move neither the caret nor caretRow.
    selBox,
    zoom,
    beatLo,
    beatHi,
    barBeats,
    visRows,
    // Resize mode does too, and its numbers change on every frame of the drag.
    resize,
    // Move mode takes over the readout, so a pickup / nudge / drop must refresh it.
    move,
    proj,
  ]);

  if (error)
    return (
      <div className="p-4 text-sm text-red-400">
        timeline unavailable — {error}
      </div>
    );
  if (!proj)
    return <div className="p-4 text-sm text-muted-foreground">loading…</div>;

  // Drawing extent: the view's beat range fills the pane exactly, so it never scrolls. See docs/timeline.md.
  const availW = Math.max(0, paneW - GUTTER);
  const spanBeats = beatHi - beatLo + 1; // contentBeats when unzoomed
  // zoomX ≥ 1 grows the lane past the pane so it can be panned; at 1 it fits exactly.
  const ppb = availW > 0 ? (availW / spanBeats) * zoomX : PX_PER_BEAT;
  const laneW = availW > 0 ? availW * zoomX : spanBeats * PX_PER_BEAT;
  // Where a beat sits. The ONE place the zoom offset is applied, so nothing positioned can drift out of step.
  ppbRef.current = ppb; // the drag reads this on pointerdown (see beginClipDrag)
  const x = (beat: number) => (beat - beatLo) * ppb;
  // The last beat drawn: the zoom's end, or the song's rounded-up extent.
  const lastBeat = view ? beatHi : contentBeats;
  // The ruler's unit: a bar while a bar fits, then its beats, then halves of a beat as the
  // zoom opens up (see ticks.ts). The GRID follows the music, so what you snap to and what
  // you see are the same thing at every zoom.
  const unit = subdivideBeats(barBeats, ppb);
  // The drawn ticks, for the gestures that SNAP to one — the ruler's click-to-seek and its
  // right-click "add marker here". Grid and RulerTicks build the same list from the same
  // helper rather than taking it as a prop: an array would be a new identity on every render
  // and would defeat the memo that keeps them off the frame path.
  const bars = tickBeats(beatLo, lastBeat, unit);
  // The widest number this ruler CAN print — the last bar's, carrying a beat once beats are
  // drawn. Taken from the ruler's END rather than the bars on screen: on those, panning past
  // bar 10 and again past bar 100 would re-thin every label under the cursor.
  const lastBarNo = Math.floor(Math.max(lastBeat, 0) / barBeats) + 1;
  const widestLabel =
    unit < barBeats
      ? `${lastBarNo}.${Math.round(barBeats)}`
      : String(lastBarNo);
  // How many COLUMNS per printed number: 1 while they fit, then 2, 4, 8… as the zoom
  // closes. Measured on the drawn unit, which is what a column now is, against the room the
  // widest label actually needs — see @studio/ui-waveform's docs/ticks.md.
  const barStride = labelStride(unit * ppb, labelMinPx(widestLabel));

  // Markers inside the visible range, drawn in the ruler; num/den turn a right-click beat into a timecode.
  const tsNum = proj.timeSigNumerator;
  const tsDen = proj.timeSigDenominator;
  const visMarkers = (proj.markers ?? []).filter(
    (mk) => mk.beat >= beatLo && mk.beat <= lastBeat,
  );

  // The rectangle's slice on one row: drawn per row so it clips with the lane and the row's dimming reads through.
  const selSlice = (b: { beatLo: number; beatHi: number }) => (
    <div
      className="pointer-events-none absolute top-0 h-full bg-primary/25 outline outline-1 -outline-offset-1 outline-primary"
      style={{ left: x(b.beatLo), width: (b.beatHi - b.beatLo + 1) * ppb }}
    />
  );

  // Lane height (taller when expanded, ROW_H for groups); the playhead spans the ruler plus every row, so sum them.
  const rowH = expanded ? ROW_H + EXPAND_EXTRA : ROW_H;
  const contentH =
    ROW_H +
    visRows.reduce((h, r) => h + (r.kind === "group" ? ROW_H : rowH), 0);

  return (
    // min-w-0: without it the fixed-width lane sets this flex child's min width and the fit-to-pane scale ratchets.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 truncate">
          {proj.name} · {Math.round(proj.tempo)} bpm · {proj.timeSigNumerator}/
          {proj.timeSigDenominator} · {nTracks} tracks —{" "}
          <span className="text-foreground">hjkl/arrows</span> move ·{" "}
          <span className="text-foreground">←</span> at beat 1 selects the row ·
          space play/pause · enter rewind ·{" "}
          <span className="text-foreground">t</span> playhead to caret ·{" "}
          <span className="text-foreground">e</span> edit clip ·{" "}
          <span className="text-foreground">m</span> move clip / mute ·{" "}
          <span className="text-foreground">s</span> solo ·{" "}
          <span className="text-foreground">r</span> rec ·{" "}
          <span className="text-foreground">v</span> select ·{" "}
          <span className="text-foreground">z</span> zoom in ·{" "}
          <span className="text-foreground">Z</span> out ·{" "}
          <span className="text-foreground">0</span> reset ·{" "}
          <span className="text-foreground">⇧L</span> loop
        </div>
        {/* The hovered marker's name — the timeline header is where a marker labels
            itself, so it stays readable however zoomed the ruler is. */}
        {hoverMarker && (
          <span
            className="shrink-0 truncate font-semibold"
            style={{ color: MARKER_COLOR, maxWidth: "18rem" }}
            title={hoverMarker}
          >
            ◆ {hoverMarker}
          </span>
        )}
        {/* Expand: taller lanes that reveal each clip's waveform / notes. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-pressed={expanded}
          title={
            expanded
              ? "collapse lanes"
              : "expand lanes to show clip contents (waveforms / notes)"
          }
          className={cn(
            "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground",
            expanded && "bg-accent text-foreground",
          )}
        >
          <StretchVertical className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div
          style={{ width: GUTTER + laneW }}
          className="relative select-none font-mono text-xs"
        >
          {/* The GRID: every tick the ruler drew, continued down the lanes as a dashed
              rule, so where a clip falls against the beat is readable where the clip is
              and not only in the header. Same `tickBeats`, same view window, so the two
              cannot drift.
              Dashed because the solid vertical lines here already mean something — the
              playhead, a marker — and a third would compete with them.
              FIRST in the wrapper on purpose: positioned siblings paint in tree order, so
              everything a lane holds draws over this rather than being crossed out by it. */}
          <Grid
            beatLo={beatLo}
            lastBeat={lastBeat}
            unit={unit}
            barBeats={barBeats}
            ppb={ppb}
            laneW={laneW}
            left0={GUTTER}
            top={ROW_H} // below the ruler, which draws its own solid tick
            height={contentH - ROW_H}
          />
          {/* ruler */}
          <div
            className="sticky top-0 z-10 flex bg-background"
            style={{ height: ROW_H }}
          >
            <div
              style={{ width: GUTTER }}
              className="shrink-0 border-r border-border"
            />
            {/* The ruler is both the transport scrubber and a time-range selector. A plain
                CLICK moves the playhead to the nearest DRAWN tick, and moves nothing else —
                the caret stays where you left it. A DRAG sweeps a selection over the dragged
                beat range across ALL tracks — the same rectangle `v` builds, so z / Shift+L
                then act on it. Beat = the view's start + pixels/ppb; the selection snaps to
                whole-beat cells, which is coarser than the ruler's unit on purpose. */}
            <div
              className="relative cursor-pointer overflow-hidden"
              style={{ width: laneW }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                if (!visRows.length) return;
                const el = e.currentTarget;
                const rect = el.getBoundingClientRect();
                const startX = e.clientX;
                const startY = e.clientY;
                const cellAt = (cx: number) =>
                  Math.max(
                    beatLo,
                    Math.min(
                      beatHi,
                      Math.floor(beatLo + (cx - rect.left) / ppb),
                    ),
                  );
                const startBeat = cellAt(startX);
                const firstRow = rowKey(visRows[0]);
                const lastRow = rowKey(visRows[visRows.length - 1]);
                // 0 = undecided, 1 = horizontal select, -1 = vertical zoom
                let gesture: 0 | 1 | -1 = 0;
                let dragged = false;
                const zoomStart = zoomX;
                const GESTURE_SLOP = 4; // px before committing to a gesture
                const onMove = (ev: MouseEvent) => {
                  const dx = ev.clientX - startX;
                  const dy = ev.clientY - startY;
                  if (gesture === 0) {
                    if (
                      Math.abs(dx) < GESTURE_SLOP &&
                      Math.abs(dy) < GESTURE_SLOP
                    )
                      return;
                    gesture = Math.abs(dy) > Math.abs(dx) ? -1 : 1;
                    if (gesture === -1) el.style.cursor = "ns-resize";
                  }
                  if (gesture === -1) {
                    // Vertical drag → zoom, 1.005 per px: ~1.16× at 30px, precise near the start and exponential at distance.
                    const next = Math.max(
                      1,
                      Math.min(32, zoomStart * 1.005 ** -dy),
                    );
                    // Anchor: keep the beat under the cursor fixed after the width change.
                    // Through the package rather than by hand — the copy that used to live
                    // here set scrollLeft immediately, so it was clamped by the OLD
                    // scrollWidth and the anchored beat drifted. See useHZoom's `zoomAt`.
                    zoomAtX(next, startX);
                  } else {
                    // Horizontal drag → selection
                    if (!dragged && Math.abs(dx) <= GESTURE_SLOP) return;
                    dragged = true;
                    setSel({
                      anchor: { row: firstRow, beat: startBeat },
                      head: { row: lastRow, beat: cellAt(ev.clientX) },
                    });
                  }
                };
                const onUp = () => {
                  window.removeEventListener("mousemove", onMove);
                  window.removeEventListener("mouseup", onUp);
                  el.style.cursor = "";
                  if (gesture === -1) return; // zoom gesture — nothing to undo
                  if (dragged) return; // selection stays
                  setSel(null); // plain click deselects and seeks
                  // Snapped to the nearest tick the ruler DREW: you aimed at a line, not at
                  // a pixel. `bars` is that list, so the grid you see and the positions you
                  // can land on cannot disagree — and since the drawn unit follows the zoom,
                  // opening the view up is how you reach a finer one.
                  const raw = Math.max(0, beatLo + (startX - rect.left) / ppb);
                  const beat = nearestTick(bars, raw) ?? raw;
                  // If the bar is asking for a timecode, the click ANSWERS it and the
                  // transport stays put: answering is not acting, the same rule the clip
                  // drag follows. Only a click — a drag on the ruler is still a selection.
                  if (feedTimecodeRef.current) {
                    feedTimecodeRef.current(
                      beatsToPosition(beat, tsNum, tsDen),
                      false,
                    );
                    return;
                  }
                  onSeek?.((beat * 60) / proj.tempo);
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
                e.preventDefault();
              }}
              onContextMenu={(e) => {
                // Right-click the ruler → "add marker here", pre-writing `marker new <tc> `.
                // HERE is where you right-clicked, snapped to the nearest DRAWN tick — the
                // same rule, off the same `bars`, that a left-click seek uses. So the two
                // buttons agree about where a point on the ruler is, and a marker can only
                // land on a line you can see. See docs/timeline.md.
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const raw = Math.max(0, beatLo + (e.clientX - rect.left) / ppb);
                const at = nearestTick(bars, raw) ?? raw;
                onContextMenu?.(
                  {
                    kind: "marker-add",
                    tc: beatsToPosition(at, tsNum, tsDen),
                  },
                  e.clientX,
                  e.clientY,
                );
              }}
            >
              {/* The RULES always draw; only the NUMBERS thin out, by powers of two, once
                  a bar is narrower than a label (see ticks.ts — the same rule the
                  waveform's ruler uses, so the two agree when stacked in the clip
                  editor). Strided on the bar's own index, not its position in `bars`, or
                  the surviving labels would change as scrolling moved the first one. */}
              <RulerTicks
                beatLo={beatLo}
                lastBeat={lastBeat}
                unit={unit}
                barBeats={barBeats}
                ppb={ppb}
                barStride={barStride}
              />
              {/* The transport loop region, over its bar range. `overflow-hidden` above
                  clips it when it runs past the view, same as the bar markers. The engine
                  does the actual wrapping; this just shows what's looping. */}
              {loop && (
                <div
                  className="pointer-events-none absolute top-0 z-10 h-full border-x-2 border-amber-400 bg-amber-400/20"
                  style={{
                    left: x(loop.lo),
                    width: (loop.hi + 1 - loop.lo) * ppb,
                  }}
                  title="loop region — Shift+L to clear"
                />
              )}
              {/* Marker handles: a diamond flag at the top of each marker line, sitting
                  in the ruler (the timeline "header"). Hovering shows the name up top;
                  right-clicking offers to delete it. The full line is drawn below. */}
              {visMarkers.map((mk) => (
                <div
                  key={mk.tc}
                  className="absolute top-0 z-20 h-full -translate-x-1/2 cursor-pointer"
                  style={{ left: x(mk.beat), width: 12 }}
                  title={mk.name}
                  onMouseEnter={() => setHoverMarker(mk.name)}
                  onMouseLeave={() =>
                    setHoverMarker((n) => (n === mk.name ? null : n))
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation(); // don't also fire the ruler's "add marker"
                    onContextMenu?.(
                      { kind: "marker", name: mk.name },
                      e.clientX,
                      e.clientY,
                    );
                  }}
                >
                  <div
                    className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rotate-45"
                    style={{ background: MARKER_COLOR }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* lanes — group headers with their members nested under them, then any
              live Strudel orbit lanes (which nest too, when their group owns the
              algo/ pattern that streams them) */}
          {visRows.map((row, ri) => {
            // Is this the caret's row, with its LABEL selected? The gutter wears the caret's own marks, because it IS the caret.
            const onRow = rowKey(row) === caret.row;
            const labelled = onRow && caret.beat === LABEL;
            // Inside the `v` rectangle? The gutter marks it too, so a rectangle reads as covering whole lanes.
            const inSel = !!selBox && ri >= selBox.rowLo && ri <= selBox.rowHi;

            // A group holds no material: a grey band naming what is below it. Its label still takes the caret, for mute/solo.
            if (row.kind === "group")
              return (
                <div
                  key={`group:${row.group.id}`}
                  className={cn(
                    "flex border-b border-border/40",
                    // A group dims on its own flag only: with no lane of its own, the mixer-wide solo rule doesn't reach the header.
                    row.group.mute && "opacity-50",
                  )}
                  style={{ height: ROW_H }}
                  // Right-click a group header → its mute/solo commands.
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu?.(
                      { kind: "group", id: row.group.id },
                      e.clientX,
                      e.clientY,
                    );
                  }}
                >
                  <div
                    style={{ width: GUTTER }}
                    {...gutterProps(row)}
                    className={cn(
                      "flex shrink-0 cursor-pointer select-none items-center gap-1 border-r border-border bg-muted/60 px-2",
                      inSel && "bg-primary/20",
                      labelled && LABEL_SELECTED,
                    )}
                  >
                    {row.group.color && (
                      <span
                        className="size-2 shrink-0 rounded-sm"
                        style={{ background: row.group.color }}
                      />
                    )}
                    <span
                      className={cn(
                        "truncate font-semibold",
                        row.group.solo && "text-amber-400",
                      )}
                      title={`${row.group.name} — a group; holds no clips of its own`}
                    >
                      {/* Stripped like a track row's: a group can pin its position too,
                          and the full name stays in the title. */}
                      {trackLabel(row.group.name)}
                    </span>
                  </div>
                  <div
                    className="relative overflow-hidden bg-muted/60"
                    style={{ width: laneW }}
                  >
                    {inSel && selBox && selSlice(selBox)}
                  </div>
                </div>
              );

            const { track: t, index: ti } = row;
            const eff = effOf(t);
            const armed = armedIds.includes(t.id);
            // M/S/A states: the graph's live trackControls when available, else the doc's own values. Arm is always the engine's.
            const ctl = trackControls?.[t.id];
            const msa: [string, "mute" | "solo" | "arm", boolean, string][] = [
              [
                "M",
                "mute",
                ctl ? ctl.mute === 1 : !!t.mute,
                "bg-orange-500 text-white",
              ],
              [
                "S",
                "solo",
                ctl ? ctl.solo === 1 : !!eff.solo,
                "bg-amber-400 text-black",
              ],
              ["A", "arm", armed, "bg-red-500 text-white"],
            ];
            return (
              <div
                key={t.id}
                className={cn(
                  "flex border-b border-border/40",
                  // Dimmed == not audible: muted itself, muted by its group, or silenced because something else is soloed.
                  silent(t) && "opacity-50",
                )}
                style={{ height: rowH }}
                // Right-click the lane or gutter → the track's commands. A clip stops this so its own menu wins.
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContextMenu?.(
                    { kind: "track", id: t.id },
                    e.clientX,
                    e.clientY,
                  );
                }}
              >
                <div
                  style={{ width: GUTTER }}
                  {...gutterProps(row)}
                  className={cn(
                    "relative flex shrink-0 cursor-pointer select-none items-center gap-1 overflow-hidden border-r border-border px-2",
                    // On the row: a faint tint. Label selected: the full caret mark.
                    onRow && !labelled && "bg-primary/10",
                    inSel && "bg-primary/20",
                    labelled && LABEL_SELECTED,
                  )}
                >
                  {/* Both live meters, subscribing for themselves — see LaneMeter. */}
                  <LaneMeter index={ti} armed={armed} />
                  {/* The instrument its name's prefix asks for ("ge.lead" → a strat),
                      painted the track's own colour — it carries the identity the
                      separate swatch used to, in the space the row index used to take.
                      An undeclared track gets a question mark, so the column still
                      lines every name up. */}
                  <span
                    // The row shows the label alone, so the full name — the track's id and filename — has to be reachable here.
                    title={[
                      t.name,
                      trackIcon(t.name)?.label,
                      armed && "record-armed; records on play",
                      t.frozen &&
                        "frozen: playing a render of its modules — gain, pan and sends still work; run `track freeze` again to edit it",
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                    className={cn(
                      "relative flex min-w-0 flex-1 items-center gap-1 truncate",
                      row.grouped && "pl-3",
                      // Armed red, soloed yellow. A ternary, not two classes: both can be true, and armed is about to write to disk.
                      armed ? "text-red-400" : eff.solo && "text-amber-400",
                    )}
                  >
                    <TrackIcon
                      name={t.name}
                      color={t.color || undefined}
                      // A coloured icon is the track's identity and holds full strength; an uncoloured one is decoration and sits back.
                      className={cn("shrink-0", !t.color && "opacity-70")}
                    />
                    {/* The label alone: the position is already said by where the row
                        sits, and the instrument by the icon left of it. Repeating
                        "3.ge." in the text spends the gutter's width on what the row
                        has just shown you. */}
                    <span className="truncate">{trackLabel(t.name)}</span>
                    {/* Frozen: the lane plays a render, so nothing on it is editable and its modules are asleep.
                        Beside the name rather than among the m/s/a buttons — those toggle, and this one reports. */}
                    {t.frozen && (
                      <Snowflake
                        className="h-3 w-3 shrink-0 text-sky-400"
                        aria-label="frozen"
                      />
                    )}
                  </span>
                  {/* [m]ute / [s]olo / [a]rm — the same controls the chains graph's track
                      nodes carry. stopPropagation so a tap toggles without also moving
                      the caret / opening the track menu. */}
                  {onTrackToggle && (
                    <div className="relative flex shrink-0 items-center gap-0.5">
                      {msa.map(([label, control, on, onCls]) => (
                        <button
                          key={control}
                          title={`${control} ${t.name}`}
                          aria-label={`${control} ${t.name}`}
                          aria-pressed={on}
                          onPointerDown={(e) => e.stopPropagation()}
                          // dblclick is its own event and bubbles past the click handler's stop —
                          // without this, two fast mutes would also send the panes after the row.
                          onDoubleClick={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTrackToggle(t.id, control);
                            // Or the next Space re-toggles this button instead of rolling the transport — see blurOnClick.
                            blurOnClick(e);
                          }}
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold leading-none",
                            on
                              ? onCls
                              : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {/* overflow-hidden because a zoom puts the out-of-view clips at
                    negative offsets: without it they'd spill across the gutter. */}
                <div
                  // Hit-tested by a clip drag (laneAtPoint), rather than re-deriving row geometry there.
                  data-lane-track={t.id}
                  className={cn(
                    "relative overflow-hidden",
                    // The lane a dragged clip would land on, while it is a legal target.
                    move?.dragging &&
                      move.toTrackId === t.id &&
                      move.trackId !== t.id &&
                      "bg-primary/10 outline outline-1 outline-primary/60",
                  )}
                  style={{ width: laneW }}
                >
                  {/* frozen: a cold wash over the whole lane, under everything else, so the render still reads as a
                      clip while the lane reads as untouchable. pointer-events-none — the caret and the track's own
                      context menu (which is how you unfreeze) must still work; what's blocked is editing, and that
                      is blocked at the drag and the clip menu, where the mistake would actually be made. */}
                  {t.frozen && (
                    <div className="pointer-events-none absolute inset-0 bg-sky-400/10" />
                  )}
                  {/* record-armed: the whole lane goes red. Bottom of the stack, so
                    the VU, the caret and the clips all still read on top of it.
                    Comes from the engine's state frame, not the project — arming is
                    session state and is in no file (see keys.ts `r`). */}
                  {armed && (
                    <div className="pointer-events-none absolute inset-0 bg-red-600/30" />
                  )}
                  {/* caret cell — gone while the label is selected (the caret is on
                      the row, not in the lane) and while a rectangle is being drawn
                      (the rectangle IS the caret then, with two ends) */}
                  {onRow && !labelled && !selBox && (
                    <div
                      className="absolute top-0 h-full bg-primary/25 outline outline-1 outline-primary"
                      style={{ left: x(caret.beat), width: ppb }}
                    />
                  )}
                  {inSel && selBox && selSlice(selBox)}
                  {/* A generated lane holds no clips of its own: its material is
                    streamed from the group's algo/ pattern, and the clips it carries
                    are the scheduler's look-ahead, rewritten every tick. Drawing them
                    would show flickering modules you can't select or edit — so hatch
                    the lane instead, marking it as never yours to fill. */}
                  {t.generated ? (
                    <div
                      title={`${t.name} — generated by an algo pattern; can't hold clips`}
                      className="pointer-events-none absolute inset-0 text-muted-foreground/30"
                      style={{ backgroundImage: HATCH }}
                    />
                  ) : (
                    <>
                      {/* The move ghost: the outline the clip left behind, where it was
                          picked up. Only on the lane that holds it, and gone the instant
                          the move commits or cancels. */}
                      {move && move.trackId === t.id && (
                        <div
                          className="pointer-events-none absolute top-1 h-[calc(100%-8px)] rounded border border-dashed border-primary/70 bg-primary/5"
                          style={{
                            left: x(move.origStart),
                            width: Math.max(
                              ppb,
                              (move.length > 0 ? move.length : NATURAL) * ppb,
                            ),
                          }}
                        />
                      )}
                      {/* The resize ghost: where the event stood when its edge was
                          grabbed. Same outline as the move ghost — one gesture language
                          for "here is what you are changing from". */}
                      {resize && resize.trackId === t.id && (
                        <div
                          className="pointer-events-none absolute top-1 h-[calc(100%-8px)] rounded border border-dashed border-primary/70 bg-primary/5"
                          style={{
                            left: x(resize.origStart),
                            width: Math.max(
                              ppb,
                              (resize.origEnd - resize.origStart) * ppb,
                            ),
                          }}
                        />
                      )}
                      {t.clips.map((c, i) => {
                        const w = (c.length > 0 ? c.length : NATURAL) * ppb;
                        // A clip whose content loops to fill its length: flagged, so the repeats aren't mistaken for one long take.
                        const looping = (c.loopEnd ?? 0) > (c.loopStart ?? 0);
                        // A time-stretched clip plays back at an altered rate — flag it with a countdown-timer icon.
                        const stretched = !!c.warped;
                        // Is THIS placement the one being moved? Pinned by track + original start, since an id can sit at several beats.
                        const moving =
                          !!move &&
                          move.trackId === t.id &&
                          c.id === move.clipId &&
                          Math.abs(c.start - move.origStart) < 1e-6;
                        // Is THIS placement the one being resized? Same pinning as the move.
                        const resizing =
                          !!resize &&
                          resize.trackId === t.id &&
                          c.id === resize.clipId &&
                          Math.abs(c.start - resize.origStart) < 1e-6;
                        const drawStart = resizing
                          ? resize.start
                          : moving
                            ? move.origStart + move.offset
                            : c.start;
                        // Dragging either edge changes the WIDTH too, unlike a move.
                        const drawW = resizing
                          ? (resize.end - resize.start) * ppb
                          : w;
                        return (
                          <div
                            // A track may place the same clip ref twice, so the id alone collides — key by placement, id + index.
                            key={`${c.id}-${i}`}
                            title={`${c.name} (${c.type})${looping ? " · looping" : ""}${stretched ? " · stretched" : ""} — drag to move`}
                            // Drag to move: along the lane, or onto one holding the same material. Nothing is written until release.
                            onPointerDown={(e) => beginClipDrag(e, t, c)}
                            onPointerMove={onClipDragMove}
                            onPointerUp={endClipDrag}
                            onPointerCancel={endClipDrag}
                            // Right-click a clip → the clip's own commands; stop the event so the lane's track menu doesn't also fire.
                            onContextMenu={(e) => {
                              e.preventDefault();
                              // A frozen lane's clip is a render, so none of a clip's commands apply to it. The event
                              // is NOT stopped here, so the lane's own track menu opens instead — which is where
                              // "unfreeze" lives, and the only thing worth offering on it.
                              if (t.frozen) return;
                              e.stopPropagation();
                              onContextMenu?.(
                                {
                                  kind: "clip",
                                  id: c.id,
                                  midi: c.type === "midi",
                                  // Where this placement SITS, so the menu can offer `event remove` — the same pair the move drag commits with.
                                  track: t.id,
                                  tc: beatsToPosition(
                                    c.start,
                                    proj.timeSigNumerator,
                                    proj.timeSigDenominator,
                                  ),
                                },
                                e.clientX,
                                e.clientY,
                              );
                            }}
                            className={cn(
                              "absolute top-1 flex h-[calc(100%-8px)] cursor-grab overflow-hidden rounded px-1 text-[10px] active:cursor-grabbing",
                              // Disabled: still placed, still readable, plainly off. Not
                              // hidden — an event you can't see is a deleted one.
                              c.disabled &&
                                "opacity-40 saturate-0 outline-dashed outline-1 outline-muted-foreground",
                              // Expanded: name on top, content filling the rest. Collapsed: the name centred in the short block as before.
                              expanded ? "flex-col" : "items-center",
                              // The type default only stands where no track colour is authored — a coloured track owns its clips' fill.
                              !t.color &&
                                (c.type === "midi"
                                  ? "bg-emerald-600/70"
                                  : "bg-sky-600/70"),
                              // The clip in hand: ring it and lift it over its ghost.
                              (moving || resizing) &&
                                "z-10 outline outline-2 outline-primary",
                              // …and while DRAGGING let the pointer through, or laneAtPoint would always answer "the lane I started on".
                              moving && move?.dragging && "pointer-events-none",
                            )}
                            style={{
                              left: x(drawStart),
                              width: Math.max(ppb, drawW),
                              // Same 70% weight as the type classes, so authored and default clips sit at one visual depth in the lane.
                              background: t.color
                                ? `color-mix(in srgb, ${t.color} 70%, transparent)`
                                : undefined,
                            }}
                          >
                            {/* Edge handles. Narrow strips inside the block's own ends,
                                so they never overlap the neighbouring event and the body
                                between them still drags the whole clip. Frozen lanes get
                                none: their clip is a render, not a placement. */}
                            {!t.frozen &&
                              (["start", "end"] as const).map((edge) => (
                                <div
                                  key={edge}
                                  className={cn(
                                    "absolute inset-y-0 z-20 w-1.5 cursor-ew-resize",
                                    edge === "start" ? "left-0" : "right-0",
                                    "hover:bg-primary/60",
                                  )}
                                  onPointerDown={(e) => {
                                    // Stop it here or the clip's own move drag starts too.
                                    e.stopPropagation();
                                    e.preventDefault();
                                    (
                                      e.currentTarget as HTMLElement
                                    ).setPointerCapture?.(e.pointerId);
                                    const end =
                                      c.start +
                                      (c.length > 0 ? c.length : NATURAL);
                                    setResize({
                                      trackId: t.id,
                                      clipId: c.id,
                                      edge,
                                      origStart: c.start,
                                      origEnd: end,
                                      start: c.start,
                                      end,
                                      x: e.clientX,
                                      ppb,
                                    });
                                  }}
                                  onPointerMove={onResizeMove}
                                  onPointerUp={commitResize}
                                  onPointerCancel={() => setResize(null)}
                                  title={
                                    edge === "start"
                                      ? "drag to move this event's start"
                                      : "drag to move this event's end"
                                  }
                                />
                              ))}
                            <div className="flex items-center gap-0.5 leading-tight">
                              {/* Kind at a glance: a note for MIDI/sequence clips, a speaker
                                for audio. */}
                              {c.type === "midi" ? (
                                <Music className="h-2.5 w-2.5 shrink-0 opacity-80" />
                              ) : (
                                <Volume2 className="h-2.5 w-2.5 shrink-0 opacity-80" />
                              )}
                              {looping && (
                                <Repeat className="h-2.5 w-2.5 shrink-0 opacity-80" />
                              )}
                              {stretched && (
                                <Timer className="h-2.5 w-2.5 shrink-0 opacity-80" />
                              )}
                              <span className="truncate">{c.name || c.id}</span>
                            </div>
                            {/* The clip's waveform / mini piano-roll, only when there's
                              room for it. `relative` anchors ClipContent's absolute fill;
                              `min-h-0` lets it shrink inside the flex column. */}
                            {expanded && (
                              <div className="relative mt-0.5 min-h-0 flex-1">
                                <ClipContent
                                  clip={c}
                                  spanBeats={c.length > 0 ? c.length : NATURAL}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* marker lines — an electric-blue vertical rule spanning the ruler and every
              lane, at each marker's beat. Non-interactive (the ruler handle above owns
              hover/right-click); brightened while its handle is hovered. */}
          {visMarkers.map((mk) => (
            <div
              key={mk.tc}
              className="pointer-events-none absolute top-0 z-20"
              style={{
                left: GUTTER + x(mk.beat),
                height: contentH,
                width: 1,
                background: MARKER_COLOR,
                boxShadow:
                  hoverMarker === mk.name ? `0 0 6px ${MARKER_COLOR}` : "none",
              }}
            />
          ))}
          {/* playhead — its own subscriber, so the transport moves one div and re-renders
              nothing else on this surface. See Playhead. */}
          <Playhead
            tempo={proj.tempo}
            beatLo={beatLo}
            beatHi={lastBeat}
            ppb={ppb}
            left0={GUTTER}
            height={contentH}
          />
        </div>
      </div>
    </div>
  );
}
