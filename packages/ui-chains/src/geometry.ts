// geometry.ts — the chains graph's measurements: the card sizes, the grid cells, the jacks and
// the cables between them, and the names of the built-in sinks. Plain numbers any renderer reads,
// so the DOM view and the layout cannot disagree about where a socket is.

import type {
  WebGraph,
  WebModuleUI,
  WebSignal,
  WebWidget,
} from "@studio/graph-model";
import { hasTabs } from "@studio/graph-model/panel";
import type { GraphEdge, GraphNode, Jack, Pt } from "./graphNode";
import { hangPoints } from "./hang";

/** The sockets a node shows: inputs reveal themselves, outputs show at once — see docs/graphBuild.md. */
export function jacksFor(
  ports: { name: string; type: WebSignal; mandatory?: boolean }[] | undefined,
  fed: ReadonlySet<string>,
  fallback: WebSignal | undefined,
  grow: boolean,
  spare = false,
  /** Which declared port a cable that NAMES none counts against — the first, except off a lane. */
  bareOn?: string,
  /** How many BARE cables land here. Past one they each get a socket, which is drawing only — docs/graphBuild.md. */
  bare = 0,
): Jack[] {
  // A module that declares nothing has the one port every module has, typed by what it handles.
  if (!ports?.length) {
    const type = fallback ?? "audio";
    // Both jacks are the SAME socket, so the spare writes a second arrow out of it — a send.
    if (spare && fed.size)
      return [
        { type, free: false },
        { type, free: true },
      ];
    // One socket per arriving cable: four stem cuts into an EQ read as four, not as a knot on one hole.
    if (bare > 1)
      return Array.from({ length: bare }, () => ({ type, free: false }));
    return [{ type, free: !fed.size }];
  }
  // A cable that named no port lands on `bareOn` when the caller says which, else on the first.
  const takesBare = (p: { name: string }, i: number) =>
    bareOn ? p.name === bareOn : i === 0;
  const isFed = (p: { name: string }, i: number) =>
    fed.has(p.name) || (takesBare(p, i) && fed.has(""));
  // Outputs show all at once, their occupancy read per socket off the edge's `sourcePort`.
  if (!grow)
    return ports.flatMap((p, i) => {
      const jack = { name: p.name, type: p.type, free: !isFed(p, i) };
      if (!spare || jack.free) return [jack];
      // The spare twin carries the SAME ADDRESS as the cable already on it — see docs/graphBuild.md.
      const bare = takesBare(p, i) && fed.has("");
      return [
        jack,
        { ...(bare ? {} : { name: p.name }), type: p.type, free: true },
      ];
    });
  const mandatory = ports.filter((p) => p.mandatory !== false).length;
  // One past the LAST occupied port, not one past the count, or a module fed only on `b` loses `a`.
  let lastFed = -1;
  ports.forEach((p, i) => {
    if (isFed(p, i)) lastFed = i;
  });
  const shown = Math.min(ports.length, Math.max(1, mandatory, lastFed + 2));
  return ports
    .slice(0, shown)
    .map((p, i) => ({ name: p.name, type: p.type, free: !isFed(p, i) }));
}

/** How far outside a column a side cable's first lane runs, and how far apart two lanes are. */
const SIDE_OFF = 8;
const SIDE_STEP = 6;
/** How far in from the card's corner a side cable leaves and arrives, so it reads as the card's. */
const SIDE_INSET = 10;

/** A side cable: out of the source's right edge, down a lane outside the column, into the target's. */
function sidePath(src: GraphNode, tgt: GraphNode, lane: number): Pt[] {
  const x =
    Math.max(src.x + src.w, tgt.x + tgt.w) + SIDE_OFF + lane * SIDE_STEP;
  const from = { x: src.x + src.w, y: src.y + src.h - SIDE_INSET };
  const to = { x: tgt.x + tgt.w, y: tgt.y + SIDE_INSET };
  const turn = Math.sign(to.y - from.y) * 4;
  // Points either side of each corner, so the smoothing keeps the run down the lane straight.
  return [
    from,
    { x: x - 2, y: from.y },
    { x, y: from.y + turn },
    { x, y: to.y - turn },
    { x: x - 2, y: to.y },
    to,
  ];
}

