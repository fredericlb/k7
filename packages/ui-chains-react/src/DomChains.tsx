// DomChains.tsx — the Chains routing graph: HTML nodes over a canvas of signal cables,
// with an SVG layer between them for the labels, the arrows and the hit paths.
// It consumes the same laid-out graph the old Pixi renderer did (dagre still owns the
// layout); only the DRAWING is React, which buys real type, CSS effects and a DOM a test
// can read. Shared by the Chains tab and the Graph panel — mount it only where it has a
// real size, since fit() frames to the host. See docs/chainsGraph.md.

import type { WaveformEnvelope } from "@studio/engine-browser";
import {
  PluginParamsStore,
  usePluginParamValue,
} from "@studio/engine-browser/params";
import {
  activeTrackIds,
  arrayEq,
  EngineStore,
  EngineStoreProvider,
  useEngineStoreOrNull,
  useInputLevel,
  useTrackLevel,
} from "@studio/engine-browser/store";
import type {
  WebCc,
  WebModuleCategory,
  WebSignal,
  WebWidget,
} from "@studio/graph-model";
import {
  type CableDraw,
  drawCables,
  newScratch,
  WOBBLE_FPS,
  WOBBLE_HZ,
  WOBBLE_MAX_SAMPLES,
  WOBBLE_STEP,
} from "@studio/ui-chains/cableCanvas";
import {
  type AutoTarget,
  arrowPoints,
  autoTarget,
  buildCableGeom,
  type CableGeom,
  computeLive,
  insertFor,
  midByArc,
  smoothPath,
} from "@studio/ui-chains/cables";
import {
  cablePath,
  type EdgeInsert,
  type GraphNode,
  headerFontPx,
  type LaidOutGraph,
  PORT_PLATE,
  type TrackControlValues,
  widgetDenorm,
  widgetNorm,
  widgetRect,
} from "@studio/ui-chains/graph";
import { pinchFactor, spreadOf } from "@studio/ui-chains/zoomGesture";
import { Snowflake } from "lucide-react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyCam,
  approach,
  type Cam,
  clampZoom,
  frameOriginX,
  isMouseWheel,
  isZoomWheel,
  type Lod,
  lodFor,
  sameLod,
  wheelFactor,
  wheelPixels,
  zoomAbout,
} from "./camera";
import {
  advanceMotion,
  type Ghost,
  type Motion,
  motionPos,
  motionTransform,
  planMotion,
} from "./nodeMotion";

/**
 * What the graph can be right-clicked ON — its OWN vocabulary, not the shell's.
 *
 * l8' `MenuCtx` is a superset covering timeline things (markers, clip placements) this
 * has no way to produce. Declaring the narrow union here is what lets the component say
 * what it emits instead of importing an app's idea of a menu; a host whose own type is
 * wider accepts a handler for it unchanged.
 */
/**
 * A play button on the SINK node — for a host that can audition what reaches it.
 *
 * On the output and not on the input, because what you want to hear is the signal after
 * everything in the chain has had it. Opt-in and absent by default: l8 has a transport of
 * its own and m9 has a deck, so neither wants a second play button inside the graph. The
 * médiathèque has neither, which is why it needs one here.
 */
export interface SinkPlay {
  playing: boolean;
  /** No engine, or nothing to play. `title` is what says which. */
  disabled?: boolean;
  title?: string;
  onToggle: () => void;
}

export type GraphMenuCtx =
  | { kind: "track"; id: string }
  | { kind: "module"; id: string; missing?: boolean }
  | { kind: "chain"; id: string }
  | { kind: "sink"; id: string }
  // One WIDGET on a module, right-clicked: the param it drives, and the CC already mapped to it.
  // Distinct from "module" because the answer is about one knob — a MIDI binding is per param, and
  // the module menu has nothing to say about which one you were pointing at.
  | {
      kind: "param";
      /** The module the widget is drawn on. */
      id: string;
      /** The widget's `bind`, verbatim — `Cutoff`, or `@monitor` for a module field. */
      param: string;
      /** Its label, for a menu that reads as the knob does. */
      label: string;
      /** The CC bound to it today, if any (the module's `controller.yaml`). */
      cc?: WebCc;
    };

/**
 * The glyphs a node draws itself with, supplied by the host.
 *
 * Injected rather than imported because they are the APP's vocabulary, not the graph's:
 * l8 draws the same track icons in its mixer and its timeline, so they cannot live in
 * a chains package without those two importing one. A second consumer that wants l8'
 * exact icons can pass l8' exact icons.
 */
export interface ChainsIcons {
  ModuleIcon: (props: {
    category?: WebModuleCategory;
    missing?: boolean;
    className?: string;
    style?: React.CSSProperties;
  }) => React.ReactNode;
  /** Whether a category HAS a glyph, so a node knows to leave room for one. */
  moduleGlyph: (category?: WebModuleCategory, missing?: boolean) => unknown;
  TrackIcon: (props: {
    name: string;
    video?: boolean;
    color?: string;
    className?: string;
    style?: React.CSSProperties;
  }) => React.ReactNode;
}

// Carried by context, not by props: `Node` is nested several layers down, and threading
// them through every layer is the kind of thing that made this file 2000 lines. The
// PROVIDER is not a caller's job though — DomChains takes `icons` as a required prop and
// provides it itself, so there is no arrangement in which a caller forgets and the graph
// throws at render. The compiler is the guarantee; the throw below is unreachable.
const IconsContext = createContext<ChainsIcons | null>(null);

function useIcons(): ChainsIcons {
  const v = useContext(IconsContext);
  if (!v) throw new Error("DomChains rendered without its icons");
  return v;
}

// A shared, never-updated store for a graph without live params — gives every widget something
// to subscribe to, so the hook is unconditional and a host may still pass nothing.
const EMPTY_PARAMS_STORE = new PluginParamsStore();

// Signal-typed accents. Sand is the neutral, automation mauve; a track control keeps its own M/S/A identity colour.
const SAND = "#c8a06a";
const MAUVE = "#a889b5";
// A cable is coloured by WHAT IT CARRIES, muted so it sits behind the nodes. See docs/chainsGraph.md.
const CABLE: Record<WebSignal, string> = {
  midi: "#5b9bd5", // blue
  audio: "#d98b45", // orange
  video: "#5fa871", // green
};
// An untyped cable (a source that says nothing) stays the neutral sand rather than claiming a signal it doesn't know.
const cableColorFor = (s?: WebSignal): string => (s ? CABLE[s] : SAND);
const RING = "#8b5cf6"; // the selection ring (violet-500), matching the old primary
const CTRL: Record<string, string> = {
  "@mute": "#f97316", // orange-500
  "@solo": "#eab308", // yellow-500
  "@arm": "#ef4444", // red-500
};

// A stable empty track order: a fresh `[]` per render would change every Node's props each frame.
const EMPTY_ORDER: string[] = [];
// The same for "no cable carries signal" — never mutated, always replaced.
const EMPTY_LIVE: Set<string> = new Set();
// …and for "nothing is leaving", so settling twice does not re-render the graph twice.
const EMPTY_GHOSTS: Ghost<GraphNode>[] = [];
// A cable drawn mid-move is drawn STILL: the ripple is a 1.2 Hz ornament and 200 ms of it is
// nothing, while resampling every cable per frame to carry it is real work. `flattenInto` reads
// `base` alone, so a still cable never looks at this.
const NO_SAMPLES: CableGeom["samples"] = [];

const DRAG_SLOP = 4; // px of movement before a press becomes a pan (so a pan never selects)
const DRAG_TRAVEL_PX = 150; // screen px of vertical drag that sweep a control's whole range
const DRAG_FINE = 0.25; // shift-held multiplier for a fine adjustment

