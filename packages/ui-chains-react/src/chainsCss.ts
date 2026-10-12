// chainsCss.ts — the chains graph's stylesheet, scoped to `.dgx`, plus the hook that injects it
// once into the page.
//
// Four hundred and fifteen lines of CSS lived in the middle of `DomChains.tsx`, between the colour
// constants and the components — the biggest block of a 4981-line file, and the only one holding
// no logic. Taking it out changes nothing at runtime and makes both readable.
//
// Scoped under `.dgx` so the component drops into any host, and injected once: the `<style>`'s id
// is what guarantees that when two graphs are mounted — the desk and the Chaînes tab are.

import type { WebSignal } from "@studio/graph-model";
import {
  FRAME_HEAD,
  PORT_PLATE,
  UI_CONTENT_TOP,
  UI_HEADER,
  UI_PAD,
} from "@studio/ui-chains/graph";

/** The header's on/off block: its width, and the air between it and the glyph — headerNameW counts both. */
export const BYPASS_W = 26;
export const BYPASS_GAP = 8;
/** The largest a node header's text — its name, its dropdowns — is drawn on SCREEN, px. */
export const HEADER_TEXT_MAX_PX = 16;

import { useEffect } from "react";

// Signal-typed accents. Sand is the neutral, automation mauve; a track control keeps its own M/S/A identity colour.
export const SAND = "#c8a06a";
export const MAUVE = "#a889b5";
// A cable is coloured by WHAT IT CARRIES, muted so it sits behind the nodes. See docs/chainsGraph.md.
export const CABLE: Record<WebSignal, string> = {
  midi: "#5b9bd5", // blue
  audio: "#d98b45", // orange
  video: "#5fa871", // green
  // An event carries no signal, so it takes automation's mauve: what it drives is a curve.
  event: MAUVE,
};
// An untyped cable (a source that says nothing) stays the neutral sand rather than claiming a signal it doesn't know.
export const cableColorFor = (s?: WebSignal): string => (s ? CABLE[s] : SAND);
export const RING = "#8b5cf6"; // the selection ring (violet-500)
export const MARK = "#f59e0b"; // a host's highlight ring (amber-500)
// Where the signal enters or leaves the graph. The audio cable's own orange, since that is what an edge carries.
export const EDGE = "#d98b45";
export const CTRL: Record<string, string> = {
  "@mute": "#f97316", // orange-500
  "@solo": "#eab308", // yellow-500
  "@highlight": "#22d3ee", // cyan-400 — a lane pushed forward, distinct from solo's yellow
  "@arm": "#ef4444", // red-500
};