/** An EVENT socket's centre — its own function because it spreads down the SIDE edges, not the flow's. */
/** How far down a curve card's LEFT edge the event that fires it plugs in. */
export const EVENT_IN_AT = 0.5;

/** Where a curve card's automation leaves: the middle of its RIGHT edge, toward the node it sits left of. */
export const curveOutPoint = (n: GraphNode): Pt => ({
  x: n.x + n.w + PORT_PLATE / 2,
  y: n.y + n.h / 2,
});

export function eventPoint(
  n: GraphNode,
  side: "in" | "out",
  index: number,
): Pt {
  // A curve's event socket is on its LEFT edge (docs/graphBuild.md)…
  if (side === "in")
    return { x: n.x - PORT_PLATE / 2, y: n.y + n.h * EVENT_IN_AT };
  // …and what a module announces leaves from ITS left edge, aligned at the bottom, one plug above the next.
  const count = Math.max(1, n.events?.length ?? 1);
  const i = Math.min(Math.max(0, index), count - 1);
  return { x: n.x - PORT_PLATE / 2, y: n.y + n.h - eventOutBottom(i) };
}

/** How far UP a module's left edge its `i`th event plug's centre sits, in px from the bottom corner, one above the next. */
export const eventOutBottom = (i: number): number => 14 + 22 * i;

/** A socket's centre in graph space, spread evenly down the node's edge as the plate's CSS is. */
export function jackPoint(n: GraphNode, side: "in" | "out", index: number): Pt {
  const count = Math.max(1, (n.jacks?.[side] ?? []).length);
  const i = Math.min(Math.max(0, index), count - 1);
  // A row read ACROSS meets its cables on the sides: out of the right edge, into the left.
  if (n.flow === "across")
    return {
      x: side === "in" ? n.x - PORT_PLATE / 2 : n.x + n.w + PORT_PLATE / 2,
      y: n.y + (n.h * (i + 1)) / (count + 1),
    };
  // Otherwise signal runs down: inputs on the TOP edge, outputs on the bottom, spread across the width.
  return {
    x: n.x + (n.w * (i + 1)) / (count + 1),
    y: side === "in" ? n.y - PORT_PLATE / 2 : n.y + n.h + PORT_PLATE / 2,
  };
}

/** A cable's polyline: it HANGS socket to socket, dagre's waypoints dropped — docs/hang.md, docs/graphBuild.md. */
export function cablePath(
  e: GraphEdge,
  src: GraphNode | undefined,
  tgt: GraphNode | undefined,
): Pt[] {
  const pts = e.points;
  if (pts.length < 2) return pts;
  // A cable that skips cards of its stack column goes round them, on the column's right side.
  if (e.side !== undefined && src && tgt) return sidePath(src, tgt, e.side);
  // An EVENT cable meets the side edges, and its two ends are indexed differently — its own branch.
  if (e.signal === "event" && src && tgt) {
    const i = Math.max(0, src.events?.indexOf(e.sourcePort ?? "") ?? 0);
    return hangPoints(
      eventPoint(src, "out", i),
      eventPoint(tgt, "in", 0),
      true, // always sideways: both ends are on a left or right edge
    );
  }
  // A bare cable leaves the FIRST jack, except off a lane where it leaves the first OCCUPIED one.
  const fromIndex = e.sourcePort
    ? (src?.jacks?.out.findIndex((j) => j.name === e.sourcePort) ?? -1)
    : src?.kind === "track"
      ? (src.jacks?.out.findIndex((j) => !j.free) ?? -1)
      : 0;
  const from = src
    ? jackPoint(src, "out", fromIndex < 0 ? 0 : fromIndex)
    : pts[0];
  // A bare cable takes the socket its RANK earned it; `jackPoint` clamps, so a node drawing one is unharmed.
  const toIndex = e.targetPort
    ? (tgt?.jacks?.in.findIndex((j) => j.name === e.targetPort) ?? -1)
    : (e.targetSlot ?? 0);
  const to = tgt
    ? jackPoint(tgt, "in", toIndex < 0 ? 0 : toIndex)
    : pts[pts.length - 1];
  return hangPoints(from, to, src?.flow === "across" || tgt?.flow === "across");
}