// One injected stylesheet, scoped under `.dgx`, so the component drops into any host.
const CSS = `
/* contain:paint says outright what overflow:hidden already made true — nothing here draws
   outside the host — which keeps the graph's display list off the rest of the page. */
/* touch-action:none — this surface pans and zooms itself. Left to the browser, a one-finger
   drag scrolls the PAGE and cancels the pan mid-gesture, and two fingers zoom the page instead
   of the graph. Nothing here scrolls, so there is nothing to hand back. */
.dgx { position:relative; width:100%; height:100%; overflow:hidden; contain:paint; cursor:grab; user-select:none; touch-action:none;
  background:
    radial-gradient(circle at 1px 1px, #201f26 1px, transparent 0) 0 0 / 24px 24px,
    radial-gradient(1100px 560px at 60% -10%, #141319 0%, #0d0d0f 60%);
  color:#e7e6ea; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --sand:${SAND}; --mauve:${MAUVE}; --card:#17161b; --line:#2c2c33; --dim:#9a968c; --faint:#64615a; }
.dgx.panning { cursor:grabbing; }
.dgx-world { position:absolute; top:0; left:0; transform-origin:0 0; }
/* This layer is non-interactive except its hit paths + insert buttons, so empty space passes
   pointer events through to the host (panning) and the nodes below. */
.dgx-cables { position:absolute; top:0; left:0; overflow:visible; pointer-events:none; }
/* The signal cables' own layer, under the SVG and the nodes. Never a pointer target: hit
   testing stays on .dgx-hit, which is SVG and follows the cable at rest.
   width/height are NOT redundant with inset:0 — a canvas is a REPLACED element, so with an
   auto width the insets are over-constrained and its INTRINSIC size (the width/height
   attributes, which we set in DEVICE px) wins. See docs/wobble.md. */
.dgx-cablecv { position:absolute; inset:0; width:100%; height:100%; display:block;
  pointer-events:none; }
.dgx-cbl-shadow { fill:none; stroke:#000; stroke-opacity:.5; stroke-linecap:round; stroke-linejoin:round; }
.dgx-cbl { fill:none; stroke-linecap:round; stroke-linejoin:round; }
.dgx-cbl.auto  { stroke:var(--mauve); stroke-width:1.8; stroke-dasharray:5 4; }
.dgx-hit { fill:none; stroke:transparent; stroke-width:14; cursor:pointer; pointer-events:stroke; }
.dgx-ins-line { fill:none; stroke:#3b82f6; stroke-width:2.5; stroke-linecap:round; }
.dgx-ins-btn { cursor:pointer; pointer-events:auto; }
.dgx-ins-btn circle { fill:#0d0d0f; stroke:#3b82f6; stroke-width:2; }
.dgx-ins-btn path { stroke:#3b82f6; stroke-width:2; }
.dgx-clab { fill:#8a8780; font:10px ui-monospace,monospace; pointer-events:none; }
.dgx-alab { fill:var(--mauve); font:10px ui-monospace,monospace; pointer-events:none; }
/* While the cards are moving, this layer is stale: its labels, its automation arrows and its
   hit paths are React-rendered from the layout that ARRIVED, and following them per frame is
   the string-rebuilding this package left SVG to escape (docs/wobble.md). So it steps aside
   for the ~200 ms of the move and comes back. The signal cables do follow — they are the
   canvas, redrawn from the interpolated positions every frame. See docs/nodeMotion.md. */
.dgx-cables { transition:opacity .1s linear; }
.dgx-cables.moving { opacity:0; }

.dgx-node { position:absolute; box-sizing:border-box; border-radius:11px;
  background:linear-gradient(180deg,#1d1c22,var(--card)); border:1px solid var(--line);
  box-shadow:0 12px 30px -10px rgba(0,0,0,.66); transition:box-shadow .16s, border-color .16s; }
.dgx-node.k-track,.dgx-node.k-module,.dgx-node.k-sink { --accent:var(--sand); }
.dgx-node.k-curve { --accent:var(--mauve); }
.dgx-node.k-stub { --accent:#ef4444; }
.dgx-node.k-unsupported { --accent:#f59e0b; }
.dgx-node { border-color:color-mix(in srgb, var(--accent) 42%, var(--line)); }
.dgx-node.sel { box-shadow:0 0 0 2px ${RING}, 0 12px 30px -10px rgba(0,0,0,.66); }
.dgx-node.tappable { cursor:pointer; }
/* Far LOD: too zoomed out for the widgets, so the card becomes just its name, sized to
   fill the node (see Node's fitFont) so it stays legible when the node is tiny on screen. */
.dgx-node.far { display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:2px; padding:5px; overflow:hidden; }
/* line-height 1.15, not 1: at exactly 1 the line box IS the font size, so every
   descender (the y and j of "sy.jun", a module's "polymer") falls outside it and this
   rule's own overflow:hidden slices it off. The 0.15 is what holds them. */
.dgx-far { display:block; max-width:100%; font-weight:600; letter-spacing:-.01em;
  line-height:1.15; text-align:center; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; color:#e7e6ea; }
.dgx-far.stub { color:#f87171; }
.dgx-far.unsupported { color:#fbbf24; }
.dgx-hd { position:absolute; top:0; left:0; right:0; display:flex; align-items:center; gap:7px;
  padding:7px 10px; box-sizing:border-box; border-bottom:1px solid #2f2f36; border-radius:11px 11px 0 0;
  background:linear-gradient(180deg,rgba(255,255,255,.015),transparent); }
/* The content area every node has below its header. A no-UI module shows "No Options"
   here — or, when its plugin is missing/unknown/unsupported, WHY there are none; a
   sink shows its OUT/stereo mark; a Ui'd module shows its widget grid. */
.dgx-empty { position:absolute; top:38px; left:0; right:0; bottom:0;
  display:flex; justify-content:center; padding:6px 8px 0;
  font:8px ui-monospace,monospace; color:var(--dim); letter-spacing:.04em;
  text-align:center; }
/* A fault, not a property — same red the node's name and border already wear. The
   message is longer than "No Options", so it wraps rather than being cut. */
.dgx-empty.stub { color:#f87171; white-space:normal; line-height:1.35; }
.dgx-tri { width:8px; height:8px; border-radius:3px; background:var(--accent);
  box-shadow:0 0 8px -1px color-mix(in srgb,var(--accent) 70%,transparent); flex:none; }
/* The size here is the CEILING and the fallback; the real one is set inline per card, fitted to
   the name (headerFontPx). The ellipsis stays as the last resort: the fit is floored, so a name
   long enough still gets cut rather than shrunk into a smudge. */
.dgx-nm { font-size:12.5px; font-weight:560; letter-spacing:-.005em; flex:1;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* The instrument glyph on a track node: its own centred line above the name, at both
   LODs. White rather than the track's colour — the colour is already the card's top
   border and background tint, and a third copy of it just muddies the glyph. */
.dgx-ticon { flex:none; color:#fff; }
/* In the header the glyph leads the name on one line — it reads as the node's kind
   before its label, the way the accent dot used to. (The far card stacks instead: see
   .dgx-node.far, where the name is the whole card and a leading glyph would eat the
   width it needs.) */
.dgx-hd .dgx-ticon { font-size:13px; }
.dgx-nm.stub { color:#f87171; }
.dgx-nm.unsupported { color:#fbbf24; }
.dgx-chip { font-size:8.5px; text-transform:uppercase; letter-spacing:.12em; font-weight:600;
  padding:2px 5px 1px; border-radius:5px; color:var(--accent);
  background:color-mix(in srgb,var(--accent) 13%,transparent);
  border:1px solid color-mix(in srgb,var(--accent) 32%,transparent); }
.dgx-sub { font:10px ui-monospace,monospace; color:var(--faint); }
.dgx-sub.stub { color:#f87171; }
.dgx-sub.unsupported { color:#fbbf24; }
/* The interface input a track is fed from. min-width:0 plus the ellipsis is what keeps a long
   channel label from pushing the track's own name out of a header only as wide as the card —
   the name identifies the node, so it wins the room.
   (No backticks in here — this block is a template literal.) */
.dgx-tin { margin-left:auto; max-width:52%; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; font:9px ui-monospace,monospace;
  color:var(--sand); background:#08080b; border:1px solid #2c2c33; border-radius:4px;
  padding:0 4px; cursor:pointer; }
.dgx-tin.unknown { color:var(--faint); }
/* A bubble STRADDLING the node's top-right corner — half on the card, half off it, so
   it reads as attached to the module without belonging to its title strip.
   The overhang is safe: dagre keeps nodes 40px apart (nodesep) and ranks 100px, and
   nothing between here and .dgx (the pane) clips, so 8px over the edge can't collide
   with a neighbour or get cut. It sits above the card's own shadow via z-index. */
.dgx-pbtn { position:absolute; top:-8px; right:-8px; z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:pointer; color:var(--dim); background:var(--card); border:1px solid var(--line);
  box-shadow:0 1px 4px rgba(0,0,0,.45); }
.dgx-pbtn:hover { color:#e7e6ea; border-color:var(--sand); }
/* Bypass, the plugin bubble's twin. The .paired variant shifts it clear of that one (17px wide +
   3px of air) so the two straddle the corner side by side; alone it takes the corner
   itself. Lit amber when ON, because a bypassed module still LOOKS like a module — the
   node dims, but dim also means "the whole chain is off", so the state needs its own
   mark. */
.dgx-bbtn { position:absolute; top:-8px; right:-8px; z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:pointer; color:var(--dim); background:var(--card); border:1px solid var(--line);
  box-shadow:0 1px 4px rgba(0,0,0,.45); }
.dgx-bbtn.paired { right:12px; }
/* A load problem the ENGINE reported for this plugin — a model it refused, a plugin it could not create. The
   node is otherwise healthy-looking, which is the whole trouble: it sits in the chain and does nothing. Amber
   and on the free corner (both right-hand ones are the plugin/bypass bubbles); the message is its tooltip. */
.dgx-wbtn { position:absolute; top:-8px; left:-8px; z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:help; color:#0d0d0f; background:#f59e0b; border:1px solid #f59e0b;
  box-shadow:0 1px 4px rgba(0,0,0,.45); font:bold 11px/1 ui-sans-serif,system-ui; }
/* FROZEN — this node is inside a track's render, so the engine never built it. Cold blue, on the bottom-left
   corner (the top-left one is the engine's warning badge, and the two can be true at once: a module can have
   failed to load and then been frozen with the failure baked in). */
.dgx-fbtn { position:absolute; bottom:-8px; left:-8px; z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:help; color:#0d0d0f; background:#7dd3fc; border:1px solid #7dd3fc;
  box-shadow:0 1px 4px rgba(0,0,0,.45); }
.dgx-fbtn svg { width:11px; height:11px; }
/* The frost itself: a wash over the node, under its contents, so the node still reads while reading as inert. */

/* A track's CLIPS, listed under its controls. Rows rather than a paragraph: the eye scans a
   lane's contents down, and each row is one clip whose name is ellipsed rather than wrapped —
   a card is only as wide as its grid, and a wrapped name would push the list past its box.
   A missing clip is red because a lane pointing at material that is not there is the one state
   this list exists to catch. See CLIP_LIST_MAX in @studio/ui-chains for the counted overflow. */
.dgx-clips { position:absolute; left:0; right:0; bottom:0; padding:0 7px 6px;
  display:flex; flex-direction:column; overflow:hidden;
  /* A rule ABOVE the list, separating it from the controls it sits under. */
  border-top:1px solid color-mix(in srgb, var(--line) 60%, transparent); }
/* One rule per row rather than a gap: the rows are short and a gap alone left them reading as
   one block of text. The first-child reset keeps the list's own top edge from doubling it. */
.dgx-clip { display:flex; align-items:center; gap:6px; height:15px;
  font-size:10px; line-height:15px; color:var(--fg); opacity:.72;
  border-top:1px solid color-mix(in srgb, var(--line) 35%, transparent); }
.dgx-clip:first-child { border-top:none; }
/* The position column: fixed width so the names beside it start on one line, and tabular
   figures so the digits themselves line up. It never shrinks — the NAME is what gets ellipsed,
   because a truncated timecode says nothing at all while a truncated name still identifies. */
.dgx-clip-tc { flex:none; font-variant-numeric:tabular-nums; font-size:9px;
  opacity:.7; letter-spacing:-.2px; }
.dgx-clip-nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dgx-clip.missing { color:#ef4444; opacity:1; }
.dgx-clip.more { opacity:.5; font-style:italic; }

/* A NOTE — a doc module. Deliberately unlike every other card: no accent bar, no header, a
   paper tint and a dashed edge, so prose is never mistaken for something in the signal path.
   It is still a node (it ranks and takes a cable), it just does not look like a device. */
.dgx-note { --accent:var(--mauve); border-style:dashed;
  background:color-mix(in srgb, var(--mauve) 7%, var(--card)); }
.dgx-note-body { padding:10px; font-size:11.5px; line-height:17px;
  white-space:pre-wrap; overflow-wrap:anywhere; overflow:hidden;
  color:var(--fg); opacity:.86; }
.dgx-node.frozen { background-image:linear-gradient(rgba(125,211,252,.12), rgba(125,211,252,.12)); }
/* The module being created: a node drawn where it will land, saying only that something is on its way. Dashed,
   because a solid border would claim it exists. */
.dgx-node.pending { border-style:dashed; opacity:.75; }
.dgx-spin { width:18px; height:18px; margin:auto; border-radius:50%;
  border:2px solid var(--line); border-top-color:var(--sand); animation:dgx-rot .8s linear infinite; }
@keyframes dgx-rot { to { transform:rotate(360deg); } }
.dgx-bbtn:hover { color:#e7e6ea; border-color:var(--sand); }
.dgx-bbtn.on { color:#0d0d0f; background:#f59e0b; border-color:#f59e0b; }
/* The universal bypass mark: a circle broken at the top by a vertical stroke. */
.dgx-bbtn i { width:7px; height:7px; border:1.4px solid currentColor; border-radius:50%;
  position:relative; }
.dgx-bbtn i::after { content:""; position:absolute; left:50%; top:-3px;
  width:1.4px; height:5px; background:currentColor; transform:translateX(-50%); }
/* The bubble's lower-left quarter still overlaps the header's corner, so a long name
   needs to stop short of it — less than when it sat fully inside. */
.dgx-hd.pbtn { padding-right:14px; }
.dgx-hd.bbtn { padding-right:26px; }
.dgx-pbtn i { width:9px; height:1.4px; background:currentColor; box-shadow:0 3px currentColor,0 -3px currentColor; }

/* A PORT: a socket in a little plate stepped off the card's edge, the way a mini-jack is panel
   mounted. The plate is what makes it read as hardware — a bare dot on a border reads as a
   bullet, and a node with three of them reads as a list. It sits OUTSIDE the card so it never
   competes with the widget grid, and its flat side is the one against the card.
   (No backticks anywhere in this block: it is inside a template literal, and one would end it.) */
.dgx-port { position:absolute; display:grid; place-items:center;
  width:17px; height:${PORT_PLATE}px; box-sizing:border-box;
  background:linear-gradient(#2a2930,#141419); border:1px solid var(--line);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05); transform:translateX(-50%); }
.dgx-port.in  { top:-${PORT_PLATE}px;    border-bottom-width:0; border-radius:4px 4px 0 0; }
.dgx-port.out { bottom:-${PORT_PLATE}px; border-top-width:0;    border-radius:0 0 4px 4px; }
/* …and the barrel, seen end on: a dark bore with a bright ring, coloured by what the port
   carries so a socket matches the cable that belongs in it. */
.dgx-port i { width:9px; height:9px; border-radius:50%;
  background:radial-gradient(circle at 37% 33%,#3b3a43,#08080b 68%);
  border:1.5px solid color-mix(in srgb,var(--jc) 62%,#2c2c33);
  box-shadow:inset 0 0 2px 1px rgba(0,0,0,.8); }
/* FREE — nothing wired to it. An invitation rather than a connection, so the plate recedes and
   the bore loses its ring: the eye finds the sockets that carry signal first, and the spare one
   only when it is looking for somewhere to plug in. */
.dgx-port.free { opacity:.55; }
.dgx-port.free i { border-color:#2c2c33; background:radial-gradient(circle at 37% 33%,#232228,#0a0a0d 68%); }

/* A widget is absolutely placed at its widgetRect box (node-local), so the drawing and the
   automation-arrow targets agree with graph.ts by construction. */
.dgx-w { position:absolute; box-sizing:border-box; display:flex; flex-direction:column;
  align-items:center; justify-content:center; }
.dgx-w.drag { cursor:ns-resize; }
.dgx-w.tap { cursor:pointer; }
.dgx-wlab { font-size:8px; text-transform:uppercase; letter-spacing:.09em; color:var(--dim);
  margin-top:1px; white-space:nowrap; }
.dgx-wval { font:10px ui-monospace,monospace; color:#e7e6ea; font-variant-numeric:tabular-nums; }
.dgx-slider { width:80%; height:5px; border-radius:3px; background:#08080b; border:1px solid #212129; overflow:hidden; }
.dgx-slider i { display:block; height:100%; background:var(--sand); }

/* The channel fader. flex:1 plus min-height:0 is the whole feature: it eats whatever vertical space the widget's
   rowSpan gives it, so a rowSpan of 6 is a real 6-cell throw rather than a slider stood on its end.
   (No backticks in here — this block is a template literal.) */
.dgx-fader { flex:1 1 0; min-height:0; width:100%; display:flex; justify-content:center; align-items:stretch;
  gap:3px; padding:2px 0; }
/* The VU, left of the throw — the strip's own signal, over the same -60..+6 dB span as the Mix panel's meter, in
   the same three colours at the same thresholds (emerald, amber from -6, red from 0). The RAMP is on the box and
   a shade masks it from the top, so the colour is decided by the level; painting it on the fill instead would
   squeeze the whole ramp into whatever height the bar happened to have, and a quiet track would read red. */
.dgx-fmeter { position:relative; width:5px; border-radius:3px; border:1px solid #212129; overflow:hidden;
  flex:none; background:linear-gradient(to top,
    #10b981 0%, #10b981 81.8%, #fbbf24 81.8%, #fbbf24 90.9%, #ef4444 90.9%, #ef4444 100%); }
/* NO transition on the shade. Levels arrive every 50ms and this was a 60ms ease, so it was
   restarted before it ever finished — the bar never reached its own value and trailed a frame
   behind for ever. A height cannot run on the compositor either, so each restart cost a
   restyle, a reflow and a display-list entry. See @studio/engine-browser's docs/meters.md. */
.dgx-fmeter i { position:absolute; inset:0; display:block; background:#08080b;
  transform-origin:top; }
.dgx-fader .rail { position:relative; width:7px; border-radius:4px; background:#08080b;
  border:1px solid #212129; }
/* Ticks OUTSIDE the rail, one per 10% of the throw — what makes it read as a strip rather than a progress bar. */
.dgx-fader .rail::before, .dgx-fader .rail::after { content:""; position:absolute; top:3px; bottom:3px; width:4px;
  background:repeating-linear-gradient(#2c2c33 0 1px, transparent 1px 10%); }
.dgx-fader .rail::before { right:calc(100% + 3px); }
.dgx-fader .rail::after { left:calc(100% + 3px); }
.dgx-fader .fill { position:absolute; left:0; right:0; bottom:0; border-radius:0 0 3px 3px; background:var(--sand); }
/* The cap, centred on the value: half its height above the point, so the CENTRE LINE is what reads the rail. */
.dgx-fader .cap { position:absolute; left:50%; width:19px; height:11px; margin-left:-9.5px; margin-top:-5.5px;
  border-radius:2.5px; background:linear-gradient(#43424b,#191920); border:1px solid #55545f;
  box-shadow:0 1px 3px rgba(0,0,0,.55); }
.dgx-fader .cap::after { content:""; position:absolute; left:2px; right:2px; top:4.5px; height:1px;
  background:var(--sand); }
.dgx-fader.unknown .fill { background:#2c2c33; }
.dgx-fader.unknown .cap::after { background:var(--faint); }
/* The gain readout, above the throw — where a strip puts it, and it must not steal height from the rail. */
.dgx-fval { font:9px ui-monospace,monospace; color:#e7e6ea; font-variant-numeric:tabular-nums;
  line-height:1.2; flex:0 0 auto; }
.dgx-fval.unknown { color:var(--faint); }
.dgx-toggle { width:26px; height:14px; border-radius:7px; background:#2c2c33; position:relative; transition:background .12s; }
.dgx-toggle.on { background:var(--sand); }
.dgx-toggle i { position:absolute; top:2px; left:2px; width:10px; height:10px; border-radius:50%; background:#e7e6ea; transition:left .12s; }
.dgx-toggle.on i { left:14px; }
.dgx-btn { min-width:20px; height:16px; padding:0 5px; border-radius:4px; font-size:9px; font-weight:700;
  display:grid; place-items:center; border:1px solid; color:var(--c);
  border-color:color-mix(in srgb,var(--c) 52%,transparent); background:color-mix(in srgb,var(--c) 15%,transparent); }
.dgx-btn.on { color:#0d0d0f; background:var(--c); border-color:var(--c); box-shadow:0 0 9px -2px var(--c); }
.dgx-num { min-width:26px; padding:2px 4px; border-radius:3px; border:1px solid var(--line);
  font:10px ui-monospace,monospace; color:#e7e6ea; }
.dgx-num.unknown { color:var(--dim); }
.dgx-sel { max-width:100%; font:9px ui-monospace,monospace; color:#e7e6ea;
  background:#08080b; border:1px solid #2c2c33; border-radius:4px; padding:1px 2px;
  cursor:pointer; }
.dgx-sel:disabled { cursor:default; opacity:.5; }
.dgx-sel.unknown { color:var(--faint); }
/* The FILE picker fills the cell its colSpan gave it — the horizontal twin of .dgx-fader's
   flex:1, and the same argument: a colSpan of 4 that draws a 40px button is four cells of
   nothing. What it holds is a file NAME, so the width is the useful part.
   Ellipsis rather than overflow: names here run long (a NAM pack's are a sentence), and a
   fixed-width box was hiding that behind its own edge. */
.dgx-file { width:100%; padding:1px 5px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.dgx-meter { width:80%; height:5px; border-radius:3px; background:#08080b; border:1px solid #212129; }

.dgx-out { position:absolute; top:38px; left:0; right:0; bottom:0; display:grid; place-items:center; }
.dgx-out b { font:600 20px ui-monospace,monospace; letter-spacing:.04em; color:var(--sand); line-height:1; }
.dgx-out span { font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); }
/* The audition button. In this stylesheet and not in a host's, because the graph's CSS is
   INJECTED (see useCss) — a class styled in an app's Tailwind would come out unstyled here. */
.dgx-play { margin-top:5px; width:22px; height:22px; display:grid; place-items:center;
  border:1px solid #2c2c33; border-radius:50%; background:#08080b; color:var(--sand);
  font-size:9px; line-height:1; cursor:pointer; }
.dgx-play:hover:not(:disabled) { border-color:var(--sand); }
.dgx-play:disabled { cursor:default; opacity:.35; }
.dgx-curve { position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; gap:9px; padding:8px 10px 9px; box-sizing:border-box; }
.dgx-cmeta { font:9px ui-monospace,monospace; color:var(--dim); line-height:1.5; }
.dgx-cmeta b { color:var(--mauve); }
`;