const CSS = `
/* contain:paint states what overflow:hidden already made true, keeping this display list off the page. */
/* touch-action:none because this surface pans and zooms itself and nothing here scrolls. */
.dgx { position:relative; width:100%; height:100%; overflow:hidden; contain:paint; cursor:grab; user-select:none; touch-action:none;
  background:
    radial-gradient(circle at 1px 1px, #201f26 1px, transparent 0) 0 0 / 24px 24px,
    radial-gradient(1100px 560px at 60% -10%, #141319 0%, #0d0d0f 60%);
  color:#e7e6ea; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --sand:${SAND}; --mauve:${MAUVE}; --card:#17161b; --line:#2c2c33; --dim:#9a968c; --faint:#64615a; }
.dgx.panning { cursor:grabbing; }
.dgx-world { position:absolute; top:0; left:0; transform-origin:0 0; }
/* Non-interactive except its hit paths and insert buttons, so empty space passes the pointer through. */
.dgx-cables { position:absolute; top:0; left:0; overflow:visible; pointer-events:none; }
/* The signal cables' own layer; its width/height and z-index are load-bearing, see docs/liveCables.md. */
.dgx-cablecv { position:absolute; inset:0; width:100%; height:100%; display:block;
  pointer-events:none;
  z-index:2; }
.dgx-cbl-shadow { fill:none; stroke:#000; stroke-opacity:.5; stroke-linecap:round; stroke-linejoin:round; }
.dgx-cbl { fill:none; stroke-linecap:round; stroke-linejoin:round; }
/* No .dgx-cbl.auto rule: the automation cables draw on the canvas with everything else. */
.dgx-hit { fill:none; stroke:transparent; stroke-width:14; cursor:pointer; pointer-events:stroke; }
.dgx-ins-line { fill:none; stroke:#3b82f6; stroke-width:2.5; stroke-linecap:round; }
.dgx-ins-btn { cursor:pointer; pointer-events:auto; }
.dgx-ins-btn circle { fill:#0d0d0f; stroke:#3b82f6; stroke-width:2; }
.dgx-ins-btn path { stroke:#3b82f6; stroke-width:2; }
/* A glued row's seams, OVER the cards: a seam's line and its plus show on hover, the row's tail always (Seams.tsx). */
.dgx-seams { position:absolute; top:0; left:0; overflow:visible; pointer-events:none; z-index:3; }
.dgx-seam { cursor:pointer; pointer-events:auto; }
.dgx-seam-hit { fill:transparent; }
.dgx-seam-line { stroke:#3b82f6; stroke-width:2.5; stroke-linecap:round; }
.dgx-seam:not(.end) > :not(.dgx-seam-hit) { opacity:0; transition:opacity .1s; }
.dgx-seam:not(.end):hover > * { opacity:1; }
.dgx-seam.end:not(:hover) .dgx-ins-btn { opacity:.6; }
/* An automation cable's delete, on hover — the mauve of the cable it removes. */
.dgx-clab { fill:#8a8780; font:10px ui-monospace,monospace; pointer-events:none; }
.dgx-alab { fill:var(--mauve); font:10px ui-monospace,monospace; pointer-events:none; }
/* Stale while the cards move, so it steps aside for the ~200 ms and comes back; see docs/nodeMotion.md. */
.dgx-cables { transition:opacity .1s linear; }
.dgx-cables.moving { opacity:0; }

.dgx-node { position:absolute; box-sizing:border-box;
  background:linear-gradient(180deg,#1d1c22,var(--card)); border:1px solid var(--line);
  box-shadow:0 12px 30px -10px rgba(0,0,0,.66); transition:box-shadow .16s, border-color .16s; }
.dgx-node.k-track,.dgx-node.k-module,.dgx-node.k-sink,.dgx-node.k-assembly { --accent:var(--sand); }
.dgx-node.k-curve { --accent:var(--mauve); }
.dgx-node.k-stub { --accent:#ef4444; }
.dgx-node.k-unsupported { --accent:#f59e0b; }
/* The graph's EDGE — a live input or a built-in output, tinted in the BACKGROUND: see docs/nodeCard.md. */
.dgx-node.edge { background:linear-gradient(180deg,
  color-mix(in srgb, ${EDGE} 16%, #1d1c22),
  color-mix(in srgb, ${EDGE} 10%, var(--card))); }
.dgx-node { border-color:color-mix(in srgb, var(--accent) 42%, var(--line)); }
/* A stack-view BAR — the inputs above every column, the outputs below: the edge's ground made solid. */
.dgx-node.bar { background:color-mix(in srgb, ${EDGE} 30%, var(--card)); border-color:color-mix(in srgb, ${EDGE} 70%, var(--line)); }
/* A lane's row reads as one strip: its cards keep only the borders they share, at the sides. */
.dgx-node.across { border-top-width:0; border-bottom-width:0; }
.dgx-node.sel { box-shadow:0 0 0 2px ${RING}, 0 12px 30px -10px rgba(0,0,0,.66); }
/* Lit by the host (st0's History panel): amber, so it never reads as the selection's violet. */
.dgx-node.marked { box-shadow:0 0 0 3px ${MARK}, 0 0 18px 2px color-mix(in srgb, ${MARK} 45%, transparent); }
.dgx-marquee { position:absolute; z-index:30; pointer-events:none; border:1px dashed ${RING}; background:color-mix(in srgb, ${RING} 12%, transparent); border-radius:2px; }
.dgx-node.tappable { cursor:pointer; }
/* A BARE card draws no header, so everything it holds moves up into that space: widgetRect's offsets stay one figure. */
.dgx-node.bare > .dgx-hd { display:none; }
.dgx-node.bare > * { translate:0 -${UI_HEADER}px; }
/* Far LOD: too zoomed out for the widgets, so the card is just its name, sized to fill the node (fitFont). */
.dgx-node.far { display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:2px; padding:5px; overflow:hidden; }
/* line-height 1.15, not 1: at exactly 1 the line box IS the font size and overflow:hidden slices descenders off. */
.dgx-far { display:block; max-width:100%; font-weight:600; letter-spacing:-.01em;
  line-height:1.15; text-align:center; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; color:#e7e6ea; }
.dgx-far.stub { color:#f87171; }
.dgx-far.unsupported { color:#fbbf24; }
/* GRAB — no header at this zoom, so the whole card is the handle; three classes to outrank .tappable. */
.dgx-node.far.grab { cursor:grab; }
.dgx-node.far.grab:active { cursor:grabbing; }
/* A COLUMN — glyph and module name on one row, the node's own name under it — FIXED at the two-line height (docs/nodeCard.md). */
.dgx-hd { position:absolute; top:0; left:0; right:0; height:${UI_HEADER}px; display:flex; flex-direction:column;
  justify-content:center; padding:0 10px; box-sizing:border-box; border-bottom:1px solid #2f2f36;
  background:linear-gradient(180deg,rgba(255,255,255,.015),transparent); }
/* The top row, and the ONLY thing the corner bubbles stand over — see its padding-right below. */
.dgx-hdtop { display:flex; align-items:center; gap:7px; min-width:0; }
/* GRAB — the header moves the card, where the host allows it (the pin gesture). */
/* A plugin's cost, sitting ON the header's bottom border at the right: no width is taken from the name. */
.dgx-load { position:absolute; right:10px; bottom:-5px; z-index:1; padding:0 3px; border-radius:3px;
  font:6px/9px ui-monospace,monospace; color:var(--dim); background:var(--card); border:1px solid #2f2f36;
  white-space:nowrap; cursor:default; }
.dgx-hd.grab { cursor:grab; }
.dgx-hd.grab:active { cursor:grabbing; }
/* The content area below the header: "No Options" or why there are none, a sink's OUT mark, or a widget grid. */
.dgx-empty { position:absolute; top:${UI_CONTENT_TOP}px; left:0; right:0; bottom:0;
  display:flex; justify-content:center; padding:6px 8px 0;
  font:8px ui-monospace,monospace; color:var(--dim); letter-spacing:.04em;
  text-align:center; }
/* A fault, not a property: the same red as the name and border, and it wraps because the message is long. */
.dgx-empty.stub { color:#f87171; white-space:normal; line-height:1.35; }
.dgx-tri { width:8px; height:8px; border-radius:3px; background:var(--accent);
  box-shadow:0 0 8px -1px color-mix(in srgb,var(--accent) 70%,transparent); flex:none; }
/* The CEILING and the fallback: headerFontPx sets the real size inline, and the floored fit still needs the ellipsis. */
.dgx-nm { font-size:12.5px; font-weight:560; letter-spacing:-.005em; flex:1;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* TWO names stacked inside UI_HEADER's 38px, both line-heights stated rather than inherited; see docs/nodeCard.md. */
.dgx-hd .dgx-nm { flex:1; min-width:0; line-height:14px; }
/* The node's own name, on its own line and so cut only by the CARD's width — the bubbles are a row above it. */
/* A tabbed panel's TABS: a column down the card's left under the header, one name a row, the open one lit. */
.dgx-tabs { position:absolute; left:0; display:flex; flex-direction:column; box-sizing:border-box;
  border-right:1px solid #2f2f36; background:rgba(0,0,0,.12); overflow-x:hidden; overflow-y:auto;
  scrollbar-width:thin; scrollbar-color:#3a3a42 transparent; }
.dgx-tab { flex:none; display:block; width:100%; padding:0 6px; box-sizing:border-box; text-align:left;
  font:9px/20px ui-monospace,monospace; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  color:var(--dim); background:transparent; border:0; border-left:2px solid transparent; cursor:pointer; }
/* A NARROW card's tabs: one menu across the top, the tab column's type, the open page its value. */
.dgx-tabmenu { position:absolute; left:${UI_PAD}px; right:${UI_PAD}px; box-sizing:border-box; padding:0 6px;
  font:9px ui-monospace,monospace; color:#e7e6ea; background:#151519;
  border:1px solid #2f2f36; border-radius:4px; cursor:pointer; }
.dgx-tab:hover { color:#e7e6ea; background:rgba(255,255,255,.04); }
.dgx-tab.on { color:#e7e6ea; border-left-color:var(--sand); background:rgba(255,255,255,.06); }
/* The header's second line: the node's own name, and the engine select pushed to its right end. */
.dgx-hdsub { display:flex; align-items:center; gap:7px; min-width:0; margin-top:2px; }
/* A track's instrument glyph, white rather than the track's colour, which the border and tint already carry. */
.dgx-ticon { flex:none; color:#fff; }
/* In the header the glyph leads the name on one line, saying the node's kind before its label. */
.dgx-hd .dgx-ticon { font-size:13px; }
.dgx-nm.stub { color:#f87171; }
.dgx-nm.unsupported { color:#fbbf24; }
.dgx-sub { font:10px ui-monospace,monospace; color:var(--faint); }
.dgx-sub.stub { color:#f87171; }
.dgx-sub.unsupported { color:#fbbf24; }
/* The interface input a track is fed from; it ellipsises so the track's own name keeps the room. */
.dgx-tin { margin-left:auto; max-width:52%; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; font:9px ui-monospace,monospace;
  color:var(--sand); background:#08080b; border:1px solid #2c2c33; border-radius:4px;
  padding:0 4px; cursor:pointer; }
.dgx-tin.unknown { color:var(--faint); }
/* One disc per bubble, placed by --slot from the corner leftwards, 20px apart; see docs/nodeCard.md. */
.dgx-cbtn { position:absolute; top:-8px; right:calc(-8px + var(--slot,0) * 20px); z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:pointer; color:var(--dim); background:var(--card); border:1px solid var(--line);
  box-shadow:0 1px 4px rgba(0,0,0,.45); }
.dgx-cbtn:hover { color:#e7e6ea; border-color:var(--sand); }
/* Bypass is lit amber when ON: the node dims, but dim also means "the whole chain is off". */
/* A load problem the ENGINE reported for this plugin, a disc right of the module's name, the message as its tooltip. */
.dgx-wbtn { flex:none; width:15px; height:15px; box-sizing:border-box; border-radius:50%;
  display:grid; place-items:center; cursor:help; color:#0d0d0f; background:#f59e0b; border:1px solid #f59e0b;
  font:bold 10px/1 ui-sans-serif,system-ui; }
/* FROZEN — baked into a render, cold blue, a disc right of the module's name (FREEZE_TAG_W in DomChains.tsx). */
.dgx-fbtn { flex:none; width:15px; height:15px; box-sizing:border-box; border-radius:50%;
  display:grid; place-items:center; cursor:help; color:#0d0d0f; background:#7dd3fc; border:1px solid #7dd3fc; }
.dgx-fbtn svg { width:11px; height:11px; }

/* A track's CLIPS, one row each under its controls; CLIP_LIST_MAX in @studio/ui-chains caps the list. */
.dgx-clips { position:absolute; left:0; right:0; bottom:0; padding:0 7px 6px;
  display:flex; flex-direction:column; overflow:hidden;
  /* A rule ABOVE the list, separating it from the controls it sits under. */
  border-top:1px solid color-mix(in srgb, var(--line) 60%, transparent); }
/* One rule per row rather than a gap, which alone left the short rows reading as one block of text. */
.dgx-clip { display:flex; align-items:center; gap:6px; height:15px;
  font-size:10px; line-height:15px; color:var(--fg); opacity:.72;
  border-top:1px solid color-mix(in srgb, var(--line) 35%, transparent); }
.dgx-clip:first-child { border-top:none; }
/* The position column never shrinks: a truncated timecode says nothing, while a truncated name still identifies. */
.dgx-clip-tc { flex:none; font-variant-numeric:tabular-nums; font-size:9px;
  opacity:.7; letter-spacing:-.2px; }
.dgx-clip-nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dgx-clip.missing { color:#ef4444; opacity:1; }
.dgx-clip.more { opacity:.5; font-style:italic; }
/* The row a hovered marker points at: the opacity lift marks it, since bold alone would reflow the row. */
.dgx-clip.hot { opacity:1; }
.dgx-clip.hot .dgx-clip-nm { font-weight:700; }

/* The mini timeline: the lane at a glance, node-wide, white in both themes; see docs/nodeCard.md. */
.dgx-clip-tl { position:relative; height:10px; margin:3px 0 3px; border-radius:2px;
  background:#fff; border:1px solid color-mix(in srgb, var(--line) 45%, transparent);
  overflow:hidden; }
/* One block per clip; its offset and width are percentages of the shared scale, computed by clipsOf. */
.dgx-clip-mk { position:absolute; top:1px; bottom:1px; min-width:2px;
  border-radius:1.5px; background:var(--accent); opacity:.8; cursor:default; }
/* Absent material is never painted in the reassuring colour of the lane it is missing from. */
.dgx-clip-mk.missing { background:#ef4444 !important; opacity:1; }
.dgx-clip-mk.hot { opacity:1; box-shadow:0 0 0 1px rgba(0,0,0,.55) inset; }

/* A NOTE — a doc module: paper tint and a dashed edge, so prose is never mistaken for a device. */
.dgx-note { --accent:var(--mauve); border-style:dashed;
  background:color-mix(in srgb, var(--mauve) 7%, var(--card)); }
.dgx-note-body { padding:10px; font-size:11.5px; line-height:17px;
  white-space:pre-wrap; overflow-wrap:anywhere; overflow:hidden;
  color:var(--fg); opacity:.86; }
.dgx-node.frozen { background-image:linear-gradient(rgba(125,211,252,.12), rgba(125,211,252,.12)); }
/* The module being created, drawn where it will land; dashed, because a solid border would claim it exists. */
.dgx-node.pending { border-style:dashed; opacity:.75; }
.dgx-spin { width:18px; height:18px; margin:auto; border-radius:50%;
  border:2px solid var(--line); border-top-color:var(--sand); animation:dgx-rot .8s linear infinite; }
@keyframes dgx-rot { to { transform:rotate(360deg); } }
.dgx-bbtn.on { color:#0d0d0f; background:#f59e0b; border-color:#f59e0b; }
/* The header's left column, the on/off block the header's whole height (BYPASS_W, BYPASS_GAP above). */
.dgx-hd.byp { padding-left:${BYPASS_W + BYPASS_GAP}px; }
.dgx-hdlead { position:absolute; left:0; top:0; bottom:0; width:${BYPASS_W}px; display:flex; flex-direction:column;
  border-right:1px solid #2f2f36; }
.dgx-byp { flex:1; min-height:0; display:grid; place-items:center;
  cursor:pointer; color:var(--dim); background:rgba(255,255,255,.02); }
/* The node's icon is the on/off: it takes the switch's colour — dim, lit on hover, dark on amber when bypassed. */
.dgx-byp .dgx-ticon { color:inherit; }
/* …and a track's icon in its place, centred in the column like the on/off mark it stands in for. */
.dgx-leadicon { flex:1; min-height:0; display:grid; place-items:center; background:rgba(255,255,255,.02); }
.dgx-byp:hover { color:#e7e6ea; background:rgba(255,255,255,.06); }
/* No reservation for the bubbles: they hang off the corner (top:-8px), so a name is cut by the CARD and nothing else. */
.dgx-pbtn i { width:9px; height:1.4px; background:currentColor; box-shadow:0 3px currentColor,0 -3px currentColor; }
/* The corner minimap: over the pane rather than in the world, and above the cards. */
.dgx-minimap { position:absolute; right:12px; bottom:12px; z-index:5; display:flex; flex-direction:column;
  gap:4px; align-items:stretch; cursor:default; }
.dgx-minimap canvas { display:block; background:rgba(13,13,15,.86); border:1px solid var(--line);
  border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,.5); cursor:crosshair; touch-action:none; }
/* The buttons sit over the map's right end, as square icons: the map is the thing, they are its tools. */
.dgx-minimap-bar { display:flex; gap:4px; justify-content:flex-end; }
.dgx-minimap-bar button { width:24px; height:24px; padding:0; display:grid; place-items:center;
  color:var(--dim); background:rgba(13,13,15,.86); border:1px solid var(--line); border-radius:5px;
  cursor:pointer; }
.dgx-minimap-bar button svg { width:13px; height:13px; }
.dgx-minimap-bar button:hover { color:#e7e6ea; border-color:var(--sand); }
.dgx-minimap-bar button.on { color:#0d0d0f; background:var(--sand); border-color:var(--sand); }
/* A rack TAP: the pad over its note and its sample; the × shows on hover. See packages/song/docs/racks.md. */
.dgx-tap { padding:3px; gap:3px; justify-content:stretch; }
.dgx-tap-pad { flex:1; min-height:0; width:100%; border-radius:5px; border:1px solid var(--line);
  background:#15151a; color:var(--dim); font:600 10px ui-monospace,monospace; cursor:pointer; }
.dgx-tap-pad:hover:not(:disabled) { border-color:var(--sand); color:#e7e6ea; }
.dgx-tap-pad.on { background:var(--sand); border-color:var(--sand); color:#0d0d0f; }
.dgx-tap-pad:disabled { cursor:default; opacity:.7; }
.dgx-tap-row { display:flex; gap:3px; width:100%; height:15px; }
.dgx-tap-note, .dgx-tap-sample { height:15px; border-radius:4px; border:1px solid #2c2c33; background:#08080b;
  font:9px/13px ui-monospace,monospace; color:var(--sand); cursor:pointer; padding:0 3px; }
.dgx-tap-note { width:26px; flex:none; text-align:center; }
.dgx-tap-sample { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
.dgx-tap-sample.unknown { color:var(--faint); }
.dgx-tap-note:disabled, .dgx-tap-sample:disabled { cursor:default; }
.dgx-tap-x { position:absolute; top:1px; right:1px; width:14px; height:14px; padding:0; display:none;
  place-items:center; border:none; border-radius:3px; background:transparent; color:var(--faint); cursor:pointer; }
.dgx-tap:hover .dgx-tap-x { display:grid; }
.dgx-tap-x:hover { color:#e7e6ea; }
.dgx-tap-x svg { width:10px; height:10px; }
/* A tap's mute, at the corner opposite its remove: shown on hover, and always once it is muted. */
.dgx-tap-m { position:absolute; top:1px; left:1px; width:14px; height:14px; padding:0; display:none;
  place-items:center; border:none; border-radius:3px; background:transparent; color:var(--faint); cursor:pointer; }
.dgx-tap:hover .dgx-tap-m, .dgx-tap.muted .dgx-tap-m { display:grid; }
.dgx-tap-m:hover { color:#e7e6ea; }
.dgx-tap-m svg { width:10px; height:10px; }
.dgx-tap.muted .dgx-tap-m { color:#f59e0b; }
.dgx-tap.muted .dgx-tap-pad { opacity:.35; text-decoration:line-through; }
.dgx-tap.add { display:grid; place-items:center; border:1px dashed var(--line); border-radius:6px;
  background:transparent; color:var(--faint); cursor:pointer; }
.dgx-tap.add:hover:not(:disabled) { color:#e7e6ea; border-color:var(--sand); }
.dgx-tap.add svg { width:14px; height:14px; }
/* The field a double-clicked control becomes, over the control it replaces for the moment. */
.dgx-wedit { position:absolute; left:2px; right:2px; top:50%; transform:translateY(-50%); z-index:3;
  height:16px; min-width:0; box-sizing:border-box; padding:0 3px; text-align:center;
  font:10px ui-monospace,monospace; color:#e7e6ea; background:#08080b;
  border:1px solid var(--sand); border-radius:4px; outline:none; user-select:text; }
/* Alternatives — one badge per attribute set, at the right end of the header's top row; JS sets each width. */
.dgx-alts { flex:none; display:flex; gap:3px; }
/* A module with no second set shows its lone plus only while the card is hovered or selected. */
.dgx-alts.lone { opacity:0; transition:opacity .12s; }
.dgx-node:hover .dgx-alts.lone, .dgx-node.sel .dgx-alts.lone { opacity:1; }
.dgx-alt { height:15px; min-width:15px; max-width:80px; padding:0 5px; border-radius:8px; box-sizing:border-box;
  display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center;
  font:9px/13px ui-monospace,monospace; cursor:pointer; color:var(--dim); background:var(--card);
  border:1px solid var(--line); }
.dgx-alt:hover { color:#e7e6ea; border-color:var(--sand); }
/* No header text — nor an alternative badge — is drawn past HEADER_TEXT_MAX_PX on screen, however far the camera zooms: --dgx-k is the zoom (camera.ts). */
.dgx-node { --dgx-cap:calc(${HEADER_TEXT_MAX_PX}px / var(--dgx-k, 1)); }
.dgx-hd .dgx-sub { font-size:min(10px, var(--dgx-cap)); }
.dgx-hd .dgx-tin, .dgx-alt, .dgx-hd .dgx-engine { font-size:min(9px, var(--dgx-cap)); }
/* A module card's BOTTOM BAR (FOOTER_H): knobs left, badges centred, alternatives right; above the seams' layer. */
/* Three columns, the outer two of equal share, so the centre is the CARD's centre whatever the sides hold. */
.dgx-foot { position:absolute; left:0; right:0; bottom:0; box-sizing:border-box; display:grid;
  grid-template-columns:1fr auto 1fr; align-items:center; gap:6px; padding:0 6px;
  border-top:1px solid #2f2f36; background:rgba(0,0,0,.12); z-index:4; }
.dgx-footl { display:flex; align-items:center; gap:4px; min-width:0; justify-self:start; }
.dgx-footc { display:flex; align-items:center; gap:4px; justify-self:center; }
.dgx-footr { display:flex; justify-content:flex-end; min-width:0; justify-self:end; }
/* The cost badge in the bar is one of its badges, not a tab hung on a border. */
.dgx-load.inbar { position:static; }
.dgx-footk { display:block; width:16px; height:16px; }
.dgx-alt.on { color:#0d0d0f; background:var(--sand); border-color:var(--sand); cursor:default; }
/* The header's one dropdown — engine and preset — on its second line; JS sets its least width (PresetButton.tsx). */
.dgx-engine { flex:none; height:15px; padding:0 4px; border-radius:8px; font:9px/13px ui-monospace,monospace;
  cursor:pointer; color:var(--sand); background:var(--card); border:1px solid var(--line);
  text-overflow:ellipsis; overflow:hidden; white-space:nowrap; }
.dgx-engine:hover { border-color:var(--sand); }
/* The preset dropdown wears the engine select's pill; muted until a preset is loaded. It takes the line's free width, to 300 px. */
.dgx-preset { display:flex; align-items:center; gap:2px; color:var(--faint); flex:1 1 auto; max-width:300px; }
.dgx-preset.on { color:var(--sand); }
.dgx-preset span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; text-align:left; }
/* The engine, leading the one dropdown: what the module runs AS, before which settings it runs with. */
.dgx-preset-eng { flex:none; max-width:60px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-weight:600; color:#e7e6ea; padding-right:4px; border-right:1px solid var(--line); margin-right:2px; }
.dgx-preset svg { flex:none; width:9px; height:9px; }
/* The previous and next arrows after it: a pill each, the width of the arrow. */
.dgx-preset-step { width:15px; padding:0; display:grid; place-items:center; color:var(--dim); margin-left:-4px; }
.dgx-preset-step svg { width:9px; height:9px; }
.dgx-alt.add { padding:0; display:grid; place-items:center; }
.dgx-alt.add svg { width:9px; height:9px; }
/* The copy is on its way: dimmed and inert until the new badge arrives. */
.dgx-alt.add.busy { opacity:.45; cursor:progress; }

/* An ASSEMBLY's bubble: a box you open, and the same disc closed again when it is. */
.dgx-obtn.on { color:#0d0d0f; background:var(--sand); border-color:var(--sand); }
.dgx-obtn i { width:7px; height:7px; border:1.4px solid currentColor; border-radius:1.5px; }
/* …and the CARD of a closed one, told apart from a module by its outline rather than by a glyph. */
.dgx-node.k-assembly { border-style:double; border-width:3px; }

/* An OPEN box: a frame BEHIND its members, drawn as the appliance's own case around them. */
.dgx-frame { position:absolute; box-sizing:border-box; border:1px dashed var(--line);
  background:rgba(255,255,255,.025); }
.dgx-frame.grab .dgx-frame-hd { cursor:grab; }
.dgx-frame-hd { position:absolute; left:0; right:0; top:0; height:${FRAME_HEAD}px;
  display:flex; align-items:center; gap:6px; padding:0 10px; box-sizing:border-box; }
.dgx-frame-nm { font-size:11px; letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* The close disc sits IN the strip rather than off the corner: a frame has no corner to hang one on. */
.dgx-frame .dgx-cbtn { position:static; margin-left:auto; }

/* A PORT: a socket in a plate stepped off the card's edge, flat side against it; see docs/nodeCard.md. */
.dgx-port { position:absolute; display:grid; place-items:center;
  width:17px; height:${PORT_PLATE}px; box-sizing:border-box;
  background:linear-gradient(#2a2930,#141419); border:1px solid var(--line);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05); transform:translateX(-50%); }
.dgx-port.in  { top:-${PORT_PLATE}px;    border-bottom-width:0; border-radius:4px 4px 0 0; }
.dgx-port.out { bottom:-${PORT_PLATE}px; border-top-width:0;    border-radius:0 0 4px 4px; }
/* EVENT sockets are side plates on the LEFT edge: a curve's event IN halfway down it, what a module announces aligned
   at the bottom (graph.ts eventOutBottom) — the only socket that says its name. */
.dgx-port.ev { width:${PORT_PLATE}px; height:17px; transform:translateY(-50%);
  left:-${PORT_PLATE}px; border-right-width:0; border-radius:4px 0 0 4px; }
/* The name, outside the plate and clear of the card. 6px like every other caption here. */
/* A curve's AUTOMATION out: a side plate halfway down its right edge, toward the node it sits left of. */
.dgx-port.cout { width:${PORT_PLATE}px; height:17px; top:50%; transform:translateY(-50%);
  right:-${PORT_PLATE}px; border-left-width:0; border-radius:0 4px 4px 0; }
.dgx-evlab { position:absolute; font-size:6px; text-transform:uppercase; letter-spacing:.09em;
  color:var(--dim); white-space:nowrap; transform:translateY(-50%); pointer-events:none; }
.dgx-evlab.evout { right:calc(100% + 3px); top:50%; }
/* …and the barrel, seen end on: a dark bore with a ring coloured by what the port carries. */
.dgx-port i { width:9px; height:9px; border-radius:50%;
  background:radial-gradient(circle at 37% 33%,#3b3a43,#08080b 68%);
  border:1.5px solid color-mix(in srgb,var(--jc) 62%,#2c2c33);
  box-shadow:inset 0 0 2px 1px rgba(0,0,0,.8); }
/* FREE — nothing wired to it, so the plate recedes and the bore loses its ring. */
.dgx-port.free { opacity:.55; }
.dgx-port.free i { border-color:#2c2c33; background:radial-gradient(circle at 37% 33%,#232228,#0a0a0d 68%); }
/* PLUG — a free socket the patch gesture can use right now; only a host passing onConnect arms it. */
.dgx-port.plug { cursor:pointer; opacity:.85; }
.dgx-port.plug:hover { opacity:1; }
.dgx-port.plug:hover i { border-color:color-mix(in srgb,var(--jc) 80%,#2c2c33); }
/* The cable in hand: dashed, coloured by its signal, its far end pinned to the cursor. */
.dgx-patchcable { fill:none; stroke-width:2; stroke-dasharray:6 5; opacity:.9; pointer-events:none; }

/* A widget is placed at its widgetRect box, so the drawing and the automation targets agree with graph.ts. */
.dgx-w { position:absolute; box-sizing:border-box; display:flex; flex-direction:column;
  align-items:center; justify-content:center; }
/* A control a CURVE drives glows the automation cable's mauve, so what is moving by itself reads at a glance. */
.dgx-w.auto { border-radius:6px; box-shadow:0 0 0 1px color-mix(in srgb, ${MAUVE} 70%, transparent),
  0 0 10px 1px color-mix(in srgb, ${MAUVE} 55%, transparent); }
.dgx-w.drag { cursor:ns-resize; }
.dgx-w.tap { cursor:pointer; }
/* A dropdown's caption ON TOP of its select, left-aligned with it: the pair is one block .dgx-w centres. */
.dgx-selcol { display:flex; flex-direction:column; align-items:stretch; width:100%; min-width:0; }
.dgx-selcol .dgx-wlab { margin:0 0 1px; text-align:left; overflow:hidden; text-overflow:ellipsis; }
/* A widget offering to take a curve's cable: the whole box lights, because a hairline on a 21px knob cannot be aimed at. */
.dgx-land { cursor:copy; border-radius:4px; outline:1.5px solid ${MAUVE};
  background:color-mix(in srgb,${MAUVE} 18%,transparent); }
/* 6px, down from 8: a caption names a control that is already drawn, so it can be the smallest thing here. */
.dgx-wlab { font-size:6px; text-transform:uppercase; letter-spacing:.09em; color:var(--dim);
  margin-top:1px; white-space:nowrap; }
/* A 'label' widget's own text — a heading over a group, not a reading, so 8px under a reading's 10. */
.dgx-wtext { font:8px ui-monospace,monospace; color:#e7e6ea; }
/* A group: a tinted frame under the controls inside it, inert so a click falls through to the card. */
.dgx-group { pointer-events:none; border-radius:5px; background:#ffffff0d;
  box-shadow:inset 0 0 0 1px #ffffff14; justify-content:flex-start; align-items:flex-start; }
/* A group's name runs up the left edge, a line of text turned 90° counter-clockwise, ending at the top — clear of the first control's dial. */
/* It sits on a SPINE, the group's colour made vivid, from the left edge to 12px — where the edge's widgets start. */
/* vertical-rl turned 180° reads bottom-up; padding and corners turn with it, so they are written on the opposite sides. */
.dgx-glab { position:absolute; left:0; top:0; bottom:0; margin:0; padding:0 5px 2px 1px; writing-mode:vertical-rl; transform:rotate(180deg); text-align:end;
  line-height:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-radius:0 5px 5px 0;
  background:var(--spine,#ffffff26); color:#e7e6ea; }
/* …and the name starts under the group's on/off switch when it has one, the spine running on behind the switch. */
.dgx-glab.sw { padding-bottom:15px; }
/* A group's on/off switch: a dot at its top-left, green when on, red when off — the group is inert, the dot is not. */
.dgx-gswitch { position:absolute; left:4px; top:4px; z-index:3; pointer-events:auto; width:8px; height:8px;
  padding:0; border:0; border-radius:50%; background:#ef4444; box-shadow:0 0 4px -1px #ef4444; cursor:pointer; }
.dgx-gswitch.on { background:#10b981; box-shadow:0 0 5px -1px #10b981; }
.dgx-gswitch.unknown { background:var(--faint); box-shadow:none; }
.dgx-gswitch:disabled { cursor:default; }
/* An OFF group greys its section: a veil over the widgets it frames, which stay usable underneath it. */
.dgx-gveil { position:absolute; inset:0; z-index:2; pointer-events:none; border-radius:inherit;
  background:#0d0d0f8c; backdrop-filter:grayscale(1); -webkit-backdrop-filter:grayscale(1); }
/* A RECORDER's waveform box: the canvas fills it, the two labels sit on top — docs/nodeCard.md. */
/* No position on .dgx-wave or .dgx-lcd: .dgx-w's absolute must win, or a 2nd box flows under the 1st. */
.dgx-lcd { padding:3px; border-radius:4px; background:#0f1a10;
  box-shadow: inset 0 0 0 1px #2b3a2c, inset 0 2px 6px rgba(0,0,0,.6); }
.dgx-lcd canvas { width:100%; height:100%; display:block; }
.dgx-lcd.live canvas { cursor:crosshair; touch-action:none; }
.dgx-lcd-msg { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  padding:4px; text-align:center; font:8px ui-monospace,monospace; color:rgba(184,240,160,.6); }
/* "no record" — CENTRED and alone, the canvas having drawn nothing beside it (takeClock.ts). */
.dgx-wave-msg { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font:8px ui-monospace,monospace; color:var(--faint); letter-spacing:.06em; pointer-events:none; }
/* …and the clock, OVER the picture: top-right, where a growing envelope reaches last. */
.dgx-wave-clock { position:absolute; top:2px; right:3px; font:8px ui-monospace,monospace;
  color:#e7e6ea; text-shadow:0 0 3px #000, 0 0 3px #000; pointer-events:none; }
.dgx-slider { width:80%; height:5px; border-radius:3px; background:#08080b; border:1px solid #212129; overflow:hidden; }
.dgx-slider i { display:block; height:100%; background:var(--sand); }

/* The channel fader: flex:1 plus min-height:0 makes the throw as tall as its rowSpan; see docs/nodeCard.md. */
.dgx-fader { flex:1 1 0; min-height:0; width:100%; display:flex; justify-content:center; align-items:stretch;
  gap:3px; padding:2px 0; }
/* The VU, left of the throw: the Mix panel's -60..+6 dB span and thresholds, its ramp on the box. */
.dgx-fmeter { position:relative; width:5px; border-radius:3px; border:1px solid #212129; overflow:hidden;
  flex:none; background:linear-gradient(to top,
    #10b981 0%, #10b981 81.8%, #fbbf24 81.8%, #fbbf24 90.9%, #ef4444 90.9%, #ef4444 100%); }
/* NO transition on the shade: a 60ms ease restarted by 50ms levels never finished; see docs/nodeCard.md. */
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
/* A number is a field like .dgx-sel: the same width, box and type, so the two line up in a panel. */
.dgx-num { box-sizing:border-box; width:100%; max-width:100%; padding:1px 2px; border-radius:4px;
  background:#08080b; border:1px solid #2c2c33; font:9px ui-monospace,monospace; color:#e7e6ea;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dgx-num.unknown { color:var(--dim); }
/* Fills the box its colSpan gave it: content-sized, a panel of dropdowns drew a ragged column. */
.dgx-sel { width:100%; max-width:100%; font:9px ui-monospace,monospace; color:#e7e6ea;
  background:#08080b; border:1px solid #2c2c33; border-radius:4px; padding:1px 2px;
  cursor:pointer; }
.dgx-sel:disabled { cursor:default; opacity:.5; }
/* A midi-in card's LED beside its device dropdown: dark at rest, green while the keyboard sends. */
.dgx-ledrow { display:flex; align-items:center; gap:4px; width:100%; min-width:0; }
.dgx-led { flex:none; width:6px; height:6px; border-radius:50%; background:#2a2a30; box-shadow:inset 0 0 0 1px #3a3a42; }
.dgx-led.on { background:#4ade80; box-shadow:0 0 6px #4ade80; }
.dgx-sel.unknown { color:var(--faint); }
/* The FILE picker fills its colSpan too, and ellipsises: a NAM pack's names run to a sentence. */
.dgx-file { width:100%; padding:1px 5px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.dgx-meter { width:80%; height:5px; border-radius:3px; background:#08080b; border:1px solid #212129; }

.dgx-out { position:absolute; top:${UI_CONTENT_TOP}px; left:0; right:0; bottom:0; display:grid; place-items:center; }
.dgx-out b { font:600 20px ui-monospace,monospace; letter-spacing:.04em; color:var(--sand); line-height:1; }
.dgx-out span { font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); }
/* The audition button lives here, not in a host's CSS: this sheet is INJECTED (see useCss). */
.dgx-play { margin-top:5px; width:22px; height:22px; display:grid; place-items:center;
  border:1px solid #2c2c33; border-radius:50%; background:#08080b; color:var(--sand);
  font-size:9px; line-height:1; cursor:pointer; }
.dgx-play:hover:not(:disabled) { border-color:var(--sand); }
.dgx-play:disabled { cursor:default; opacity:.35; }
/* A curve card is its picture and nothing else: no header, the whole card, and the header's grab. */
.dgx-curve { position:absolute; inset:0; padding:4px 6px; box-sizing:border-box; }
.dgx-curve.grab { cursor:grab; }
.dgx-curve.grab:active { cursor:grabbing; }
/* While playing: where the transport is on the picture, and a dot on the value the curve has there. */
.dgx-curvehead { position:absolute; top:4%; bottom:4%; width:1px; margin-left:-0.5px; background:#e7e6ea; opacity:.7; pointer-events:none; }
.dgx-curvedot { position:absolute; width:6px; height:6px; margin:-3px 0 0 -3px; border-radius:50%; background:var(--mauve); box-shadow:0 0 0 1.5px #0d0d0f; pointer-events:none; }
`;

export function useCss(): void {
  useEffect(() => {
    // Refreshed when it DIFFERS, not only created: a hot reload that kept the old sheet drew new markup unstyled.
    const held = document.getElementById("dgx-css");
    if (held) {
      if (held.textContent !== CSS) held.textContent = CSS;
      return;
    }
    const s = document.createElement("style");
    s.id = "dgx-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }, []);
}
