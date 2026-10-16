// TimelineTab.tsx — a keyboard-driven arrangement: one lane per track, clips positioned by
// beat, a live playhead, and a caret moved with hjkl/arrows. Only CONTINUOUS interaction
// lives here (the caret, growing the `v` rectangle, dragging a clip); every discrete action
// is a key binding naming a command, run from the shell via this component's imperative
// handle. See docs/timeline.md.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  Clock,
  Ghost,
  Layers,
  ListTodo,
  Music,
  Plus,
  Repeat,
  Spline,
  StretchVertical,
  Timer,
  TimerOff,
  Volume2,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { arrayEq, useEngineState } from "@studio/engine-browser/store";
import type { Task } from "@studio/song-schema/tasks";
import {
  beatsToDuration,
  beatsToPosition,
  parsePosition,
} from "@studio/song-schema/timecode";
import { trackLabel } from "@studio/song-schema/trackKind";
import { usePointerFollow } from "@studio/ui-timeline/drag";
import {
  GUTTER_DESKTOP,
  GUTTER_MOBILE,
  MARKER_COLOR,
  ROW_H,
} from "@studio/ui-timeline/lanes";
import {
  useHZoom,
  usePanScroll,
  zoomCeiling,
} from "@studio/ui-timeline/panZoom";
import { adjacentTick } from "@studio/ui-timeline/ticks";
import { nearestTick } from "@studio/ui-waveform";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import {
  type Clipboard,
  copyEvents,
  droppedCount,
  type MaybeClipboard,
  pasteEvents,
} from "../clipboard";
import {
  isFirstPlacement,
  materialInstances,
  materialOf,
} from "../clipInstances";
import { clipLoop, placedRepeats } from "../clipLoop";
import type { MenuCtx } from "../contextMenu";
import { acceptsFileDrop, dragPayload } from "../fileDrop";
import type { PasteResult } from "../gridCaret";
import type { HistoryMark } from "../historyMarks";
import { useDocument } from "../hooks/useDocument";
import { usePlayheadFrames } from "../hooks/usePlayheadFrames";
import { blurOnClick } from "../keys";
import { cursorOf, ModeStrip, stripButton } from "../modeIcons";
import { usePaneVisible } from "../paneVisible";
import { m } from "../paraglide/messages.js";
import {
  type PendingEdit,
  pendingClips,
  pendingSplitAt,
} from "../pendingEdits";
import {
  dropLaneOf,
  findRow,
  HATCH,
  isCellRow,
  type LaneFamily,
  laneOf,
  orderableLane,
  projectRows,
  type Row,
  type RowKey,
  type RowTarget,
  rowIndexOf,
  rowKey,
  rowTarget,
  stepRow,
} from "../rows";
import type { EditFocus } from "../shellEquality";
import { freeSnap, moveOffset, snapMode, snapPosition, snapTo } from "../snap";
import { recordingFrom } from "../takeCounter";
import type { DropLane, DropUpload, TimelineDropEvent } from "../timelineDrop";
import { moveNudge, type TimelineMode, timelineMode } from "../timelineMode";
import {
  CROSSFADE_BEATS,
  crossfadePair,
  pictureToolLine,
  TOOL_LABEL,
  TOOLS,
  type Tool,
  toolLine,
} from "../timelineTools";
import { TrackIcon, trackIcon } from "../trackIcons";
import type {
  WebAutomationLane,
  WebClip,
  WebProject,
  WebTrack,
  WebVideoTrack,
} from "../types";
import { useIsMobile } from "../useIsMobile";
import { ClipActivity } from "./ClipActivity";
import { ClipContent } from "./ClipContent";
import type { EditTarget } from "./ClipView";
import {
  Grid,
  type RulerMode,
  RulerTicks,
  rulerScale,
  rulerTicks,
} from "./Ruler";
import { UploadProgress } from "./UploadProgress";

// Fallback beat width, used only before the pane is measured — after that the view's range fills it exactly.
const PX_PER_BEAT = 24;
// One empty list for "no tasks", so a timeline handed none does not get a new array every render.
const NO_TASKS: readonly Task[] = [];
/** The name column, 30% wider than the shared `GUTTER_DESKTOP`, since this one carries an arrow, two meters, an icon, a name and three toggles — ONE variable, or a click lands a column off (@studio/ui-timeline's lanes.ts). */
const GUTTER_WIDE = Math.round(GUTTER_DESKTOP * 1.3);

// Extra lane height when EXPANDED, so a clip can draw its content. Groups stay ROW_H — they hold no clips.
const EXPAND_EXTRA = 40;
// Expand's movement, shared by the lanes and every line spanning them, so they travel as one.
const GROW =
  "transition-[height] duration-200 ease-out motion-reduce:transition-none";
// The shortest an event may be left by a FREE resize — a 64th; the grid's own step is the floor while there is one.
const MIN_FREE_BEATS = 1 / 16;
const NATURAL = 4;

/** The part of the lanes that draws its clips, in px: lane x, rows' y — docs/timeline.md, "Only the clips near the screen are drawn". */
type ClipWindow = { x0: number; x1: number; y0: number; y1: number };
const WHOLE: ClipWindow = {
  x0: -Infinity,
  x1: Infinity,
  y0: -Infinity,
  y1: Infinity,
};
/** No command in flight: one shared empty list, so the lanes' memo inputs do not change for nothing. */
const NO_PENDING: readonly PendingEdit[] = []; // beats drawn for a length-0 clip
const DBLCLICK_MS = 500; // the longest gap the OS default lets a double-click have
// The lane something is about to land on — a clip drag's target lane, and an OS file drag's alike.
const DROP_LANE = "bg-primary/10 outline outline-1 outline-primary/60";
// The row a dragged header would take the place of — the same outline the lane targets wear, one vocabulary.
const DROP_ROW = "outline outline-1 -outline-offset-1 outline-primary";
// A header that can be dragged to another slot. `cursor-pointer` stays: the same press still selects the row.
const GRAB_ROW = "cursor-grab active:cursor-grabbing";
// The corner's new-lane button, named because it is spelled twice: bare, and as a dropdown's trigger.
const NEW_TRACK_BTN =
  "flex h-5 items-center gap-1 rounded px-1 text-[10px] text-muted-foreground uppercase tracking-wider hover:bg-accent hover:text-foreground";
// How wide a pass must be before its loop mark also gets the glyph: the 8px icon needs its own width plus air.
const MIN_LOOP_GLYPH_PX = 18;
// No tool line to dispatch ⇒ no tools, and a stable array so the strip is not handed a new one per render.
const NO_TOOLS: readonly Tool[] = [];
const VU_MIN_DB = -60; // name-header VU meter: dB mapped to an empty header fill
const VU_MAX_DB = 6; // dB mapped to a full-width header fill

// A track row as the CLIPBOARD reads it — both halves of `copy` go through it, and `event` carries the placement's own words (clipboard.ts).
const laneEvents = (r: Extract<Row, { kind: "track" }>) => ({
  events: r.track.clips.map((c) => ({
    ref: materialOf(c),
    start: c.start,
    event: c.event,
  })),
});

// A selected label wears the caret cell's fill + outline: it IS the caret, parked on the row instead of the lane.
const LABEL_SELECTED =
  "bg-primary/25 outline outline-1 -outline-offset-1 outline-primary";

/** What holds the NAME COLUMN still while the lanes pan under it: `sticky left-0` on every cell, over an opaque `before:` ground, at z-30 (docs/timeline.md). */
const GUTTER_STICKY =
  "sticky left-0 z-30 before:absolute before:inset-0 before:-z-10 before:bg-background before:content-['']";

// `beat: LABEL` puts the caret on the row's label — the only position a group or generated lane can take.
export const LABEL = -1;

/** The take being recorded, drawn on its lane as it grows — its OWN subscription, so a frame rewrites one absolutely positioned div (docs/playhead.md). */
function RecordingClip({
  tempo,
  startBeat,
  countInBeats,
  beatLo,
  beatHi,
  ppb,
}: {
  tempo: number;
  startBeat: number;
  /** The pre-roll, in beats — nothing is recorded during it, so nothing is drawn. */
  countInBeats: number;
  beatLo: number;
  beatHi: number;
  ppb: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The take's material starts after the COUNT-IN, not where the transport rolled.
  const from0 = recordingFrom(startBeat, countInBeats);
  // WIDTH per animation frame, not a transform: unlike the playhead this element genuinely changes size — see docs/playhead.md.
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const now = (seconds * tempo) / 60;
        const from = Math.max(from0, beatLo);
        const to = Math.min(now, beatHi);
        const shown = now > from0 && to > from;
        el.style.visibility = shown ? "visible" : "hidden";
        if (shown) {
          el.style.left = `${(from - beatLo) * ppb}px`;
          el.style.width = `${(to - from) * ppb}px`;
        }
      },
      [tempo, from0, beatLo, beatHi, ppb],
    ),
  );
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-y-1 z-10 rounded border border-red-400/70 bg-red-500/25"
      style={{ visibility: "hidden" }}
      title={m["clip.takeRolling"]()}
    />
  );
}

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
  const ref = useRef<HTMLDivElement | null>(null);
  // Written per animation frame instead of per engine frame: 50 ms is one move every three screen frames — see docs/playhead.md.
  usePlayheadFrames(
    useCallback(
      (seconds: number) => {
        const el = ref.current;
        if (!el) return;
        const beat = (seconds * tempo) / 60;
        // HIDDEN, not unmounted, outside the zoomed range: the callback needs a node to write to when it comes back.
        const inside = beat >= beatLo && beat <= beatHi;
        el.style.visibility = inside ? "visible" : "hidden";
        if (inside)
          el.style.transform = `translateX(${(beat - beatLo) * ppb}px)`;
      },
      [tempo, beatLo, beatHi, ppb],
    ),
  );
  return (
    // Parked at the lane's left edge and TRANSLATED from there: a position is layout and a transform is not.
    <div
      ref={ref}
      className={cn(
        "pointer-events-none absolute top-0 z-20 w-px bg-white/80",
        GROW,
      )}
      style={{
        left: left0,
        willChange: "transform",
        visibility: "hidden", // until the first frame says where it is
        height,
      }}
    />
  );
}

// dB → how much of the header the bar fills.
const vuFill = (db: number | undefined) =>
  Math.max(
    0,
    Math.min(1, ((db ?? -Infinity) - VU_MIN_DB) / (VU_MAX_DB - VU_MIN_DB)),
  ) * 100;

/** One lane's meters — the output level across the header, the input level when armed; the dB is rounded first, so a bar nobody can see costs no re-render. */
function LaneMeter({ index, armed }: { index: number; armed: boolean }) {
  // Hidden, the selectors answer a constant, so the meter-rate frames render nothing behind another pane.
  const visible = usePaneVisible();
  const out = useEngineState((s) =>
    visible ? Math.round(s.levels[index] ?? -Infinity) : -Infinity,
  );
  const input = useEngineState((s) =>
    visible && armed
      ? Math.round(s.inputLevels[index] ?? -Infinity)
      : -Infinity,
  );
  return (
    <>
      {/* live VU: a faint green fill behind the label, SCALED from the left rather than resized so it never reflows (@studio/engine-browser docs/meters.md). */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-full origin-left bg-emerald-500/20"
        style={{ transform: `scaleX(${vuFill(out) / 100})` }}
      />
      {/* armed input meter, pinned to the bottom edge; the faint track shows at silence, so a quiet armed input still reads as armed. */}
      {armed && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-red-500/20">
          <div
            className="h-full w-full origin-left bg-red-500"
            style={{ transform: `scaleX(${vuFill(input) / 100})` }}
          />
        </div>
      )}
    </>
  );
}

/** Which attribute set a lane is playing, drawn only when it HAS a choice — amber away from the first, and the click opens the lane's ⋮ menu (packages/song/docs/alternatives.md). */
function LaneAlternative({
  track,
  names,
  current,
  onOpen,
}: {
  track: string;
  names: string[];
  current: string;
  onOpen: (at: { x: number; y: number }) => void;
}) {
  const away = current !== names[0];
  const title = `${track}: alternative '${current}' of ${names.length} — ${names.join(", ")}. Click to switch or add one.`;
  return (
    <button
      type="button"
      aria-haspopup="menu"
      // The gutter is too narrow to repeat the lane's name, so the tooltip carries it.
      title={title}
      aria-label={title}
      // As the m/s/a buttons do: the gutter is the row's handle, and opening this must not also move the caret.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onOpen({ x: r.left, y: r.bottom + 2 });
        // Or the next Space re-opens this menu instead of rolling the transport — see blurOnClick.
        blurOnClick(e);
      }}
      className={cn(
        "shrink-0 rounded-sm px-1 font-mono text-[9px] leading-none",
        away
          ? "bg-amber-400/20 text-amber-400 hover:bg-amber-400/30"
          : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {current}
    </button>
  );
}

// The lanes' grid layer is `Grid`, in Ruler.tsx beside the ticks it matches — its memo is documented there.

interface Caret {
  row: RowKey; // identity, not an index — a lane added or removed renumbers the rows
  beat: number; // >= 0 a beat cell; LABEL the row's label
}

/** One field of a picture placement, in seconds — what a finished drag asks the shell to write. */
// By INDEX in the lane's `events:`, which is the only address that is unique: one source may be
// placed twice, and an ACTIVATION names no source at all (song-video/docs/shapes.md).
export interface VideoEdit {
  index: number;
  field: "start" | "source_from" | "length";
  value: number;
}

// The shortest shot a drag may leave, in seconds: `length: 0` already MEANS 'to the end of the source'.
const V_MIN = 0.04;
// Seconds drawn for a `length: 0` placement, whose real extent needs the source opened to know.
const V_NATURAL = 4;

/** A picture placement in hand, in seconds throughout; `pxPerSec` and the ticks are captured at the GRAB, so a zoom mid-drag cannot slide the shot. */
interface VDrag {
  trackId: string;
  index: number; // its place in the lane's `events:` — see VideoEdit
  // An event with no `ref`: a span saying the lane is ON, with no source to trim (docs/shapes.md).
  activation: boolean;
  // Where the press landed: the body moves the shot, an edge trims it. See docs/picture.md.
  mode: "move" | "in" | "out";
  origStart: number;
  origLength: number; // 0 == to the end of the source
  origFrom: number;
  /** How fast the source runs under the shot, signed; absent is 1 — what a head trim multiplies (song-video/docs/speed.md). */
  speed?: number;
  start: number; // live
  length: number; // live; still 0 while a length-0 placement is only being moved
  x: number; // pointer x at grab
  pxPerSec: number;
  moved: boolean;
  pending?: boolean; // written, still drawn until the reload — as Move.pending is
}

/** The extent a placement is DRAWN at: its own, or the placeholder a length-0 shot gets. */
const drawnLength = (length: number): number =>
  length > 0 ? length : V_NATURAL;