function useCss() {
  useEffect(() => {
    if (document.getElementById("dgx-css")) return;
    const s = document.createElement("style");
    s.id = "dgx-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }, []);
}

// --- widget targeting + value resolution (ports render.ts's widgetTarget/widgetValue) --

type TrackControl = keyof TrackControlValues;
type WidgetTarget =
  | { kind: "plugin"; pluginId: string; name: string }
  | { kind: "track"; trackId: string; control: TrackControl }
  | { kind: "module"; module: string; field: string }
  // A param of a module realised OUTSIDE the graph — see `offlineOf`.
  | { kind: "offline"; module: string; name: string };

/**
 * What a widget actuates: an `@` bind is an INTRINSIC — the thing's own field rather than a plugin param — and
 * which thing that is depends on the node it is drawn on. A track's are its mixer controls; a module's are the
 * fields of its own file, which is how a live input's `monitor` is reachable at all (it has no plugin, so it has
 * no params, so before this every widget on one was inert).
 *
 * Everything else is a plugin param, and needs a plugin to send it to.
 */
function widgetTarget(
  n: GraphNode,
  w: WebWidget,
  /** Does the host offer a channel for modules with no plugin? See `offlineOf`. */
  offline = false,
): WidgetTarget | null {
  if (!w.bind) return null;
  if (w.bind.startsWith("@")) {
    const field = w.bind.slice(1);
    if (n.kind === "track")
      return {
        kind: "track",
        trackId: n.label,
        control: field as TrackControl,
      };
    return n.module ? { kind: "module", module: n.module, field } : null;
  }
  if (n.pluginId) return { kind: "plugin", pluginId: n.pluginId, name: w.bind };
  // No plugin, and the host says it knows what such a module is set to. Opt-in, so a host
  // that does NOT — l8, st0 — keeps drawing nothing here rather than a knob that turns
  // against an address the engine never had.
  return offline && n.module
    ? { kind: "offline", module: n.module, name: w.bind }
    : null;
}

// Is any optimistic value outstanding on this channel? The guard that keeps a frame free when none is.
function hasChannel(o: Record<string, number>, prefix: string): boolean {
  for (const key in o) if (key.startsWith(prefix)) return true;
  return false;
}

/**
 * The override map with one channel's entries dropped, keeping the one under the hand.
 *
 * Returns the SAME object when it dropped nothing. A fresh one is never Object.is-equal to the
 * state, so `setOverride` would re-render on every incoming frame purely to say nothing changed —
 * which, at a plugin's ~20 frames a second per plugin, doubled the graph's render rate.
 */
function dropChannel(
  o: Record<string, number>,
  prefix: string,
  under: string | undefined,
): Record<string, number> {
  let dropped = false;
  const keep: Record<string, number> = {};
  for (const key in o) {
    if (key.startsWith(prefix) && key !== under) dropped = true;
    else keep[key] = o[key];
  }
  return dropped ? keep : o;
}

// The override map's key: an optimistic value that outranks the incoming frame until that frame catches up.
function targetKey(t: WidgetTarget): string {
  if (t.kind === "track") return `t:${t.trackId}:${t.control}`;
  if (t.kind === "module") return `m:${t.module}:${t.field}`;
  if (t.kind === "offline") return `o:${t.module}:${t.name}`;
  return `p:${t.pluginId}:${t.name}`;
}

/**
 * A module field's current value as a WIDGET number: the index of the option whose label the field holds.
 *
 * The field is a word (`monitor: auto`) and a widget speaks numbers, and the widget's own `options` already
 * carry the mapping — so the panel that draws the choices is the one that names them, and nothing here has to
 * know what `monitor` means.
 */
function moduleFieldValue(
  n: GraphNode,
  w: WebWidget,
  field: string,
): number | undefined {
  const current = field === "monitor" ? n.monitor : undefined;
  if (current === undefined) return undefined;
  return w.options?.find((o) => o.label === current)?.value;
}

/**
 * Where a host parks the camera between mounts.
 *
 * Named because it was not: six surfaces wrote `useRef<{x,y,k}|null>(null)` with four
 * near-identical comments above it. The graph is torn down with its pane, so the pan and zoom
 * have to be held by something that outlives it — see docs/chainsGraph.md. A host that omits
 * it gets a fresh frame on every reopen, which is a choice, but rarely the intended one.
 *
 * `Cam` itself lives in camera.ts, with everything else that moves it, and is re-exported here
 * because four hosts import it from the package entry.
 */
export type { Cam };
export type CamStore = React.MutableRefObject<Cam | null>;

interface Channels {
  // The STORE, not its map: each widget subscribes to its own plugin, so one plugin's frame
  // re-renders one control instead of the graph. See @studio/engine-browser's docs/params.md.
  params: PluginParamsStore;
  trackControls: Record<string, TrackControlValues>;
  override: Record<string, number>;
  // The engine's `levels` arrive by POSITION, so metering anything needs the order to name them. Here rather than
  // as a prop because a widget deep inside a tabs page needs it too, and `ch` is what already reaches there.
  trackOrder: string[];
  // A module the compiler emits NO plugin for — see `moduleParams` on the props.
  moduleParams: Record<string, Record<string, number>>;
  // Does the host handle those at all? An EMPTY map is a legitimate state (nothing set yet),
  // so the offer has to be a fact of its own rather than inferred from the map's size.
  offlineChannel: boolean;
  // …and can it TAKE one back? Showing without taking is legitimate — m9's graph knows a
  // deck's tempo while the desk that sets it is unmounted — but a knob that turns against a
  // host with nowhere to put the value is the lie this pair of flags exists to avoid.
  offlineWritable: boolean;
  // The same question for the other two channels, which went years without being asked. The
  // send is an optional call (`setPluginParam?.()`, `onTrackSet?.()`), so a host that passes
  // neither still got a widget that dragged, moved its optimistic override, sent nothing, and
  // had no engine frame coming to correct it. l8's Graph panel was exactly that.
  pluginWritable: boolean;
  trackWritable: boolean;
}

/**
 * The value a widget shows: override, else engine, else authored, else nothing. See docs/chainsGraph.md.
 *
 * `live` is the subscribed value when the caller is a rendering widget, which holds its own
 * subscription. An event handler passes none and the store is read at call time — which for a
 * handler is the RIGHT reading, being the value as of the click rather than as of the last paint.
 */
function widgetValue(
  n: GraphNode,
  w: WebWidget,
  ch: Channels,
  live?: number,
): number | undefined {
  const tgt = widgetTarget(n, w, ch.offlineChannel);
  if (!tgt) return undefined;
  const key = targetKey(tgt);
  if (key in ch.override) return ch.override[key];
  const v =
    tgt.kind === "track"
      ? ch.trackControls[tgt.trackId]?.[tgt.control]
      : tgt.kind === "module"
        ? moduleFieldValue(n, w, tgt.field)
        : tgt.kind === "offline"
          ? // What the SURFACE that realises it says, else what the file authored. There is no
            // engine answer to fall back on: the compiler emitted no plugin to ask.
            (ch.moduleParams[tgt.module]?.[tgt.name] ?? n.params?.[tgt.name])
          : (live ??
            ch.params.getSnapshot()[tgt.pluginId]?.[tgt.name] ??
            n.params?.[tgt.name]);
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

const draggable = (w: WebWidget) =>
  w.type === "knob" ||
  w.type === "slider" ||
  w.type === "fader" ||
  w.type === "number";

function fmtValue(v: number | undefined): string {
  if (v === undefined) return "–";
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

// --- edge geometry ------------------------------------------------------------
// The maths lives in @studio/ui-chains/cables; here we only pair it with the drawing's per-edge metadata.

interface EdgeGeom extends CableGeom {
  id: string;
  source: string;
  target: string;
  label?: string;
  signal?: WebSignal; // what the cable carries — picks its colour (see cableColor)
  insert: EdgeInsert | null;
}

// --- controls ----------------------------------------------------------------

// A knob dial as an SVG arc, value normalised 0..1. An unknown value leaves the pointer off and travel unfilled.
function Knob({ t, known, size }: { t: number; known: boolean; size: number }) {
  const START = Math.PI * 0.75,
    SWEEP = Math.PI * 1.5;
  const c = size / 2;
  const R = c - 2.5;
  const pt = (a: number) => [c + Math.cos(a) * R, c + Math.sin(a) * R];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const a = START + SWEEP * Math.max(0, Math.min(1, t));
  const [ix, iy] = pt(a);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={c - 1} fill="#0e0e12" stroke="#26262d" />
      <path
        d={arc(START, START + SWEEP)}
        fill="none"
        stroke="#2f2f36"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {known && (
        <>
          <path
            d={arc(START, a)}
            fill="none"
            stroke={SAND}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <line
            x1={c}
            y1={c}
            x2={ix}
            y2={iy}
            stroke="#e7e6ea"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

// A tiny sparkline for a curve node, chosen off its shape sub-label.
function Spark({ sub }: { sub: string }) {
  const W = 54,
    H = 24,
    p = 3,
    n = 48,
    s = sub.toLowerCase();
  const f = (t: number) =>
    s.includes("triangle")
      ? t < 0.5
        ? t * 2
        : 2 - t * 2
      : s.includes("saw")
        ? t
        : s.includes("square")
          ? t < 0.5
            ? 1
            : 0
          : s.includes("custom")
            ? t < 0.25
              ? t * 4
              : t < 0.55
                ? 1
                : t < 0.8
                  ? 1 - (t - 0.55) * 3.2
                  : 0.2
            : (Math.sin(t * Math.PI * 2) + 1) / 2;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return `${(p + t * (W - 2 * p)).toFixed(1)} ${(H - p - f(t) * (H - 2 * p)).toFixed(1)}`;
  });
  const d = "M " + pts.join(" L ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <path
        d={`${d} L ${W - p} ${H - p} L ${p} ${H - p} Z`}
        fill="rgba(168,137,181,.12)"
      />
      <path
        d={d}
        fill="none"
        stroke={MAUVE}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A tabs widget: a tab bar over the active page's sub-widgets. Local state, since Widget itself is stateless.
function TabsWidget({
  n,
  w,
  ch,
  style,
  onDragStart,
  onTap,
  onPick,
  onPickAsset,
  onWatchWaveform,
  onContextParam,
}: {
  n: GraphNode;
  w: WebWidget;
  ch: Channels;
  style: React.CSSProperties;
  onDragStart: (n: GraphNode, w: WebWidget, e: React.PointerEvent) => void;
  onTap: (n: GraphNode, w: WebWidget) => void;
  onPick: (n: GraphNode, w: WebWidget, value: number) => void;
  /** Open the library browser for this widget, at the click's viewport coords. */
  onPickAsset: (n: GraphNode, param: string, x: number, y: number) => void;
  /** Right-click a sub-widget — passed straight through to each. */
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap for a module — see WaveformWidget. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
}) {
  const [activePage, setActivePage] = useState<string | null>(null);
  const pages = w.pages ?? {};
  const pageNames = Object.keys(pages);
  const current = activePage ?? pageNames[0] ?? null;
  const currentWidgets = current ? pages[current] : null;
  const TAB_H = 16; // px for the tab bar

  return (
    <div className="dgx-w" style={style} onClick={(e) => e.stopPropagation()}>
      {/* tab bar */}
      <div
        className="flex overflow-hidden"
        style={{ height: TAB_H, borderBottom: "1px solid #2f2f36" }}
      >
        {pageNames.map((name) => (
          <button
            key={name}
            onClick={(e) => {
              e.stopPropagation();
              setActivePage(name);
            }}
            className="flex-1 truncate px-1 text-center text-[8px] leading-none text-muted-foreground hover:text-foreground"
            style={{
              borderBottom:
                name === current
                  ? "1.5px solid var(--sand)"
                  : "1.5px solid transparent",
              color: name === current ? "#e7e6ea" : undefined,
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {/* sub-widgets of the active page */}
      {currentWidgets &&
        Object.entries(currentWidgets).map(([id, sub]) => {
          const sr = widgetRect(sub);
          return (
            <Widget
              key={id}
              n={n}
              w={sub}
              ch={ch}
              onDragStart={onDragStart}
              onTap={onTap}
              onPick={onPick}
              onPickAsset={onPickAsset}
              onWatchWaveform={onWatchWaveform}
              onContextParam={onContextParam}
              styleOverride={{
                position: "absolute",
                left: sr.x - (style.left as number),
                top: sr.y - (style.top as number) + TAB_H,
                width: sr.w,
                height: sr.h,
              }}
            />
          );
        })}
    </div>
  );
}

// Module-level so "no envelope" is one identity: a fresh [] per read would look like a change every frame.
const NO_ENVELOPE: WaveformEnvelope[] = [];
const NOOP = (): void => {};

// Hand a node back to React: the three properties the frame loop writes, and only those.
function clearMotionStyle(el: HTMLElement | undefined): void {
  if (!el) return;
  el.style.transform = "";
  el.style.filter = "";
  el.style.pointerEvents = "";
}

// Are these the same cards on their way out? By id, so re-planning mid-exit does not re-render.
function sameGhosts(
  a: readonly Ghost<GraphNode>[],
  b: readonly Ghost<GraphNode>[],
): boolean {
  return a.length === b.length && a.every((g, i) => g.node.id === b[i].node.id);
}

// A waveform widget: a real-time min/max envelope on a <canvas>, off the frame's waveform map for this module.
function WaveformWidget({
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
  // Where to listen. Normally this node's own plugin, on the side the widget asks for —
  // but a node may name a tap of its own, which is how a live input gets a picture at all:
  // it has no plugin, so it borrows the INPUT of the first module on the lane it feeds.
  // The widget's `source` does not apply there; an input has one signal, not two sides.
  const tap = n.tap ?? (n.pluginId ? { id: n.pluginId, side: w.source } : null);
  // The waveform key is pluginId:side (e.g. "chain:module:output").
  const key = tap?.id && tap.side ? `${tap.id}:${tap.side}` : null;

  // The envelope reaches the canvas through a REF off a RAW subscription, never through
  // useEngineState — see docs/waveformWidget.md for the three things that were wrong here.
  const store = useEngineStoreOrNull();
  const envelopeRef = useRef<WaveformEnvelope[]>(NO_ENVELOPE);
  const dirtyRef = useRef(true);
  // Set by the draw effect; the subscription below pokes it to restart a stopped loop.
  const wakeRef = useRef<() => void>(NOOP);

  useEffect(() => {
    if (!store) return;
    // Read on subscribe too: a widget mounted (or repointed at another tap) between two
    // frames must not keep drawing the previous one until the next frame lands.
    const read = (): void => {
      const env = key
        ? (store.getSnapshot().waveform[key] ?? NO_ENVELOPE)
        : NO_ENVELOPE;
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

  // The tap is the ENGINE's, and inserting one costs it a plugin in the chain — so it is
  // placed while this widget is on screen and removed when it leaves. Nothing did this,
  // which is why the widget drew an empty box: it read a key the engine was never filling.
  const id = tap?.id;
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

    // The box comes from a ResizeObserver, exactly as the cable canvas takes its host size:
    // measuring inside the draw flushes style on every frame, per widget on screen.
    let W = 0;
    let H = 0;
    let appliedDpr = 0;
    let raf = 0;
    let last = 0;
    const minDt = 1000 / WOBBLE_FPS;

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
      const env = envelopeRef.current;
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

    // Started by an envelope, stopped by stillness — the rule the camera and the ripple
    // already follow. A widget on a silent module schedules no frames at all.
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
  }, []);

  return (
    <div className="dgx-w" style={style}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}

// One widget at its widgetRect box: knob/slider/number drag, toggle/button tap, painted off the override.
function WidgetInner({
  n,
  w,
  ch,
  onDragStart,
  onTap,
  onPick,
  onPickAsset,
  onWatchWaveform,
  onContextParam,
  styleOverride,
}: {
  n: GraphNode;
  w: WebWidget;
  ch: Channels;
  onDragStart: (n: GraphNode, w: WebWidget, e: React.PointerEvent) => void;
  onTap: (n: GraphNode, w: WebWidget) => void;
  // A dropdown picks an exact value rather than flipping one, so it can't go through onTap.
  onPick: (n: GraphNode, w: WebWidget, value: number) => void;
  // A library dropdown picks a FILE for a module field, so it takes neither a widget nor a number.
  /** Open the library browser for this widget, at the click's viewport coords. */
  onPickAsset: (n: GraphNode, param: string, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap for a module — see WaveformWidget. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** Right-click on this control — the host's menu for the PARAM it drives (see GraphMenuCtx). */
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
  styleOverride?: React.CSSProperties;
}) {
  const r = widgetRect(w);
  // Hoisted above the two delegating returns because the subscription below is a hook and a hook
  // cannot live after one. Pure, and null for both of them — neither type carries a `bind`.
  const tgt = widgetTarget(n, w, ch.offlineChannel);
  // This control's own live value: a plugin frame re-renders this widget, not the graph. Same
  // shape as InputMeterBar and FaderMeter below — the leaf that draws the number owns the tap.
  const live = usePluginParamValue(
    ch.params,
    tgt?.kind === "plugin" ? tgt.pluginId : null,
    tgt?.kind === "plugin" ? tgt.name : null,
  );

  // Tabs widget: delegate to TabsWidget
  if (w.type === "tabs") {
    return (
      <TabsWidget
        n={n}
        w={w}
        ch={ch}
        style={
          styleOverride ?? { left: r.x, top: r.y, width: r.w, height: r.h }
        }
        onDragStart={onDragStart}
        onTap={onTap}
        onPick={onPick}
        onPickAsset={onPickAsset}
        onWatchWaveform={onWatchWaveform}
        onContextParam={onContextParam}
      />
    );
  }

  // Waveform widget: delegate to WaveformWidget
  if (w.type === "waveform") {
    return (
      <WaveformWidget
        n={n}
        w={w}
        onWatch={onWatchWaveform}
        style={
          styleOverride ?? { left: r.x, top: r.y, width: r.w, height: r.h }
        }
      />
    );
  }

  // Drawn from a value it cannot change: read-only rather than dead, which is what an offline
  // module looks like on a surface that only borrows its number — and now what ANY widget looks
  // like when its host gave no way back. Read-only is honest; draggable-and-ignored is not.
  const actuable =
    tgt !== null &&
    (tgt.kind === "offline"
      ? ch.offlineWritable
      : tgt.kind === "track"
        ? ch.trackWritable
        : ch.pluginWritable);
  const value = widgetValue(n, w, ch, live);
  const known = value !== undefined;
  const t = known ? widgetNorm(w, value) : 0;
  const style: React.CSSProperties = styleOverride ?? {
    left: r.x,
    top: r.y,
    width: r.w,
    height: r.h,
  };
  const caption =
    w.type === "label" || w.type === "button" ? undefined : w.label;

  // A control never selects the node; an inert one (label, meter, undrivable knob) lets the click fall through.
  const interact: React.HTMLAttributes<HTMLDivElement> & { className: string } =
    actuable && draggable(w)
      ? {
          className: "dgx-w drag",
          onPointerDown: (e) => onDragStart(n, w, e),
          onClick: (e) => e.stopPropagation(),
        }
      : w.type === "dropdown" || w.type === "filepicker"
        ? {
            className: "dgx-w",
            onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
            onClick: (e: React.MouseEvent) => e.stopPropagation(),
          }
        : actuable && (w.type === "toggle" || w.type === "button")
          ? {
              className: "dgx-w tap",
              onClick: (e) => {
                e.stopPropagation();
                onTap(n, w);
              },
            }
          : { className: "dgx-w" };

  // A control that drives something can be right-clicked for what drives IT. On the widget rather
  // than the node, and stopped there, so the module's own menu does not answer for one knob.
  if (actuable && onContextParam)
    interact.onContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onContextParam(n, w, e.clientX, e.clientY);
    };

  let body: React.ReactNode = null;
  if (w.type === "knob") {
    const size = Math.min(r.w, r.h - (caption ? 11 : 0)) - 4;
    body = <Knob t={t} known={known} size={Math.max(14, size)} />;
  } else if (w.type === "slider") {
    body = (
      <div className="dgx-slider">
        <i style={{ width: `${(known ? t : 0) * 100}%` }} />
      </div>
    );
  } else if (w.type === "fader") {
    // Readout first, then the rail with whatever height is left — see .dgx-fader.
    body = (
      <>
        <span className={`dgx-fval${known ? "" : " unknown"}`}>
          {fmtValue(value)}
        </span>
        <div className={`dgx-fader${known ? "" : " unknown"}`}>
          {/* The VU rides beside the throw, left of it, as a channel strip has it. Only on a chain that IS a
              track: a bus is fed by several, and there is no one level to show. */}
          {n.chain && <FaderMeter trackId={n.chain} order={ch.trackOrder} />}
          <div className="rail">
            <i
              className="fill"
              style={{ height: `${(known ? t : 0) * 100}%` }}
            />
            <i
              className="cap"
              style={{ top: `${(1 - (known ? t : 0)) * 100}%` }}
            />
          </div>
        </div>
      </>
    );
  } else if (w.type === "toggle") {
    const on = known && t >= 0.5;
    body = (
      <div className={`dgx-toggle${on ? " on" : ""}`}>
        <i />
      </div>
    );
  } else if (w.type === "button") {
    const on = known && t >= 0.5;
    const c = (w.bind && CTRL[w.bind]) ?? RING;
    body = (
      <b
        className={`dgx-btn${on ? " on" : ""}`}
        style={{ ["--c" as string]: c }}
      >
        {w.label ?? "?"}
      </b>
    );
  } else if (w.type === "number") {
    body = (
      <span className={`dgx-num${known ? "" : " unknown"}`}>
        {fmtValue(value)}
      </span>
    );
  } else if (w.type === "label") {
    body = <span className="dgx-wval">{w.text ?? ""}</span>;
  } else if (w.type === "meter") {
    body = <div className="dgx-meter" />;
  } else if (w.type === "filepicker" || (w.type === "dropdown" && w.library)) {
    // Picks a FILE the module carries, for the file-valued param it binds. A button, not a
    // <select>: these folders are nested and long (a NAM pack is a folder per amp), and a
    // native select is one flat alphabetical scroll with no search. Clicking asks the shell to
    // open the same browsing popup the `+` on an arrow uses — see AssetPicker.
    //
    // `dropdown` + `library` is the older spelling of the same widget, from when the files came
    // from a shared library instead of the module's own assets/. Read as a filepicker so every
    // panel already written keeps working — see docs/filePicker.md.
    const param = String(w.type === "filepicker" ? (w.bind ?? "") : w.library);
    const current = n.assets?.[param] ?? "";
    const shown = current
      ? current.slice(current.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")
      : "—";
    body = (
      <button
        type="button"
        className={`dgx-sel dgx-file${current ? "" : " unknown"}`}
        // The whole path, since the face shows only the basename: two amps in different packs
        // can have the same file name, and hovering is what tells them apart.
        title={current || `pick a ${w.library} file`}
        disabled={!n.module}
        onClick={(e) => {
          e.stopPropagation();
          onPickAsset(n, param, e.clientX, e.clientY);
        }}
      >
        {shown}
      </button>
    );
  } else if (w.type === "dropdown") {
    // Options carry their own values, so the current setting is the NEAREST one — a plugin's states aren't evenly spaced.
    const opts = w.options ?? [];
    const cur =
      known && opts.length
        ? opts.reduce((best, o) =>
            Math.abs(o.value - value) < Math.abs(best.value - value) ? o : best,
          ).value
        : undefined;
    body = (
      <select
        className={`dgx-sel${known ? "" : " unknown"}`}
        value={cur ?? ""}
        disabled={!actuable || !opts.length}
        onChange={(e) => onPick(n, w, Number(e.target.value))}
      >
        {/* Only until the first value arrives — without it the select would show the
            first option as though it were the setting. */}
        {cur === undefined && <option value="">—</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div {...interact} style={style}>
      {body}
      {caption && <span className="dgx-wlab">{caption}</span>}
    </div>
  );
}
// Memoised: it holds its own param tap now, so a frame that did not move THIS number must not redraw it.
const Widget = memo(WidgetInner);

// Fit one line of text to a box in world units: glyph-count width, capped by height, floored so it never vanishes.
function fitFont(label: string, w: number, h: number): number {
  const GLYPH = 0.58;
  const byWidth = (w * 0.86) / Math.max(1, label.length * GLYPH);
  return Math.max(8, Math.min(byWidth, h * 0.6));
}

/**
 * What the header actually leaves the NAME, in px — the card less everything beside it.
 *
 * The numbers are `.dgx-hd`'s own, above: 10px of padding each side, a 7px gap, a 13px glyph or
 * an 8px dot leading it, and the padding-right a corner button adds (`pbtn`/`bbtn`). Repeated
 * here because the layout is flex and the real figure only exists after a reflow, which is
 * exactly what a per-card measurement would cost. If the CSS moves, this moves with it.
 */
function headerNameW(n: GraphNode, hasGlyph: boolean): number {
  const HD_PAD = 10;
  const HD_GAP = 7;
  const lead = hasGlyph ? 13 : 8;
  const corner = n.module && n.hasNativePluginUI ? 26 : 0;
  return Math.max(16, n.w - HD_PAD * 2 - lead - HD_GAP - corner);
}

// The glyph's height on the far card, taken from the NODE: it sits on its own line, so it needs a share of height.
const farIconPx = (w: number, h: number): number =>
  Math.min(h * 0.34, w * 0.34);

// The armed-track input meter: its own store subscription, so a moving input re-renders 4px, not the graph.
function InputMeterBar({
  trackId,
  order,
}: {
  trackId: string;
  order: string[];
}) {
  const level = useInputLevel(trackId, order);
  if (level === null) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 4,
        overflow: "hidden", // clips the fill to the card's rounded bottom corners
        borderBottomLeftRadius: 10,
        borderBottomRightRadius: 10,
        pointerEvents: "none",
        background: "rgba(239,68,68,0.22)", // red-500 @ 22%
      }}
    >
      {/* Scaled, not resized: the fill is a plain block of colour, so scaleX draws the identical
          pixels while changing no geometry — a width would reflow this element every frame the
          engine speaks. See @studio/engine-browser's docs/meters.md. */}
      <div
        style={{
          height: "100%",
          width: "100%",
          transform: `scaleX(${level})`,
          transformOrigin: "left",
          background: CTRL["@arm"], // red-500, matching the arm control
        }}
      />
    </div>
  );
}

/**
 * The fader's VU — the same signal, range and colours as a Mix-panel strip, because it is the same strip: a mixer
 * module sits on a track's chain and the fader on it is that track's level.
 *
 * Its own component with its own subscription, exactly like InputMeterBar: the level arrives every frame, and it
 * has to move a 9px bar rather than re-render the graph. `null` (a chain that is not a track — a bus is fed by
 * several) draws nothing at all, so the fader keeps its full width instead of reserving space for a dead bar.
 */
function FaderMeter({ trackId, order }: { trackId: string; order: string[] }) {
  const t = useTrackLevel(trackId, order);
  if (t === null) return null;
  return (
    <div className="dgx-fmeter">
      {/* The SHADE, not the fill: it covers the ramp from the top down to the level. Scaled from
          the top rather than resized — same block of black, no geometry to redo. */}
      <i style={{ transform: `scaleY(${1 - t})` }} />
    </div>
  );
}

function NodeInner({
  n,
  selected,
  showWidgets,
  far,
  ch,
  trackOrder,
  onTapNode,
  onContext,
  onOpenPlugin,
  onBypass,
  warning,
  onDragStart,
  onTapWidget,
  onPickWidget,
  onPickAsset,
  trackInput,
  onPickTrackInput,
  onWatchWaveform,
  onContextParam,
  sinkPlay,
}: {
  n: GraphNode;
  selected: string | null;
  showWidgets: boolean;
  // The camera is too far for the node's content: draw just its name, fitted to the card.
  far: boolean;
  ch: Channels;
  // The engine level index order, so a track's meter bar can find its slot; the node itself never reads levels.
  trackOrder: string[];
  onTapNode: (n: GraphNode) => void;
  onContext: (n: GraphNode, e: React.MouseEvent) => void;
  onOpenPlugin: (module: string) => void;
  onBypass: (module: string) => void;
  /** What the engine reported about THIS node's plugin, if anything. */
  warning?: string;
  onDragStart: (n: GraphNode, w: WebWidget, e: React.PointerEvent) => void;
  onTapWidget: (n: GraphNode, w: WebWidget) => void;
  onPickWidget: (n: GraphNode, w: WebWidget, value: number) => void;
  /** Open the library browser for this widget, at the click's viewport coords — a FILE for
   *  the module field the widget names. Called `onPickLibrary` until the assets rework;
   *  the old name survived a merge as a dead prop beside this one, and is gone now. */
  onPickAsset: (n: GraphNode, param: string, x: number, y: number) => void;
  /** What this TRACK is fed from, as a chip on its header. Undefined draws none — which is
   *  every node that is not a track, and every host that cannot change one. */
  trackInput?: string;
  onPickTrackInput: (n: GraphNode, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap for a module — see WaveformWidget. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** Right-click on one of this node's controls — the menu for the PARAM, not for the module. */
  onContextParam?: (n: GraphNode, w: WebWidget, x: number, y: number) => void;
  sinkPlay?: SinkPlay;
}) {
  const { ModuleIcon, moduleGlyph, TrackIcon } = useIcons();
  // The category whose glyph this node wears. A sink has none of its own, but it IS io, so it gets io's arrows.
  const iconCategory =
    n.kind === "sink"
      ? ("io" as const)
      : n.kind === "module"
        ? n.category
        : undefined;
  // Does this node draw a glyph? Decides whether the accent dot steps aside and the far card reserves height.
  const hasGlyph = n.kind === "track" || !!moduleGlyph(iconCategory, n.missing);
  const sel =
    (!!n.chain && n.chain === selected) ||
    (!!n.chains && !!selected && n.chains.includes(selected)) ||
    (n.kind === "module" && !!n.module && n.module === selected);
  // Every node responds to a tap. A module can flag four ways (missing/stub/unknownPlugin/notSupported), all red.
  const red = n.missing || n.stub || n.unknownPlugin || n.notSupported;
  const flagCls = red ? " stub" : "";
  const flagText = n.missing
    ? "module not found"
    : n.stub
      ? "missing plugin"
      : n.unknownPlugin
        ? "unknown plugin"
        : n.notSupported
          ? "not supported"
          : null;
  const cls = [
    "dgx-node",
    `k-${red ? "stub" : n.kind}`,
    "tappable",
    sel ? "sel" : "",
    n.frozen ? "frozen" : "",
    n.pending ? "pending" : "",
    far ? "far" : "", // far ⇒ name only; every other LOD draws header + content
  ]
    .filter(Boolean)
    .join(" ");

  // The armed track's input meter, at every LOD, so an armed track reads as "recording this" at any zoom.
  const armBar =
    n.kind === "track" ? (
      <InputMeterBar trackId={n.label} order={trackOrder} />
    ) : null;

  // The module on its way: a spinner and nothing else. It has no name, no category and no parameters yet — the
  // command that will decide all three is still running — so anything else drawn here would be invented.
  if (n.pending)
    return (
      <div
        className={cls}
        data-node-id={n.id}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          display: "grid",
        }}
        aria-busy="true"
        aria-label="creating a module"
      >
        <i className="dgx-spin" />
      </div>
    );

  /**
   * A NOTE: a doc module, drawn as its text and nothing else.
   *
   * Before the LOD branch on purpose. Every other card drops to its name when the camera pulls
   * back, because widgets stop being readable and the name is what is left; a note has no
   * widgets and its text IS the card, so shrinking it to the instance's filename would replace
   * the only thing worth reading with the one thing that is not.
   *
   * No jacks drawn either: a note takes one input and gives nothing back, and a socket on a
   * comment invites a wire out of it. The cable INTO it is the ordinary one — that is what says
   * which part of the chain the note is about. See @studio/song's docs/docModules.md.
   */
  if (n.note !== undefined)
    return (
      <div
        className={`${cls} dgx-note`}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          opacity: n.dim ? 0.5 : 1,
        }}
        onClick={() => onTapNode(n)}
        onContextMenu={(e) => onContext(n, e)}
        title={n.label}
      >
        {/* `pre-wrap`: the author's own line breaks are the shape of the note, and a long line
            still wraps inside the width `noteSize` reserved for it. */}
        <div className="dgx-note-body">{n.note}</div>
      </div>
    );

  // Far LOD: widgets are unreadable at this zoom, so the whole card becomes the name, sized to fill it.
  if (far) {
    const label = n.label || (n.kind === "sink" ? "OUT" : n.kind);
    return (
      <div
        className={cls}
        data-node-id={n.id}
        style={{
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          opacity: n.dim ? 0.5 : 1,
          ...(n.kind === "track" && n.color
            ? {
                borderTop: `5px solid ${n.color}`,
                borderTopLeftRadius: 0,
                borderTopRightRadius: 0,
              }
            : {}),
          ...(n.color
            ? { background: `color-mix(in srgb, ${n.color} 12%, var(--card))` }
            : {}),
        }}
        onClick={() => onTapNode(n)}
        onContextMenu={(e) => onContext(n, e)}
      >
        {/* Stacked here, unlike the header: at this zoom the name IS the card, so a
            glyph beside it would take the width the text needs to stay legible. It goes
            above instead, on a share of the HEIGHT, and the name is fitted to the rest. */}
        {n.kind === "track" ? (
          <TrackIcon
            name={label}
            video={n.video}
            className="dgx-ticon"
            style={{ fontSize: farIconPx(n.w, n.h) }}
          />
        ) : (
          <ModuleIcon
            category={iconCategory}
            missing={n.missing}
            className="dgx-ticon"
            style={{ fontSize: farIconPx(n.w, n.h) }}
          />
        )}
        <span
          className={`dgx-far${flagCls}`}
          style={{
            fontSize: fitFont(
              label,
              n.w,
              n.h - (hasGlyph ? farIconPx(n.w, n.h) : 0),
            ),
          }}
        >
          {label}
        </span>
        {armBar}
      </div>
    );
  }

  return (
    <div
      className={cls}
      data-node-id={n.id}
      style={{
        left: n.x,
        top: n.y,
        width: n.w,
        height: n.h,
        opacity: n.dim ? 0.5 : 1,
        ...(n.kind === "track" && n.color
          ? {
              borderTop: `5px solid ${n.color}`,
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
            }
          : {}),
        ...(n.color
          ? { background: `color-mix(in srgb, ${n.color} 12%, var(--card))` }
          : {}),
      }}
      onClick={() => onTapNode(n)}
      onContextMenu={(e) => onContext(n, e)}
    >
      <div
        className={`dgx-hd${n.hasNativePluginUI && n.module ? " pbtn" : ""}${
          n.kind === "module" && n.module && n.hasNativePluginUI ? " bbtn" : ""
        }`}
      >
        {/* The accent dot marks identity on a node with no glyph of its own. Where one
            IS drawn it leads the row instead, saying the node's kind rather than just
            colouring it — two markers in a row would only crowd the name. */}
        {!hasGlyph && <span className="dgx-tri" />}
        {n.kind === "track" ? (
          <TrackIcon name={n.label} video={n.video} className="dgx-ticon" />
        ) : (
          <ModuleIcon
            category={iconCategory}
            missing={n.missing}
            className="dgx-ticon"
          />
        )}
        {/* The name is SIZED to fit rather than ellipsed: a card is only as wide as its panel's
            grid, and at a fixed 12.5px seventeen identically-shaped mixers all read "vo_j…".
            What is left for it is the card less the header's padding, the leading glyph or dot,
            and the room a corner button takes out of the right — see headerFontPx. `title`
            stays: a name floored at the minimum can still be shorter than the truth. */}
        <span
          className={`dgx-nm${flagCls}`}
          title={n.label}
          style={{ fontSize: headerFontPx(n.label, headerNameW(n, hasGlyph)) }}
        >
          {n.label}
        </span>
        {/* The flag moved to the content area (it explains the missing options down
            there); the header keeps only a real sub — the chains a module is shared
            across. Saying it in both places was the same sentence twice. */}
        {n.sub && <span className={`dgx-sub${flagCls}`}>{n.sub}</span>}
        {/* What feeds this track, and one click to change it. In the header row rather than
            on a corner like the plugin bubble: it carries a NAME, and the corners are for
            glyph-sized toggles. `stopPropagation` on the press for the same reason the
            others do it — otherwise the pointer-down arms a pan and the click never lands. */}
        {trackInput !== undefined && (
          <button
            type="button"
            className={`dgx-tin${trackInput === "aucune" ? " unknown" : ""}`}
            title={`Entrée de l'interface : ${trackInput} — cliquer pour changer`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onPickTrackInput(n, e.clientX, e.clientY);
            }}
          >
            {trackInput}
          </button>
        )}
      </div>

      {/* The native plugin's editor. A bubble on the node's top-right corner rather
          than the last item in the header row: it acts on the PLUGIN, not on the
          title, and in the row it was competing for width with exactly the names that
          need it most — an external plugin's, which is the only kind that has one. */}
      {/* …and not while frozen: there is no live plugin behind a baked module, so the engine has no window to open. */}
      {n.hasNativePluginUI && n.module && !n.frozen && (
        <span
          className="dgx-pbtn"
          title="Open native plugin UI"
          // Keep the press off the pane, as a widget's does — otherwise it arms a pan and the click never reaches the button.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenPlugin(n.module!);
          }}
        >
          <i />
        </span>
      )}

      {/* Bypass — a module still in the path but passing its input through untouched.
          Sits beside the plugin bubble, offset left by however much room that one takes
          when it is there, so the pair reads as one cluster on the corner and a module
          without a native UI still gets its bypass in the same place. */}
      {n.kind === "module" && n.module && !n.frozen && (
        <span
          className={`dgx-bbtn${n.bypassed ? " on" : ""}${n.hasNativePluginUI ? " paired" : ""}`}
          title={n.bypassed ? "Bypassed — click to re-enable" : "Bypass"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onBypass(n.module!);
          }}
        >
          <i />
        </span>
      )}

      {/* What the engine said went wrong with THIS plugin. Hover for the message — it is
          usually the only explanation for a module that looks fine and does nothing. */}
      {warning && (
        <span
          className="dgx-wbtn"
          title={warning}
          role="img"
          aria-label={`engine warning: ${warning}`}
        >
          !
        </span>
      )}

      {/* Frozen: on a track, it is playing a render of itself; on a module, it is INSIDE that render and the
          engine never built it. Worth its own badge rather than folding into `dim`, because the two mean opposite
          things about what a click will do — a bypassed module is live and one click from audible, a frozen one
          is not there at all until the track thaws. */}
      {n.frozen && (
        <span
          className="dgx-fbtn"
          role="img"
          aria-label="frozen"
          title={
            n.kind === "track"
              ? "Frozen — playing a render of itself. Gain, pan and sends still work; `track freeze` again to edit it."
              : "Frozen — this module is inside its track's render and is not running. Unfreeze the track to change it."
          }
        >
          <Snowflake />
        </span>
      )}

      {/* Ports. Which sockets show is decided in graph.ts (`jacksFor`) — it depends on what is
          wired to the node, which is a fact about the graph rather than about the DOM. Here we
          only place them: evenly spaced down the edge, so two ports sit at a third and two
          thirds and neither collides with the header. */}
      {/* A curve is not on the signal path — it drives a knob — so it gets one mauve socket and
          no input: nothing plugs INTO a curve. Kept out of `jacksFor`, which types a jack by the
          signal it carries and a curve carries none. */}
      {n.kind === "curve" && (
        <span
          className="dgx-port out"
          style={{ ["--jc" as string]: MAUVE, top: "50%" }}
        >
          <i />
        </span>
      )}
      {n.kind !== "curve" &&
        (["in", "out"] as const).map((side) =>
          (n.jacks?.[side] ?? []).map((p, i, all) => (
            <span
              key={`${side}:${p.name ?? i}`}
              className={`dgx-port ${side}${p.free ? " free" : ""}`}
              title={
                p.name
                  ? `${p.name} (${p.type})${p.free ? " — free" : ""}`
                  : undefined
              }
              style={{
                // Coloured by what the port carries, so a socket matches the cable for it.
                ["--jc" as string]: cableColorFor(p.type),
                // Spread across the WIDTH: the sockets are on the top and bottom edges now
                // that signal runs down. Must agree with `jackPoint`, which is where the
                // cable's end is computed — the plate and the cable end are one place drawn
                // twice, and a disagreement reads as a cable that misses its socket.
                left: `${((i + 1) / (all.length + 1)) * 100}%`,
              }}
            >
              <i />
            </span>
          )),
        )}

      {n.kind === "sink" ? (
        <div className="dgx-out">
          <b>OUT</b>
          <span>stereo</span>
          {/* Auditioning happens at the OUTPUT: what you want to hear is the signal after
              everything in the chain, so the button belongs where that signal arrives. Only a
              host that can actually play offers one — l8 and m9 pass nothing. */}
          {sinkPlay ? (
            <button
              type="button"
              className="dgx-play"
              disabled={!!sinkPlay.disabled}
              // The node is selectable and draggable; a click on the button is neither.
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                sinkPlay.onToggle();
              }}
              // Says WHY it is dead rather than looking broken — no engine, or nothing to play.
              title={
                sinkPlay.title ?? (sinkPlay.playing ? "Arrêter" : "Écouter")
              }
              aria-label={sinkPlay.playing ? "Arrêter" : "Écouter"}
            >
              {sinkPlay.playing ? "■" : "▶"}
            </button>
          ) : null}
        </div>
      ) : n.kind === "curve" ? (
        <div className="dgx-curve">
          <Spark sub={n.sub ?? ""} />
          <div className="dgx-cmeta">
            <b>{n.sub ?? "curve"}</b>
          </div>
        </div>
      ) : n.ui && showWidgets ? (
        Object.entries(n.ui.widgets).map(([k, w]) => (
          <Widget
            key={k}
            n={n}
            w={w}
            ch={ch}
            onDragStart={onDragStart}
            onTap={onTapWidget}
            onPick={onPickWidget}
            onPickAsset={onPickAsset}
            onWatchWaveform={onWatchWaveform}
            onContextParam={onContextParam}
          />
        ))
      ) : (
        // No grid and no content: keep the card's shape and say what is missing. A flagged module says WHY, in red.
        <div className={`dgx-empty${flagCls}`}>{flagText ?? "No Options"}</div>
      )}
      {/* What this lane HOLDS, under its controls. Only on a track, only when it holds
          something, and only once the widgets are legible — at far zoom the card is its name
          and a list of clip refs would be a grey smear.

          A "missing" clip is called out: a lane pointing at material that is not there looks
          exactly like a full one otherwise, which is the failure this list is best at catching.
          The count line replaces the tail rather than extending it — see CLIP_LIST_MAX. */}
      {n.kind === "track" && n.clips?.length && showWidgets ? (
        <div className="dgx-clips">
          {n.clips.map((c) => (
            <div
              key={`${c.ref}@${c.start}`}
              className={`dgx-clip${c.kind === "missing" ? " missing" : ""}`}
              title={
                c.kind === "missing"
                  ? `${c.tc} — ${c.ref}: no such clip in this project`
                  : `${c.tc} — ${c.ref} (${c.kind})`
              }
            >
              {/* WHERE first, then WHAT. A lane is read down its positions — they are what
                  orders the list — and a fixed-width column of them stays a column however
                  long the names beside it are. Tabular figures so the digits line up. */}
              <span className="dgx-clip-tc">{c.tc}</span>
              <span className="dgx-clip-nm">{c.ref}</span>
            </div>
          ))}
          {n.clipsMore ? (
            <div className="dgx-clip more">+{n.clipsMore}</div>
          ) : null}
        </div>
      ) : null}
      {armBar}
    </div>
  );
}
// Memoised: with `ch` and every handler stable, a pan or a param frame re-renders no card at all.
const Node = memo(NodeInner);

// The SVG layer OVER the cable canvas: everything about a cable that does not move — its
// label, the automation arrows, and the hit paths the insert `+` hangs off. The signal
// cables themselves are drawn by DomChains onto a canvas; see @studio/ui-chains'
// docs/wobble.md for why they left the DOM.
function CablesInner({
  signal,
  auto,
  showLabels,
  boost,
  hovered,
  setHovered,
  onInsert,
}: {
  signal: EdgeGeom[];
  auto: AutoTarget[];
  showLabels: boolean;
  // World-unit stroke multiplier that grows as the camera pulls back, keeping on-screen thickness constant.
  boost: number;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  // The pointer position travels with it: the `+` opens a picker, which must land where you clicked.
  onInsert: (info: EdgeInsert, x: number, y: number) => void;
}) {
  return (
    <>
      {/* A signal cable's NAME — the cable itself is on the canvas underneath, and its label
          stays here because text is the one thing a canvas draws worse.

          No arrowhead, then or now: a cable ends in a PLUG, and the plug is the socket it
          disappears into — the nodes paint over this layer, so the last few pixels are hidden by
          the plate and the cable reads as seated. An arrow was the right mark while the cable
          pointed at a card and had nowhere in particular to land. Direction is not lost with it:
          the graph is laid out top to bottom, inputs on a card's top edge and outputs on its
          bottom, so which way a cable runs is read off where it lands. */}
      {signal.map((g) => {
        const pts = g.base;
        if (!showLabels || !g.label || pts.length < 2) return null;
        const mid = pts[Math.floor(pts.length / 2)];
        return (
          <text
            key={g.id}
            className="dgx-clab"
            x={mid.x}
            y={mid.y - 6}
            textAnchor="middle"
          >
            {g.label}
          </text>
        );
      })}

      {/* automation cables — straight mauve bezier into the target widget / border */}
      {auto.map((s) => {
        const dx = Math.max(40, Math.abs(s.to.x - s.from.x) * 0.45);
        const d = `M ${s.from.x} ${s.from.y} C ${s.from.x + dx} ${s.from.y}, ${s.to.x - dx} ${s.to.y}, ${s.to.x} ${s.to.y}`;
        const ang = Math.atan2(s.to.y - s.from.y, s.to.x - s.from.x);
        const lab = s.onWidget
          ? {
              x: (s.from.x + s.to.x) / 2,
              y: (s.from.y + s.to.y) / 2 - 6,
              anchor: "middle" as const,
            }
          : { x: s.to.x - 4, y: s.to.y - 12, anchor: "end" as const };
        return (
          <g key={s.id}>
            <path className="dgx-cbl-shadow" d={d} strokeWidth={3.2 * boost} />
            <path
              className="dgx-cbl auto"
              d={d}
              style={{ strokeWidth: 1.8 * boost }}
            />
            <polygon
              points={arrowPoints(s.to, ang, 6.5 * boost)}
              fill={MAUVE}
            />
            {showLabels && (
              <text
                className="dgx-alab"
                x={lab.x}
                y={lab.y}
                textAnchor={lab.anchor}
              >
                {s.param}
              </text>
            )}
          </g>
        );
      })}

      {/* insert affordance — a transparent hit path over each eligible arrow, plus the
          blue recolour + circled `+` while it's hovered */}
      {signal.map((g) => {
        if (!g.insert) return null;
        const d = smoothPath(g.base);
        const on = hovered === g.id;
        const mid = midByArc(g);
        return (
          <g key={`ins:${g.id}`}>
            <path
              className="dgx-hit"
              d={d}
              onMouseEnter={() => setHovered(g.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={(e) => {
                e.stopPropagation();
                onInsert(g.insert!, e.clientX, e.clientY);
              }}
            />
            {on && (
              <>
                <path className="dgx-ins-line" d={d} />
                <g
                  className="dgx-ins-btn"
                  onMouseEnter={() => setHovered(g.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onInsert(g.insert!, e.clientX, e.clientY);
                  }}
                >
                  <circle cx={mid.x} cy={mid.y} r={9} />
                  <path
                    d={`M ${mid.x - 4} ${mid.y} H ${mid.x + 4} M ${mid.x} ${mid.y - 4} V ${mid.y + 4}`}
                  />
                </g>
              </>
            )}
          </g>
        );
      })}
    </>
  );
}
// Memoised: a pan changes the camera, not the cables, and the wobble already bypasses React.
const Cables = memo(CablesInner);

// Map a right-clicked node to the shell's menu context (track id, module instance, chain name; curves have none).
function nodeToCtx(n: GraphNode): GraphMenuCtx | null {
  switch (n.kind) {
    case "track":
      return { kind: "track", id: n.label };
    case "module":
      return n.module
        ? { kind: "module", id: n.module, missing: n.missing }
        : null;
    case "chain":
      return { kind: "chain", id: n.chain ?? n.label };
    case "sink":
      return { kind: "sink", id: n.label };
    case "curve":
      return null;
  }
}

/**
 * Frame these nodes. Answers whether it actually framed: a host with no size yet — a pane still
 * hidden, a canvas one render early — frames nothing, and a caller that recorded that as done
 * would never try again. Ask, and retry on the next render.
 *
 * `axis: "height"` fills the height and lets the set run off the right,
 * where it pans — for a ROW, where fitting both axes divides the pane between however many
 * members it has and the scale falls with each one. Below WIDGET_MIN_SCALE the widget grid is
 * dropped altogether, so a wide enough row would frame to a rank of bare name cards.
 */
/**
 * The camera, for a host that has to put it back.
 *
 * `fitTo` frames a set of nodes; `get`/`set` are for a view that TAKES the camera and owes it
 * afterwards — the mixer arrangement borrows it to show the row, and hands it back when it
 * closes. Reading the live camera rather than the parked one (`camStore`, written only when a
 * glide settles) is the difference between restoring where you were and where you last stopped.
 */
export interface ChainsCamApi {
  fitTo: FitToFn;
  get: () => Cam;
  set: (c: Cam) => void;
}

export interface FitToOpts {
  /** Keep the zoom this fit computed and only CENTRE on this node — used to walk a chain. */
  panOnly?: GraphNode;
  /**
   * `"height"` fills the height and lets the set run off the right, where it pans — for a ROW,
   * where fitting both axes divides the pane between however many members it has and the scale
   * falls with each one. Below WIDGET_MIN_SCALE the widget grid is dropped altogether, so a wide
   * enough row would frame to a rank of bare name cards.
   */
  axis?: "both" | "height";
  /**
   * Multiply the fitted zoom. Below 1 it pulls BACK from a perfect fit, which is what a view
   * wants when the set it framed is the subject and not the whole story — the mixer row asks for
   * 0.8, so the cards that feed the strips stay in the frame around them.
   */
  zoom?: number;
}

export type FitToFn = (nodes: GraphNode[], opts?: FitToOpts) => boolean;

export function DomChains({
  icons,
  graph,
  selected,
  trackOrder,
  onSelect,
  onPickModule,
  onContextMenu,
  onEdgeInsert,
  onCanvasInsert,
  onCamReady,
  row,
  camStore,
  engineWarnings,
  fitKey,
  fitAxis = "both",
  command,
  onBypassModule,
  onSetModuleAsset,
  onAssetBrowse,
  onLibraryBrowse,
  trackInputs,
  onPickTrackInput,
  onWatchWaveform,
  sinkPlay,
  pluginParamsStore,
  setPluginParam,
  moduleParams,
  onModuleParam,
  trackControls,
  onTrackToggle,
  onTrackSet,
  motion = true,
}: {
  /** The glyphs the nodes wear. Required, so no caller can render a graph without them. */
  icons: ChainsIcons;
  graph: LaidOutGraph;
  /**
   * Animate a change of layout: cards slide to their new places, a new one fades up, a removed
   * one fades out. On by default — a graph redrawn after a command is the case it exists for.
   *
   * Turn it OFF where the layout is recomputed as fast as somebody types: st0's chain view
   * re-lays out on every keystroke, so each character would be one node leaving and another
   * arriving, and the picture would never be still long enough to read. See docs/nodeMotion.md.
   *
   * `prefers-reduced-motion` overrules it either way; nothing here is load-bearing, so the
   * reduced answer is simply the old one — everything lands at once.
   */
  motion?: boolean;
  selected: string | null;
  /**
   * The engine level index order, threaded to each track node.
   *
   * The levels themselves never flow through here — and neither does WHICH tracks are audible:
   * this renderer subscribes for that itself, off the host's store, because it moves 20 times a
   * second and only the cable canvas reads it. See docs/liveCables.md.
   */
  trackOrder?: string[];
  onSelect: (c: string | null) => void;
  onPickModule?: (module: string | null) => void;
  onContextMenu?: (ctx: GraphMenuCtx, x: number, y: number) => void;
  onEdgeInsert?: (info: EdgeInsert, x: number, y: number) => void;
  /** Right-click on EMPTY canvas — a pick lands in the graph wired to nothing. */
  onCanvasInsert?: (x: number, y: number) => void;
  /** Hands the camera up, once mounted — see ChainsCamApi. */
  onCamReady?: (cam: ChainsCamApi) => void;
  /**
   * This graph is arranged as a ROW to be read across — l8's mixer view.
   *
   * It changes what the navigation MEANS rather than what it looks like: the wheel walks along
   * the row instead of zooming, and nothing pans vertically, because there is one line of cards
   * and everything above or below it is empty. The cards, the cables and the zoom are untouched.
   */
  row?: boolean;
  // Where the camera lives BETWEEN mounts: the graph unmounts with its pane. See docs/chainsGraph.md.
  camStore?: CamStore;
  /** Engine load problems by PluginDoc id — a node badges itself from this. */
  engineWarnings?: Record<string, string>;
  // Identifies WHICH graph is on screen: a change re-frames, a redraw of the same one leaves the camera alone.
  fitKey?: string | number | null;
  /** How the first frame is chosen. "both" (the default) fits the whole graph; "height" fills the
   *  height and lets the width overflow, which is pannable — what a row of channel strips wants,
   *  since fitting both axes shrinks every strip as the song gains tracks. */
  fitAxis?: "both" | "height";
  command: (line: string) => void | Promise<void>;
  // Bypass a module. Separate from `command` because it must RELOAD — the quiet path never bumps reloadKey.
  onBypassModule?: (module: string) => void;
  // Set a file-valued param on a module: `param` is the key ("nam"), `file` assets-relative or "none".
  onSetModuleAsset?: (module: string, kind: string, file: string) => void;
  /** Open the asset browser for a module's file-valued param, at viewport coords. */
  onAssetBrowse?: (module: string, kind: string, x: number, y: number) => void;
  onLibraryBrowse?: (
    module: string,
    kind: string,
    x: number,
    y: number,
  ) => void;
  /**
   * What each track is fed FROM, by track id — the chip a track node wears.
   *
   * A plain record and not a lookup on the graph, like `engineWarnings` beside it: this is
   * what the HOST knows about a live input and the graph does not. The chip is drawn only
   * where `onPickTrackInput` is also given, so a host that cannot change one never shows one.
   */
  trackInputs?: Record<string, string>;
  /** Choose what feeds a track, at the click's viewport coords — the popup is the host's,
   *  exactly as the asset browser above is. */
  onPickTrackInput?: (trackId: string, x: number, y: number) => void;
  /** Place/remove the engine's waveform tap while a waveform widget is on screen. */
  onWatchWaveform?: (
    pluginId: string,
    side: "input" | "output",
    on: boolean,
  ) => void;
  /** A play button on the sink. Omit it and there is none — see SinkPlay. */
  sinkPlay?: SinkPlay;
  pluginParamsStore?: PluginParamsStore;
  setPluginParam?: (id: string, name: string, value: number) => void;
  /**
   * What a module with NO plugin is currently set to, by module name then param.
   *
   * `offline` modules compile to nothing the engine holds — m9's tempo is one — so there is
   * no plugin to ask and no id to ask it by. Their value lives on whichever surface realises
   * them (for the tempo, the desk that warps the clip), and this is how that surface lends it
   * to the graph. Without it such a widget draws the number the FILE declares and never
   * changes, which reads as a knob stuck on its default.
   *
   * Passing it — or `onModuleParam` — is what turns those widgets on at all: a host that
   * offers neither keeps them inert rather than showing a control that turns against nothing.
   */
  moduleParams?: Record<string, Record<string, number>>;
  /** …and the way back, for the same modules. Called per frame during a drag. */
  onModuleParam?: (module: string, name: string, value: number) => void;
  trackControls?: Record<string, TrackControlValues>;
  onTrackToggle?: (trackId: string, control: "mute" | "solo" | "arm") => void;
  onTrackSet?: (
    trackId: string,
    control: "volume" | "pan",
    value: number,
  ) => void;
}) {
  useCss();
  // NOT subscribed here: each widget taps its own plugin, so one frame moves one control rather
  // than re-rendering every node. See @studio/engine-browser's docs/params.md.
  const params = pluginParamsStore ?? EMPTY_PARAMS_STORE;
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  // The camera lives OUTSIDE React, and that is the point: nothing in the render reads x or y,
  // so a pan that went through state re-rendered every node on every pointer event for a
  // translation the compositor could have done alone. `cam` is what is on screen, `goal` where
  // a gesture is taking it — the same thing while panning, apart only while a zoom glides.
  const cam = useRef<Cam>({ ...(camStore?.current ?? { x: 0, y: 0, k: 1 }) });
  const goal = useRef<Cam>({ ...cam.current });
  // The point a zoom holds still: where the wheel was, in host coordinates.
  const anchor = useRef({ px: 0, py: 0 });
  const kick = useRef<() => void>(() => {});
  // Through a ref: the wheel and the pan are bound once, and would otherwise read `row` as it
  // was on their first render — the mixer view would never reach them.
  const rowRef = useRef(row);
  rowRef.current = row;
  // Redraws the cable canvas. Declared here rather than beside its body further down because
  // everything that moves the camera has to call it: the canvas sits OUTSIDE `.dgx-world`, so
  // the CSS transform that pans the nodes moves nothing on it — see docs/camera.md.
  const paintRef = useRef<() => void>(() => {});
  // Has the graph been framed? A saved camera means the user already has a view, so it starts true.
  const fitted = useRef(camStore?.current != null);
  // Has the USER taken the camera? Separate from `fitted` — see docs/chainsGraph.md.
  const userMoved = useRef(camStore?.current != null);
  const camStoreRef = useRef(camStore);
  camStoreRef.current = camStore;
  // What the drawing takes from the camera, and all it takes (see camera.ts). Committed only
  // when one of the three actually differs, which above WIDGET_MIN_SCALE is never.
  const [lod, setLod] = useState<Lod>(() => lodFor(cam.current.k));
  const lodRef = useRef(lod);
  // Persist ONLY after a real fit: the identity camera is indistinguishable from one the user chose.
  const persist = () => {
    const store = camStoreRef.current;
    if (store && fitted.current) store.current = { ...cam.current };
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  // Put the camera somewhere outright — a fit or a chain selection, not a gesture: there is
  // nothing to chase, so it lands whole in one frame.
  const place = (c: Cam) => {
    Object.assign(cam.current, c);
    Object.assign(goal.current, c);
    applyCam(worldRef.current, cam.current);
    paintRef.current();
    const next = lodFor(cam.current.k);
    if (!sameLod(next, lodRef.current)) {
      lodRef.current = next;
      setLod(next);
    }
    persist();
  };
  // A camera restored from the store is never placed by a fit, so it needs this one write.
  useLayoutEffect(() => {
    applyCam(worldRef.current, cam.current);
    paintRef.current();
  }, []);
  const [panning, setPanning] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  // Optimistic values the hand set, outranking the incoming frame until it catches up.
  const [override, setOverride] = useState<Record<string, number>>({});

  // Latest callbacks in refs, so the once-bound window listeners read current values without re-subscribing.
  const cb = useRef({
    onSelect,
    onPickModule,
    onContextMenu,
    onEdgeInsert,
    onCanvasInsert,
    command,
    onBypassModule,
    onSetModuleAsset,
    onAssetBrowse,
    onLibraryBrowse,
    onPickTrackInput,
    setPluginParam,
    onModuleParam,
    onTrackToggle,
    onTrackSet,
  });
  cb.current = {
    onSelect,
    onPickModule,
    onContextMenu,
    onEdgeInsert,
    onCanvasInsert,
    command,
    onBypassModule,
    onSetModuleAsset,
    onAssetBrowse,
    onLibraryBrowse,
    onPickTrackInput,
    setPluginParam,
    onModuleParam,
    onTrackToggle,
    onTrackSet,
  };

  // --- the compiled geometry: signal cables (with insert eligibility) + automations ---
  const model = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const signal: EdgeGeom[] = [];
    const auto: AutoTarget[] = [];
    for (const e of graph.edges) {
      if (e.automation) {
        const a = autoTarget(e, byId);
        if (a) auto.push(a);
        continue;
      }
      if (e.points.length < 2) continue;
      signal.push({
        id: e.id,
        // Plugged into the SOCKETS rather than aimed at the borders dagre routed to — see cablePath.
        ...buildCableGeom(
          cablePath(e, byId.get(e.source), byId.get(e.target)),
          WOBBLE_STEP,
          WOBBLE_MAX_SAMPLES,
        ),
        source: e.source,
        target: e.target,
        label: e.label,
        signal: e.signal,
        insert: insertFor(e.source, e.target, byId),
      });
    }
    return { byId, signal, auto };
  }, [graph]);

  // --- node motion: the cards slide, arrive and leave rather than jumping -----------
  //
  // Beside the geometry it is about, though the cable refs it writes to are declared just
  // below: these are closures the frame loop calls, so nothing here runs during this render.
  //
  // FLIP. React draws every node at its FINAL place — `left`/`top`, exactly as before — and the
  // frame loop writes the offset it still has to cover as a `transform`. So the two never
  // disagree about where anything is, a layout arriving mid-flight simply continues from the
  // screen, and a graph at rest carries no inline style at all.
  //
  // `filter:opacity()` rather than `opacity`, because React owns that one: a dimmed node
  // declares `opacity` inline, and an unrelated re-render mid-fade would take the fade back.
  // The two multiply, which is the right answer for a dimmed node on its way out.
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  ).current;
  const animate = motion && !reducedMotion;
  const motions = useRef<Map<string, Motion>>(new Map());
  // Where each node is DRAWN right now, ghosts included — what the next layout measures from.
  const drawn = useRef<Map<string, Ghost<GraphNode>>>(new Map());
  const [ghosts, setGhosts] = useState<Ghost<GraphNode>[]>(EMPTY_GHOSTS);
  const ghostCount = useRef(0);
  ghostCount.current = ghosts.length;
  // React has just replaced the nodes, so the element map is stale: re-read it once, next frame.
  const rebind = useRef(true);
  const nodeEls = useRef<Map<string, HTMLElement>>(new Map());
  // Which ids currently carry an inline transform, so each is cleared exactly once.
  const styled = useRef<Set<string>>(new Set());
  const cablesSvg = useRef<SVGSVGElement>(null);
  const layoutNodes = useRef(graph.nodes);
  layoutNodes.current = graph.nodes;

  // The positions a settled graph is measured from: the layout, and nothing else.
  const settledDrawn = (): Map<string, Ghost<GraphNode>> =>
    new Map(
      layoutNodes.current.map((n) => [n.id, { node: n, x: n.x, y: n.y }]),
    );

  /** One frame of movement: advance, write, and rebuild the cables from where the cards ARE. */
  const motionStep = useRef<(dt: number) => boolean>(() => false);
  motionStep.current = (dt: number) => {
    const ms = motions.current;
    if (rebind.current) {
      rebind.current = false;
      const world = worldRef.current;
      nodeEls.current = new Map();
      if (world)
        for (const el of world.querySelectorAll<HTMLElement>("[data-node-id]"))
          nodeEls.current.set(String(el.dataset.nodeId), el);
    }
    const still = advanceMotion(ms, dt);
    for (const [id, m] of ms) {
      const el = nodeEls.current.get(id);
      if (!el) continue;
      el.style.transform = motionTransform(m);
      el.style.filter = m.a >= 1 ? "" : `opacity(${m.a})`;
      // A card on its way out is already gone as far as the graph is concerned.
      el.style.pointerEvents = m.at === 0 ? "none" : "";
      styled.current.add(id);
    }
    for (const id of styled.current) {
      if (ms.has(id)) continue;
      clearMotionStyle(nodeEls.current.get(id));
      styled.current.delete(id);
    }
    // The cables follow for free: this loop repaints the canvas every frame anyway, so all it
    // takes is geometry built from where the cards ARE. `rebuildCables` is what decides — it
    // asks `motionCables` while anything is in flight — so the liveness path agrees with this
    // one instead of putting the final geometry back under moving nodes.
    rebuildCables.current();
    return still;
  };

  /**
   * The cable draws for one frame of a move, from the interpolated positions.
   *
   * `cablePath` is two socket points — no waypoints, no resampling — so rebuilding all of them
   * per frame costs nothing worth naming. They are drawn STILL: the ripple is a 1.2 Hz ornament
   * and 200 ms without it is invisible, where resampling every cable to carry it would not be.
   */
  const motionCables = useRef<() => CableDraw[]>(() => []);
  motionCables.current = () => {
    const ms = motions.current;
    const byId = new Map<string, GraphNode>();
    for (const n of layoutNodes.current) {
      const p = motionPos(n, ms);
      byId.set(n.id, p.x === n.x && p.y === n.y ? n : { ...n, x: p.x, y: p.y });
    }
    const draws: CableDraw[] = [];
    for (const e of graph.edges) {
      if (e.automation || e.points.length < 2) continue;
      const base = cablePath(e, byId.get(e.source), byId.get(e.target));
      if (base.length < 2) continue;
      draws.push({
        geom: { base, samples: NO_SAMPLES, len: 0 },
        color: cableColorFor(e.signal),
        live: false,
      });
    }
    return draws;
  };

  /** Everything lands: styles off, ghosts unmounted, the real cable geometry back. */
  const settleMotion = useRef<() => void>(NOOP);
  settleMotion.current = () => {
    motions.current.clear();
    for (const id of styled.current) clearMotionStyle(nodeEls.current.get(id));
    styled.current.clear();
    drawn.current = settledDrawn();
    cablesSvg.current?.classList.remove("moving");
    if (ghostCount.current) setGhosts(EMPTY_GHOSTS);
    // Back to the baked geometry — resampled, and rippling again wherever signal runs.
    applyLive.current();
  };

  /**
   * A new layout: what moved, what arrived, what left — and the first frame of it, now.
   *
   * A LAYOUT effect, and the first write happens in it rather than being left to the loop: React
   * has already put every node at its destination, so a frame painted before the offsets are on
   * would show the whole graph jump there and then slide back out. That is the FLIP pitfall, and
   * a layout effect is exactly the hook that runs before the browser paints.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs above were reassigned with this render's layout, so `graph` IS the trigger and the body reads nothing else.
  useLayoutEffect(() => {
    if (!animate) {
      // Turned off mid-flight — nothing else would ever take the inline styles back off.
      if (motions.current.size || styled.current.size) settleMotion.current();
      drawn.current = settledDrawn();
      return;
    }
    // The FIRST layout is not a change. A graph that faded up every time its pane mounted would
    // be an animation about nothing — and on mount the frame loop is not bound yet, so a motion
    // started here would never be advanced and the whole graph would sit at zero opacity.
    // The cap is a screen and a half, in WORLD px — what the eye can follow is a fact about the
    // view, not about the layout, so it is measured through the camera's zoom.
    const host = hostRef.current;
    const travel = host
      ? (Math.hypot(host.clientWidth, host.clientHeight) * 1.5) /
        Math.max(cam.current.k, 0.01)
      : Number.POSITIVE_INFINITY;
    const plan = drawn.current.size
      ? planMotion(drawn.current, motions.current, graph.nodes, travel)
      : null;
    drawn.current = settledDrawn();
    if (!plan?.moving) {
      // Nothing to do — but something may still be in flight from the layout before this one,
      // and nothing else would ever take its inline styles back off.
      if (motions.current.size || styled.current.size) settleMotion.current();
      return;
    }
    for (const g of plan.ghosts) drawn.current.set(g.node.id, g);
    motions.current = plan.motions;
    rebind.current = true;
    setGhosts((cur) => (sameGhosts(cur, plan.ghosts) ? cur : plan.ghosts));
    // The stale half of the drawing steps aside for the move — see the `.dgx-cables` rule.
    cablesSvg.current?.classList.add("moving");
    // dt 0: place the offsets, advance nothing.
    motionStep.current(0);
    // …and look again next frame. The ghosts are not in the DOM yet — the state update above
    // lands after this effect — so this write missed them, and without a second bind they would
    // never be found at all. One frame drawn where they already were is the right picture anyway.
    rebind.current = true;
    kick.current();
  }, [graph, animate]);

  // --- what carries signal: refs, not state ----------------------------------------
  // Liveness comes from the engine's meters and is read by the cable CANVAS and nothing else —
  // no node, no widget, no SVG layer. So it never enters the render: a track crossing the
  // silence floor repaints the canvas and re-renders zero components. It used to be a prop fed
  // by a hook, and on percussive material that was the whole graph several times a second.
  // See docs/liveCables.md.
  // Read here as well as at the bottom, where it decides which store the METERS get: liveness
  // has to subscribe from the host's own, and an inert one simply never notifies.
  const hostStore = useEngineStoreOrNull();
  const liveRef = useRef<Set<string>>(EMPTY_LIVE);
  const activeRef = useRef<string[]>(EMPTY_ORDER);
  const cableDrawsRef = useRef<CableDraw[]>([]);
  const rebuildCables = useRef<() => void>(NOOP);
  const applyLive = useRef<() => void>(NOOP);
  // Set by the ripple effect below; poked whenever liveness changes, to start a stopped loop.
  const rippleRef = useRef<() => void>(NOOP);

  // --- the cable canvas ------------------------------------------------------------
  // Thicker cables as the camera pulls back, so their width on screen holds. Taken from the LOD
  // rather than recomputed from the camera: `lodFor` QUANTISES it, which is what keeps a zoom
  // from re-rendering the SVG layer every pixel — and both layers must read the same number, or
  // the cables change width whenever one redraws and the other does not.
  const linkBoost = lod.boost;

  // Both reassigned every render, like `paint` and `fit`, so they always see the CURRENT edges
  // without the subscription that calls them having the graph as a dependency.
  // Colour by what a cable CARRIES, live or not — tinting live cables orange made everything look like audio.
  rebuildCables.current = () => {
    // Mid-move the laid-out geometry is a lie: the cards are somewhere between two layouts and
    // the cables have to leave from where they actually are. See docs/nodeMotion.md.
    if (motions.current.size) {
      cableDrawsRef.current = motionCables.current();
      return;
    }
    const live = liveRef.current;
    cableDrawsRef.current = model.signal.map((g) => ({
      geom: g,
      color: cableColorFor(g.signal),
      live: live.has(g.id),
    }));
  };
  // The liveness set is keyed by EDGE, so it is recomputed from the track ids against the
  // current edges — which is why a graph change goes through here too, not just a meter frame.
  applyLive.current = () => {
    liveRef.current = computeLive(model.signal, activeRef.current);
    rebuildCables.current();
    paintRef.current();
    rippleRef.current();
  };

  const cvRef = useRef<HTMLCanvasElement>(null);
  const scratch = useRef(newScratch()).current;
  const phase = useRef(0);
  // The host's size, from the ResizeObserver below rather than read off the DOM: a layout read
  // inside the draw would flush style on every frame, which is the kind of cost this change exists to remove.
  const hostSize = useRef({ w: 0, h: 0 });
  // Reassigned every render, like `fit` below, so the rAF and the observer always draw the
  // CURRENT camera and cables without either of them being a dependency. Declared up with the
  // camera refs, because the two places that MOVE the camera outside the loop repaint through it.
  paintRef.current = () => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(hostSize.current.w * dpr);
    const height = Math.round(hostSize.current.h * dpr);
    if (!width || !height) return;
    // Resizing the backing store also clears it, so only do it when it actually changed —
    // and doing it here is what keeps the canvas sharp when the window moves to another screen.
    if (cv.width !== width || cv.height !== height) {
      cv.width = width;
      cv.height = height;
    }
    drawCables(
      ctx,
      {
        width,
        height,
        // `cam.current`, not `cam`: the camera is a REF now, mutated in place by the frame loop.
        cam: cam.current,
        dpr,
        cables: cableDrawsRef.current,
        phase: phase.current,
        boost: linkBoost,
      },
      scratch,
    );
  };

  // A graph or LOD change redraws AT ONCE, in a layout effect, so the canvas and the nodes land
  // in the same frame. The CAMERA is not in here any more and must not be: it left React with
  // the pan and the zoom, so it never re-renders — the loop repaints instead, right after it
  // writes the transform, which is what keeps the cables on their sockets through a gesture.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the frame's inputs, not values this body reads — the refs above were reassigned with them during the render, so listing them here IS the redraw trigger.
  useLayoutEffect(() => {
    applyLive.current();
  }, [model.signal, linkBoost]);

  // The ripple, on its own clock. It is an ornament at WOBBLE_HZ, so it is capped well below
  // the screen's rate, and it stops dead when nothing carries signal — a still graph then
  // leaves its last frame on the canvas and costs nothing at all. Mounted ONCE and steered by
  // `liveRef`, because liveness no longer re-renders anything for an effect to depend on.
  useEffect(() => {
    let raf = 0;
    let lastAt = 0;
    const step = 1000 / WOBBLE_FPS;
    const tick = (now: number) => {
      if (liveRef.current.size === 0) {
        raf = 0; // nothing carries signal any more: stop, and let `sync` restart us
        return;
      }
      raf = requestAnimationFrame(tick);
      if (now - lastAt < step) return;
      // By REAL elapsed time, not by a fixed increment, so capping the rate slows nothing down.
      phase.current += Math.PI * 2 * WOBBLE_HZ * ((now - lastAt) / 1000);
      lastAt = now;
      paintRef.current();
    };
    const sync = () => {
      if (raf || liveRef.current.size === 0) return;
      lastAt = performance.now();
      raf = requestAnimationFrame(tick);
    };
    rippleRef.current = sync;
    sync();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      rippleRef.current = NOOP;
    };
  }, []);

  // The meters, straight off the store into `activeRef` — the one subscription in this file that
  // is not a leaf's, and the reason a crossing costs a repaint instead of a render.
  useEffect(() => {
    if (!hostStore) return;
    const order = trackOrder ?? EMPTY_ORDER;
    const read = (): void => {
      const ids = activeTrackIds(hostStore.getSnapshot(), order);
      if (arrayEq(ids, activeRef.current)) return;
      activeRef.current = ids;
      applyLive.current();
    };
    read();
    return hostStore.subscribe(read);
  }, [hostStore, trackOrder]);

  // --- fit: frame the whole graph to the host, on graph change and on resize ---------
  // Returns whether it actually framed: with no host size or extents there is nothing to fit, so the caller retries.
  const fit = useRef<() => boolean>(() => false);
  fit.current = () => {
    const host = hostRef.current;
    // isFinite, not truthy: an empty dagre layout reported -Infinity and still marked the view framed over nothing.
    if (
      !host ||
      !Number.isFinite(graph.width) ||
      !Number.isFinite(graph.height)
    )
      return false;
    if (!graph.width || !graph.height) return false;
    const sw = host.clientWidth;
    const sh = host.clientHeight;
    if (!sw || !sh) return false;
    const pad = 0.9;
    // "height" frames the HEIGHT and lets the width run off the side, which is pannable. A row of
    // channel strips wants that: fitting both axes means the strips get smaller with every track
    // the song gains, and a mixer you cannot read is worse than one you have to scroll.
    const k = clampZoom(
      fitAxis === "height"
        ? (sh / graph.height) * pad
        : Math.min((sw / graph.width) * pad, (sh / graph.height) * pad),
    );
    // Framed, so from here the camera is worth remembering — `place` persists it.
    fitted.current = true;
    place({
      k,
      // Height-fitted content usually overflows; pin it to the left edge rather than centring it
      // off screen, so the first strip is the one you see.
      x:
        fitAxis === "height" && graph.width * k > sw
          ? 0
          : (sw - graph.width * k) / 2,
      y: (sh - graph.height * k) / 2,
    });
    return true;
  };
  // Frame once, and again only when `fitKey` says this is a different graph. See docs/chainsGraph.md.
  const lastFitKey = useRef(fitKey);
  useLayoutEffect(() => {
    if (fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey;
      fitted.current = false;
    }
    if (!fitted.current) fitted.current = fit.current();
  }, [graph, fitKey]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Only until the first successful fit: the host starts at zero size, but later resizes must not re-frame.
    const ro = new ResizeObserver(([entry]) => {
      // The cable canvas is sized from here, and redrawn — it is not in the flow, so nothing
      // else would tell it the host got bigger.
      const box = entry?.contentRect;
      if (box) hostSize.current = { w: box.width, h: box.height };
      paintRef.current();
      // Keep re-framing while the camera is still ours — the host settles for a while after the first fit.
      if (userMoved.current) return;
      if (fit.current()) fitted.current = true;
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // --- fitTo: frame a subset of nodes (chain selection from the sidebar) ---------
  const fitTo = useRef<FitToFn>(() => false);
  fitTo.current = (nodes: GraphNode[], opts: FitToOpts = {}) => {
    const { panOnly, axis = "both", zoom = 1 } = opts;
    const host = hostRef.current;
    if (!host || !nodes.length) return false;
    const sw = host.clientWidth;
    const sh = host.clientHeight;
    if (!sw || !sh) return false;
    // Framing a chain the user picked is their choice too: a later resize must not throw it away.
    // AFTER the size checks, so a frame that did not happen does not claim the camera either.
    userMoved.current = true;
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    const bw = maxX - minX;
    const bh = maxY - minY;
    const pad = 0.9;
    const k = clampZoom(
      (axis === "height"
        ? (sh / bh) * pad
        : Math.min((sw / bw) * pad, (sh / bh) * pad)) * zoom,
    );
    if (panOnly) {
      // Keep the zoom from the chain fit; only adjust translation to center the target.
      const cur = cam.current;
      place({
        k: cur.k,
        x: sw / 2 - (panOnly.x + panOnly.w / 2) * cur.k,
        y: sh / 2 - (panOnly.y + panOnly.h / 2) * cur.k,
      });
    } else {
      // Centred, EXCEPT a row that does not fit across: centring a rank of strips wider than the
      // pane puts its middle on screen and hides the first channel, which is the one you look for
      // to know where you are. Left-aligned then, with the same margin the pad allows, and the
      // tail runs off the right where it pans.
      const spills = axis === "height" && bw * k > sw;
      const originX = frameOriginX(sw, bw * k, pad, spills);
      place({
        k,
        x: originX - minX * k,
        y: (sh - bh * k) / 2 - minY * k,
      });
    }
    return true;
  };
  useEffect(() => {
    // One options object forwarded whole. It was three positionals, and the axis got dropped in
    // this very line — a caller silently getting fit-both, which is the bug the parameter exists
    // to prevent. An object cannot be half-forwarded by accident.
    onCamReady?.({
      fitTo: (nodes, opts) => fitTo.current(nodes, opts),
      get: () => ({ ...cam.current }),
      // Placed outright, no glide: putting a camera BACK is not a gesture to animate — the view
      // you left should be the view you return to, at once.
      set: (c) => {
        userMoved.current = true;
        place(c);
      },
    });
  }, [onCamReady]);

  // --- reconcile optimistic overrides as fresh engine/track frames arrive ------------
  const drag = useRef<{
    node: GraphNode;
    w: WebWidget;
    tgt: WidgetTarget;
    key: string;
    startT: number;
    startY: number;
    travel: number; // screen px that sweep the whole range for THIS control
    value: number;
    sent: boolean;
  } | null>(null);
  const overrideRef = useRef(override);
  overrideRef.current = override;
  useEffect(() => {
    // A plugin frame landed: drop the overrides it now speaks for, keeping the one under the hand.
    // Subscribed rather than depended on, so a frame reconciling nothing costs one key scan and
    // no render — which is the whole point of not holding the param map up here.
    return params.subscribe(() => {
      if (!hasChannel(overrideRef.current, "p:")) return;
      setOverride((o) => dropChannel(o, "p:", drag.current?.key));
    });
  }, [params]);
  useEffect(() => {
    setOverride((o) => dropChannel(o, "o:", drag.current?.key));
  }, [moduleParams]);
  useEffect(() => {
    setOverride((o) => dropChannel(o, "t:", drag.current?.key));
  }, [trackControls]);

  // Either prop turns the channel on: a host may only be able to SHOW such a value (m9's
  // graph, while the desk that realises it is unmounted) or only to take one.
  const offlineChannel =
    moduleParams !== undefined || onModuleParam !== undefined;
  const pluginWritable = setPluginParam !== undefined;
  // Either one: a track node's widgets are the toggles AND the two continuous controls, and a
  // host that wired one half meant it.
  const trackWritable = onTrackSet !== undefined || onTrackToggle !== undefined;
  const offlineWritable = onModuleParam !== undefined;
  // Memoised on VALUES, never on the host's callbacks: a host that passes an inline lambda
  // (App.tsx does, to GraphPanel) would otherwise hand every node a new `ch` on every render.
  const ch = useMemo<Channels>(
    () => ({
      params,
      trackControls: trackControls ?? {},
      override,
      trackOrder: trackOrder ?? EMPTY_ORDER,
      moduleParams: moduleParams ?? {},
      offlineChannel,
      pluginWritable,
      trackWritable,
      offlineWritable,
    }),
    [
      params,
      trackControls,
      override,
      trackOrder,
      moduleParams,
      offlineChannel,
      pluginWritable,
      trackWritable,
      offlineWritable,
    ],
  );

  // The same trick the window listeners use below, extended to the node handlers: read the current
  // value through a ref so every handler can be bound once and a memoised Node never sees a new prop.
  // Assigned on every render, never in an effect — an effect would serve one render's stale value.
  const chRef = useRef(ch);
  chRef.current = ch;
  const selRef = useRef(selected);
  selRef.current = selected;

  // --- widget drag (knob/slider/number): live sends coalesced, commit on release ------
  const beginDrag = useCallback(
    (n: GraphNode, w: WebWidget, e: React.PointerEvent) => {
      const ch = chRef.current;
      e.stopPropagation(); // don't select the node or start a pan
      // A frozen MODULE's plugin does not exist in the engine — the render replaced it — so a knob here would
      // move, send a param set into the void, and be discarded on the next reload. A frozen TRACK is different:
      // its node's widgets are the mixer strip, and gain/pan/mute are exactly what stays live.
      if (n.frozen && n.kind === "module") return;
      const tgt = widgetTarget(n, w, ch.offlineChannel);
      if (!tgt) return;
      const v = widgetValue(n, w, ch);
      drag.current = {
        node: n,
        w,
        tgt,
        key: targetKey(tgt),
        startT: v === undefined ? 0 : widgetNorm(w, v),
        startY: e.clientY,
        // A fader sweeps over its OWN throw, so the cap tracks the pointer instead of running away from it — the one
        // control here whose travel is drawn on screen, and the one where a fixed 150 px would be visibly wrong.
        // Measured off the rail rather than derived from the box: the readout, the caption and the borders all eat
        // into it, and clientHeight is exactly the span the cap's centre line moves over. Arithmetic would drift the
        // moment any of that changed, and the drift is the bug — a cap that does not stay under the finger.
        travel:
          w.type === "fader"
            ? Math.max(
                40,
                (e.currentTarget as HTMLElement).querySelector(".rail")
                  ?.clientHeight ?? DRAG_TRAVEL_PX,
              )
            : DRAG_TRAVEL_PX,
        value: v ?? widgetDenorm(w, 0),
        sent: false,
      };
    },
    [],
  );

  // Global pointer handling — pan, widget drag, gesture settle. Bound once; a movement threshold gates selection.
  const pan = useRef<{
    sx: number;
    sy: number;
    cx: number;
    cy: number;
    moved: number;
  } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (d) {
        const dy = (d.startY - e.clientY) / d.travel;
        const t = d.startT + dy * (e.shiftKey ? DRAG_FINE : 1);
        const value = widgetDenorm(d.w, t);
        if (value === d.value) return;
        d.value = value;
        setOverride((o) => ({ ...o, [d.key]: value }));
        // Coalesce to one live send per frame; only a plugin param feeds live (a track knob persists on release).
        if (!d.sent && (d.tgt.kind === "plugin" || d.tgt.kind === "offline")) {
          d.sent = true;
          requestAnimationFrame(() => {
            const cur = drag.current;
            if (!cur) return;
            cur.sent = false;
            if (cur.tgt.kind === "plugin")
              cb.current.setPluginParam?.(
                cur.tgt.pluginId,
                cur.tgt.name,
                cur.value,
              );
            // An offline module has no socket to send down: the surface that REALISES it —
            // for m9's tempo, the clip warp — is what this reaches, and it decides the cost.
            else if (cur.tgt.kind === "offline")
              cb.current.onModuleParam?.(
                cur.tgt.module,
                cur.tgt.name,
                cur.value,
              );
          });
        }
        return;
      }
      const p = pan.current;
      if (!p) return;
      const nx = e.clientX - p.sx;
      const ny = e.clientY - p.sy;
      p.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (p.moved > DRAG_SLOP) {
        setPanning(true);
        setHovered(null);
        userMoved.current = true; // the camera is theirs now — stop auto-framing
        // Both, and no glide: a drag under a finger has nothing to catch up to. Both, unless the
        // graph is a row — then there is nowhere to go vertically and a drag that slid the line
        // off the top would be a gesture with only one useful direction out of two.
        cam.current.x = goal.current.x = p.cx + nx;
        if (!rowRef.current) cam.current.y = goal.current.y = p.cy + ny;
        kick.current();
      }
    };
    const up = () => {
      const d = drag.current;
      if (d) {
        drag.current = null;
        if (d.tgt.kind === "track") {
          if (d.tgt.control === "volume" || d.tgt.control === "pan")
            cb.current.onTrackSet?.(d.tgt.trackId, d.tgt.control, d.value);
          // A module FIELD is a named setting, not a range — nothing here can be dragged
          // to a new one, so a drag that reached one commits nothing rather than guessing.
        } else if (d.tgt.kind === "plugin" && d.node.module) {
          cb.current.command(
            `module param ${d.node.module} ${JSON.stringify(d.tgt.name)} ${d.value}`,
          );
        }
        // The override stays until the matching frame arrives (see the reconcile effects).
      }
      if (pan.current) {
        suppressClick.current = pan.current.moved > DRAG_SLOP;
        pan.current = null;
        setPanning(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // A widget's own pointerdown stops here, so this fires for the canvas or a node body: a press that moves pans.
    // Grabbing the canvas also ends any zoom still in flight — it stops where it got to, rather
    // than sliding on under a hand that is now steering.
    goal.current.k = cam.current.k;
    pan.current = {
      sx: e.clientX,
      sy: e.clientY,
      cx: cam.current.x,
      cy: cam.current.y,
      moved: 0,
    };
  };

  /**
   * The camera loop, the wheel and the two-finger pinch, bound once — see docs/camera.md.
   *
   * Everything here writes the transform onto the element and reads only refs, so a pan or a
   * zoom costs no React work at all until the LOD changes. The loop runs while a gesture is
   * live and stops when the camera settles: an idle graph schedules no frames.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let last = 0;
    const step = (t: number) => {
      // Clamped: a backgrounded tab hands back one enormous dt, which would land the glide in
      // a single jump — the one frame where smoothing is most visible for being absent.
      const dt = last ? Math.min(100, t - last) : 16;
      last = t;
      const c = cam.current;
      const g = goal.current;
      let moving = pan.current != null;
      // The cards, before the camera: `motionStep` rebuilds the cable draws from where they are
      // this frame, and the repaint below is the one that puts them on screen.
      if (motions.current.size) {
        const still = motionStep.current(dt);
        moving = moving || still;
        if (!still) settleMotion.current();
      }
      if (c.k !== g.k) {
        // Within a thousandth of the goal, land on it — an exponential never quite arrives.
        const near = Math.abs(g.k - c.k) <= c.k * 1e-3;
        const k = near ? g.k : c.k + (g.k - c.k) * approach(dt);
        Object.assign(c, zoomAbout(c, k, anchor.current.px, anchor.current.py));
        Object.assign(g, { x: c.x, y: c.y });
        moving = moving || !near;
      }
      applyCam(worldRef.current, c);
      paintRef.current(); // the canvas is outside `.dgx-world`, so the transform misses it
      const next = lodFor(c.k);
      if (!sameLod(next, lodRef.current)) {
        lodRef.current = next;
        setLod(next);
      }
      if (moving) raf = requestAnimationFrame(step);
      else {
        raf = 0;
        last = 0;
        persistRef.current(); // settled — this is the camera worth remembering
      }
    };
    kick.current = () => {
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(step);
      }
    };
    // Non-passive, both to stop the page scrolling under it and because this IS the handler:
    // a React onWheel would allocate a synthetic event per notch, and a trackpad sends many.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true; // either way, the camera is theirs now — stop auto-framing
      if (rowRef.current) {
        // A ROW is read across, so the wheel walks along it and nothing moves vertically —
        // there is only one line of cards, and a view that drifts off it is a view of nothing.
        // Whatever the device says: a mouse has no deltaX to offer, so its notch drives x here.
        const c = cam.current;
        const g = goal.current;
        g.k = c.k;
        c.x = g.x =
          g.x -
          wheelPixels(e.deltaX || e.deltaY, e.deltaMode, host.clientWidth);
      } else if (isZoomWheel(e) || isMouseWheel(e)) {
        const r = host.getBoundingClientRect();
        anchor.current = { px: e.clientX - r.left, py: e.clientY - r.top };
        // Multiplied onto the GOAL, not onto what is on screen: pinching faster then stacks up
        // instead of each step being swallowed by the one still gliding.
        // `e.ctrlKey` marks a trackpad PINCH, whose stream of small deltas needs a rate of its
        // own — a notch's would make it crawl. Cmd+wheel is a mouse and keeps the notch's.
        goal.current.k = clampZoom(
          goal.current.k *
            wheelFactor(e.deltaY, e.deltaMode, host.clientHeight, e.ctrlKey),
        );
      } else {
        // Two fingers on a SURFACE. The camera moves WITH them, 1:1 and with no glide — the same
        // rule a drag follows, because both are a hand pushing the world about and easing that is
        // lag. The deltas are screen pixels and so is the translation, which is why no zoom is in
        // this. A mouse never lands here: `isMouseWheel` sent its notch to the zoom above.
        const c = cam.current;
        const g = goal.current;
        g.k = c.k; // a slide takes over from any zoom still in flight, as a pointer-down does
        c.x = g.x = g.x - wheelPixels(e.deltaX, e.deltaMode, host.clientWidth);
        c.y = g.y = g.y - wheelPixels(e.deltaY, e.deltaMode, host.clientHeight);
      }
      kick.current();
    };
    host.addEventListener("wheel", wheel, { passive: false });

    /**
     * Two fingers, where there is no wheel at all.
     *
     * Touch events rather than the pointer flow above: that flow drives node drags, widget drags
     * and cable draws, and a second finger arriving mid-gesture would be read as a second drag.
     * Here the rule is simply "two fingers means zoom" — the pan in progress is dropped.
     *
     * Measured from the camera the gesture STARTED on rather than frame to frame, because a
     * ratio of ratios accumulates rounding: pinch out and back in, and you would not land where
     * you began. Written straight onto `cam` with no glide — the fingers are the animation.
     */
    let pinch: { dist: number; k: number; x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pan.current = null; // a pinch is not a pan, whatever the first finger had started
      setPanning(false);
      pinch = { dist: spreadOf(e.touches[0], e.touches[1]), ...cam.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = spreadOf(e.touches[0], e.touches[1]);
      if (d <= 0) return;
      const r = host.getBoundingClientRect();
      const px = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const py = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      userMoved.current = true;
      const k = clampZoom(pinch.k * pinchFactor(pinch.dist, d));
      // From the gesture's OWN starting camera, not from what is on screen — `zoomAbout` reads
      // the camera it is given, so handing it `pinch` is what makes the whole gesture absolute.
      Object.assign(cam.current, zoomAbout(pinch, k, px, py));
      Object.assign(goal.current, cam.current);
      kick.current();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    host.addEventListener("touchstart", onTouchStart, { passive: false });
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", onTouchEnd);

    return () => {
      host.removeEventListener("wheel", wheel);
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", onTouchEnd);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // --- node + widget actions ---------------------------------------------------------
  const tapNode = useCallback((n: GraphNode) => {
    if (suppressClick.current) return; // that click ended a pan
    const selected = selRef.current;
    cb.current.onPickModule?.(n.kind === "module" ? (n.module ?? null) : null);
    if (n.kind === "module" && n.module) {
      cb.current.onSelect(selected === n.module ? null : n.module);
    } else if (n.chain) {
      cb.current.onSelect(selected === n.chain ? null : n.chain);
    }
  }, []);
  const contextNode = useCallback((n: GraphNode, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ctx = nodeToCtx(n);
    if (ctx) cb.current.onContextMenu?.(ctx, e.clientX, e.clientY);
  }, []);
  /**
   * Right-click on a CONTROL: the menu for the param it drives.
   *
   * Only a module's own PLUGIN param. Two things are excluded, and both because the answer would
   * be a promise nothing can keep:
   *
   * - a widget on a track node (`@volume`) drives a mixer control, and the MIDI map is a file in a
   *   MODULE's folder — there is nowhere to record it;
   * - an `@` bind is a module FIELD (`monitor`), a word rather than a number, so a control change
   *   has nothing to sweep.
   *
   * Both fall through to the node's own menu, which is what they had before.
   */
  const contextParam = useCallback(
    (n: GraphNode, w: WebWidget, x: number, y: number): void => {
      if (!n.module || !w.bind || w.bind.startsWith("@") || !n.pluginId) return;
      cb.current.onContextMenu?.(
        {
          kind: "param",
          id: n.module,
          param: w.bind,
          label: w.label || w.bind,
          cc: n.cc?.[w.bind],
        },
        x,
        y,
      );
    },
    [],
  );
  const openPlugin = useCallback(
    (module: string) => void cb.current.command(`module open ${module}`),
    [],
  );
  // Bare `module bypass` toggles, and NOT the quiet path: bypass changes the graph's shape, so it must reload.
  const bypassModule = useCallback(
    (module: string) => cb.current.onBypassModule?.(module),
    [],
  );
  // The widget only ASKS: the browser popup is a viewport-positioned overlay, so it is the
  // shell's to render, exactly as the `+` on an arrow works. What comes back is written by
  // the shell too — an asset loads when the plugin is BUILT, so there is nothing optimistic
  // to do here.
  const pickAsset = useCallback(
    (n: GraphNode, param: string, x: number, y: number) => {
      if (n.module) cb.current.onAssetBrowse?.(n.module, param, x, y);
    },
    [],
  );
  // What feeds a track. Same shape as the asset browser above and for the same reason: the
  // list is the MACHINE's — its interface, its channel labels — and the graph knows neither.
  const pickTrackInput = useCallback((n: GraphNode, x: number, y: number) => {
    cb.current.onPickTrackInput?.(n.label, x, y);
  }, []);
  /**
   * Commit a module FIELD: the option's label, written into the module's own file.
   *
   * No optimism and no socket. A field is not a plugin param — there is nothing live to set, and the engine
   * learns it by rebuilding the track's input, so the reload the command triggers IS how it takes effect.
   * Showing the new value before that would be a guess about a round-trip we can just wait for.
   *
   * Declared before its two callers because their dependency arrays name it, and those are evaluated
   * on the spot rather than at call time.
   */
  const setModuleField = useCallback(
    (w: WebWidget, tgt: { module: string; field: string }, value: number) => {
      const label = w.options?.find((o) => o.value === value)?.label;
      if (!label) return; // a field with no named settings — nothing to write
      cb.current.command(`module ${tgt.field} ${tgt.module} ${label}`);
    },
    [],
  );

  // A dropdown's chosen setting: the same commit path as a toggle, but the value is the option's, not a flip.
  const pickWidget = useCallback(
    (n: GraphNode, w: WebWidget, value: number) => {
      const tgt = widgetTarget(n, w, chRef.current.offlineChannel);
      if (!tgt || tgt.kind === "track") return; // a track intrinsic has no named settings
      if (tgt.kind === "module") {
        setModuleField(w, tgt, value);
        return;
      }
      if (tgt.kind === "offline") {
        setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
        cb.current.onModuleParam?.(tgt.module, tgt.name, value);
        return;
      }
      setOverride((o) => ({ ...o, [targetKey(tgt)]: value }));
      cb.current.setPluginParam?.(tgt.pluginId, tgt.name, value);
      if (n.module)
        cb.current.command(
          `module param ${n.module} ${JSON.stringify(tgt.name)} ${value}`,
        );
    },
    [setModuleField],
  );

  const tapWidget = useCallback(
    (n: GraphNode, w: WebWidget) => {
      const ch = chRef.current;
      const tgt = widgetTarget(n, w, ch.offlineChannel);
      if (!tgt) return;
      if (tgt.kind === "track") {
        // Mute/solo/arm: no optimism, so a rapid double-click can't leave the button inverted against the file.
        if (
          tgt.control === "mute" ||
          tgt.control === "solo" ||
          tgt.control === "arm"
        )
          cb.current.onTrackToggle?.(tgt.trackId, tgt.control);
        return;
      }
      // A module field cycles through its own named settings — there is no 0/1 to flip.
      if (tgt.kind === "module") {
        const opts = w.options ?? [];
        const at = opts.findIndex((o) => o.value === widgetValue(n, w, ch));
        const next = opts[(at + 1) % (opts.length || 1)];
        if (next) setModuleField(w, tgt, next.value);
        return;
      }
      // A plugin toggle has no such round-trip: set it 0/1 down the socket, optimistically, and commit at once.
      const cur = widgetValue(n, w, ch);
      const on = cur !== undefined && widgetNorm(w, cur) >= 0.5;
      const next = widgetDenorm(w, on ? 0 : 1);
      setOverride((o) => ({ ...o, [targetKey(tgt)]: next }));
      if (tgt.kind === "offline") {
        cb.current.onModuleParam?.(tgt.module, tgt.name, next);
        return;
      }
      cb.current.setPluginParam?.(tgt.pluginId, tgt.name, next);
      if (n.module)
        cb.current.command(
          `module param ${n.module} ${JSON.stringify(tgt.name)} ${next}`,
        );
    },
    [setModuleField],
  );
  const insert = useCallback((info: EdgeInsert, x: number, y: number) => {
    if (suppressClick.current) return;
    cb.current.onEdgeInsert?.(info, x, y);
  }, []);
  /**
   * Right-click on EMPTY canvas — the picker, for a module that lands wired to nothing.
   *
   * Only when the event reaches the host itself or the world it holds: a node stops propagation on its own
   * right-click, so anything still arriving here came from the background. `preventDefault` regardless, because
   * the browser's own menu over a graph is never what was wanted.
   */
  const canvasMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const t = e.target as Node;
    if (
      t !== hostRef.current &&
      !(t as HTMLElement).classList?.contains("dgx-world")
    )
      return;
    cb.current.onCanvasInsert?.(e.clientX, e.clientY);
  };

  const showWidgets = lod.widgets;
  const showLabels = lod.labels;
  // Too far for the widgets ⇒ nodes draw as a fitted name instead (see Node's far branch).
  const far = !showWidgets;

  /**
   * Where the meters read their levels. The host's store when it drives an engine; an inert one
   * of our own when it does not.
   *
   * PROVIDED here rather than demanded of the host, exactly as `icons` is, and for the same
   * reason: `InputMeterBar` renders under every TRACK node unconditionally, so a host that drew
   * a graph without wrapping itself in an EngineStoreProvider crashed at render — which is what
   * the médiathèque's module preview did, and what m9's deck panel would have done too.
   * An inert store never updates, so those meters simply read silent, which is the truth.
   */
  const ownStore = useRef<EngineStore | null>(null);
  ownStore.current ??= new EngineStore();
  const meterStore = hostStore ?? ownStore.current;

  return (
    <EngineStoreProvider value={meterStore}>
      <IconsContext.Provider value={icons}>
        <div
          ref={hostRef}
          className={`dgx${panning ? " panning" : ""}`}
          onPointerDown={onPointerDown}
          onContextMenu={canvasMenu}
          style={{ cursor: hovered ? "pointer" : undefined }}
        >
          {/* The signal cables. OUTSIDE `.dgx-world` on purpose: that element carries the
              camera as a CSS transform, and a canvas scaled by CSS goes blurry — so the camera
              is applied to the 2D context instead and this stays at the host's own resolution. */}
          <canvas ref={cvRef} className="dgx-cablecv" />
          {/* No `transform` here on purpose: the camera is written onto this element by the
              frame loop, so React re-rendering the graph never fights a gesture for it. */}
          <div className="dgx-world" ref={worldRef}>
            <svg
              className="dgx-cables"
              ref={cablesSvg}
              width={graph.width}
              height={graph.height}
            >
              <Cables
                signal={model.signal}
                auto={model.auto}
                showLabels={showLabels}
                boost={linkBoost}
                hovered={hovered}
                setHovered={setHovered}
                onInsert={insert}
              />
            </svg>
            {/* On their way out: drawn where they were last seen, faded down by the loop and
                unmounted when it settles. Before the live nodes so a card arriving on the same
                spot paints over the one it replaces rather than under it. */}
            {ghosts.map((g) => (
              <Node
                key={`gone:${g.node.id}`}
                n={{ ...g.node, x: g.x, y: g.y }}
                selected={null}
                showWidgets={showWidgets}
                far={far}
                ch={ch}
                trackOrder={EMPTY_ORDER}
                onTapNode={NOOP}
                onContext={NOOP}
                onOpenPlugin={NOOP}
                onBypass={NOOP}
                onDragStart={NOOP}
                onTapWidget={NOOP}
                onPickWidget={NOOP}
                onPickAsset={NOOP}
                onPickTrackInput={NOOP}
                onContextParam={NOOP}
              />
            ))}
            {graph.nodes.map((n) => (
              <Node
                key={n.id}
                n={n}
                selected={selected}
                showWidgets={showWidgets}
                far={far}
                ch={ch}
                trackOrder={trackOrder ?? EMPTY_ORDER}
                onTapNode={tapNode}
                onContext={contextNode}
                onOpenPlugin={openPlugin}
                onBypass={bypassModule}
                warning={n.pluginId ? engineWarnings?.[n.pluginId] : undefined}
                onDragStart={beginDrag}
                onTapWidget={tapWidget}
                onPickWidget={pickWidget}
                onPickAsset={pickAsset}
                trackInput={
                  onPickTrackInput && n.kind === "track"
                    ? (trackInputs?.[n.label] ?? "aucune")
                    : undefined
                }
                onPickTrackInput={pickTrackInput}
                onWatchWaveform={onWatchWaveform}
                onContextParam={contextParam}
                sinkPlay={sinkPlay}
              />
            ))}
          </div>
        </div>
      </IconsContext.Provider>
    </EngineStoreProvider>
  );
}
