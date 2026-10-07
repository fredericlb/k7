# The card a node draws — its header, its corner, its flags, its LODs

`DomChains.tsx`'s `NodeInner` is one component drawing every kind of node, and the branches it
takes are all decisions someone made once. This page holds the reasons; the file holds one line
each.

## Two names: one drawn, one on hover

A node and its module are two different things — `sy_jun-chorus` is one use of
`@st0/audio/modulation/chorus-ense`. A header saying only the node's name makes seventeen uses of
one mixer read as seventeen unrelated cards.

So the header wears the MODULE — the last segment of its ref, which is its file name — or the
node's own name when there is no second one. When the two differ, the node's name is the first line's
TOOLTIP: hovering the module's line answers WHICH use this is. It has no line of its own, because the
second line holds the engine-and-preset dropdown, a control used far more often than a name that
is read once. The name's own tooltip holds both, the ref and the node. The far LOD says the module too: at that
zoom the card IS one word, and the useful one is what the node is rather than which copy of it. Two
LODs answering differently would be two cards.

**A curve card draws the curve editor's picture, and only that**: the same samples, split the same way
(`previewParts`, `@studio/song-schema`'s `curveMath.ts`, at the editor's resolution), on the same -1..1 frame with 0 dashed and the same beat and bar lines (`previewBeats`), an
endless oscillator's next cycle faded. One function behind both, so a card cannot show a curve the
editor would not. The split puts an exact sample on the boundary between the solid cycle
and the faded rest, in both: split by filtering samples instead, a drop that falls between two of them
— a saw's, at every cycle's end — belongs to neither line and is not drawn. The card has NO header: the picture is the whole card and says nothing in words —
its kind is what the picture shows, and its name is the card's tooltip. The header's two gestures
move onto the picture, so the card still drags (the pin) and a double-click still frames it. Its SVG stretches to the box
(`preserveAspectRatio="none"`) with `non-scaling-stroke`, so the lines keep their width whatever the
card's proportions. Its bar lines and its playhead read the song's clock from the host (`SongClockProvider`,
docs/hosting.md), 4/4 and no playhead without one.

**While the transport plays, a card draws a playhead**: a line where the song is on its picture and a
dot on the value the curve has there (`previewPlayhead`). An endless oscillator's picture is one
cycle, so the song folds into it — its phase is the song's, counted from bar 1 — and a finite curve
holds at its end once past it. It is the picture's arithmetic and not the engine's: a curve under
conditions is drawn as if it ran always, and an envelope, which has no song time, draws none. The
position is the engine's frame (~20 Hz), subscribed by the picture alone, so a frame re-renders that
SVG and never the graph.

**The far LOD draws no curve card**, and no cable into or out of one (`withoutCurves`, in
`@studio/ui-chains`' `curvePlacement.ts`). A binding is a detail of the knob it moves, and at that zoom
the knobs are gone: what is left is the signal path, which a mauve card per binding would crowd. The
cards are dropped AFTER the layout, so zooming changes what is drawn and never where anything sits.

The stack lives inside `UI_HEADER` (38 px), which the layout and the hit areas share, and the header
is that height ALWAYS — `height:UI_HEADER` in the CSS, not its content's height. A card with one name
then has the same header as a card with two: a row of cards reads as one band of headers rather than
a skyline, and the widget grid, placed at `UI_CONTENT_TOP` by the layout, starts the same 4 px under
the header's rule on every card. Both line-heights are stated rather than inherited for the same reason: a header that
grew would put every widget grid under its own card's chrome.

The card is SQUARE-cornered, and so are its header and an open box's frame: a card is a
panel in a rack, and the cables meeting its edges read as plugged into a face, not into a pebble.

### The node's icon leads the header, and on a module it is the on/off

The header's LEFT column (`.dgx-hdlead`, `BYPASS_W` wide, its whole height, a rule between it and the
name) holds the node's ICON — its module glyph, or a lane's track icon. On a live module that icon IS
the bypass: clicking it switches the module off and on, and it takes the switch's colours — dim, lit on
hover, amber when bypassed. The first thing a hand reaches for on a module is in the place the eye
starts reading, and the mark that says what the card is says whether it runs, rather than a generic
power glyph saying only the latter. A baked module has nothing behind it to bypass, so its icon there
is just an icon; so is a lane's, and a strip's, which wears its lane's face. The name's row then leads
with the name. `headerNameW` counts the column: it and the gap after it (`BYPASS_GAP`) replace the
header's left padding. A card with no column — a sink — leads its name's row with its glyph instead.
`min-width:0` on the row is what makes an ellipsis inside a flex row work at all — the same reason it
appears on the track's input label.