/** Where a picture drag puts the shot, in seconds — PURE and exported for its tests, since nothing in this app mounts a component. */
export function videoDragTo(
  v: Pick<
    VDrag,
    | "mode"
    | "origStart"
    | "origLength"
    | "origFrom"
    | "start"
    | "length"
    | "speed"
  >,
  deltaSec: number,
  snapSec: (sec: number) => number,
): { start: number; length: number } {
  const drawn = drawnLength(v.origLength);
  if (v.mode === "move")
    return { start: snapSec(v.origStart + deltaSec), length: v.length };
  if (v.mode === "in") {
    // The head follows the pointer, the source's in-point follows the head, and the EXTENT shortens by the same amount.
    // Forwards, the head cannot pass the source's first frame; a freeze or a reverse never reaches it that way.
    const speed = v.speed ?? 1;
    const floor =
      speed > 0 ? v.origStart - v.origFrom / speed : Number.NEGATIVE_INFINITY;
    const start = Math.max(
      Math.min(snapSec(v.origStart + deltaSec), v.origStart + drawn - V_MIN),
      floor,
    );
    return { start, length: drawn - (start - v.origStart) };
  }
  const end = Math.max(
    snapSec(v.origStart + drawn + deltaSec),
    v.origStart + V_MIN,
  );
  return { start: v.start, length: end - v.origStart };
}

/** The fields a finished picture drag writes, in SECONDS — the left edge writes three, and each is load-bearing (docs/picture.md). */
export function videoDragEdits(v: VDrag): VideoEdit[] {
  if (v.mode === "out")
    return [{ index: v.index, field: "length", value: v.length }];
  const edits: VideoEdit[] = [
    { index: v.index, field: "start", value: v.start },
  ];
  if (v.mode === "in") {
    const delta = v.start - v.origStart;
    // An ACTIVATION has no source: its left edge moves the start and leaves the end where it was.
    if (!v.activation)
      edits.push({
        index: v.index,
        field: "source_from",
        value: Math.max(0, v.origFrom + delta * (v.speed ?? 1)),
      });
    edits.push({
      index: v.index,
      field: "length",
      value: Math.max(V_MIN, v.length),
    });
  }
  return edits;
}

/** Whether a finished drag left the placement exactly where it was — then nothing is written. */
export function videoDragIsStill(v: VDrag): boolean {
  return (
    v.start === v.origStart &&
    (v.mode !== "out" || v.length === drawnLength(v.origLength))
  );
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
  // The lane it is over — only ever one whose wiring can take THIS event. The keyboard never changes it.
  toTrackId: string;
  // A pointer drag is live: it commits on release, and must not also be cancelled by the keymap's handlers.
  dragging?: boolean;
  // Released and written, waiting for the reload: the clip keeps drawing where it was DROPPED rather than snapping home for a round trip.
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
  /** `transport step` — the drawn tick after (`1`) or before (`-1`) `sec`, in seconds; null past either end (docs/timeline.md). */
  stepTarget: (sec: number, dir: 1 | -1) => number | null;
  toggleLoop: () => void;
  /** `selection copy` — the events the rectangle holds, in its own coordinates (clipboard.ts). */
  copy: () => MaybeClipboard;
  /** `selection paste` — the `events add` line putting the clipboard down at the caret. */
  pasteLine: (clip: Clipboard) => PasteResult;
  /** `selection delete` — the line removing what `copy` would take: the rectangle's events, or the one under the caret. */
  deleteLine: () => PasteResult;
  /** `selection split` — the cut the blade would make on the caret's lane, at `sec`, the PLAYHEAD; audio and picture alike. */
  splitLine: (sec: number) => PasteResult;
  startMove: () => void;
  // The header toggles, so `ui ruler`, `ui lanes` and `ui automation` reach what the buttons reach.
  toggleRuler: () => void;
  toggleLanes: () => void;
  toggleAutomation: () => void;
  /** `ui tool <name>` — which tool this surface is holding. Its own, since a cut means nothing on a graph. */
  setTool: (t: Tool) => void;
}