// A node with no UI is this big; one with a UI is sized by its grid. Header + content always.

/** The main output, as a chain's `out.to` spells it — a bare name, taken literally everywhere. */
export const MAIN_OUT = "OUT";

/** The mixer's SUM — the one destination the graph draws no cable INTO. See docs/graphBuild.md. */
export const MIX_OUT = "MIX";

/** The PICTURE's two, drawn by exactly the rules above — see @studio/song's docs/videoOutputs.md. */
export const RENDER_OUT = "RENDER";
export const VIDEO_OUT = "VIDEO_OUT";

/** The id an assembly's card has, in the family of the `mod:` / `trk:` / `snk:` ids buildGraph mints. */
export const assemblyId = (name: string): string => `asm:${name}`;

/** What an OPEN box adds around the layout of its members: a title strip, and a margin. */
export const FRAME_HEAD = 26;
export const FRAME_PAD = 14;

export const NODE_W = 160;
export const NODE_H = 70;

// The narrowest a card may be whatever its grid says — what the header strip needs. See docs/graphBuild.md.
export const NODE_MIN_W = 72;

// A port's plate, here rather than in the stylesheet so the cable's end and the CSS are one number.
export const PORT_PLATE = 13;

// Module-UI grid geometry in graph units, shared with the renderer. See docs/graphBuild.md.
export const CELL = 36;
export const UI_PAD = 6;
export const UI_HEADER = 38;
/** The air between the header's rule and the content under it — the first row, or a card's note. */
export const UI_TOP_GAP = 4;
/** Where a card's content starts: the header, then that air. */
export const UI_CONTENT_TOP = UI_HEADER + UI_TOP_GAP;
/** A tabbed panel's tab column, at the card's left: wide enough for a ten-character name (docs/graphBuild.md). */
export const TAB_COL_W = 66;
/** …and one tab's height in it. */
export const TAB_H = 20;
/** A NARROW card's tabs: a menu across its top, under the header, instead of the column (docs/graphBuild.md). */
export const TAB_MENU_H = 26;
/** The air between two rows. */
export const ROW_GAP = 8;
/** The air below the last row. */
export const UI_EDGE = 12;

/** The height `rows` rows take on a card, the gaps between them included. */
export const rowsHeight = (rows: number): number =>
  rows * CELL + Math.max(0, rows - 1) * ROW_GAP;
/** The air between two columns, so neighbouring groups read as two sections rather than one slab. */
export const COL_GAP = 6;

/** The width `cols` columns take on a card, the gaps between them included. */
export const colsWidth = (cols: number): number =>
  cols * CELL + Math.max(0, cols - 1) * COL_GAP;

/** The font size a node's header name needs to be READ WHOLE, in px — see docs/graphBuild.md. */
export const HEADER_MAX_PX = 12.5; // .dgx-nm's size today, and the ceiling
export const HEADER_MIN_PX = 7.5;
const GLYPH_W = 0.55; // average advance per px of font size, for the header's face

/** What a module ref is CALLED — the last segment, the whole ref staying as the header's `title`. */
export function moduleDisplayName(ref: string): string {
  const cut = ref.lastIndexOf("/");
  const name = cut >= 0 ? ref.slice(cut + 1) : ref;
  return name || ref;
}

export function headerFontPx(label: string, availableW: number): number {
  const n = Math.max(1, label.length);
  const byWidth = availableW / (n * GLYPH_W);
  return Math.max(HEADER_MIN_PX, Math.min(HEADER_MAX_PX, byWidth));
}