### The header is a COLUMN, and only its top row makes way for the bubbles

`.dgx-hd` stacks two things: `.dgx-hdtop`, a row carrying the glyph, the module's name and whatever
stands beside them, and `.dgx-hdsub` under it — the engine-and-preset dropdown. Two consequences, both of them the point:

- **the glyph leads the module's name and nothing else.** Centred against the whole two-line block
  it belongs to neither line, and reads as an ornament of the card rather than of the name;
- **neither line makes way for the corner bubbles.** They are `position:absolute; top:-8px;
  right:-8px`: 17 px discs hung on the card's top-right CORNER, half of each one outside it, so
  about two pixels of overlap at the very top of the glyphs. Reserving header width against them
  takes a quarter of a narrow card, so a name ellipses with a visibly empty gap before the buttons
  and reads as far longer than it is. A name is cut by the CARD's width and by nothing else.

## A lane's FADER wears that lane's face

A strip is what a track's level became, so the node that carries it reads as the track: the lane's
instrument glyph, and the lane's name on the first line. Otherwise every song's mixer row is a wall
of cards all called `Mixer`, and which lane each belongs to is learnable only by following a cable.

**The node is not renamed.** `label` and `module` stay what they were, or every verb aimed at that
node would miss; only the FACE changes. `trackFace` is the lane, and it is the one field that says so.

The name is spelt **without the lane's instrument code**: `ge.rythm-machine` reads `rythm-machine`,
because the glyph beside it is what that `ge.` was for and saying it twice costs a third of a narrow
card. The TRACK node keeps its full id — it IS addressed by that string, and a lane whose card and
whose commands disagree about its name is worse than a repeated prefix.

Which codes exist is `@studio/song-schema`'s table, and drawing a graph must not drag that in — so
`trackLabel` arrives through `ChainsIcons`, beside `TrackIcon`, for the reason `chainsIcons.tsx`
gives for the glyph itself. Same table on both sides: the prefix the icon is picked from is the
prefix the name drops, so one cannot change without the other. It is optional, and a host supplying
none gets the full name.

Where it comes from is worth knowing, because it cannot come from the graph: `graph.yaml` says what
a module is wired to, never what plugin it turns out to be, and a strip is defined by its TYPE
(`Mixer`). So `trackMixersOf` reads it off the compiled project and hands it to `buildGraphDoc`,
exactly as the clip extents are handed in. The document keys it by track, like `trackColors` and
every other per-lane map; `buildGraph` inverts it once, since a node asks the other way.

## The header's arithmetic is repeated, not measured

The name is SIZED to fit rather than ellipsed, because a card is only as wide as its panel's grid
and at a fixed 12.5 px seventeen identically-shaped mixers all read `vo_j…`. The `title` stays
anyway: the fit is floored, so a long enough name is still cut.

`headerNameW` is the top row's own numbers written out again: 10 px of padding each side, a 7 px
gap, a 13 px glyph or an 8 px dot leading the name, and the tags beside it on a card with no bottom bar. It
sizes the MODULE's line alone — the node's name below it is ellipsed, having a whole card's width to
run in. The layout is flex, so the real figure only exists after a reflow, which is exactly what a
per-card measurement would cost. If the CSS moves, this moves with it.

## The header's two lines: the module on the first, the engine on the second

The top line is the MODULE's name, and nothing else on a module card: its TAGS (the engine's `!` when
the plugin failed to load, first because a fault outranks a state; the snowflake when it is frozen)
and its cost are in the bottom bar's centre. A card with no bottom bar — a strip — keeps them beside
its name, each a set width (`FREEZE_TAG_W` for both discs) counted in the width `headerNameW` leaves
the name, and the cost on the header's bottom border. The second line is what the ENGINE does with the node — ONE dropdown (`PresetButton`) saying what it
runs as (`packages/song/docs/engines.md`) and with which preset, opening one list the host draws: the
presets, and a left bar of the engines when there is a choice. Two dropdowns side by side were two
places to look for "how is this module set up", and the engine bar beside the presets keeps the pick
and what it changes in one popup. The button is SET-width, never left to the browser:
`presetButtonW`, the preset's room plus the longest engine name's when there are engines.