export function TimelineTab({
  active,
  reloadKey,
  rolling,
  takeStartBeat,
  takeCountInBeats,
  midiTake = null,
  tasks = NO_TASKS,
  videoTracks,
  fps,
  onVideoEdit,
  setStatus,
  onEditTarget,
  onOpenClip,
  onEmptyClick,
  onCaret,
  onView,
  onContextMenu,
  onNewTrack,
  onSeek,
  onSetLoop,
  onMoveEvent,
  onToolLine,
  pendingEdits = NO_PENDING,
  onResizeEvent,
  onFadeEvent,
  feedMove,
  feedTimecode,
  feedEventsMove,
  onFocusRow,
  trackControls,
  onTrackToggle,
  laneNodes,
  mark,
  onNodeMenu,
  onNewVideoTrack,
  onReorder,
  videoArmed,
  videoRecording,
  onVideoArm,
  onVideoToggle,
  onDropFiles,
  dropUpload,
  readOnly = false,
  lanesLocked = false,
  ref,
}: {
  active: boolean;
  /** A bottom panel is open: the lanes draw folded and Expand is dead, the user's choice kept for when it closes (docs/shell.md). */
  lanesLocked?: boolean;
  reloadKey: number;
  /** Nothing here can be written — a shared snapshot; what it takes away is the EDITING GESTURES and only those (docs/shared.md). */
  readOnly?: boolean;
  /** Is a take rolling, and from which beat — both PROPS and not subscriptions, since they change once per take. */
  rolling: boolean;
  takeStartBeat: number;
  /** The take's pre-roll in BEATS, so the growing clip can skip it: those bars record nothing. */
  takeCountInBeats: number;
  /** The open project's tasks from TODOS.md; those with a timecode are flagged in the ruler (docs/tasks.md). */
  tasks?: readonly Task[];
  /** The MIDI take being captured right now, and the beat it starts on — the browser's, so absent from the engine's armed set. */
  midiTake?: { lane: string; from: number } | null;
  // The song's picture lanes, from the SECOND compile of the same folder (`GET /video-doc`) — see hooks/useVideoDoc.ts.
  videoTracks: WebVideoTrack[];
  /** The picture's frame rate, absent when the song has none — it puts the seconds ruler's fine ticks on frames (docs/picture.md). */
  fps?: number;
  /** A picture placement was dragged: set these fields of it in SECONDS, by `ref`, as a LIST — one gesture, one read-modify-write (docs/picture.md). */
  onVideoEdit?: (trackId: string, edits: VideoEdit[]) => void;
  /** OS files were dropped on a lane: upload, declare and place them. Absent ⇒ the pane refuses the drag (hooks/useTimelineDrop.ts). */
  onDropFiles?: (d: TimelineDropEvent) => void;
  /** …and how far that upload has got, drawn at the foot of the pane — the file tree's bar, over here. */
  dropUpload?: DropUpload | null;
  setStatus: (s: string) => void;
  onEditTarget: (t: EditFocus | null) => void; // the clip under the caret, for the shell
  // A clip was CLICKED — a press that never moved; the caret-driven `onEditTarget` above is a different question.
  onOpenClip?: (t: EditTarget) => void;
  // The bare lane was clicked — the counterpart of `onOpenClip`: the shell puts the graph back.
  onEmptyClick?: () => void;
  /** The caret: its position, the track it is on, and the same two facts as TIMECODES — computed here, the only place that knows the beat grid. */
  onCaret: (
    c: Caret & {
      trackId: string | null;
      /** Where the caret is. Null when it is parked on a row's label rather than in time. */
      tc: string | null;
      /** Where the event under it STARTS — how every `event` verb addresses one. Null on bare lane. */
      eventTc: string | null;
      /** The RECTANGLE, when one is drawn: the lanes it covers comma-joined, and its span — reported unconditionally, since a command may be answered before its form exists. */
      selection: { tracks: string; from: string; to: string } | null;
    },
  ) => void;
  // What state the timeline is in, for the key conditions — and for `expanded`, which the SHELL acts on (docs/shell.md).
  onView: (v: {
    /** Which MODE the keyboard is in, derived from the two below rather than stored (timelineMode.ts). */
    mode: TimelineMode;
    /** …and which TOOL a press means, which is chosen rather than derived (timelineTools.ts). */
    tool: Tool;
    selecting: boolean;
    zoomed: boolean;
    loop: boolean;
    expanded: boolean;
  }) => void;
  // Right-click: report what is under the cursor and where, so the shell can open its menu (see contextMenu.ts).
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  /** Make a lane — the corner button over the name column; absent ⇒ no button, which is what a frozen song gets. */
  onNewTrack?: () => void;
  /** …and a PICTURE lane, which turns that button into a menu; absent ⇒ the project declares no viewport and there is nothing to choose between. */
  onNewVideoTrack?: () => void;
  /** A header was dragged onto another's row: `target` is the lane whose place it should have (docs/timeline.md). */
  onReorder?: (family: LaneFamily, lane: string, target: string) => void;
  /** The PICTURE lane armed to record its camera, and whether one is rolling — the browser's, not the engine's (hooks/useVideoRecording.ts). */
  videoArmed?: string | null;
  videoRecording?: boolean;
  /** Toggle that arm; absent ⇒ no button, which is what a frozen song gets. */
  onVideoArm?: (id: string) => void;
  /** A picture lane's mute or solo — the audio lane's two words, over picture (docs/picture.md). */
  onVideoToggle?: (id: string, control: "mute" | "solo") => void;
  // Move the transport, in seconds — the same engine seek the minimap's click uses.
  onSeek?: (seconds: number) => void;
  // Set/clear the transport loop region, in seconds (Shift+L → toggleLoop below).
  onSetLoop?: (start: number, end: number, enabled: boolean) => void;
  /** An edge handle was dragged: re-time the event at `fromTc` to span newStart..newEnd (a move is `event move`, whose 4th argument changes lane). */
  onResizeEvent?: (
    trackId: string,
    fromTc: string,
    newStartTc: string,
    newEndTc: string,
  ) => void;
  /** A fade's corner handle was dragged: `lenTc` is a LENGTH, not a position (see `event fadein`). */
  onFadeEvent?: (
    trackId: string,
    fromTc: string,
    which: "fadeIn" | "fadeOut",
    lenTc: string,
  ) => void;
  onMoveEvent?: (
    trackId: string,
    fromTc: string,
    toTc: string,
    toTrackId?: string,
  ) => void;
  /** A TOOL's press as the command LINE it produced, alone among this pane's writes; absent ⇒ no tools (docs/timeline.md). */
  onToolLine?: (line: string) => void;
  /** What one-shot commands are doing and the document not yet: drawn as done already (pendingEdits.ts). */
  pendingEdits?: readonly PendingEdit[];
  // Present only while the command bar is filling `event move`: the drag then ANSWERS the bar instead of committing (docs/timeline.md).
  feedMove?: (
    trackId: string,
    fromTc: string,
    toTc: string,
    toTrackId: string | undefined,
    live: boolean,
  ) => void;
  // Present only while the bar's OPEN field is asking for a timecode: a click on the ruler answers it instead of seeking.
  feedTimecode?: (tc: string, live: boolean) => void;
  // Present only while the bar is filling `events move`: the rectangle then ANSWERS its region on every change.
  feedEventsMove?: (tracks: string, from: string, to: string) => void;
  // A header was DOUBLE-clicked: point the shell's other panes at this row — selecting it is this component's own business.
  onFocusRow?: (target: RowTarget) => void;
  // Per-track mute/solo/arm by track id — the same state the graph's track nodes draw, so the two stay in lockstep.
  trackControls?: Record<string, { mute: number; solo: number; arm: number }>;
  onTrackToggle?: (
    id: string,
    control: "mute" | "solo" | "arm" | "highlight",
  ) => void;
  /** What a hovered History row touched — its lanes tinted, its clips ringed (historyMarks.ts). */
  mark?: HistoryMark | null;
  /** What the graph knows about each lane's NODE, by lane id — the same maps the chains pane draws from (packages/song/docs/alternatives.md). */
  laneNodes?: {
    alternatives?: Record<
      string,
      { alternatives: string[]; alternative: string }
    >;
    frozen?: Record<string, "at" | "inside">;
    /** Each lane's automation, by track id, from the graph — one row per entry, drawn under the lane. */
    automation?: Record<string, WebAutomationLane[]>;
  };
  /** Open a lane's ⋮ menu at a point — the shell's, being the same menu the chains graph opens on the same node. */
  onNodeMenu?: (
    n: {
      module?: string;
      alternatives?: string[];
      alternative?: string;
      frozen?: "at" | "inside";
    },
    at: { x: number; y: number },
  ) => void;
  ref?: React.Ref<TimelineHandle>;
}) {
  // The ONE live value the body itself needs; the rest is drawn by Playhead and LaneMeter, which subscribe for themselves (docs/timeline.md).
  const armedIds = useEngineState((s) => s.armed, arrayEq);
  // Re-asked when the project moves, and again on a backoff while the service is not answering — see useDocument.
  const { doc: proj, error } = useDocument(() => api.projectDoc(), reloadKey);
  const [caret, setCaret] = useState<Caret>({ row: "", beat: 0 });
  const [sel, setSel] = useState<Selection | null>(null);
  // Expanded: taller lanes showing each clip's content. A per-session view toggle, on by default, not a saved preference.
  const [wantExpanded, setExpanded] = useState(true);
  const expanded = wantExpanded && !lanesLocked;
  // Whether each lane's automation rows are drawn under it — a view toggle like Expand, writing nothing.
  const [showAutomation, setShowAutomation] = useState(true);
  // Which unit the RULER counts in: a song carrying picture is read in bars while you write it and in seconds while you cut it.
  const [rulerMode, setRulerMode] = useState<RulerMode>("bars");
  // The name of the marker the cursor is over, shown in the header while hovering.
  const [hoverMarker, setHoverMarker] = useState<string | null>(null);
  // The task flag the cursor is over: its text is drawn under the ruler, which clips its own children.
  const [hoverTask, setHoverTask] = useState<{
    beat: number;
    text: string;
  } | null>(null);
  // The zoom stack: [] is the song at rest, the last entry is what's drawn.
  const [zoom, setZoom] = useState<Viewport[]>([]);
  // The transport loop as an inclusive beat range, or null. The engine enforces the wrap; this only draws the band.
  const [loop, setLoop] = useState<{ lo: number; hi: number } | null>(null);
  // …and the loop the ENGINE holds, as one string so a frame that repeats it re-renders nothing.
  const engineLoop = useEngineState((s) =>
    s.loop?.on ? `${s.loop.start}|${s.loop.end}` : s.loop ? "off" : "",
  );
  // Adopted when it CHANGES, not each frame: a reloaded page learns the loop that is playing, and a frame
  // older than a loop just set here cannot undo it.
  const lastEngineLoop = useRef("");
  useEffect(() => {
    // Not before the document: a refreshed page hears the engine first, and would mark its loop as adopted with nowhere to draw it.
    if (!proj || engineLoop === lastEngineLoop.current) return;
    lastEngineLoop.current = engineLoop;
    if (!engineLoop) return;
    if (engineLoop === "off") {
      setLoop(null);
      return;
    }
    const [start, end] = engineLoop.split("|").map(Number);
    const lo = (start * proj.tempo) / 60;
    // The band is inclusive of its last cell; the engine's end is where the loop wraps, one cell after it.
    const hi = (end * proj.tempo) / 60 - 1;
    setLoop((cur) =>
      cur && cur.lo === lo && cur.hi === hi ? cur : { lo, hi },
    );
  }, [engineLoop, proj]);
  // The clip being moved. A ref shadows it so the key handler reads the live value without re-binding on each nudge.
  const [move, setMove] = useState<Move | null>(null);
  const moveRef = useRef<Move | null>(move);
  moveRef.current = move;
  /** Which mode the keyboard is in — DERIVED here beside the two states it reads, so nothing can come to disagree (timelineMode.ts). */
  const mode = timelineMode(move, sel);
  const modeRef = useRef<TimelineMode>(mode);
  modeRef.current = mode;
  /** Where an OS file drag is hovering — the lane it would land on and the beat it would land at, drawn until it leaves. */
  const [dropAt, setDropAt] = useState<{ lane: string; beat: number } | null>(
    null,
  );
  /** …and the TOOL, which is CHOSEN rather than derived: what a press means. Session only, never written (timelineTools.ts). */
  const [tool, setTool] = useState<Tool>("pointer");
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;
  // The tool's icon as the pointer — undefined for the arrow, whose picture the system already draws (modeIcons.tsx).
  const toolCursor = tool === "pointer" ? undefined : cursorOf(tool);
  // Read by the pointer-drag callbacks, which are defined above both — a drop uses the same commit enter does.
  const projRef = useRef<WebProject | null>(null);
  projRef.current = proj;
  const commitMoveRef = useRef<() => void>(() => {});

  // A committed move stops being drawn once the project it wrote has come back — which is also the right answer when the command FAILED.

  // biome-ignore lint/correctness/useExhaustiveDependencies: `proj` IS the signal — a new doc arrived.
  useEffect(() => {
    setMove((m) => (m?.pending ? null : m));
    setResize((r) => (r?.pending ? null : r));
  }, [proj]);

  const barBeats = Math.max(1, proj?.timeSigNumerator || 4);
  // The song's tracks, and the rows they draw as (groups with members nested under).
  const allTracks = useMemo(() => proj?.tracks ?? [], [proj]);
  const rows = useMemo(
    () =>
      proj
        ? projectRows(
            proj,
            allTracks,
            videoTracks,
            showAutomation ? laneNodes?.automation : undefined,
          )
        : [],
    [proj, allTracks, videoTracks, laneNodes?.automation, showAutomation],
  );
  const clipEnd = (c: { start: number; length: number }) =>
    c.start + (c.length > 0 ? c.length : NATURAL);
  // What a clip's ENVELOPE depends on in the project, as one identity: an object literal in a prop is what memo cannot see through.
  const envProject = useMemo(
    () => ({
      tempo: proj?.tempo ?? 120,
      timeSigNumerator: proj?.timeSigNumerator ?? 4,
    }),
    [proj?.tempo, proj?.timeSigNumerator],
  );
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
  const GUTTER = isMobile ? GUTTER_MOBILE : GUTTER_WIDE;
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
  // Once loaded, not per reload: the scroller exists only after the first document, and on mount there is none to hold.
  const loaded = !!proj;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loaded` gates the scroller's existence.
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
  }, [loaded]);

  // The viewport plus a screen each way, snapped to half-screens so a scroll re-renders only when it crosses one.
  const [clipWin, setClipWin] = useState<ClipWindow>(WHOLE);
  const readClipWin = useCallback(() => {
    const el = scrollRef.current;
    // A hidden pane measures 0: keep the window it had, it is what comes back.
    if (!el?.clientWidth || !el.clientHeight) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const sx = Math.floor(el.scrollLeft / (w / 2)) * (w / 2);
    const sy = Math.floor(el.scrollTop / (h / 2)) * (h / 2);
    const next = { x0: sx - w, x1: sx + 2 * w, y0: sy - h, y1: sy + 2 * h };
    setClipWin((cur) =>
      cur.x0 === next.x0 &&
      cur.x1 === next.x1 &&
      cur.y0 === next.y0 &&
      cur.y1 === next.y1
        ? cur
        : next,
    );
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `proj` gates the scroller's existence.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", readClipWin, { passive: true });
    const ro = new ResizeObserver(readClipWin);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", readClipWin);
      ro.disconnect();
    };
  }, [proj, readClipWin]);
  // Before paint, after useHZoom's own layout effect has moved scrollLeft: a zoom must not draw one frame of missing clips.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers, the reading is off the DOM.
  useLayoutEffect(readClipWin, [zoomX, paneW, beatLo, beatHi, readClipWin]);

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
        ? {
            kind: "clip",
            project: proj,
            clip: clipUnderCaret,
            track: caretRow?.kind === "track" ? caretRow.track.id : undefined,
          }
        : null,
    );
  }, [active, proj, clipUnderCaret, onEditTarget]);

  // Which materials are placed more than once, and where each one's first placement is — one pass per compile.
  const instances = useMemo(
    () => materialInstances(proj?.tracks ?? []),
    [proj],
  );
  /** The material the caret is parked on when it has copies elsewhere — null when it is placed only once. */
  const kinOfCaret = useMemo(() => {
    if (!clipUnderCaret) return null;
    const ref = materialOf(clipUnderCaret);
    return (instances.get(ref)?.n ?? 0) > 1 ? ref : null;
  }, [clipUnderCaret, instances]);

  // What m/s aim at from here — a lane's track, a header's group, a pattern lane's GROUP. See docs/timeline.md.
  const caretTrackId = useMemo(() => {
    const target = caretRow && rowTarget(caretRow);
    // A video lane is not an engine track: the caret reports no track id on one, so every consumer downstream refuses it.
    return !target || target.kind === "video" ? null : target.id;
  }, [caretRow]);
  // …reported to the shell further down, once the selection rectangle it also carries exists.

  // The lanes shift-clicked together, by track id — what the right-click offers to group (docs/timeline.md).
  const [picked, setPicked] = useState<string[]>([]);
  // Click a header: the row itself is selected, and a live rectangle is dropped, or a click would leave two selections drawn.
  const selectRow = useCallback((row: Row) => {
    setSel(null);
    setPicked([]);
    setCaret({ row: rowKey(row), beat: LABEL });
  }, []);
  // Shift-click a track's header: it joins the picked lanes, or leaves them; the lane named before it joins too, as the anchor.
  const pickRow = useCallback(
    (row: Row) => {
      if (row.kind !== "track") return selectRow(row);
      const id = row.track.id;
      const anchor = caret.row.startsWith("track:")
        ? caret.row.slice("track:".length)
        : null;
      setSel(null);
      setPicked((cur) => {
        const base = cur.length || !anchor || anchor === id ? cur : [anchor];
        return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      });
      setCaret({ row: rowKey(row), beat: LABEL });
    },
    [selectRow, caret.row],
  );

  // Double-click a header: the shell points its other panes at the row. Nothing is written.
  const focusRow = useCallback(
    (row: Row) => {
      const target = rowTarget(row);
      if (target) onFocusRow?.(target);
    },
    [onFocusRow],
  );

  /** Dragging a header to a new slot: which lane is in hand, and which row's place it would take. */
  const [rowDrag, setRowDrag] = useState<{
    family: LaneFamily;
    lane: string;
    over: string | null;
  } | null>(null);
  // Read by the gutter's own onClick: a drag that moved must not also read as the click that selects the row.
  const rowMoved = useRef(false);
  // Every window-level drag here follows ONE pointer and abandons on a cancel — @studio/ui-timeline/drag.
  const follow = usePointerFollow();

  const beginRowDrag = useCallback(
    (e: React.PointerEvent, row: Row) => {
      if (e.button !== 0 || readOnly || !onReorder) return;
      // The gutter carries controls — mute, solo, arm, the ⋮ menu. A press on one of those is not a press on the handle.
      if ((e.target as HTMLElement).closest?.("button")) return;
      const from = orderableLane(row);
      if (!from) return;
      rowMoved.current = false;
      const y0 = e.clientY;
      const onMove = (ev: PointerEvent) => {
        if (!rowMoved.current && Math.abs(ev.clientY - y0) <= DRAG_SLOP) return;
        rowMoved.current = true;
        // The row under the pointer off the DOM, as every other drag here does — rows have three heights.
        const key = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest?.("[data-sel-row]")
          ?.getAttribute("data-sel-row");
        const over = dropLaneOf(rows, key, from.family);
        setRowDrag({ family: from.family, lane: from.lane, over });
      };
      const onUp = () => {
        setRowDrag((d) => {
          // A drop on nothing, or on the lane's own row, writes nothing: there is no move to journal.
          if (d?.over && d.over !== d.lane) onReorder(d.family, d.lane, d.over);
          return null;
        });
      };
      // A cancel drops the lane where it was: the next click elsewhere must not complete the move.
      follow(e, { move: onMove, end: onUp, cancel: () => setRowDrag(null) });
    },
    [readOnly, onReorder, rows, follow],
  );

  // The gutter is the row's handle on all three kinds of row, paired with `select-none`: a double-click would else select the name.
  const gutterProps = useCallback(
    (row: Row) => ({
      onPointerDown: (e: React.PointerEvent) => beginRowDrag(e, row),
      // Swallowed after a drag: the same press cannot both move the lane and select it.
      onClick: (e: React.MouseEvent) => {
        if (rowMoved.current) return;
        if (e.shiftKey) pickRow(row);
        else selectRow(row);
      },
      onDoubleClick: () => focusRow(row),
    }),
    [selectRow, pickRow, focusRow, beginRowDrag],
  );

  /** …and how a PICTURE lane reads: hidden itself, or hidden because something else is soloed (pictureMix.ts). */
  const pictureOff = useCallback(
    (t: WebVideoTrack) =>
      t.mute || (videoTracks.some((x) => x.solo) && !t.solo),
    [videoTracks],
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

  // The pointer half of Move mode: same state, same commitMove, same same-material rule on the target lane.
  const ppbRef = useRef(PX_PER_BEAT); // assigned during render, below
  /** The ruler's current UNIT in beats, assigned during render beside `ppbRef` and read on pointerdown — a drag snaps to it. */
  const unitRef = useRef(1);
  const dragRef = useRef<{
    x: number;
    y: number;
    ppb: number;
    /** The snap step, in beats — the ruler's unit at the moment of the grab. */
    unit: number;
    moved: boolean;
    // WHICH clip is under the press, carried here rather than read off `move`: a lane whose clip cannot be moved sets none.
    trackId: string;
    clipId: string;
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
      // LEFT button, the one you already have on the clip.
      if (e.button !== 0) return;
      // Shifted, it is a selection press, not a grab: bubble to the lane, which grows the rectangle.
      if (e.shiftKey) return;
      e.stopPropagation();
      // A tool other than the pointer answers the press itself and the grab never starts — with the grab's own three guards (docs/timeline.md).
      if (toolRef.current !== "pointer" && onToolLine) {
        e.preventDefault();
        if (readOnly || track.generated || c.frozen) return;
        const p = projRef.current;
        if (!p) return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        // The clip's own left edge IS its start, so the pointer's beat needs no scroll or gutter arithmetic.
        const at =
          c.start + (e.clientX - r.left) / Math.max(1e-6, ppbRef.current);
        const tc = (b: number) =>
          beatsToPosition(b, p.timeSigNumerator, p.timeSigDenominator);
        // The crossfade is about TWO events: a drag sizes it, a click makes the default, Alt takes it away.
        if (toolRef.current === "crossfade") {
          const pair = crossfadePair(track.clips, c, at);
          if (!pair)
            return void setStatus(
              "no audio event beside this one to crossfade into",
            );
          const x0 = e.clientX;
          const alt = e.altKey;
          const lenAt = (x: number) => {
            const dx = Math.abs(x - x0);
            if (dx < 4) return CROSSFADE_BEATS;
            return Math.max(
              0.125,
              Math.round((2 * dx) / ppbRef.current / 0.125) * 0.125,
            );
          };
          const move = (m: PointerEvent) =>
            setStatus(
              `crossfade ${lenAt(m.clientX)} beat(s) — release to set it`,
            );
          const up = (u: PointerEvent) => {
            const len = alt ? 0 : lenAt(u.clientX);
            const dur =
              len > 0
                ? beatsToDuration(len, p.timeSigNumerator, p.timeSigDenominator)
                : "0";
            onToolLine?.(
              `event crossfade ${track.id} ${tc(pair.a.start)} ${tc(pair.b.start)} ${dur}`,
            );
          };
          follow(e, {
            move,
            end: up,
            cancel: () => setStatus("crossfade dropped"),
          });
          return;
        }
        // A cut lands on the grid as a drag does, Shift freeing it (snap.ts).
        const snapped = e.shiftKey ? at : snapTo(at, unitRef.current);
        const act = toolLine(toolRef.current, {
          track: track.id,
          name: c.name || c.id,
          start: c.start,
          length: c.length,
          at: snapped,
          tc: tc(c.start),
          atTc: tc(snapped),
          muted: c.disabled,
        });
        if (act?.line) onToolLine?.(act.line);
        if (act) setStatus(act.note);
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        ppb: ppbRef.current,
        unit: unitRef.current,
        moved: false,
        trackId: track.id,
        clipId: c.id,
      };
      // No MOVE on a generated, frozen or read-only lane — there is a clip to look at and nothing to write (packages/song/docs/freeze.md).
      if (readOnly || track.generated || c.frozen) return;
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
    [readOnly, onToolLine, setStatus, follow],
  );

  // Resizing an event by its edge, kept apart from the move drag: a resize changes start AND length and never leaves the lane.
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
    unit: number; // the ruler's unit at the grab — the step both edges snap to
    pending?: boolean; // released and written, still drawn until the reload — see Move.pending
  } | null>(null);
  const resizeRef = useRef<typeof resize>(null);
  resizeRef.current = resize;

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (r?.pending) return; // already written and only still drawn — a hover must not re-time it
    if (!r) return;
    // The ruler's unit at the grab, measured from where the edge WAS: the grid, Ctrl the event's own offset, Shift free (snap.ts).
    const mode = snapMode(e);
    const delta = (e.clientX - r.x) / r.ppb;
    // An edge may not cross the other; the floor is the grid's step while there is one, and a 64th once the gesture is free.
    const min = mode === "free" ? MIN_FREE_BEATS : r.unit;
    const next =
      r.edge === "start"
        ? {
            start: Math.max(
              0,
              Math.min(
                r.origEnd - min,
                snapPosition(r.origStart, delta, r.unit, mode),
              ),
            ),
            end: r.origEnd,
          }
        : {
            start: r.origStart,
            end: Math.max(
              r.origStart + min,
              snapPosition(r.origEnd, delta, r.unit, mode),
            ),
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
    // A drag that ended where it started writes nothing — the same courtesy the move drag extends.
    if (r.start === r.origStart && r.end === r.origEnd) {
      setResize(null);
      setStatus("resize cancelled — no change");
      return;
    }
    // Held until the reload, exactly as a committed move is: clearing here snapped the edge back for a round trip.
    setResize({ ...r, pending: true });
    onResizeEvent?.(
      r.trackId,
      beatsToPosition(r.origStart, num, den),
      beatsToPosition(r.start, num, den),
      beatsToPosition(r.end, num, den),
    );
  }, [proj, onResizeEvent, setStatus]);

  // --- dragging a FADE ----------------------------------------------------------

  /** A fade is a LENGTH from one end inwards — one number, capped at the clip's extent, with `orig` read at the grab. */
  const [fade, setFade] = useState<{
    trackId: string;
    clipId: string;
    which: "fadeIn" | "fadeOut";
    start: number; // beats — the placement's key, what the command addresses
    span: number; // the clip's drawn extent, the cap
    orig: number; // the fade's length when grabbed
    len: number;
    x: number; // pointer x at grab
    ppb: number;
    pending?: boolean;
  } | null>(null);
  const fadeRef = useRef<typeof fade>(null);
  fadeRef.current = fade;

  const onFadeMove = useCallback((e: React.PointerEvent) => {
    const f = fadeRef.current;
    if (!f || f.pending) return;
    // A fade has no grid of its own to keep an offset from: Shift frees it, and so does Ctrl, as it always has.
    const free = freeSnap(e) || e.shiftKey;
    // A fade-in grows rightwards and a fade-out leftwards, so the pointer's delta counts against the one and for the other.
    const dx = (e.clientX - f.x) / f.ppb;
    const d = snapTo(f.which === "fadeIn" ? dx : -dx, free ? 0 : 1);
    const len = Math.max(0, Math.min(f.span, f.orig + d));
    if (len !== f.len) setFade({ ...f, len });
  }, []);

  const commitFade = useCallback(() => {
    const f = fadeRef.current;
    if (f?.pending) return; // a second pointerup must not send the same edit twice
    if (!f || !proj) {
      setFade(null);
      return;
    }
    const num = proj.timeSigNumerator;
    const den = proj.timeSigDenominator;
    // Ended where it started: write nothing, the courtesy every other drag here extends.
    if (f.len === f.orig) {
      setFade(null);
      setStatus("fade cancelled — no change");
      return;
    }
    setFade({ ...f, pending: true });
    onFadeEvent?.(
      f.trackId,
      beatsToPosition(f.start, num, den),
      f.which,
      // A LENGTH, so it is spelled as a duration — the command reads it back with `parseDuration` (see `event fadein`).
      beatsToDuration(f.len, num, den),
    );
  }, [proj, onFadeEvent, setStatus]);

  // --- dragging a PICTURE placement ---------------------------------------------

  /** The three drags a shot takes, told apart by where the press landed — the left edge writes three fields (docs/picture.md). */
  const [vdrag, setVDrag] = useState<VDrag | null>(null);
  const vdragRef = useRef<VDrag | null>(vdrag);
  vdragRef.current = vdrag;
  // The ruler's drawn ticks (in beats) and the beats-per-second, assigned during render below and read on pointerdown.
  const ticksRef = useRef<number[]>([]);
  // …and the list itself, kept until what draws it changes (built far below, past an early return no hook may follow).
  const ticksCache = useRef<{ key: string; beats: number[] } | null>(null);
  const bpsRef = useRef(1);
  const onVideoEditRef = useRef(onVideoEdit);
  onVideoEditRef.current = onVideoEdit;

  const beginVideoDrag = useCallback(
    (
      e: React.PointerEvent,
      track: WebVideoTrack,
      c: WebVideoTrack["clips"][0],
      index: number,
      mode: VDrag["mode"],
    ) => {
      if (e.button !== 0 || !onVideoEditRef.current) return;
      e.stopPropagation();
      // The tools reach a SHOT too, each on its `picture …` verb, and the grab never starts (docs/timeline.md).
      if (toolRef.current !== "pointer" && onToolLine) {
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pxPerSec = Math.max(1e-6, ppbRef.current * bpsRef.current);
        const next = track.clips[index + 1];
        const end =
          c.length > 0
            ? c.start + c.length
            : next
              ? next.start
              : Number.POSITIVE_INFINITY;
        const raw =
          mode === "move"
            ? c.start + (e.clientX - r.left) / pxPerSec
            : mode === "in"
              ? c.start
              : end;
        const act = pictureToolLine(toolRef.current, {
          lane: track.id,
          name: c.name || c.id || "on",
          start: c.start,
          end,
          at: e.shiftKey
            ? raw
            : snapTo(raw * bpsRef.current, unitRef.current) / bpsRef.current,
        });
        if (act?.line) onToolLine(act.line);
        if (act) setStatus(act.note);
        if (act) return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setVDrag({
        trackId: track.id,
        index,
        // The compile leaves an activation's id empty, having no ref to put there.
        activation: !c.id,
        mode,
        origStart: c.start,
        origLength: c.length,
        origFrom: c.sourceFrom,
        ...(c.speed !== undefined ? { speed: c.speed } : {}),
        start: c.start,
        length: c.length,
        x: e.clientX,
        // px per second at the grab: px per beat × beats per second.
        pxPerSec: Math.max(1e-6, ppbRef.current * bpsRef.current),
        moved: false,
      });
    },
    [onToolLine, setStatus],
  );

  const onVideoDragMove = useCallback((e: React.PointerEvent) => {
    const v = vdragRef.current;
    if (!v || v.pending) return;
    // Measured from the GRAB and not from the last frame: a re-applied offset makes the edge run away from the cursor.
    const raw = (e.clientX - v.x) / v.pxPerSec;
    if (Math.abs(e.clientX - v.x) > DRAG_SLOP) v.moved = true;
    // The ruler's own ticks; Ctrl moves by whole steps of its unit instead, keeping the shot's offset; Shift is free (snap.ts).
    const mode = snapMode(e);
    const d =
      mode === "relative" ? snapTo(raw, unitRef.current / bpsRef.current) : raw;
    const snapSec = (sec: number): number => {
      if (mode !== "grid") return Math.max(0, sec);
      const t = nearestTick(ticksRef.current, sec * bpsRef.current);
      return t === null ? Math.max(0, sec) : Math.max(0, t / bpsRef.current);
    };
    const next = videoDragTo(v, d, snapSec);
    if (next.start !== v.start || next.length !== v.length)
      setVDrag({ ...v, ...next });
  }, []);

  const commitVideoDrag = useCallback(() => {
    const v = vdragRef.current;
    if (!v || v.pending) return; // a second pointerup must not send the same edit twice
    const write = onVideoEditRef.current;
    // A drag that ended where it started writes nothing — the same courtesy the clip drag extends.
    if (!write || !v.moved || videoDragIsStill(v)) {
      setVDrag(null);
      if (v.moved) setStatus("drag cancelled — no change");
      return;
    }
    // Held until the reload, exactly as a committed move is: clearing here snapped the shot back for a round trip.
    setVDrag({ ...v, pending: true });
    write(v.trackId, videoDragEdits(v));
  }, [setStatus]);

  // The browser took the gesture: the shot goes back where it was, and nothing is written.
  const cancelVideoDrag = useCallback(() => {
    setVDrag((v) => (v && !v.pending ? null : v));
  }, []);

  // The reload landed, so the compiler's answer replaces the drag's guess — the same rule the clip move follows.
  useEffect(() => {
    setVDrag((v) => (v?.pending ? null : v));
  }, [videoTracks]);

  // A live prop read from pointer callbacks that must not re-bind on every frame — as `commitMoveRef` does.
  const feedMoveRef = useRef(feedMove);
  feedMoveRef.current = feedMove;
  const feedTimecodeRef = useRef(feedTimecode);
  feedTimecodeRef.current = feedTimecode;

  // The move as `event move`'s four values, in ONE place, so a live drag and its release cannot disagree.
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
      /** On the RULER'S UNIT, read at the grab: the grid itself, Ctrl keeping the event's offset from it, Shift free (snap.ts). */
      const offset = moveOffset(
        e.clientX - d.x,
        d.ppb,
        d.unit,
        m.origStart,
        snapMode(e),
      );
      const lane = laneAtPoint(e.clientX, e.clientY);
      // Where the event may LAND: a lane takes it when its matching output is wired, which `contentType` says in one word (packages/song/docs/trackModules.md).
      const src = projRef.current?.tracks.find((t) => t.id === m.trackId);
      const takes =
        src?.clips.find((c) => c.id === m.clipId)?.type === "midi"
          ? "notes"
          : "audio";
      const toTrackId =
        lane && !lane.generated && lane.contentType.includes(takes)
          ? lane.id
          : m.toTrackId;
      if (offset !== m.offset || toTrackId !== m.toTrackId) {
        const next = { ...m, offset, toTrackId };
        setMove(next);
        // …and if the bar is asking for this move, it reads the timecode under the pointer as the drag happens.
        const feed = feedMoveRef.current;
        const a = feed ? moveArgs(next) : null;
        if (feed && a) feed(a.trackId, a.fromTc, a.toTc, a.toTrackId, true);
      }
    },
    [laneAtPoint, moveArgs],
  );

  /** Put the caret ON the event that was clicked, covering it — the same `v` rectangle the keyboard builds, clamped to the zoomed view. */
  const coverClip = useCallback(
    (m: Move) => {
      const row: RowKey = `track:${m.trackId}`;
      const len = m.length > 0 ? m.length : NATURAL;
      const lo = clampCell({ row, beat: Math.floor(m.origStart) });
      const hi = clampCell({
        row,
        beat: Math.max(lo.beat, Math.ceil(m.origStart + len) - 1),
      });
      setCaret(clampCaret({ row, beat: lo.beat }));
      setSel({ anchor: lo, head: hi });
    },
    [clampCell, clampCaret],
  );

  // When a click last opened a clip: the split it causes can shift the lanes, so a double-click's second press may land on bare lane.
  const clipOpenedAt = useRef(0);

  const endClipDrag = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    // Answering the bar is NOT committing, and it comes BEFORE the click branch: a click is how you say WHICH clip.
    const feed = feedMoveRef.current;
    const m = moveRef.current;
    if (feed && m) {
      const a = moveArgs(m);
      if (a) feed(a.trackId, a.fromTc, a.toTc, a.toTrackId, false);
      setMove(null);
      setStatus("event move — enter runs it, esc drops the line");
      return;
    }
    // A press that never passed the slop is a CLICK: it selects the clip, and only a DOUBLE-click opens it (docs/timeline.md).
    if (!d.moved && m) {
      coverClip(m);
      setMove(null);
      return;
    }
    commitMoveRef.current();
  }, [moveArgs, setStatus, coverClip]);

  /** The browser took the gesture away — a system swipe, palm rejection: the clip goes back, and nothing is written. */
  const cancelClipDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setMove(null);
  }, []);

  /** A clip's double-click: its contents in the event panel. */
  const openClip = useCallback(
    (e: React.MouseEvent, c: WebClip, track: string) => {
      const p = projRef.current;
      if (!p) return;
      e.stopPropagation();
      clipOpenedAt.current = performance.now();
      onOpenClip?.({ kind: "clip", project: p, clip: c, track });
    },
    [onOpenClip],
  );

  /** The frozen lane's authored MIDI clip under the pointer — or its first, when the press falls between two. */
  const openFrozenNotes = useCallback(
    (e: React.MouseEvent, track: WebTrack, c: WebClip) => {
      const p = projRef.current;
      const midi = (track.frozenMaterial ?? []).filter(
        (m) => m.type === "midi",
      );
      if (!p || !midi.length) return;
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const at =
        c.start + (e.clientX - r.left) / Math.max(1e-6, ppbRef.current);
      const hit =
        midi.find(
          (m) =>
            m.start <= at && at < m.start + (m.length > 0 ? m.length : NATURAL),
        ) ?? midi[0];
      clipOpenedAt.current = performance.now();
      onOpenClip?.({ kind: "clip", project: p, clip: hit, track: track.id });
    },
    [onOpenClip],
  );

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
    // HELD, not cleared: clearing here draws the clip back at its old start for the whole write-and-reload round trip.
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
      // One block per MODE, and the mode is derived from the state this used to read directly (timelineMode.ts).
      if (modeRef.current === "move") {
        // Move swallows keys HARD, the ones it answers and every other: a nudge must not also scroll the pane.
        const d = moveNudge(e.key);
        if (d) nudgeMove(d);
        else if (e.key === "Enter") commitMove();
        else if (e.key === "Escape") {
          setMove(null);
          setStatus("move cancelled");
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const selecting = modeRef.current === "select";
      // Escape drops the selection and stops there, or the shell would also throw you out of the fullscreen pane.
      if (selecting && e.key === "Escape") {
        const s = selRef.current;
        setSel(null);
        if (s) setCaret(clampCaret(s.head)); // the caret lands where the selection ended
        setStatus("selection cancelled");
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // hjkl and the arrows walk in both remaining modes; WHAT they walk is the difference between them.
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
      stepTarget: (sec, dir) => {
        const bps = bpsRef.current;
        const to = adjacentTick(ticksRef.current, sec * bps, dir);
        return to === null ? null : to / bps;
      },
      /** `selection copy` — the events inside the rectangle, relative to its corner; TRACK rows only, skipped rather than counted. */
      copy: () => {
        const s = selRef.current;
        /** NO RECTANGLE: the PLACEMENT under the caret is what gets copied — a lane's unit is a clip rather than a grid step. */
        if (!s) {
          const c = clipUnderCaret;
          // A generated lane's clips are the scheduler's look-ahead, backed by no file — there is no placement to put down.
          if (!c || caretRow?.kind !== "track" || caretRow.track.generated)
            return null;
          const len = c.length > 0 ? c.length : NATURAL;
          return copyEvents([laneEvents(caretRow)], c.start, c.start + len);
        }
        const a = rowIndexOf(visRows, s.anchor.row);
        const b = rowIndexOf(visRows, s.head.row);
        if (a < 0 || b < 0) return null;
        const lo = Math.min(s.anchor.beat, s.head.beat);
        const hi = Math.max(s.anchor.beat, s.head.beat);
        const lanes = visRows
          .slice(Math.min(a, b), Math.max(a, b) + 1)
          .flatMap((r) =>
            r.kind === "track" && !r.track.generated ? [laneEvents(r)] : [],
          );
        return lanes.length ? copyEvents(lanes, lo, hi + 1) : null;
      },
      /** `selection paste` — one `events add`, so twelve placements are one journal entry; the lanes are the track rows from the CARET down. */
      pasteLine: (c) => {
        if (c.kind !== "events")
          return { note: "the clipboard holds notes, not events" };
        if (!proj || caret.beat === LABEL)
          return {
            note: "put the caret in a lane first — a label is not a position",
          };
        const at = rowIndexOf(visRows, caret.row);
        if (at < 0) return { note: "the caret is on no row" };
        const lanes = visRows
          .slice(at)
          .flatMap((r) =>
            r.kind === "track" && !r.track.generated ? [r.track.id] : [],
          );
        const out = pasteEvents(c, lanes, caret.beat);
        if (!out.length)
          return {
            note: "nothing to paste here — no lane under the rectangle",
          };
        const num = proj.timeSigNumerator;
        const den = proj.timeSigDenominator;
        // `start` is the only field re-spelled: it is a position in the ARRANGEMENT and the paste moved it.
        const payload = out.map((e) => ({
          track: e.track,
          ref: e.ref,
          start: beatsToPosition(e.start, num, den),
          ...(e.from !== undefined ? { from: e.from } : {}),
          ...(e.to !== undefined ? { to: e.to } : {}),
          ...(e.fadeIn ? { fadeIn: e.fadeIn } : {}),
          ...(e.fadeOut ? { fadeOut: e.fadeOut } : {}),
          ...(e.loop ? { loop: e.loop } : {}),
          ...(e.disabled ? { disabled: true } : {}),
          ...(e.warp === false ? { warp: false } : {}),
        }));
        const dropped = droppedCount(out.length, c);
        return {
          line: `events add ${JSON.stringify(payload)}`,
          note:
            `${out.length} event${out.length > 1 ? "s" : ""} pasted` +
            (dropped ? ` — ${dropped} had no lane and were left` : ""),
        };
      },
      /** `selection delete` — one `events remove` naming each event the rectangle holds, so the lot is one Ctrl+Z. */
      splitLine: (sec) => {
        if (!proj) return { note: "no project" };
        const bps = proj.tempo / 60;
        const nothing = {
          note: "nothing to split — put the caret on a lane with a clip under the playhead",
        };
        if (caretRow?.kind === "video") {
          const clips = caretRow.track.clips;
          // The shot on TOP at the playhead: the last in file order whose span holds it, the picture's own rule.
          for (let i = clips.length - 1; i >= 0; i--) {
            const c = clips[i];
            const next = clips[i + 1];
            const end =
              c.length > 0
                ? c.start + c.length
                : next
                  ? next.start
                  : Number.POSITIVE_INFINITY;
            if (sec >= c.start && sec < end)
              return (
                pictureToolLine("cut", {
                  lane: caretRow.track.id,
                  name: c.name || c.id || "on",
                  start: c.start,
                  end,
                  at: sec,
                }) ?? nothing
              );
          }
          return nothing;
        }
        if (caretRow?.kind !== "track" || caretRow.track.generated)
          return nothing;
        const at = sec * bps;
        const c = caretRow.track.clips.find(
          (x) => at > x.start && (x.length <= 0 || at < x.start + x.length),
        );
        if (!c) return nothing;
        const tc = (b: number) =>
          beatsToPosition(b, proj.timeSigNumerator, proj.timeSigDenominator);
        return (
          toolLine("cut", {
            track: caretRow.track.id,
            name: c.name || c.id,
            start: c.start,
            length: c.length,
            at,
            tc: tc(c.start),
            atTc: tc(at),
          }) ?? nothing
        );
      },
      deleteLine: () => {
        if (!proj) return { note: "no project" };
        const num = proj.timeSigNumerator;
        const den = proj.timeSigDenominator;
        const s = selRef.current;
        // NO RECTANGLE: the placement under the caret, the same one `copy` would take.
        if (!s) {
          const c = clipUnderCaret;
          if (!c || caretRow?.kind !== "track" || caretRow.track.generated)
            return {
              note: "nothing to delete — put the caret on a clip, or draw a rectangle with v",
            };
          return {
            line: `event remove ${caretRow.track.id} ${beatsToPosition(c.start, num, den)}`,
            note: "event deleted",
          };
        }
        const a = rowIndexOf(visRows, s.anchor.row);
        const b = rowIndexOf(visRows, s.head.row);
        if (a < 0 || b < 0) return { note: "the rectangle is on no row" };
        const lo = Math.min(s.anchor.beat, s.head.beat);
        const hi = Math.max(s.anchor.beat, s.head.beat) + 1;
        // The rule `copy` keeps: track rows only, and an event is in the rectangle when it STARTS there.
        const hits = visRows
          .slice(Math.min(a, b), Math.max(a, b) + 1)
          .flatMap((r) =>
            r.kind === "track" && !r.track.generated
              ? laneEvents(r)
                  .events.filter(
                    (e) => e.start >= lo - 1e-9 && e.start < hi - 1e-9,
                  )
                  .map((e) => ({
                    track: r.track.id,
                    start: beatsToPosition(e.start, num, den),
                  }))
              : [],
          );
        if (!hits.length)
          return { note: "no event starts inside the rectangle" };
        // The rectangle held what is gone: it is dropped, as a cut leaves nothing selected.
        setSel(null);
        return {
          line: `events remove ${JSON.stringify(hits)}`,
          note: `${hits.length} event${hits.length > 1 ? "s" : ""} deleted`,
        };
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
        if (c.frozen) return; // a render, not a placement — see the pointer path above
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
      // The clock button: bars ⇄ seconds. Both units read the SAME grid — see docs/picture.md.
      toggleRuler: () =>
        setRulerMode((m) => (m === "bars" ? "seconds" : "bars")),
      // The height button: tall lanes draw each clip's waveform or notes.
      toggleLanes: () => {
        if (!lanesLocked) setExpanded((v) => !v);
      },
      toggleAutomation: () => setShowAutomation((v) => !v),
      // Picking up a tool drops the rectangle: the two are different questions, and a press is about to mean something else.
      setTool: (t) => {
        setTool(t);
        if (t !== "pointer") setSel(null);
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
      lanesLocked,
    ],
  );

  useEffect(
    () =>
      onView({
        mode,
        tool,
        selecting: !!sel,
        zoomed: zoom.length > 0,
        loop: !!loop,
        expanded,
      }),
    [mode, tool, sel, zoom, loop, expanded, onView],
  );

  // Leaving the tab drops the pickup, rather than stranding a move whose keys no longer reach it.
  useEffect(() => {
    if (!active) setMove(null);
  }, [active]);

  // The playhead does NOT touch the caret: two independent positions, and only you move the caret — see docs/timeline.md.

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

  /** The lanes a rectangle covers that can actually hold events, comma-joined, and its span — null rather than an empty string. */
  const selRange = useMemo(() => {
    if (!selBox || !proj) return null;
    const ids = visRows
      .slice(selBox.rowLo, selBox.rowHi + 1)
      .flatMap((r) =>
        r.kind === "track" && !r.track.generated ? [r.track.id] : [],
      );
    if (!ids.length) return null;
    const num = proj.timeSigNumerator;
    const den = proj.timeSigDenominator;
    return {
      tracks: ids.join(","),
      from: beatsToPosition(selBox.beatLo, num, den),
      to: beatsToPosition(selBox.beatHi, num, den),
    };
  }, [selBox, visRows, proj]);

  // The caret, whole: where it is, what it is over, and what it has selected — one payload, because one gesture moves all three.
  useEffect(() => {
    // The grid, read here rather than passed in: a beat means nothing without the time signature.
    const at = (beat: number): string | null =>
      proj
        ? beatsToPosition(beat, proj.timeSigNumerator, proj.timeSigDenominator)
        : null;
    onCaret({
      ...caret,
      trackId: caretTrackId,
      // LABEL is 'parked on the row's name', a row and not a moment, so it reports no timecode.
      tc: caret.beat === LABEL ? null : at(caret.beat),
      eventTc: clipUnderCaret ? at(clipUnderCaret.start) : null,
      selection: selRange,
    });
  }, [caret, caretTrackId, clipUnderCaret, selRange, proj, onCaret]);

  // While the bar is filling `events move`, the rectangle ANSWERS its region and re-answers on every change.
  useEffect(() => {
    if (!feedEventsMove || !selRange) return;
    feedEventsMove(selRange.tracks, selRange.from, selRange.to);
  }, [feedEventsMove, selRange]);

  useEffect(() => {
    if (!active) return;
    // A TOOL in hand outranks everything below: a press is about to do something other than what this pane usually does.
    if (tool !== "pointer") {
      setStatus(m["tl.toolPicked"]({ tool }));
      return;
    }
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
    // Same for a resize — a drag with no numbers is a guess, and the span is the whole point of the gesture.
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
    else if (caretRow.kind === "video")
      setStatus(
        `selected: video ${caretRow.track.name} — picture, cut in seconds; drag its shots, m hides the lane`,
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
    // …and a tool outranks even that.
    tool,
    proj,
  ]);

  // Only with nothing to draw: a failed RE-read keeps the last song on screen while useDocument retries.
  if (error && !proj)
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
  // Beats per second — the whole conversion between the song's unit and the picture's, exact because there is ONE tempo, clamped off zero.
  const bps = Math.max(1e-6, proj.tempo / 60);
  // The ruler's scale, from the SHARED chooser (Ruler.tsx), so this ruler and the clip editors' cannot pick different ladders.
  const { unit, secStep, barStride } = rulerScale(
    rulerMode,
    ppb,
    barBeats,
    bps,
    lastBeat,
    fps,
  );
  // The drawn ticks, for the gestures that SNAP to one — cached on what draws them: built whole, they are up to ~190 000 entries a render.
  const ticksKey = `${rulerMode}|${beatLo}|${lastBeat}|${unit}|${barBeats}|${bps}|${secStep}|${fps}`;
  if (ticksCache.current?.key !== ticksKey)
    ticksCache.current = {
      key: ticksKey,
      beats: rulerTicks(
        rulerMode,
        beatLo,
        lastBeat,
        unit,
        barBeats,
        bps,
        secStep,
        undefined,
        fps,
      ).map((t) => t.beat),
    };
  const bars = ticksCache.current.beats;
  ticksRef.current = bars;
  bpsRef.current = bps;
  /** …and the step a CLIP drag moves in, in beats: whatever the ruler is drawing, snapping the OFFSET rather than the resulting position. */
  unitRef.current = rulerMode === "seconds" ? secStep * bps : unit;
  // Both tick layers take the same seven, so the ruler and the grid cannot read different units.
  const tickProps = {
    mode: rulerMode,
    beatLo,
    lastBeat,
    unit,
    barBeats,
    bps,
    secStep,
    fps,
  };

  // Markers inside the visible range, drawn in the ruler; num/den turn a right-click beat into a timecode.
  const tsNum = proj.timeSigNumerator;
  const tsDen = proj.timeSigDenominator;
  const visMarkers = (proj.markers ?? []).filter(
    (mk) => mk.beat >= beatLo && mk.beat <= lastBeat,
  );
  // The tasks pinned somewhere in view; a timecode this song's grid cannot read is not drawn rather than drawn wrong.
  const visTasks = tasks.flatMap((t) => {
    if (!t.at) return [];
    try {
      const beat = parsePosition(t.at.timecode, tsNum, tsDen);
      return beat >= beatLo && beat <= lastBeat ? [{ ...t, beat }] : [];
    } catch {
      return [];
    }
  });

  // --- dropping OS files on a lane (docs/timeline.md) -------------------------------

  /** The lanes a drop may walk down, in drawing order — a generated lane holds no file, a lane drawing shapes no placement. */
  const dropTargets = visRows.flatMap((r): DropLane[] =>
    r.kind === "track" && !r.track.generated
      ? [{ id: r.track.id, kind: "audio" }]
      : r.kind === "video" && !r.track.shapes.length
        ? [{ id: r.track.id, kind: "video" }]
        : [],
  );
  const dropping = !readOnly && !!onDropFiles;
  /** Where a file drag is over: the DOM says which lane, as it does for a clip drag, and the lane's own left edge says which beat. */
  const dropPointAt = (
    cx: number,
    cy: number,
  ): { lane: string; beat: number } | null => {
    const el = document
      .elementFromPoint(cx, cy)
      ?.closest?.("[data-lane-track],[data-lane-video]");
    const id =
      el?.getAttribute("data-lane-track") ??
      el?.getAttribute("data-lane-video");
    if (!el || !id) return null;
    const raw = Math.max(
      0,
      beatLo + (cx - el.getBoundingClientRect().left) / ppb,
    );
    // Snapped to the lines actually drawn, whichever unit the ruler is reading — the rule every gesture here follows.
    return { lane: id, beat: nearestTick(bars, raw) ?? raw };
  };
  /** Where the drop would land on this lane — a caret rather than a block, the material having no width until it is read. */
  const dropMark = (lane: string) =>
    dropAt?.lane === lane ? (
      <div
        className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-primary"
        style={{ left: x(dropAt.beat) }}
      />
    ) : null;

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
    visRows.reduce(
      // A group header and an automation row are short; a lane row is not.
      (h, r) =>
        h + (r.kind === "group" || r.kind === "automation" ? ROW_H : rowH),
      0,
    );
  // Each row's top under the ruler, the y the clip window is tested against; the ruler's own height sits inside the margin.
  const rowTops: number[] = [];
  visRows.reduce((y, r) => {
    rowTops.push(y);
    return y + (r.kind === "group" || r.kind === "automation" ? ROW_H : rowH);
  }, 0);
  const rowNear = (ri: number, h: number) =>
    rowTops[ri] + h >= clipWin.y0 && rowTops[ri] <= clipWin.y1;
  const xNear = (left: number, w: number) =>
    left + w >= clipWin.x0 && left <= clipWin.x1;

  return (
    // min-w-0: without it the fixed-width lane sets this flex child's min width and the fit-to-pane scale ratchets.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* The tools as a 32px column — the third way to one, beside the keys and the bar, and the only one a finger has. */}
        <ModeStrip
          // A second device dispatches no tool line, and the column is still drawn: the two view toggles under it are the pane's own.
          modes={onToolLine ? TOOLS : NO_TOOLS}
          current={tool}
          onPick={(t) => onToolLine?.(`ui tool ${t}`)}
          title={(t) => TOOL_LABEL[t]()}
          footer={
            <>
              {/* The ruler's unit, beside Expand because it is the same kind of control: what this surface SHOWS, changing nothing on disk. */}
              <button
                type="button"
                onClick={() =>
                  setRulerMode((m) => (m === "bars" ? "seconds" : "bars"))
                }
                aria-pressed={rulerMode === "seconds"}
                title={
                  rulerMode === "seconds"
                    ? m["tl.rulerSeconds"]()
                    : m["tl.rulerBars"]()
                }
                className={stripButton(rulerMode === "seconds")}
              >
                <Clock className="h-4 w-4" />
              </button>
              {/* Expand: taller lanes that reveal each clip's waveform / notes. */}
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                disabled={lanesLocked}
                aria-pressed={expanded}
                title={
                  lanesLocked
                    ? "lanes stay folded while a bottom panel is open"
                    : expanded
                      ? "collapse lanes"
                      : "expand lanes to show clip contents (waveforms / notes)"
                }
                className={`${stripButton(expanded)} disabled:opacity-40`}
              >
                <StretchVertical className="h-4 w-4" />
              </button>
              {/* Automation lanes shown or hidden: only drawn when a lane HAS automation, so the button is never a dead toggle. */}
              {laneNodes?.automation &&
                Object.keys(laneNodes.automation).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAutomation((v) => !v)}
                    aria-pressed={showAutomation}
                    title={
                      showAutomation
                        ? "hide automation lanes"
                        : "show automation lanes"
                    }
                    className={stripButton(showAutomation)}
                  >
                    <Spline className="h-4 w-4" />
                  </button>
                )}
            </>
          }
        />
        {/* `isolate` — load-bearing: it keeps this pane's four z-indices private from the shell's (docs/timeline.md). */}
        <div
          ref={scrollRef}
          // The tool's own icon AS the cursor, forced past the clip's `cursor-grab` so the hand says what a press will do.
          style={toolCursor ? { cursor: toolCursor } : undefined}
          className={cn(
            // A stable gutter: the pane shrinking under a split must not refit the lanes and slide the clip from under the pointer.
            "isolate min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]",
            toolCursor && "[&_*]:!cursor-[inherit]",
          )}
          /** OS files: preventDefault is what ACCEPTS the drop — without it the browser silently refuses and then opens the file (fileDrop.ts). */
          onDragOver={(e) => {
            if (!dropping || !acceptsFileDrop(dragPayload(e))) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            const spot = dropPointAt(e.clientX, e.clientY);
            // Returning the same object bails the update out: `dragover` fires per frame, and this component is not small.
            setDropAt((d) =>
              d?.lane === spot?.lane && d?.beat === spot?.beat ? d : spot,
            );
          }}
          // `dragleave` also fires crossing into a child, so the mark comes down only when the pointer really left the pane.
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setDropAt(null);
          }}
          onDrop={(e) => {
            if (!dropping || !acceptsFileDrop(dragPayload(e))) return;
            e.preventDefault();
            setDropAt(null);
            const spot = dropPointAt(e.clientX, e.clientY);
            const files = Array.from(e.dataTransfer.files);
            if (!files.length) return;
            // A lane is what says WHERE the material goes, so a drop between rows is refused by name rather than guessed at.
            if (!spot) {
              setStatus(
                "drop it on a lane — a lane is what says where it goes",
              );
              return;
            }
            onDropFiles?.({
              lane: spot.lane,
              lanes: dropTargets,
              tc: beatsToPosition(spot.beat, tsNum, tsDen),
              seconds: Math.round((spot.beat / bps) * 1000) / 1000,
              files,
            });
          }}
        >
          <div
            style={{ width: GUTTER + laneW }}
            className="relative select-none font-mono text-xs"
          >
            {/* The GRID: the ruler's own ticks continued down the lanes, dashed and FIRST in the wrapper so everything paints over it. */}
            <Grid
              {...tickProps}
              ppb={ppb}
              laneW={laneW}
              left0={GUTTER}
              scroller={scrollRef}
              top={ROW_H} // below the ruler, which draws its own solid tick
              height={contentH - ROW_H}
            />
            {/* ruler */}
            <div
              className="sticky top-0 z-40 flex bg-background"
              style={{ height: ROW_H }}
            >
              {/* The corner: sticky BOTH ways, and needing no ground of its own since the ruler row is opaque across the full width. */}
              <div
                style={{ width: GUTTER }}
                className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-background px-1"
              >
                {/* NEW TRACK, in the corner: the one place above the lanes that scrolls with neither axis, and `track new` like everything else. */}
                {/* One button, two shapes: a song with no frame has one kind of lane, so a menu of one would be a click for nothing. */}
                {onNewTrack &&
                  (onNewVideoTrack ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          title={m["tl.newLane"]()}
                          className={NEW_TRACK_BTN}
                        >
                          <Plus className="h-3 w-3" />
                          {m["tl.lane"]()}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          className="gap-2 text-xs"
                          onSelect={onNewTrack}
                        >
                          <Music className="h-3.5 w-3.5 opacity-70" />
                          {m["tl.audioLane"]()}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-2 text-xs"
                          onSelect={onNewVideoTrack}
                        >
                          {/* The camcorder every picture lane wears, so the entry and the row it makes are one thing. */}
                          <TrackIcon
                            name=""
                            video
                            className="h-3.5 w-3.5 opacity-70"
                          />
                          {m["tl.videoLane"]()}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <button
                      type="button"
                      onClick={onNewTrack}
                      title={m["tl.newLaneOnly"]()}
                      className={NEW_TRACK_BTN}
                    >
                      <Plus className="h-3 w-3" />
                      {m["tl.lane"]()}
                    </button>
                  ))}
              </div>
              {/* The ruler is both the transport scrubber and a time-range selector — click seeks, drag sweeps `v`'s rectangle (docs/timeline.md). */}
              <div
                className="relative cursor-pointer overflow-hidden"
                style={{ width: laneW }}
                onMouseDown={(e) => {
                  // A macOS Ctrl+click is the context menu's, not a seek: answered here, it cleared the selection the menu then looped.
                  if (e.button !== 0 || e.ctrlKey) return;
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
                      // Vertical drag → zoom, 1.005 per px; the ceiling is the pane's, not a constant of its own.
                      const next = Math.max(
                        1,
                        Math.min(zoomCeiling(availW), zoomStart * 1.005 ** -dy),
                      );
                      // Anchor: keep the beat under the cursor fixed after the width change, through the package — see useHZoom's `zoomAt`.
                      zoomAtX(next, startX);
                    } else {
                      // Horizontal drag → selection
                      if (!dragged && Math.abs(dx) <= GESTURE_SLOP) return;
                      dragged = true;
                      const headBeat = cellAt(ev.clientX);
                      setSel((s) =>
                        s &&
                        s.anchor.row === firstRow &&
                        s.anchor.beat === startBeat &&
                        s.head.row === lastRow &&
                        s.head.beat === headBeat
                          ? s
                          : {
                              anchor: { row: firstRow, beat: startBeat },
                              head: { row: lastRow, beat: headBeat },
                            },
                      );
                    }
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    el.style.cursor = "";
                    if (gesture === -1) return; // zoom gesture — nothing to undo
                    if (dragged) return; // selection stays
                    setSel(null); // plain click deselects and seeks
                    // Snapped to the nearest tick the ruler DREW: `bars` is that list, so the grid you see and the positions you can land on agree.
                    const raw = Math.max(
                      0,
                      beatLo + (startX - rect.left) / ppb,
                    );
                    const beat = nearestTick(bars, raw) ?? raw;
                    // If the bar is asking for a timecode, the click ANSWERS it and the transport stays put — only a click, never a drag.
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
                  // Right-click the ruler → 'add marker here', snapped to the same drawn tick a left-click seek uses (docs/timeline.md).
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const raw = Math.max(
                    0,
                    beatLo + (e.clientX - rect.left) / ppb,
                  );
                  const at = nearestTick(bars, raw) ?? raw;
                  onContextMenu?.(
                    {
                      kind: "marker-add",
                      tc: beatsToPosition(at, tsNum, tsDen),
                      // The same precedence `toggleLoop` applies: a selection is looped, otherwise a loop is cleared.
                      loop: selRef.current ? "set" : loop ? "clear" : undefined,
                    },
                    e.clientX,
                    e.clientY,
                  );
                }}
              >
                {/* The RULES always draw; only the NUMBERS thin out, strided on the bar's own index so scrolling never moves them (ticks.ts). */}
                <RulerTicks
                  {...tickProps}
                  ppb={ppb}
                  barStride={barStride}
                  scroller={scrollRef}
                />
                {/* The transport loop region over its bar range; the ENGINE does the wrapping, this only shows what is looping. */}
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
                {/* Marker handles: a diamond flag in the ruler, hover for the name and right-click to delete; the full line is drawn below. */}
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
                {/* Task flags at the ruler's foot: hover for the text; a click falls through to the ruler, which seeks there. */}
                {visTasks.map((t) => (
                  <button
                    type="button"
                    key={`task:${t.line}`}
                    className={cn(
                      "absolute bottom-0 z-20 -translate-x-1/2 border-0 bg-transparent p-0",
                      t.done ? "text-muted-foreground/50" : "text-amber-400",
                    )}
                    style={{ left: x(t.beat) }}
                    aria-label={t.text}
                    onMouseEnter={() =>
                      setHoverTask({ beat: t.beat, text: t.text })
                    }
                    onMouseLeave={() => setHoverTask(null)}
                    onFocus={() => setHoverTask({ beat: t.beat, text: t.text })}
                    onBlur={() => setHoverTask(null)}
                  >
                    <ListTodo className="h-3 w-3" />
                  </button>
                ))}
              </div>
              {/* The hovered task's text, hung under the ruler: inside it, the ruler's own clipping would cut it off. */}
              {hoverTask && (
                <div
                  className="pointer-events-none absolute z-50 max-w-xs rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow"
                  style={{ top: ROW_H, left: GUTTER + x(hoverTask.beat) }}
                >
                  {hoverTask.text}
                </div>
              )}
            </div>

            {/* lanes — group headers with their members nested under them. */}
            {visRows.map((row, ri) => {
              // Is this the caret's row, with its LABEL selected? The gutter wears the caret's own marks, because it IS the caret.
              const onRow = rowKey(row) === caret.row;
              const labelled = onRow && caret.beat === LABEL;
              // Inside the `v` rectangle? The gutter marks it too, so a rectangle reads as covering whole lanes.
              const inSel =
                !!selBox && ri >= selBox.rowLo && ri <= selBox.rowHi;

              // A group holds no material: a grey band naming what is below it. Its label still takes the caret, for mute/solo.
              if (row.kind === "group")
                return (
                  <div
                    key={`group:${row.group.id}`}
                    // Hit-tested by the shift-drag selection, as laneAtPoint does with data-lane-track.
                    data-sel-row={rowKey(row)}
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
                        GUTTER_STICKY,
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
                        {/* Stripped like a track row's: a group can pin its position too, and the full name stays in the title. */}
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

              /** A PICTURE lane: decimal seconds against a beat grid, exactly convertible here, so they can be dragged (docs/picture.md). */
              if (row.kind === "video") {
                const vt = row.track;
                const toBeats = (s: number) => s * bps;
                return (
                  <div
                    key={`video:${vt.id}`}
                    data-sel-row={rowKey(row)}
                    className={cn(
                      "flex border-b border-border/40",
                      // Dimmed == not on screen: hidden itself, or hidden because something else is soloed.
                      pictureOff(vt) && "opacity-50",
                      rowDrag?.lane === vt.id && "opacity-40",
                      rowDrag?.over === vt.id &&
                        rowDrag.lane !== vt.id &&
                        DROP_ROW,
                    )}
                    // No context menu: it is DERIVED from the command catalogue, and picture has no verbs in it (docs/contextMenu.md).
                    style={{ height: ROW_H }}
                  >
                    <div
                      style={{ width: GUTTER }}
                      {...gutterProps(row)}
                      className={cn(
                        "flex shrink-0 cursor-pointer select-none items-center gap-1 border-r border-border bg-muted/40 px-2",
                        GUTTER_STICKY,
                        onReorder && GRAB_ROW,
                        inSel && "bg-primary/20",
                        labelled && LABEL_SELECTED,
                      )}
                    >
                      {vt.color && (
                        <span
                          className="size-2 shrink-0 rounded-sm"
                          style={{ background: vt.color }}
                        />
                      )}
                      <TrackIcon
                        name={vt.name}
                        video
                        className="h-3.5 w-3.5 shrink-0 opacity-70"
                      />
                      <span
                        className="flex-1 truncate"
                        title={`${vt.name} — a ${vt.shapes.length ? "shape" : "video"} lane; cut in seconds, composited on the viewport`}
                      >
                        {trackLabel(vt.name)}
                      </span>
                      {/* [m]ute and [s]olo, the audio lane's two, meaning HIDDEN and hides-the-rest. */}
                      {onVideoToggle && (
                        <div className="flex shrink-0 items-center gap-0.5">
                          {(
                            [
                              [
                                "M",
                                "mute",
                                vt.mute,
                                "bg-orange-500 text-white",
                              ],
                              ["S", "solo", vt.solo, "bg-amber-400 text-black"],
                            ] as const
                          ).map(([label, control, on, onCls]) => (
                            <button
                              key={control}
                              type="button"
                              title={`${control} ${vt.name}`}
                              aria-label={`${control} ${vt.name}`}
                              aria-pressed={on}
                              onPointerDown={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onVideoToggle(vt.id, control);
                                blurOnClick(e);
                              }}
                              className={cn(
                                "flex h-4 w-4 items-center justify-center rounded-sm font-bold text-[9px] leading-none",
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
                      {/* ARM: a picture lane records its camera in the BROWSER, so a lane DRAWING shapes — which has no input — gets no button. */}
                      {onVideoArm && !vt.shapes.length && (
                        <button
                          type="button"
                          title={`arm ${vt.name} — record + play captures its camera`}
                          aria-label={`arm ${vt.name}`}
                          aria-pressed={videoArmed === vt.id}
                          onPointerDown={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onVideoArm(vt.id);
                            blurOnClick(e);
                          }}
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm font-bold text-[9px] leading-none",
                            videoArmed === vt.id
                              ? "bg-red-500 text-white"
                              : "bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground",
                            // Pulsing while the camera is actually rolling: armed and recording are two states.
                            videoArmed === vt.id &&
                              videoRecording &&
                              "animate-pulse",
                          )}
                        >
                          A
                        </button>
                      )}
                    </div>
                    <div
                      // Hit-tested by a file drop, as data-lane-track is: a lane drawing shapes holds no placements, so it takes none.
                      data-lane-video={vt.shapes.length ? undefined : vt.id}
                      className={cn(
                        "relative overflow-hidden",
                        dropAt?.lane === vt.id && DROP_LANE,
                        // Armed red, the whole lane, exactly as an armed audio lane reads.
                        videoArmed === vt.id && "bg-red-600/30",
                      )}
                      style={{ width: laneW }}
                    >
                      {vt.clips.map((c, i) => {
                        // The one being dragged draws where the pointer says — the ghost the commit then makes true.
                        const live =
                          vdrag && vdrag.trackId === vt.id && vdrag.index === i
                            ? vdrag
                            : null;
                        const start = live ? live.start : c.start;
                        const length = live ? live.length : c.length;
                        // An ACTIVATION says WHEN this lane is on and names no source (docs/shapes.md).
                        const activation = !c.id;
                        // A length-0 placement runs to the end of a source nothing has measured, so it draws provisional: dashed and amber.
                        const provisional = length <= 0;
                        // …except on an activation, whose length 0 needs no source opened: it runs to the next one.
                        // A retimed shot says so, since nothing else on the strip would: ×0.5, a freeze, a reverse.
                        const pace =
                          c.speed === undefined
                            ? ""
                            : c.speed === 0
                              ? " · freeze"
                              : ` ×${c.speed}`;
                        const label = activation
                          ? "on"
                          : `${c.name || c.id}${pace}`;
                        const w = Math.max(
                          ppb,
                          toBeats(provisional ? V_NATURAL : length) * ppb,
                        );
                        // Off screen and not in hand: nothing to draw — see ClipWindow.
                        if (
                          !live &&
                          !(rowNear(ri, ROW_H) && xNear(x(toBeats(start)), w))
                        )
                          return null;
                        return (
                          <div
                            // By placement, not by ref: one source may be placed twice, and the file keys its placements by ref too (videoTrackFile.ts).
                            key={`${c.id}:${i}`}
                            onPointerDown={(e) =>
                              beginVideoDrag(e, vt, c, i, "move")
                            }
                            onPointerMove={onVideoDragMove}
                            onPointerUp={commitVideoDrag}
                            onPointerCancel={cancelVideoDrag}
                            onContextMenu={(e) => {
                              // The shot's own start, not the pointer's: that is what the `picture …` verbs address it by.
                              e.preventDefault();
                              e.stopPropagation();
                              onContextMenu?.(
                                {
                                  kind: "picture-shot",
                                  lane: vt.id,
                                  at: String(c.start),
                                  name: label,
                                },
                                e.clientX,
                                e.clientY,
                              );
                            }}
                            className={cn(
                              "absolute inset-y-0.5 flex items-center gap-0.5 overflow-hidden rounded-sm px-1 text-[10px] text-white",
                              onVideoEdit ? "cursor-grab" : "",
                              provisional
                                ? "border border-dashed border-amber-400 bg-amber-600/50"
                                : "bg-violet-600/70",
                              live?.pending && "opacity-60",
                            )}
                            style={{ left: x(toBeats(start)), width: w }}
                            title={
                              activation
                                ? `${label} — ${provisional ? "until the next one" : `${length}s`} at ${start}s`
                                : `${label} — ${
                                    provisional
                                      ? "to the end of the source"
                                      : `${length}s`
                                  } at ${start}s, from ${c.sourceFrom}s into the source`
                            }
                          >
                            <TrackIcon
                              name={c.name}
                              video
                              className="h-2.5 w-2.5 shrink-0 opacity-80"
                            />
                            <span className="truncate">{label}</span>
                            {/* The two trim handles, wider than they look: a 6px target is a miss, and a miss lands on the body's own drag. */}
                            {onVideoEdit && (
                              <>
                                <span
                                  onPointerDown={(e) =>
                                    beginVideoDrag(e, vt, c, i, "in")
                                  }
                                  className="absolute inset-y-0 left-0 w-2 cursor-ew-resize"
                                />
                                <span
                                  onPointerDown={(e) =>
                                    beginVideoDrag(e, vt, c, i, "out")
                                  }
                                  className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                      {inSel && selBox && selSlice(selBox)}
                      {dropMark(vt.id)}
                    </div>
                  </div>
                );
              }

              /** An AUTOMATION row: one knob of the lane above against song time — only a `custom` curve has a shape, and its header addresses the TRACK. */
              if (row.kind === "automation") {
                const lane = row.lane;
                const pts = lane.points
                  .map((pt) => {
                    try {
                      return {
                        b: parsePosition(
                          pt.time,
                          proj?.timeSigNumerator ?? 4,
                          proj?.timeSigDenominator ?? 4,
                        ),
                        v: Math.min(1, Math.max(0, pt.value)),
                      };
                    } catch {
                      return null; // an unreadable timecode is one point, not a broken row
                    }
                  })
                  .filter((pt): pt is { b: number; v: number } => !!pt)
                  .sort((a, b) => a.b - b.b);
                return (
                  <div
                    key={rowKey(row)}
                    data-sel-row={rowKey(row)}
                    className="flex border-border/40 border-b opacity-80"
                    style={{ height: ROW_H }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // The MOMENT under the pointer, snapped to a tick the ruler actually drew — what makes the `curve point …` verbs act where you aimed.
                      const box = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      const raw = Math.max(
                        0,
                        beatLo + (e.clientX - box.left - GUTTER) / ppb,
                      );
                      onContextMenu?.(
                        {
                          kind: "curve-point",
                          curve: row.lane.curve,
                          param: row.lane.param,
                          tc: beatsToPosition(
                            nearestTick(bars, raw) ?? raw,
                            proj?.timeSigNumerator ?? 4,
                            proj?.timeSigDenominator ?? 4,
                          ),
                        },
                        e.clientX,
                        e.clientY,
                      );
                    }}
                  >
                    <div
                      style={{ width: GUTTER }}
                      {...gutterProps(row)}
                      className={cn(
                        "flex shrink-0 cursor-pointer select-none items-center gap-1 truncate border-r border-border bg-muted/30 px-2 text-[10px] text-muted-foreground",
                        GUTTER_STICKY,
                        // Indented past its lane: the knob belongs to the lane above.
                        "pl-5",
                      )}
                      title={`${lane.module} · ${lane.param} ← ${lane.curve}`}
                    >
                      <span className="truncate">{lane.param}</span>
                    </div>
                    <div className="relative flex-1 overflow-hidden">
                      {pts.length > 1 && (
                        // `vectorEffect` so the stroke keeps its width whatever the viewBox does — the x axis here is an extreme aspect.
                        <svg
                          className="pointer-events-none absolute inset-0 h-full w-full"
                          aria-hidden="true"
                        >
                          <title>{lane.param}</title>
                          <polyline
                            fill="none"
                            stroke="#a889b5"
                            strokeWidth={1.5}
                            vectorEffect="non-scaling-stroke"
                            points={pts
                              .map(
                                (pt) =>
                                  `${x(pt.b)},${(1 - pt.v) * (ROW_H - 6) + 3}`,
                              )
                              .join(" ")}
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                );
              }

              const { track: t, index: ti } = row;
              const eff = effOf(t);
              // Present only for a lane with a CHOICE of attribute sets — see LaneAlternative.
              const alt = laneNodes?.alternatives?.[t.id];
              // M/S/A states: the graph's live trackControls when available, else the doc's own values.
              const ctl = trackControls?.[t.id];
              // Armed by the engine (audio) or by the browser (MIDI), which only trackControls knows of.
              const armed = armedIds.includes(t.id) || ctl?.arm === 1;
              const msa: [string, "mute" | "solo" | "arm", boolean, string][] =
                [
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
                  data-sel-row={rowKey(row)}
                  className={cn(
                    "flex border-b border-border/40",
                    GROW,
                    // Dimmed == not audible: muted itself, muted by its group, or silenced because something else is soloed.
                    silent(t) && "opacity-50",
                    // …and the reorder drag's two marks: the lane in hand, and the slot it would take.
                    rowDrag?.lane === laneOf(t.id) && "opacity-40",
                    rowDrag?.over === laneOf(t.id) &&
                      rowDrag.lane !== laneOf(t.id) &&
                      DROP_ROW,
                  )}
                  style={{ height: rowH }}
                  // Right-click the lane or gutter → the track's commands. A clip stops this so its own menu wins.
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu?.(
                      {
                        kind: "track",
                        id: t.id,
                        ...(picked.length > 1 && picked.includes(t.id)
                          ? { picked }
                          : {}),
                      },
                      e.clientX,
                      e.clientY,
                    );
                  }}
                >
                  <div
                    style={{ width: GUTTER }}
                    {...gutterProps(row)}
                    className={cn(
                      // No `relative`: GUTTER_STICKY positions it, and two position classes would fight in `cn`.
                      "flex shrink-0 cursor-pointer select-none items-center gap-1 overflow-hidden border-r border-border px-2",
                      GUTTER_STICKY,
                      onReorder && !t.generated && GRAB_ROW,
                      // On the row: a faint tint. Label selected: the full caret mark.
                      onRow && !labelled && "bg-primary/10",
                      inSel && "bg-primary/20",
                      (labelled || picked.includes(t.id)) && LABEL_SELECTED,
                    )}
                  >
                    {/* Both live meters, subscribing for themselves — see LaneMeter. */}
                    <LaneMeter index={ti} armed={armed} />
                    {/* The instrument the name's prefix asks for ("ge.lead" → a strat), in the track's colour; undeclared gets a question mark. */}
                    <span
                      // The row shows the label alone, so the full name — the track's id and filename — has to be reachable here.
                      title={[
                        t.name,
                        trackIcon(t.name)?.label,
                        armed && "record-armed; records on play",
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
                      {/* Which attribute set this lane plays, before the name; `shrink-0` means a narrow gutter eats the name, not this. */}
                      {alt && onNodeMenu && (
                        <LaneAlternative
                          track={t.name}
                          names={alt.alternatives}
                          current={alt.alternative}
                          onOpen={(at) =>
                            onNodeMenu(
                              {
                                // A lane IS a module node, so it is addressable as one (packages/song/docs/trackModules.md).
                                module: t.id,
                                alternatives: alt.alternatives,
                                alternative: alt.alternative,
                                frozen: laneNodes?.frozen?.[t.id],
                              },
                              at,
                            )
                          }
                        />
                      )}
                      {/* The label alone: the row's position and the icon already say what "3.ge." would repeat at the gutter's expense. */}
                      <span className="truncate">{trackLabel(t.name)}</span>
                    </span>
                    {/* [m]ute / [s]olo / [a]rm, the graph's track nodes' own controls; stopPropagation so a tap does not also move the caret. */}
                    {onTrackToggle && (
                      <div className="relative flex shrink-0 items-center gap-0.5">
                        {msa.map(([label, control, on, onCls]) => (
                          <button
                            key={control}
                            title={`${control} ${t.name}`}
                            aria-label={`${control} ${t.name}`}
                            aria-pressed={on}
                            onPointerDown={(e) => e.stopPropagation()}
                            // dblclick is its own event and bubbles past the click handler's stop.
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
                  {/* overflow-hidden because a zoom puts out-of-view clips at negative offsets, which would spill across the gutter. */}
                  <div
                    // Hit-tested by a clip drag (laneAtPoint), rather than re-deriving row geometry there.
                    data-lane-track={t.id}
                    /** A click on the BARE lane: it puts the caret there, and `dragRef` is the test, since clips bubble to here. */
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      if (dragRef.current) return; // a clip took this press
                      /** Shift: the caret GROWS into the `v` rectangle — the same Selection the keyboard's `v` builds, and it works over a clip too. */
                      if (e.shiftKey) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const cellAt = (cx: number) =>
                          Math.max(
                            beatLo,
                            Math.min(
                              beatHi,
                              Math.floor(beatLo + (cx - rect.left) / ppb),
                            ),
                          );
                        const anchor: Cell = sel
                          ? sel.anchor
                          : clampCell({
                              row: caret.row,
                              beat: caret.beat === LABEL ? beatLo : caret.beat,
                            });
                        setSel({
                          anchor,
                          head: clampCell({
                            row: `track:${t.id}` as RowKey,
                            beat: cellAt(e.clientX),
                          }),
                        });
                        const onSelMove = (ev: PointerEvent) => {
                          // The head's row comes off the rows' own DOM (data-sel-row): rows have three heights, and a second copy would drift.
                          const key = document
                            .elementFromPoint(ev.clientX, ev.clientY)
                            ?.closest?.("[data-sel-row]")
                            ?.getAttribute("data-sel-row") as RowKey | null;
                          // A move that lands in the same cell keeps the same selection, and re-renders nothing.
                          setSel((s) => {
                            if (!s) return s;
                            const head = clampCell({
                              row: key ?? s.head.row,
                              beat: cellAt(ev.clientX),
                            });
                            return head.row === s.head.row &&
                              head.beat === s.head.beat
                              ? s
                              : { ...s, head };
                          });
                        };
                        // The rectangle stays as drawn on a release or a cancel alike; only the pointer stops steering it.
                        follow(e, { move: onSelMove });
                        return;
                      }
                      if (e.target !== e.currentTarget) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const beat = Math.floor(
                        beatLo + (e.clientX - rect.left) / ppb,
                      );
                      setSel(null);
                      setCaret(
                        clampCaret({ row: `track:${t.id}` as RowKey, beat }),
                      );
                      // The second press of the double-click that opened a clip is not a click on nothing.
                      if (
                        performance.now() - clipOpenedAt.current >
                        DBLCLICK_MS
                      )
                        onEmptyClick?.();
                    }}
                    className={cn(
                      "relative overflow-hidden",
                      // The lane a dragged clip would land on, while it is a legal target.
                      move?.dragging &&
                        move.toTrackId === t.id &&
                        move.trackId !== t.id &&
                        DROP_LANE,
                      dropAt?.lane === t.id && DROP_LANE,
                      mark?.lanes.has(t.id) && "bg-amber-500/15",
                    )}
                    style={{ width: laneW }}
                  >
                    {/* record-armed: the whole lane goes red, at the bottom of the stack, off the engine's state frame rather than the project. */}
                    {armed && (
                      <div className="pointer-events-none absolute inset-0 bg-red-600/30" />
                    )}
                    {dropMark(t.id)}
                    {/* caret cell — gone while the label is selected, and while a rectangle is being drawn, the rectangle BEING the caret then. */}
                    {onRow && !labelled && !selBox && (
                      <div
                        // pointer-events-none: it is a mark, not a target, so a press on it reads as a press on the bare lane.
                        className="pointer-events-none absolute top-0 h-full bg-primary/25 outline outline-1 outline-primary"
                        style={{ left: x(caret.beat), width: ppb }}
                      />
                    )}
                    {inSel && selBox && selSlice(selBox)}
                    {/* A generated lane carries only the scheduler's look-ahead, rewritten every tick, so it is hatched rather than drawn. */}
                    {t.generated ? (
                      <div
                        title={`${t.name} — generated by an algo pattern; can't hold clips`}
                        className="pointer-events-none absolute inset-0 text-muted-foreground/30"
                        style={{ backgroundImage: HATCH }}
                      />
                    ) : (
                      <>
                        {/* The take growing on its lane: nothing on disk names it yet, so it is drawn from the transport and replaced on Stop. */}
                        {midiTake?.lane === t.id ? (
                          <RecordingClip
                            tempo={proj.tempo}
                            startBeat={midiTake.from}
                            countInBeats={0}
                            beatLo={beatLo}
                            beatHi={beatHi}
                            ppb={ppb}
                          />
                        ) : (
                          rolling &&
                          armedIds.includes(t.id) && (
                            <RecordingClip
                              tempo={proj.tempo}
                              startBeat={takeStartBeat}
                              countInBeats={takeCountInBeats}
                              beatLo={beatLo}
                              beatHi={beatHi}
                              ppb={ppb}
                            />
                          )
                        )}
                        {/* The move ghost: where the clip was picked up, on its own lane only, gone the instant the move commits or cancels. */}
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
                        {/* The resize ghost: where the event stood when its edge was grabbed, in the move ghost's outline — one gesture language. */}
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
                        {/* The lane as the commands just sent leave it: removed, muted, shifted — before the round trip. */}
                        {pendingClips(t.id, t.clips, pendingEdits).map(
                          (c, i) => {
                            const splitAt = pendingSplitAt(
                              t.id,
                              c.start,
                              pendingEdits,
                            );
                            const w = (c.length > 0 ? c.length : NATURAL) * ppb;
                            // A clip whose content loops to fill its length: flagged, so the repeats aren't mistaken for one long take.
                            const looping =
                              (c.loopEnd ?? 0) > (c.loopStart ?? 0);
                            // …and WHERE it starts over: the marks come off `passes`, so a MIDI clip stating its window draws none (clipLoop.ts).
                            const loop = clipLoop(c);
                            const loopMarks = loop
                              ? placedRepeats(loop, ppb)
                              : [];
                            // A glyph needs room the bare rule does not; `MIN_LOOP_GLYPH_PX` is where it stops being a glyph and starts being grit.
                            const loopGlyphs =
                              !!loop && loop.win * ppb >= MIN_LOOP_GLYPH_PX;
                            // A time-stretched clip gets a countdown-timer icon, CROSSED when this event has declined the map (`event status warp`).
                            const stretched = !!c.warped;
                            const unwarped = !!c.warpOff;
                            /** The same material, placed elsewhere too: `ghost` marks every placement but the earliest, and `kin` lights the rest from the caret. */
                            const inst = instances.get(materialOf(c));
                            const ghost =
                              (inst?.n ?? 1) > 1 &&
                              !isFirstPlacement(inst, t.id, c.start);
                            const kin =
                              !!kinOfCaret &&
                              materialOf(c) === kinOfCaret &&
                              c !== clipUnderCaret;
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
                            // Off screen and not in hand: nothing to draw — see ClipWindow.
                            if (
                              !moving &&
                              !resizing &&
                              !(
                                rowNear(ri, rowH) &&
                                xNear(x(drawStart), Math.max(ppb, drawW))
                              )
                            )
                              return null;
                            return (
                              <div
                                // A track may place the same clip ref twice, so the id alone collides — key by placement, id + index.
                                key={`${c.id}-${i}`}
                                title={`${c.name} (${c.type})${looping ? " · looping" : ""}${stretched ? (unwarped ? " · unwarped (plays at its own rate)" : " · stretched") : ""}${(inst?.n ?? 1) > 1 ? ` · ${ghost ? "another instance" : "first"} of ${inst?.n}` : ""} — click to select, double-click to open, drag to move (ctrl : hors grille)`}
                                // Drag to move: along the lane, or onto one holding the same material. Nothing is written until release.
                                onPointerDown={(e) => beginClipDrag(e, t, c)}
                                onPointerMove={onClipDragMove}
                                onPointerUp={endClipDrag}
                                onPointerCancel={cancelClipDrag}
                                // A double-click opens the clip; a RENDER opens the notes it was made from, the authored MIDI clip under the pointer (docs/timeline.md).
                                onDoubleClick={(e) =>
                                  c.frozen && t.frozenMaterial
                                    ? openFrozenNotes(e, t, c)
                                    : openClip(e, c, t.id)
                                }
                                // Right-click an event → the PLACEMENT's commands; stop the event so the lane's track menu doesn't also fire.
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onContextMenu?.(
                                    {
                                      kind: "clip",
                                      id: c.id,
                                      // Where this placement SITS, so the menu can offer `event remove` — the same pair the move drag commits with.
                                      track: t.id,
                                      tc: beatsToPosition(
                                        c.start,
                                        proj.timeSigNumerator,
                                        proj.timeSigDenominator,
                                      ),
                                      // …and the RECTANGLE, when one is drawn: a range verb takes a span, and the placement only says where it starts.
                                      sel: selRange,
                                    },
                                    e.clientX,
                                    e.clientY,
                                  );
                                }}
                                className={cn(
                                  // `isolate` keeps the activity layer's -z-10 inside this block; `group` is what the name reads.
                                  "group absolute top-1 flex h-[calc(100%-8px)] cursor-grab overflow-hidden rounded px-1 text-[10px] active:cursor-grabbing isolate",
                                  // Disabled: still placed, still readable, plainly off — an event you cannot see is a deleted one.
                                  c.disabled &&
                                    "opacity-40 saturate-0 outline-dashed outline-1 outline-muted-foreground",
                                  // A SIBLING of the one under the caret: light on purpose, so it does not compete with the clip you picked.
                                  kin &&
                                    "outline outline-1 -outline-offset-1 outline-primary/60 brightness-110",
                                  // Expanded: name on top, content filling the rest. Collapsed: the name centred in the short block as before.
                                  expanded ? "flex-col" : "items-center",
                                  // Touched by the hovered History row, matched on the MATERIAL its file names.
                                  mark?.clips.has(c.name) &&
                                    "outline outline-2 outline-amber-500",
                                  // The clip in hand: ring it and lift it over its ghost.
                                  (moving || resizing) &&
                                    "z-10 outline outline-2 outline-primary",
                                  // …and while DRAGGING let the pointer through, or laneAtPoint would always answer "the lane I started on".
                                  moving &&
                                    move?.dragging &&
                                    "pointer-events-none",
                                )}
                                style={{
                                  left: x(drawStart),
                                  width: Math.max(ppb, drawW),
                                }}
                              >
                                {/* The fill, with the content's activity running through it: 50% opaque where quiet, 100% where loud (docs/timeline.md). */}
                                {/* A COMPED event is one block, its pieces' activity laid where each plays (song docs/takes.md). */}
                                {c.pieces ? (
                                  c.pieces.map((p) => (
                                    <div
                                      key={p.id}
                                      className="absolute inset-y-0 -z-10"
                                      style={{
                                        left: (p.start - c.start) * ppb,
                                        width: Math.max(1, p.length * ppb),
                                      }}
                                    >
                                      <ClipActivity
                                        clip={p}
                                        spanBeats={
                                          p.length > 0 ? p.length : NATURAL
                                        }
                                        color={t.color || undefined}
                                        project={envProject}
                                        pending={resizing}
                                      />
                                    </div>
                                  ))
                                ) : (
                                  <ClipActivity
                                    clip={c}
                                    spanBeats={
                                      c.length > 0 ? c.length : NATURAL
                                    }
                                    color={t.color || undefined}
                                    project={envProject}
                                    pending={resizing}
                                  />
                                )}
                                {/* Where the material STARTS OVER, one rule per pass: `placedRepeats`, since this axis begins at the event's left edge (clipLoop.ts). */}
                                {loopMarks
                                  .filter((b) => b * ppb < drawW)
                                  .map((b) => (
                                    <div
                                      key={b}
                                      className="pointer-events-none absolute inset-y-0 w-px bg-white/30"
                                      style={{ left: b * ppb }}
                                    >
                                      {/* Only when a pass is wide enough to hold it — below that the glyphs touch and read as a dotted smear. */}
                                      {loopGlyphs && (
                                        <Repeat className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 h-2 w-2 text-white/75" />
                                      )}
                                    </div>
                                  ))}
                                {/* The FADES as two wedges, `pointer-events-none` since the corner handle is what you grab; `fadeOf` keeps them live mid-drag (docs/timeline.md). */}
                                {(["fadeIn", "fadeOut"] as const).map(
                                  (which) => {
                                    const live =
                                      fade?.clipId === c.id &&
                                      fade.trackId === t.id &&
                                      fade.which === which
                                        ? fade.len
                                        : undefined;
                                    const len =
                                      live ??
                                      (which === "fadeIn"
                                        ? c.fadeIn
                                        : c.fadeOut) ??
                                      0;
                                    if (len <= 0) return null;
                                    const w = Math.min(drawW, len * ppb);
                                    return (
                                      <div
                                        key={which}
                                        className={cn(
                                          "pointer-events-none absolute inset-y-0 bg-black/45",
                                          which === "fadeIn"
                                            ? "left-0"
                                            : "right-0",
                                        )}
                                        style={{
                                          width: w,
                                          // The wedge itself: a fade-in is dark at the head and clear by its end, a fade-out the mirror.
                                          clipPath:
                                            which === "fadeIn"
                                              ? "polygon(0 0, 100% 100%, 0 100%)"
                                              : "polygon(100% 0, 100% 100%, 0 100%)",
                                        }}
                                      />
                                    );
                                  },
                                )}
                                {/* …and the two corner handles that drag them, at the TOP corners so they never share a pixel with the resize strips. */}
                                {!readOnly &&
                                  (["fadeIn", "fadeOut"] as const).map(
                                    (which) => {
                                      const len =
                                        (which === "fadeIn"
                                          ? c.fadeIn
                                          : c.fadeOut) ?? 0;
                                      return (
                                        <div
                                          key={`h-${which}`}
                                          className={cn(
                                            "absolute top-0 z-30 h-2 w-2 cursor-ew-resize rounded-sm",
                                            which === "fadeIn"
                                              ? "left-0"
                                              : "right-0",
                                            // Visible once there is a fade; otherwise on hover, the same disclosure the edge handles use.
                                            len > 0
                                              ? "bg-white/60"
                                              : "bg-white/0 group-hover:bg-white/35",
                                          )}
                                          title={
                                            which === "fadeIn"
                                              ? "Drag to fade in — Ctrl frees the grid"
                                              : "Drag to fade out — Ctrl frees the grid"
                                          }
                                          onPointerDown={(e) => {
                                            e.stopPropagation();
                                            (
                                              e.currentTarget as HTMLElement
                                            ).setPointerCapture(e.pointerId);
                                            setFade({
                                              trackId: t.id,
                                              clipId: c.id,
                                              which,
                                              start: c.start,
                                              span:
                                                c.length > 0
                                                  ? c.length
                                                  : NATURAL,
                                              orig: len,
                                              len,
                                              x: e.clientX,
                                              ppb,
                                            });
                                          }}
                                          onPointerMove={onFadeMove}
                                          onPointerUp={commitFade}
                                          onPointerCancel={() => setFade(null)}
                                        />
                                      );
                                    },
                                  )}
                                {/* Edge handles, narrow strips INSIDE the block's own ends, and absent rather than inert on a read-only document. */}
                                {!readOnly &&
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
                                          unit: unitRef.current,
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
                                {/* A split sent and not yet answered: the cut drawn where the two halves will meet. */}
                                {splitAt !== undefined && splitAt > c.start && (
                                  <div
                                    className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground/80"
                                    style={{
                                      left: (splitAt - drawStart) * ppb,
                                    }}
                                  />
                                )}
                                <div className="flex items-center gap-0.5 leading-tight">
                                  {/* Kind at a glance: a note for MIDI/sequence clips, a speaker for audio. */}
                                  {c.type === "midi" ? (
                                    <Music className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                  ) : (
                                    <Volume2 className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                  )}
                                  {/* A COMPED event: several takes heard as one, opened in the clip panel's takes mode. */}
                                  {c.pieces && (
                                    <Layers className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                  )}
                                  {/* A RETURN of material heard earlier, drawn on every placement but the first (docs/timeline.md). */}
                                  {ghost && (
                                    <Ghost className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                  )}
                                  {/* No loop badge here: the marks down the block say the same thing and say WHERE. */}
                                  {stretched &&
                                    (unwarped ? (
                                      <TimerOff className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                    ) : (
                                      <Timer className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                    ))}
                                  {/* The name on HOVER, faded rather than unmounted so the row keeps its height — and shown outright while the block is in hand. */}
                                  <span
                                    className={cn(
                                      "truncate opacity-0 transition-opacity group-hover:opacity-100",
                                      (moving || resizing) && "opacity-100",
                                    )}
                                  >
                                    {c.name || c.id}
                                  </span>
                                </div>
                                {/* The clip's waveform or mini piano-roll, only when there is room; `relative` anchors ClipContent's absolute fill. */}
                                {expanded && (
                                  <div className="relative mt-0.5 min-h-0 flex-1">
                                    {c.pieces ? (
                                      c.pieces.map((p) => (
                                        <div
                                          key={p.id}
                                          className="absolute inset-y-0"
                                          style={{
                                            left: (p.start - c.start) * ppb,
                                            width: Math.max(1, p.length * ppb),
                                          }}
                                        >
                                          <ClipContent
                                            clip={p}
                                            spanBeats={
                                              p.length > 0 ? p.length : NATURAL
                                            }
                                            project={envProject}
                                          />
                                        </div>
                                      ))
                                    ) : (
                                      <ClipContent
                                        clip={c}
                                        spanBeats={
                                          c.length > 0 ? c.length : NATURAL
                                        }
                                        project={envProject}
                                        overlay={
                                          c.frozen
                                            ? t.frozenMaterial
                                            : undefined
                                        }
                                      />
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          },
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* marker lines spanning the ruler and every lane, non-interactive: the ruler handle above owns hover and right-click. */}
            {visMarkers.map((mk) => (
              <div
                key={mk.tc}
                className={cn("pointer-events-none absolute top-0 z-20", GROW)}
                style={{
                  left: GUTTER + x(mk.beat),
                  height: contentH,
                  width: 1,
                  background: MARKER_COLOR,
                  boxShadow:
                    hoverMarker === mk.name
                      ? `0 0 6px ${MARKER_COLOR}`
                      : "none",
                }}
              />
            ))}
            {/* playhead — its own subscriber, so the transport moves one div and re-renders nothing else here (see Playhead). */}
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
      {/* The drop's own bar, at the foot of the pane: a dragged video is where this surface waits longest. */}
      <UploadProgress
        fileName={dropUpload?.fileName ?? null}
        loaded={dropUpload?.loaded ?? 0}
        total={dropUpload?.total ?? 0}
        done={dropUpload?.done ?? 0}
        count={dropUpload?.count ?? 0}
        active={!!dropUpload}
      />
    </div>
  );
}