// --- notes (doc modules) ---------------------------------------------------------

/** A note's text metrics: monospace-ish, and the box it needs. See @studio/song's docs/docModules.md. */
const NOTE_CHAR_W = 6.6; // one glyph at the size the renderer draws a note
const NOTE_LINE_H = 17;
const NOTE_PAD = 10;
const NOTE_MIN_W = 140;
const NOTE_MAX_W = 320; // past this a note is a document, and it wraps instead of widening

/** How big a NOTE has to be to show its text — dagre is told this. See docs/graphBuild.md. */
export function noteSize(text: string): { w: number; h: number } {
  const lines = (text || "").split("\n");
  const widest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const w = Math.max(
    NOTE_MIN_W,
    Math.min(NOTE_MAX_W, widest * NOTE_CHAR_W + NOTE_PAD * 2),
  );
  const perLine = Math.max(1, Math.floor((w - NOTE_PAD * 2) / NOTE_CHAR_W));
  // Every authored line takes at least one drawn line, and a long one takes as many as it wraps to.
  const drawn = lines.reduce(
    (n, l) => n + Math.max(1, Math.ceil(l.length / perLine)),
    0,
  );
  return { w, h: Math.max(NODE_H, drawn * NOTE_LINE_H + NOTE_PAD * 2) };
}

// --- a track's clip list (see docs/graphBuild.md) --------------------------------

/** How many clips a track node lists before it starts counting the rest instead. */
export const CLIP_LIST_MAX = 6;
/** One row, separator included — 15px of line plus the 1px rule (`.dgx-clip`). Tracks DomChains' CSS. */
const CLIP_ROW_H = 16;
/** The list's bottom padding, plus the rule that separates it from the controls above. */
const CLIP_LIST_PAD = 7;
/** The mini timeline above the list: its track, plus the gap under it (`.dgx-clip-tl`). */
const CLIP_TIMELINE_H = 14;
/** The narrowest a clip block is drawn, as a fraction of the timeline — ~3px on a 160px node. */
const CLIP_MIN_W = 0.02;

/** The clip list of a TRACK node, and the extra height it ADDS to its grid's. See docs/graphBuild.md. */
export function clipsOf(
  graph: WebGraph,
  track: string,
  base: { w: number; h: number },
  /** The last position anything in the GRAPH sits at — the shared scale. See `clips.at`. */
  span: number,
): Partial<GraphNode> {
  const all = graph.trackClips?.[track];
  if (!all?.length) return {};
  const clips = all.map((c) => {
    // A graph whose clips all sit at bar 1 has no span to divide by, and 0 is where they belong.
    const at = span > 0 ? Math.min(1, Math.max(0, c.start / span)) : 0;
    const w =
      span > 0 && c.len ? Math.max(CLIP_MIN_W, c.len / span) : CLIP_MIN_W;
    // Clamped to the right edge, so a clip running past the last START stops at it.
    return { ...c, at, w: Math.min(w, 1 - at) || CLIP_MIN_W };
  });
  const more = Math.max(0, all.length - CLIP_LIST_MAX);
  // The rows the LIST will draw, plus the overflow line when there is one.
  const rows = Math.min(all.length, CLIP_LIST_MAX) + (more > 0 ? 1 : 0);
  return {
    clips,
    ...(more > 0 ? { clipsMore: more } : {}),
    w: base.w,
    h: base.h + CLIP_LIST_PAD + CLIP_TIMELINE_H + rows * CLIP_ROW_H,
  };
}

/** The scale every mini timeline shares: the last position in the GRAPH. See docs/graphBuild.md. */
export function clipSpanOf(graph: WebGraph): number {
  let span = 0;
  // The END of the last clip, not its start, or the final block hangs off the right of every node.
  for (const clips of Object.values(graph.trackClips ?? {}))
    for (const c of clips) span = Math.max(span, c.start + (c.len ?? 0));
  return span;
}