## Header text is capped on SCREEN

Everything a header writes — the name, the sub-name, an input's label, the engine-and-preset
dropdown — and the alternative badges in the bottom bar are drawn at most `HEADER_TEXT_MAX_PX` (16 px) tall on screen,
whatever the camera's zoom. A graph that fits a row to a pane's height zooms in a long way, and
header text scaled with it reads as a shout over the controls it names. Sizes are world units under
a CSS transform, so the cap is the zoom's inverse: `applyCam` writes it to the world as `--dgx-k`,
and each header text takes `min(its own size, 16px / --dgx-k)`. The boxes keep their size; only the
text inside them shrinks, so nothing reflows around it.

## A tabbed panel's column

A panel with two or more tabs (`packages/ui-module-builder/docs/pages.md`) draws them as a column
down the card's LEFT, under the header — `TAB_COL_W` wide, one `TAB_H` row per name, the open one lit
by a sand rule on its left edge. The card is widened by the column rather than the grid narrowed,
and `widgetRect` takes the column's width as its left offset, so a tab's widgets sit exactly where
the builder's grid shows them. A card is at least tall enough to list every tab: a twelve-tab panel
on a short grid grows rather than cutting its last names.

The open tab is the card's own STATE, not a field of the document: which page shows is a view, and
two cards of the same module may show different ones. What the grid draws is the shared `widgets`
and then the open tab's. Every lookup BY BIND — MIDI control, the automation arrow, a picker's
library choices — walks every tab through `panelWidgets` (`@studio/graph-model/panel`), since a knob
on a closed tab is still the module's.

A single tab draws no column: one tab is no tab, and the builder never writes one.

## One corner list

`cornerButtons` says which bubbles a node shows and, through `--slot`, where each one sits. That is
all it says: the discs hang off the corner rather than standing in the text, so there is no width to
give up. One list, read by the buttons themselves, which cannot disagree with anything.

A BAKED module gets no `plugin` bubble, there being no live plugin behind it for the engine to open
a window on — and, for the same reason, no on/off block in its header. Its freeze is undone from the right-click menu, where
`node freeze` sits like every other node verb.

## The alternatives are badges, not a bubble

A module's attribute sets (`packages/song/docs/alternatives.md`) are drawn as a row of badges at the
right of the card's bottom bar: one per set, the one playing lit, and a `+` last. Out of the header,
they take no width from the name. They
are not in `cornerButtons`, because they are not one control each module might have — they are a
list whose length is the module's. A menu hid the one fact worth seeing at a glance, that this node
has variants and which one is on; a badge per set says it without a click, and switching is one
click instead of two.

A clicked badge lights AT ONCE, before the command's reply: the graph that proves it can be the
better part of a second behind, and a badge that stays dark reads as a click that missed. The
guess gives way to whatever the next graph says, and gives up on its own after a few seconds,
since a refused switch sends no graph that would correct it. The `+` greys out the same way until
the new set's badge arrives.

The `+` always DUPLICATES the set that is on (`node alternative copy`), never starts an empty one:
the reason to add a set is to try a change against what you are hearing, and a copy is that.

A module with only its own settings still gets the `+`, since a second set has to start somewhere
and that somewhere is the node — but only while the card is hovered or selected, or every card in
the graph would wear one. Its slot is kept while it is hidden, so hovering a card does not shift
anything. A note draws none: it returns before the card that carries them.

### Where a bubble sits

A bubble STRADDLES the node's corner — half on the card, half off it — so it reads as attached to
the module without belonging to its title strip. The 8 px overhang is safe: dagre keeps nodes 40 px
apart (`nodesep`) and ranks 100 px, and nothing between the card and `.dgx` (the pane) clips.
`z-index` lifts it over the card's own shadow.

Every bubble is the same disc; what differs is the SLOT it takes, counted from the corner leftwards
(`--slot`, 17 px wide plus 3 px of air). One rule rather than a `.paired` variant per pair: there
are two of them — plugin UI and an assembly's open — and a variant per combination is where a third
would go wrong.

