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
import { PORT_PLATE } from "@studio/ui-chains/graph";
import { useEffect } from "react";

// Signal-typed accents. Sand is the neutral, automation mauve; a track control keeps its own M/S/A identity colour.
export const SAND = "#c8a06a";
export const MAUVE = "#a889b5";
// A cable is coloured by WHAT IT CARRIES, muted so it sits behind the nodes. See docs/chainsGraph.md.
export const CABLE: Record<WebSignal, string> = {
  midi: "#5b9bd5", // blue
  audio: "#d98b45", // orange
  video: "#5fa871", // green
  // An event carries no signal, so it takes automation's mauve rather than a fourth voice on
  // the palette: what it drives is a curve, and the value coming back is already that colour.
  event: MAUVE,
};
// An untyped cable (a source that says nothing) stays the neutral sand rather than claiming a signal it doesn't know.
export const cableColorFor = (s?: WebSignal): string => (s ? CABLE[s] : SAND);
export const RING = "#8b5cf6"; // the selection ring (violet-500), matching the old primary
export const CTRL: Record<string, string> = {
  "@mute": "#f97316", // orange-500
  "@solo": "#eab308", // yellow-500
  "@arm": "#ef4444", // red-500
};

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
  pointer-events:none;
  /* OVER the cards: a patch bay's cables lie on top of the rack, not behind it — and the
     shadow each cable already strokes is what seats it visually on the card face it crosses.
     Safe because this layer never takes the pointer; the SVG's hit paths, labels and inserts
     stay below the nodes, so nothing a card offers becomes unclickable under a cable. */
  z-index:2; }
