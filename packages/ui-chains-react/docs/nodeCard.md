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
second line holds the engine's stage, which is a control and is used far more often than a name that
is read once. The name's own tooltip holds both, the ref and the node. The far LOD says the module too: at that
zoom the card IS one word, and the useful one is what the node is rather than which copy of it. Two
LODs answering differently would be two cards.

The stack lives inside `UI_HEADER` (38 px), which the layout and the hit areas share, and the header
is that height ALWAYS — `height:UI_HEADER` in the CSS, not its content's height. A card with one name
then has the same header as a card with two: a row of cards reads as one band of headers rather than
a skyline, and the widget grid, placed at `UI_CONTENT_TOP` by the layout, starts the same 4 px under
the header's rule on every card. Both line-heights are stated rather than inherited for the same reason: a header that
grew would put every widget grid under its own card's chrome.

The card is SQUARE-cornered, and so are its header and an open box's frame: a card is a
panel in a rack, and the cables meeting its edges read as plugged into a face, not into a pebble.

### On/off leads the header

A live module's bypass is a block at the header's LEFT edge, its full height, before the glyph —
`.dgx-byp`, `BYPASS_W` wide, a rule between it and the name. It is the first control a hand reaches
for on a module, so it sits where the eye starts reading the card, and as a block the height of the
header it is a target rather than a 17 px disc on a corner. Lit amber when the module is bypassed.
`headerNameW` counts it: the block and the gap after it (`BYPASS_GAP`) replace the header's left
padding. A baked module, a track and a sink draw none — there is nothing behind them to bypass. `min-width:0` on the row is what makes an ellipsis inside a flex row work at
all — the same reason it appears on the track's input label.

### The header is a COLUMN, and only its top row makes way for the bubbles

`.dgx-hd` stacks two things: `.dgx-hdtop`, a row carrying the glyph, the module's name and whatever
stands beside them, and `.dgx-hdsub` under it — the engine's stage and the engine select. Two consequences, both of them the point:

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
gap, a 13 px glyph or an 8 px dot leading the name, and the engine select when there is one. It
sizes the MODULE's line alone — the node's name below it is ellipsed, having a whole card's width to
run in. The layout is flex, so the real figure only exists after a reflow, which is exactly what a
per-card measurement would cost. If the CSS moves, this moves with it.

## The header's two lines: alternatives on the first, the engine on the second

The top line is the MODULE — its name, then its TAGS (the engine's `!` when the plugin failed to
load, first because a fault outranks a state; the snowflake when it is frozen), then at the right end the alternatives' badges, which are ways of playing that
module. The tags are states of the module, so they read beside its name; on a corner of the card a
tag would hang outside it and collide with whatever dagre puts next to it. Each has a set width
(`FREEZE_TAG_W` for both discs), counted with the badges in the width `headerNameW` leaves the name. The second line is what the ENGINE does with the node — its stage, IN / MIX /
OUT, and at the right end the engine select (`packages/song/docs/engines.md`), which says what it runs
as. Each control sits on the line whose subject it qualifies, and the header, being a fixed two lines,
has room for both without growing.

Both are SET-width, never left to the browser: `altBadgeW` per badge (5.5 px a character plus
padding, 15 to 80 px) and `engineSelectW` for the select (capped at 84 px). The badges share the
top line with the name, so `headerNameW` subtracts their row — badges, gaps and the `+` — and the
name's fitted size is computed against the width they actually take; a row sized by its content
would only know that width after a reflow. The select shares the second line with the stage sliders,
which share out what it leaves, and need no figure of their own.

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

A module's attribute sets (`packages/song/docs/alternatives.md`) are drawn as a row of badges at
the right end of the header's top line: one per set, the one playing lit, and a `+` last. They
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
the graph would wear one. Its slot is kept while it is hidden, so hovering a card does not shift its
name. A note draws none: it returns before the card that carries them.

### Where a bubble sits

A bubble STRADDLES the node's corner — half on the card, half off it — so it reads as attached to
the module without belonging to its title strip. The 8 px overhang is safe: dagre keeps nodes 40 px
apart (`nodesep`) and ranks 100 px, and nothing between the card and `.dgx` (the pane) clips.
`z-index` lifts it over the card's own shadow.

Every bubble is the same disc; what differs is the SLOT it takes, counted from the corner leftwards
(`--slot`, 17 px wide plus 3 px of air). One rule rather than a `.paired` variant per pair: there
are two of them — plugin UI and an assembly's open — and a variant per combination is where a third
would go wrong.

## The engine's stage, on the header's second line

A module whose plugin the engine wraps in its own stage (`engine/st0-engine/docs/mix.md`) gets one
slider per value the stage takes — `in` (`@input-volume`), `mix` (`@mix`), `out` (`@output-volume`) —
always in that order, only those that apply. WHICH apply is the compile's own test, carried on the
step as `stage` (`packages/song/src/ownMix.ts`), so the card shows exactly what the engine does to the
module.

They sit on the header's SECOND line, side by side, sharing what the engine select leaves. The header
is a fixed two lines whatever it holds, so they cost the card no height; the panel keeps the whole of
its grid, and the tab column is the tabs' alone. A card with a stage is at least wide enough for a
`STAGE_SLOT_W` slot per slider after the header's lead (`nodeSize`), so three of them never crush to
nothing on a narrow panel.

It is not part of `ui.yaml` and nothing edits it: every module has the same three in the same place,
which is the point — a panel author, a person or AI organize, places the plugin's controls and never
these. Each is drawn compact: its caption a fixed width anchored left, the bar, the reading a hover
tooltip. The sliders are ordinary widgets on the same live path as `@mix` everywhere else, so a drag,
a typed value and a MIDI map all work on them; a lane has none, its level being its strip's fader.

## What a plugin costs, on the header's border

A card whose plugin costs something says so in a small badge sitting ON the header's bottom border,
at the right: `3%`, or `3% · 45 MB` for one of our plugins holding a big buffer. On the border and
absolute, so it takes no width from the name, which is already sized to the last pixel. The figures
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

An EVENT socket sits on a SIDE edge, where signal never goes: inputs and outputs run down the card,
so left and right are free and the two can never be confused. It is also the only socket that says
its name — an event is announced, and "note-on" is the whole of what the announcement means.

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