## The bottom bar: the stage on the left, the badges centred, the alternatives on the right

A module card ends in a BAR (`.dgx-foot`, `FOOTER_H` tall, which `nodeSize` adds under the panel so
it covers none of it). A strip draws none: it has neither a stage nor attribute sets.

Its LEFT holds the engine's stage (`engine/st0-engine/docs/mix.md`) — the up to three values the engine
wraps a plugin in, carried on the step as `stage` (`packages/song/src/ownMix.ts`) — as small knobs
(`FOOT_KNOB_PX`) in signal order: IN, MIX, OUT, each only when the stage has it, its name the tooltip.
They are ordinary widgets (a drag, a typed value, a MIDI map). Its CENTRE holds the node's badges —
the engine's `!`, the snowflake when it is frozen or frozen automatically, and what the plugin costs —
centred on the CARD, the bar being three columns whose outer two share alike. Its RIGHT holds the
alternatives' badges. Both kinds are about running THIS module rather than about its panel, which is why they share
a bar of their own rather than a corner of the grid.

The bar sits above the seams' layer, so a seam's hover band, which runs the cards' whole height,
never covers its controls.

## What a plugin costs, in a badge

A card whose plugin costs something says so in a small badge: `3%`, or `3% · 45 MB` for one of our
plugins holding a big buffer. On a module card it is one of the bottom bar's centred badges; on a card
with no bar it sits ON the header's bottom border at the right, absolute, so it takes no width from
the name, which is already sized to the last pixel. The figures
are the engine's (`engine/st0-engine/docs/load.md`), shaped in `src/nodeLoad.ts`:

- **Silent under 1 % and under 1 MB.** Most nodes cost nearly nothing, and a graph where every card
  says "0%" teaches the eye to skip the one that says 40.
- **Whole percents**, so the badge is a string that changes only when the figure does: each card
  subscribes to its own plugin's entry, and a frame that rounds the same re-renders nothing.
- **The tooltip says what the figure is**: audio-thread share of each block, and the memory the
  plugin holds — or that it reports none, since an external plugin cannot, and a missing figure must
  not read as zero.

## A flagged node has TWO colours, not one

A plugin the engine could load but WON'T (`not_supported`) is **amber**; everything it cannot find
at all is **red**. That is what `graphFlags.md` says and what the card draws: `notSupported` is its
own class rather than folded into `red`, so `.k-unsupported`, `.dgx-nm.unsupported`,
`.dgx-sub.unsupported` and `.dgx-far.unsupported` are reachable. Folding them makes a
not-supported plugin draw a red card, contradicting its own flag line and this package's promise of
"an unsupported plugin amber" (`docs/hosting.md`).

## Where signal enters and leaves: an orange ground

`IN` and `OUT` are not processing steps, they are the graph's **edges** — one is a socket on the
interface, the other the machine's output. Nothing distinguished them from the modules in between,
while an eye looking for "where does it come in" looks for them first. So they take a slightly
orange background (`EDGE`, the orange the audio cable already carries: it is what an edge
transports).

**The ground, and not the border.** The border already says something else — amber for a refused
plugin, red for a missing one (section above). One more orange outline would read as a fault, and
that is exactly the misreading to avoid on the two nodes you look at first.

Two marks, because the two edges do not look alike in the model:

| edge | what is tested | why |
|---|---|---|
| an output | `kind === "sink"` | `MIX`, `OUT`, `RENDER`, `VIDEO_OUT` have no folder, they are already of that kind |
| an input | `monitor !== undefined` | `graphDoc.ts` sets that field **only** when `io === "in"`, so its presence IS the question |

The second is worth saying: testing `monitor` to know whether a node is an input looks like a
shortcut and is not — it is the only field the web model carries for that reason. If some other
kind of module ever gains one, this will need an explicit mark.

**A frozen node stays frosted.** `.frozen` sets its `background-image` further down the sheet and so
wins over this ground: a state beats an identity, which is the right order — knowing an edge is in a
render matters more than recognising it as an edge.