/** The note bits of a module node, or nothing — `graph.modules` is keyed by DOC modules alone. */
export function noteOf(
  g: WebGraph,
  module: string,
): { note: string; w: number; h: number } | Record<string, never> {
  const meta = g.modules?.[module];
  if (!meta || meta.content === undefined) return {};
  const text = meta.content;
  return { note: text, ...noteSize(text) };
}

/** The bottom BAR a module card carries — its stage's knobs on the left, its alternatives on the right (nodeCard.md). */
export const FOOTER_H = 20;

// How big a node must be to hold `ui`, its tab column, and with `footer` the bottom bar under them.
export function nodeSize(
  ui?: WebModuleUI,
  footer = false,
): { w: number; h: number } {
  const size = panelSize(ui);
  return footer ? { ...size, h: size.h + FOOTER_H } : size;
}

function panelSize(ui?: WebModuleUI): { w: number; h: number } {
  const colW = columnW(ui);
  // The tab column is as tall as its tabs, up to 4 rows; a tab MENU is one line above the grid instead.
  const tabsH = colW
    ? Math.min(
        (ui?.tabs?.length ?? 0) * TAB_H,
        Math.max(rowsHeight(ui?.rows ?? 0), rowsHeight(TAB_COL_MAX_ROWS)),
      )
    : 0;
  const menu = menuH(ui);
  if (!ui?.cols || !ui?.rows) return { w: NODE_W + colW, h: NODE_H + menu };
  return {
    // The grid's width, NOT max(NODE_W, …) — see docs/graphBuild.md.
    w: Math.max(NODE_MIN_W, colW + UI_PAD * 2 + colsWidth(ui.cols)),
    h: Math.max(
      NODE_H,
      UI_CONTENT_TOP + menu + Math.max(rowsHeight(ui.rows), tabsH) + UI_EDGE,
    ),
  };
}

/** The tab column's width: TAB_COL_W when the card draws its tabs as a column, else nothing. */
export const columnW = (ui: WebModuleUI | undefined): number =>
  hasTabs(ui) && ui?.tabsAs !== "dropdown" ? TAB_COL_W : 0;

/** …and the tab MENU's height, when a narrow card offers its tabs across its top instead. */
export const menuH = (ui: WebModuleUI | undefined): number =>
  hasTabs(ui) && ui?.tabsAs === "dropdown" ? TAB_MENU_H : 0;

/** How many rows' height the tab column may stretch a card to; past it the column scrolls (docs/nodeCard.md). */
export const TAB_COL_MAX_ROWS = 4;

// A widget's box in node-local coordinates (origin = the node's top-left), `left` being the tab column's width.
export function widgetRect(
  w: WebWidget,
  left = 0,
  top = 0,
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: left + UI_PAD + w.col * (CELL + COL_GAP),
    y: top + UI_CONTENT_TOP + w.row * (CELL + ROW_GAP),
    w: colsWidth(Math.max(1, w.colSpan ?? 1)),
    h: rowsHeight(Math.max(1, w.rowSpan ?? 1)),
  };
}

/** `widgetRect` on a STRIP drawn taller than its grid: the fader takes the extra height and what sits under it moves down (docs/graphBuild.md). */
export function stripWidgetRect(
  n: { strip?: boolean; ui?: WebModuleUI; h: number },
  w: WebWidget,
  left = 0,
  top = 0,
): { x: number; y: number; w: number; h: number } {
  const r = widgetRect(w, left, top);
  const fader = n.strip
    ? Object.values(n.ui?.widgets ?? {}).find((x) => x.type === "fader")
    : undefined;
  const extra = fader ? n.h - nodeSize(n.ui).h : 0;
  if (!fader || extra <= 0) return r;
  if (w.type === "fader" && w.bind === fader.bind)
    return { ...r, h: r.h + extra };
  const under =
    w.col === fader.col && w.row >= fader.row + (fader.rowSpan ?? 1);
  return under ? { ...r, y: r.y + extra } : r;
}
