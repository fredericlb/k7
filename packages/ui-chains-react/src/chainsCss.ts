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
  // An event carries no signal, so it takes automation's mauve: what it drives is a curve.
  event: MAUVE,
};
// An untyped cable (a source that says nothing) stays the neutral sand rather than claiming a signal it doesn't know.
export const cableColorFor = (s?: WebSignal): string => (s ? CABLE[s] : SAND);
export const RING = "#8b5cf6"; // the selection ring (violet-500)
// Where the signal enters or leaves the graph. The audio cable's own orange, since that is what an edge carries.
export const EDGE = "#d98b45";
export const CTRL: Record<string, string> = {
  "@mute": "#f97316", // orange-500
  "@solo": "#eab308", // yellow-500
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
.dgx-clab { fill:#8a8780; font:10px ui-monospace,monospace; pointer-events:none; }
.dgx-alab { fill:var(--mauve); font:10px ui-monospace,monospace; pointer-events:none; }
/* Stale while the cards move, so it steps aside for the ~200 ms and comes back; see docs/nodeMotion.md. */
.dgx-cables { transition:opacity .1s linear; }
.dgx-cables.moving { opacity:0; }

.dgx-node { position:absolute; box-sizing:border-box; border-radius:11px;
  background:linear-gradient(180deg,#1d1c22,var(--card)); border:1px solid var(--line);
  box-shadow:0 12px 30px -10px rgba(0,0,0,.66); transition:box-shadow .16s, border-color .16s; }
.dgx-node.k-track,.dgx-node.k-module,.dgx-node.k-sink { --accent:var(--sand); }
.dgx-node.k-curve { --accent:var(--mauve); }
.dgx-node.k-stub { --accent:#ef4444; }
.dgx-node.k-unsupported { --accent:#f59e0b; }
/* The graph's EDGE — a live input or a built-in output, tinted in the BACKGROUND: see docs/nodeCard.md. */
.dgx-node.edge { background:linear-gradient(180deg,
  color-mix(in srgb, ${EDGE} 16%, #1d1c22),
  color-mix(in srgb, ${EDGE} 10%, var(--card))); }
.dgx-node { border-color:color-mix(in srgb, var(--accent) 42%, var(--line)); }
.dgx-node.sel { box-shadow:0 0 0 2px ${RING}, 0 12px 30px -10px rgba(0,0,0,.66); }
.dgx-node.tappable { cursor:pointer; }
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
.dgx-hd { position:absolute; top:0; left:0; right:0; display:flex; align-items:center; gap:7px;
  padding:7px 10px; box-sizing:border-box; border-bottom:1px solid #2f2f36; border-radius:11px 11px 0 0;
  background:linear-gradient(180deg,rgba(255,255,255,.015),transparent); }
/* GRAB — the header moves the card, where the host allows it (the pin gesture). */
.dgx-hd.grab { cursor:grab; }
.dgx-hd.grab:active { cursor:grabbing; }
/* The content area below the header: "No Options" or why there are none, a sink's OUT mark, or a widget grid. */
.dgx-empty { position:absolute; top:38px; left:0; right:0; bottom:0;
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
.dgx-nms { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; }
.dgx-nms .dgx-nm { flex:none; line-height:14px; }
.dgx-nodenm { font:9.5px ui-monospace,monospace; line-height:10px; color:var(--faint);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
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
/* A load problem the ENGINE reported for this plugin, on the free corner, with the message as its tooltip. */
.dgx-wbtn { position:absolute; top:-8px; left:-8px; z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:help; color:#0d0d0f; background:#f59e0b; border:1px solid #f59e0b;
  box-shadow:0 1px 4px rgba(0,0,0,.45); font:bold 11px/1 ui-sans-serif,system-ui; }
/* FROZEN — baked into a render, cold blue, on the bottom-left corner since the warning badge holds the top-left. */
.dgx-fbtn { position:absolute; bottom:-8px; left:-8px; z-index:2;
  width:17px; height:17px; border-radius:50%; display:grid; place-items:center;
  cursor:help; color:#0d0d0f; background:#7dd3fc; border:1px solid #7dd3fc;
  box-shadow:0 1px 4px rgba(0,0,0,.45); }
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
/* The universal bypass mark: a circle broken at the top by a vertical stroke. */
.dgx-bbtn i { width:7px; height:7px; border:1.4px solid currentColor; border-radius:50%;
  position:relative; }
.dgx-bbtn i::after { content:""; position:absolute; left:50%; top:-3px;
  width:1.4px; height:5px; background:currentColor; transform:translateX(-50%); }
/* A long name stops short of the bubbles, driven by the --corners count they are placed from. */
.dgx-hd { padding-right:calc(10px + max(0px, (var(--corners,0) * 12px) + 2px)); }
.dgx-pbtn i { width:9px; height:1.4px; background:currentColor; box-shadow:0 3px currentColor,0 -3px currentColor; }
/* Alternatives — the module's other attribute sets, lit when a set other than its own is on. */
.dgx-abtn.on { color:#0d0d0f; background:var(--sand); border-color:var(--sand); }
.dgx-abtn i { width:3px; height:3px; border-radius:50%; background:currentColor;
  box-shadow:0 -4px currentColor, 0 4px currentColor; }

/* A PORT: a socket in a plate stepped off the card's edge, flat side against it; see docs/nodeCard.md. */
.dgx-port { position:absolute; display:grid; place-items:center;
  width:17px; height:${PORT_PLATE}px; box-sizing:border-box;
  background:linear-gradient(#2a2930,#141419); border:1px solid var(--line);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05); transform:translateX(-50%); }
.dgx-port.in  { top:-${PORT_PLATE}px;    border-bottom-width:0; border-radius:4px 4px 0 0; }
.dgx-port.out { bottom:-${PORT_PLATE}px; border-top-width:0;    border-radius:0 0 4px 4px; }
/* An EVENT socket sits on a SIDE edge, where signal never goes, and is the only one that says its name. */
.dgx-port.ev { width:${PORT_PLATE}px; height:17px; transform:translateY(-50%); }
.dgx-port.ev.evout { right:-${PORT_PLATE}px; left:auto; border-left-width:0;  border-radius:0 4px 4px 0; }
.dgx-port.ev.evin  { left:-${PORT_PLATE}px;             border-right-width:0; border-radius:4px 0 0 4px; }
/* The name, outside the plate and clear of the card. 6px like every other caption here. */
.dgx-evlab { position:absolute; font-size:6px; text-transform:uppercase; letter-spacing:.09em;
  color:var(--dim); white-space:nowrap; transform:translateY(-50%); pointer-events:none; }
.dgx-evlab.evout { left:calc(100% + ${PORT_PLATE + 3}px); }
.dgx-evlab.evin  { right:calc(100% + ${PORT_PLATE + 3}px); }
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
.dgx-w.drag { cursor:ns-resize; }
.dgx-w.tap { cursor:pointer; }
/* A caption BESIDE its select, in the flow at full width, both min-width:0; see docs/widgets.md. */
.dgx-selrow { display:flex; align-items:center; gap:4px; width:100%; min-width:0; }
.dgx-selrow .dgx-wlab { margin-top:0; flex:none; min-width:0; overflow:hidden;
  text-overflow:ellipsis; }
.dgx-selrow .dgx-sel { flex:1; min-width:0; }
/* A widget offering to take a curve's cable: the whole box lights, because a hairline on a 21px knob cannot be aimed at. */
.dgx-land { cursor:copy; border-radius:4px; outline:1.5px solid ${MAUVE};
  background:color-mix(in srgb,${MAUVE} 18%,transparent); }
.dgx-wlab.top { position:absolute; top:1px; left:2px; right:2px; margin-top:0;
  overflow:hidden; text-overflow:ellipsis;
  /* Centred by text-align: out of the flow, this span is not a child .dgx-w can centre. */
  text-align:center; }
/* 6px, down from 8: a caption names a control that is already drawn, so it can be the smallest thing here. */
.dgx-wlab { font-size:6px; text-transform:uppercase; letter-spacing:.09em; color:var(--dim);
  margin-top:1px; white-space:nowrap; }
.dgx-wval { font:10px ui-monospace,monospace; color:#e7e6ea; font-variant-numeric:tabular-nums; }
/* A 'label' widget's own text — a heading over a group, not a reading, and 8px since it left .dgx-wval's 10. */
.dgx-wtext { font:8px ui-monospace,monospace; color:#e7e6ea; }
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
.dgx-num { min-width:26px; padding:2px 4px; border-radius:3px; border:1px solid var(--line);
  font:10px ui-monospace,monospace; color:#e7e6ea; }
.dgx-num.unknown { color:var(--dim); }
/* Fills the box its colSpan gave it: content-sized, a panel of dropdowns drew a ragged column. */
.dgx-sel { width:100%; max-width:100%; font:9px ui-monospace,monospace; color:#e7e6ea;
  background:#08080b; border:1px solid #2c2c33; border-radius:4px; padding:1px 2px;
  cursor:pointer; }
.dgx-sel:disabled { cursor:default; opacity:.5; }
.dgx-sel.unknown { color:var(--faint); }
/* The FILE picker fills its colSpan too, and ellipsises: a NAM pack's names run to a sentence. */
.dgx-file { width:100%; padding:1px 5px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; }
.dgx-meter { width:80%; height:5px; border-radius:3px; background:#08080b; border:1px solid #212129; }

.dgx-out { position:absolute; top:38px; left:0; right:0; bottom:0; display:grid; place-items:center; }
.dgx-out b { font:600 20px ui-monospace,monospace; letter-spacing:.04em; color:var(--sand); line-height:1; }
.dgx-out span { font-size:8.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--faint); }
/* The audition button lives here, not in a host's CSS: this sheet is INJECTED (see useCss). */
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