**An automatically frozen node is frosted too, and gives way.** `n.autoFrozen` (a VST's automatic
render, `packages/song/docs/autoFreeze.md`) takes the same wash and snowflake, but where `frozen`
refuses a drag and hides the plugin bubble and the on/off block, `autoFrozen` keeps them: a drag or the
plugin bubble first calls the host's `onThawAutoFreeze` with the VST the render was taken at, so the
edit reaches a live plugin.

## A note is drawn before the LOD branch

Every other card drops to its name when the camera pulls back, because widgets stop being readable
and the name is what is left. A note has no widgets and its text IS the card, so shrinking it to
the node's filename would replace the only thing worth reading with the one thing that is not.

No jacks are drawn on it either: a note takes one input and gives nothing back, and a socket on a
comment invites a wire out of it. The cable INTO it is the ordinary one — that is what says which
part of the chain the note is about. See `@studio/song`'s `docs/docModules.md`.

## The sockets on a card's edge

A PORT is a socket in a little plate stepped off the card's edge. The plate is what makes it read
as hardware: a bare dot on a border reads as a bullet, and a node with three of them reads as a
list. It sits OUTSIDE the card so it never competes with the widget grid. The bore is coloured by
what the port carries, so a socket matches the cable that belongs in it.

An EVENT socket is a plate on a SIDE edge, where signal never goes — inputs and outputs run along the
top and bottom, so the two can never be confused. What a module announces is on its LEFT edge,
aligned at the bottom, one above the next (`eventOutBottom`, in px from the corner); a curve's event
input is halfway down its own left edge. It is the only socket that says its name, beside it — an
event is announced, and "note-on" is the whole of what the announcement means.

Three states, and they say three different things:

- **FREE** — nothing wired to it. An invitation rather than a connection, so the plate recedes and
  the bore loses its ring: the eye finds the sockets carrying signal first.
- **PLUG** — a free socket the patch gesture can use right now. Only a host that passes `onConnect`
  arms this, so a read-only graph keeps its inert sockets.
- **The cable in hand** is dashed and coloured by its signal, its far end pinned to the cursor — a
  promise of a cable, not yet one, which is what the dashes say.

## A lane's clips

`ClipList` is its own component because the hover link between its two halves needs STATE, and the
node around it is memoised so that a pan or a meter frame re-renders no card at all — a
`useState` up there would hand every track node a reason to re-render that has nothing to
do with the graph.

The list is drawn only on a track, only when it holds something, and only once the widgets are
legible: at far zoom the card is its name, and a list of clip refs would be a grey smear. The count
line replaces the tail rather than extending it.

The mini timeline draws EVERY clip; the list below shows `CLIP_LIST_MAX` of them. Hovering a marker
bolds its name below when that name is on screen: the timeline says WHERE, the list says WHAT.

The strip is WHITE in both themes deliberately: it stands for the song itself rather than for more
of the card's chrome, so the blocks on it read as material on tape. A block's colour is the TRACK's,
which is what tells two lanes apart at a glance; a lane that authors none falls back to the node's
accent, and a missing clip overrides both and is red — absent material is never painted in the
reassuring colour of the lane it is missing from, which is the one state this list exists to catch.

## The fader's VU

`FaderMeter` shows the same signal, range and colours as a Mix-panel strip, because it IS the same
strip: a mixer module sits on a track's chain, and the fader on it is that track's level.

It is its own component with its own subscription, exactly like `InputMeterBar` — the level
arrives every frame and it has to move a 9 px bar rather than re-render the graph. A chain that is
not a track draws nothing at all (a bus is fed by several, so there is no one level to show), so
the fader keeps its full width instead of reserving space for a dead bar.

`flex:1` plus `min-height:0` on `.dgx-fader` is the whole feature of the throw: it eats whatever
vertical space the widget's `rowSpan` gives it, so a `rowSpan` of 6 is a real 6-cell throw rather
than a slider stood on its end.

The VU's RAMP is on the box and a shade masks it from the top, so the colour is decided by the
level; painting it on the fill instead would squeeze the whole ramp into whatever height the bar
happened to have, and a quiet track would read red. The shade carries **no transition**: levels
arrive every 50 ms, so a 60 ms ease is restarted before it ever finishes — the bar never reaches
its own value and trails a frame behind for ever. A height cannot run on the compositor either,
so each restart costs a restyle, a reflow and a display-list entry. See
`@studio/engine-browser`'s docs/meters.md.