.dgx-cbl-shadow { fill:none; stroke:#000; stroke-opacity:.5; stroke-linecap:round; stroke-linejoin:round; }
.dgx-cbl { fill:none; stroke-linecap:round; stroke-linejoin:round; }
/* .dgx-cbl.auto is gone: the automation cables draw on the canvas with everything else. */
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
/* GRAB — with no header at this zoom the whole card is the handle, so it wears the header's
   cursor. Three classes, so it outranks .dgx-node.tappable's pointer. */
.dgx-node.far.grab { cursor:grab; }
.dgx-node.far.grab:active { cursor:grabbing; }
.dgx-hd { position:absolute; top:0; left:0; right:0; display:flex; align-items:center; gap:7px;
  padding:7px 10px; box-sizing:border-box; border-bottom:1px solid #2f2f36; border-radius:11px 11px 0 0;
  background:linear-gradient(180deg,rgba(255,255,255,.015),transparent); }
/* GRAB — the header moves the card, where the host allows it (the pin gesture). */
.dgx-hd.grab { cursor:grab; }
.dgx-hd.grab:active { cursor:grabbing; }
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
/* TWO names, stacked: the MODULE this node uses on top, the node's own underneath.
   They are different things and the card said only the second, so seventeen uses of one
   mixer read as seventeen unrelated cards and what a node IS could only be learnt by
   opening it.

   Inside UI_HEADER (38px), which is shared with the layout and the hit areas — 7px of
   padding either side leaves 24, so both line-heights are stated rather than inherited:
   a header that grew would put every widget grid under its own card's chrome.
   min-width:0 is what makes the ellipsis inside a flex row work at all. */
.dgx-nms { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; }
.dgx-nms .dgx-nm { flex:none; line-height:14px; }
.dgx-nodenm { font:9.5px ui-monospace,monospace; line-height:10px; color:var(--faint);
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
/* The corner CLUSTER. Every bubble is the same disc; what differs is which SLOT it takes,
   counted from the corner leftwards (--slot; 17px wide + 3px of air = 20px apart). One rule
   instead of a .paired variant per pair: there are three of these now (alternatives, bypass,
   plugin UI) and a variant per combination is where a fourth would have gone wrong. */
.dgx-cbtn { position:absolute; top:-8px; right:calc(-8px + var(--slot,0) * 20px); z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:pointer; color:var(--dim); background:var(--card); border:1px solid var(--line);
  box-shadow:0 1px 4px rgba(0,0,0,.45); }
.dgx-cbtn:hover { color:#e7e6ea; border-color:var(--sand); }
/* Bypass is lit amber when ON, because a bypassed module still LOOKS like a module — the
   node dims, but dim also means "the whole chain is off", so the state needs its own
   mark. */
/* A load problem the ENGINE reported for this plugin — a model it refused, a plugin it could not create. The
   node is otherwise healthy-looking, which is the whole trouble: it sits in the chain and does nothing. Amber
   and on the free corner (both right-hand ones are the plugin/bypass bubbles); the message is its tooltip. */
.dgx-wbtn { position:absolute; top:-8px; left:-8px; z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:help; color:#0d0d0f; background:#f59e0b; border:1px solid #f59e0b;
  box-shadow:0 1px 4px rgba(0,0,0,.45); font:bold 11px/1 ui-sans-serif,system-ui; }
/* FROZEN — this node is baked into a render, so the engine never built it. Cold blue, on the
   bottom-left corner (the top-left one is the engine's warning badge, and the two can be true at
   once: a module can have failed to load and then been frozen with the failure baked in). */
.dgx-fbtn { position:absolute; bottom:-8px; left:-8px; z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:help; color:#0d0d0f; background:#7dd3fc; border:1px solid #7dd3fc;
  box-shadow:0 1px 4px rgba(0,0,0,.45); }
.dgx-fbtn svg { width:11px; height:11px; }

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
/* The row a hovered marker points at. Bold ALONE would reflow the row as the letters widen;
   the opacity lift is what makes it read as "this one" without the text moving. */
.dgx-clip.hot { opacity:1; }
.dgx-clip.hot .dgx-clip-nm { font-weight:700; }

/* The mini timeline: the lane at a glance, node-wide, above the names.
   WHITE, because this strip stands for the song itself rather than for more of the card's
   chrome — the blocks on it have to read as material on tape. It keeps a thin border so the
   white does not bleed into a light theme's card, and stays white in both themes deliberately:
   it is a surface, not a panel that should follow the skin. */
.dgx-clip-tl { position:relative; height:10px; margin:3px 0 3px; border-radius:2px;
  background:#fff; border:1px solid color-mix(in srgb, var(--line) 45%, transparent);
  overflow:hidden; }
/* One block per clip: placed at its start, as wide as it runs. Its offset and width are
   percentages of the shared scale, computed on the node (see clipsOf) — nothing divides here. */
.dgx-clip-mk { position:absolute; top:1px; bottom:1px; min-width:2px;
  border-radius:1.5px; background:var(--accent); opacity:.8; cursor:default; }
/* Absent material is never painted in the reassuring colour of the lane it is missing from. */
.dgx-clip-mk.missing { background:#ef4444 !important; opacity:1; }
.dgx-clip-mk.hot { opacity:1; box-shadow:0 0 0 1px rgba(0,0,0,.55) inset; }

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
.dgx-bbtn.on { color:#0d0d0f; background:#f59e0b; border-color:#f59e0b; }
/* The universal bypass mark: a circle broken at the top by a vertical stroke. */
.dgx-bbtn i { width:7px; height:7px; border:1.4px solid currentColor; border-radius:50%;
  position:relative; }
.dgx-bbtn i::after { content:""; position:absolute; left:50%; top:-3px;
  width:1.4px; height:5px; background:currentColor; transform:translateX(-50%); }
/* The bubbles' lower-left quarters still overlap the header's corner, so a long name needs to
   stop short of them — 14px for the first, 12px more for each one further left. Driven by
   --corners, the same count the buttons are placed from, so the name and the cluster cannot
   disagree about how many there are. */
.dgx-hd { padding-right:calc(10px + max(0px, (var(--corners,0) * 12px) + 2px)); }
.dgx-pbtn i { width:9px; height:1.4px; background:currentColor; box-shadow:0 3px currentColor,0 -3px currentColor; }
/* Alternatives: the module's other attribute sets. Three dots, the everyday "there is more here"
   mark, and lit like bypass when a set OTHER than the module's own is on — a node running a
   variant looks exactly like one running its own fields, and that is the thing worth marking. */
.dgx-abtn.on { color:#0d0d0f; background:var(--sand); border-color:var(--sand); }
.dgx-abtn i { width:3px; height:3px; border-radius:50%; background:currentColor;
  box-shadow:0 -4px currentColor, 0 4px currentColor; }

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
/* An EVENT socket sits on a SIDE edge, where signal never goes: inputs and outputs run down the
   card, so the left and right are free and the two can never be confused for one another. It is
   also the only socket that says its name — an event is announced, and "note-on" is the whole of
   what the announcement means. */
.dgx-port.ev { width:${PORT_PLATE}px; height:17px; transform:translateY(-50%); }
.dgx-port.ev.evout { right:-${PORT_PLATE}px; left:auto; border-left-width:0;  border-radius:0 4px 4px 0; }
.dgx-port.ev.evin  { left:-${PORT_PLATE}px;             border-right-width:0; border-radius:4px 0 0 4px; }
/* The name, outside the plate and clear of the card. 6px like every other caption here. */
.dgx-evlab { position:absolute; font-size:6px; text-transform:uppercase; letter-spacing:.09em;
  color:var(--dim); white-space:nowrap; transform:translateY(-50%); pointer-events:none; }
.dgx-evlab.evout { left:calc(100% + ${PORT_PLATE + 3}px); }
.dgx-evlab.evin  { right:calc(100% + ${PORT_PLATE + 3}px); }
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
/* PLUG — a free socket the patch gesture can use right now: an out to draw a cable from, a
   matching in to land it in. Only a host that passes onConnect arms this, so a read-only
   graph keeps its inert sockets. */
.dgx-port.plug { cursor:pointer; opacity:.85; }
.dgx-port.plug:hover { opacity:1; }
.dgx-port.plug:hover i { border-color:color-mix(in srgb,var(--jc) 80%,#2c2c33); }
/* The cable in hand: dashed and coloured by its signal, its far end pinned to the cursor —
   a promise of a cable, not yet one, which is what the dashes say. */
.dgx-patchcable { fill:none; stroke-width:2; stroke-dasharray:6 5; opacity:.9; pointer-events:none; }

/* A widget is absolutely placed at its widgetRect box (node-local), so the drawing and the
   automation-arrow targets agree with graph.ts by construction. */
.dgx-w { position:absolute; box-sizing:border-box; display:flex; flex-direction:column;
  align-items:center; justify-content:center; }
.dgx-w.drag { cursor:ns-resize; }
.dgx-w.tap { cursor:pointer; }
/* A SELECT reads as the control; its caption is a heading over it, not a foot under it — and
   pinned out of the flow so the select itself is what .dgx-w's justify-content centres, rather
   than the pair of them. left/right rather than a width so a long name ellipsises in place. */
/* A caption BESIDE its select, when the box is wide enough for both. In the flow, so the pair
   is what .dgx-w centres — there is nothing to pin here.
   Full width, so the select underneath can spend what the caption does not: the caption is
   flex:none (it is a word, and shrinking it only ellipsises a name), the select takes the rest.
   min-width:0 on BOTH is what lets that happen at all — a flex item's default min-width:auto
   floors it at its content, and a long option list would then push the pair past the box
   instead of the select fitting inside it.
   (No backticks in here: this whole sheet is a template literal, and one ends the string.) */
.dgx-selrow { display:flex; align-items:center; gap:4px; width:100%; min-width:0; }
.dgx-selrow .dgx-wlab { margin-top:0; flex:none; min-width:0; overflow:hidden;
  text-overflow:ellipsis; }
.dgx-selrow .dgx-sel { flex:1; min-width:0; }
/* A widget offering to take a curve's cable. Mauve like the automation it is about to become,
   and the whole box lights rather than an outline: the target is the CONTROL, and a hairline
   on a 21px knob is not a thing a cable can be aimed at. */
.dgx-land { cursor:copy; border-radius:4px; outline:1.5px solid ${MAUVE};
  background:color-mix(in srgb,${MAUVE} 18%,transparent); }
.dgx-wlab.top { position:absolute; top:1px; left:2px; right:2px; margin-top:0;
  overflow:hidden; text-overflow:ellipsis;
  /* Centred by text-align, not by the flex box: out of the flow, this span is no longer a
     child .dgx-w's align-items can centre, and left/right make it span the whole width — so
     without this the name sits against the left edge. */
  text-align:center; }
/* 6px, down from 8. A caption names a control that is already drawn — it is read once and
   then recognised by position — so it can be smaller than anything it labels, and the two
   pixels go back to the panel. */
.dgx-wlab { font-size:6px; text-transform:uppercase; letter-spacing:.09em; color:var(--dim);
  margin-top:1px; white-space:nowrap; }
.dgx-wval { font:10px ui-monospace,monospace; color:#e7e6ea; font-variant-numeric:tabular-nums; }
/* A 'label' widget's own text — a heading over a group, not a reading. It borrowed .dgx-wval
   above, which is why shrinking captions alone would have left it 4px larger than everything
   it heads; its own class is what lets the two move apart. 8px, down from that 10. */
.dgx-wtext { font:8px ui-monospace,monospace; color:#e7e6ea; }
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
/* Fills the box its colSpan gave it, the same argument .dgx-file makes below: a widget two
   cells wide that draws a 30px select is a cell and a half of nothing, and what a dropdown
   holds is a WORD — the width is the readable part, and the one that stops "Saw down" being
   clipped to "Saw d…". It was content-sized, so a panel of dropdowns drew a ragged left column
   of boxes no two of which were the same width. */
.dgx-sel { width:100%; max-width:100%; font:9px ui-monospace,monospace; color:#e7e6ea;
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

export function useCss(): void {
  useEffect(() => {
    if (document.getElementById("dgx-css")) return;
    const s = document.createElement("style");
    s.id = "dgx-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }, []);
}
