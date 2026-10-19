# Building the chains graph (`graph.ts`)

Turns the compiled `WebGraph` into positioned nodes and edges, mirroring the real signal path: a
chain's input and output map to its first and last module (or to a pass-through node when the chain
has no modules), and that is what `from`/`out` connect to.

The code is deliberately **renderer-agnostic** — plain numbers, no Pixi, no DOM — the seam that lets
dagre own layout and lets the same geometry serve the hit areas and the drawing by construction.

`graph.ts` is the one import site; behind it each stage has a file. `graphNode.ts` holds the shapes,
`geometry.ts` the measurements, `nodeUIs.ts` the built-in cards' panels and `widgetValue.ts` a
widget's value maths. `buildGraph.ts` runs the build: a `Build` (`buildContext.ts`) holds the run's
maps and writers, the steps that add cards are `buildChains.ts`, and the socket and rank passes
close it. `graphLayout.ts` and `moduleRow.ts` place the result. Hosts import `./graph` alone, so
the split stays internal.

## What a node carries from its step

`CARRIED`, `FLAGS` and `Consumed` declare it once instead of copying it. Restating the fields one by
one makes "add a field" three edits in three files, and the third is the one that gets missed: a
field that reaches the browser and stops at the node sends the host re-fetching the whole graph on a
click to read a value already under the mouse, and a field forgotten on the edge copy in `layout` —
`targetPort` — puts every ported cable on the node's edge.

The `_Unplaced` guard underneath makes the three groups cover the type: a new field on
`WebChainStep` stops the build HERE, by name, until it is placed in one of them.

Most carried fields are carried *rather than consumed* because two readers want them: `inputUI`,
`rackUI` and `withFolderOptions` each turn one into a panel, and the renderer needs the raw value
again to know which entry is current or what a tapped pad should sound. `Consumed` is the other
side: `module` becomes the label and the id, `enabled` becomes `bypassed`/`dim`, `emits` decides an
edge's signal, `automations` become nodes of their own, and `bases`/`shaders` become options.

`events` is carried and drawn as labelled sockets up the LEFT edge from its bottom (`eventOutBottom`),
apart from `jacks.in` and `jacks.out`, which run along the top and bottom: those
are the signal path, and an event is not something the chain carries. One list would let a cable be
dragged from a note-on into an audio input — the drawing allowing what the model forbids.

## One track's signal path

`subgraphForTrack` narrows the graph to the chains one track enters plus everything reachable
downstream, and returns a `WebGraph`, so `buildGraph` takes it unchanged. A downstream chain fed by
ANOTHER track would drag that track in, so its `from` is dropped and the chain we pass through is
kept.

`trackModules` adds the ORDER, which a node set does not carry: chain by chain from the track's own,
then step by step inside each, which is the order the song is written in. De-duplicated, because a
module shared between two of the track's chains is one module and drawing it twice would offer two
sets of controls for one thing.

### The lane's mixer is pinned right, with no header

When a row ends on the lane's mixer — the node wearing its `trackFace` — `splitTrailingMixer`
(`anchorRight.ts`) takes it out of the row and hands the host a second graph holding that card
alone, `bare`. The host draws it in a column at the pane's right edge, so the lane's level stays
under the hand however far along the row the view has walked. The card has no header because the
lane's own card already leads the row with that name and glyph, and the header's height goes to the
fader instead.

The mixer graph keeps the row's `height` and `top`, so fitting both to the same pane height gives
them the same scale. Its column then only needs the mixer's aspect ratio to be exactly its width.
That width is the PANEL's: a mixer is an audio effect, so its header carries the engine's three stage
sliders and is widened for them, and a card that hides its header has no use for that width.

The cable into the mixer is dropped rather than drawn. A card pinned to the screen has no fixed
place in the row's world, so a cable to it would have to be rebuilt on every camera frame, for an
arrow the order of the row already says. A bare card therefore carries no socket that a cable
meets: its content is lifted by the header's height in CSS, which `widgetRect` does not know about.

A row that is only the mixer, or that ends on anything else, is left whole.

## Node geometry

A node with no UI is a fixed size; one with a widget grid is sized BY that grid (`nodeSize`), and
dagre is told the real size so it reserves the space and routes edges around it. A size it was not
told is a node its neighbours overlap.

`NODE_W` is the no-panel size only, and **not** a floor under panelled nodes: as a floor it parks
dead space to the right of every grid narrower than it — a 2-column mixer strip is 84px of controls
in a 160px card. A panel says how wide its module is, which is the only thing that knows.
`NODE_MIN_W` is the one floor there is, and it is not aesthetic: below ~72px the header's padding
and kind glyph leave no room for the name at all. The name ellipses at these widths, so it carries a
`title` — on a wall of identically shaped strips, the tooltip is what tells them apart. Every node
renders a header strip plus a content area, so even a module with no UI needs room for its
"No Options" label.

A panel with two or more TABS adds a column at the card's left, `TAB_COL_W` wide, and is at least
`TAB_H` per tab tall so every name is listed (`columnW`). `widgetRect` takes that width as its
`left`, and it is the one input beyond the widget: a tab's widgets are drawn right of the column,
exactly where the builder's grid places them. `ui-chains-react/docs/nodeCard.md` draws the column.

`UI_HEADER` clears the node's name **and** its `sub` line at their existing positions, so the header
is sized for the worst case rather than per node. That is what lets a widget's box depend only on
its own col/row, keeping `widgetRect` a pure function of the widget. The cost is about 12px of
unused strip on a module with no sub line. `CELL` fits a control *and* its caption: a usable knob is
~24px across and the caption needs another ~10.

Rows are `ROW_GAP` apart, columns `COL_GAP`, the first row sits `UI_TOP_GAP` (4 px) under the
header's rule — `UI_CONTENT_TOP` is the two summed, and the CSS places a card's note and OUT mark
there too, so nothing touches the rule — and the last has `UI_EDGE` of air under it. A row of knobs is a control over its caption, and with no air
under the caption it read as the label of the knob BELOW rather than the one above. Columns take
less, a caption being narrower than its cell; what they need it for is GROUPS — two tinted frames
side by side with no gap between them read as one slab rather than two sections. The
header already ends in a border, so a pad above the first row would separate nothing; below the
last, a caption on the card's border reads as cut off, and the edge is wider than a row gap so the
grid ends as a block rather than a row missing.
A widget spanning rows or columns covers the gaps between them (`rowsHeight`, `colsWidth`), so a
fader, a screen or a group is one box, not a stack of cells.

A module card is its panel and, under it, a bottom bar of `FOOTER_H` — the engine stage's knobs and
the alternatives (`packages/ui-chains-react/docs/nodeCard.md`) — which `nodeSize` adds when asked; a
strip has neither, and is its panel alone.

### The header's name has to be readable at that width

`moduleDisplayName` keeps the LAST segment of a module ref — `@k7-core/audio/modulation/chorus-ense` →
`chorus-ense` — because everything before it is where the module is filed, and spending a card's
width on a namespace every neighbour repeats leaves no room for the word that tells them apart. The
whole ref stays as the header's `title`.

`headerFontPx` then shrinks the size to fit. A card is only as wide as its grid: a two-column strip
is 84px, so at a fixed 12.5px seventeen identically-shaped mixers all read `vo_j…`. Estimated from
the glyph count rather than measured — this runs for every node on every layout, and a DOM
measurement per card is a reflow per card. `GLYPH_W` is the average advance of the header's face at
1px, so both its errors beat the fixed size. Never LARGER than `HEADER_MAX_PX`, since this is about
fitting a long name and not blowing up a short one, and floored at `HEADER_MIN_PX`, below which it
is a smudge and an ellipsis is honester.

### A NOTE is sized by its text

A doc module draws its `content` as written, and `noteSize` measures the box dagre has to reserve
for it — a note that overlaps the chain it is about says nothing. Wrapped at `NOTE_MAX_W` rather
than widened without limit: one long paragraph would push every rank of the graph sideways to make
room for prose. The height follows the WRAPPED line count. `noteOf` decides a module IS a note by
asking `WebGraph`'s `modules` map, which is keyed by doc modules and nothing else — no second field,
and no lookup table to keep in step with one.

## Two layouts, and the fold behind them

A panel has two AUTHORED shapes (`packages/ui-module-builder/docs/layouts.md`): itself, the
HORIZONTAL layout, at most 4 rows, and its `vertical` twin, at most 4 columns. `buildGraph`'s
`layout` (and `moduleRow`'s, which passes it on) picks one. `"vertical"` swaps the twin in for the
panel and marks it `tabsAs: "dropdown"`, so its tabs are a menu across the card's top (`menuH`)
rather than a column down its left (`columnW` is then 0). A panel with no twin keeps its own grid,
marked the same way, and the fold below narrows it. k7's per-track view draws horizontal on a
desktop, where the row is read ACROSS, and vertical on a phone, where it is read DOWN. The global
graph draws vertical, folded to 4 columns: its cards sit in ranks that run left to right, so a narrow
card keeps the ranks close and the cables short.

The fold is what serves a panel no one authored a shape for — a workspace module, a VST scanned on
the spot. `buildGraph`'s `fit` holds every card's widget grid to a number of ROWS or of COLUMNS,
never both: one side is the constraint, the other takes what overflows. Held to four rows, a
nine-row panel becomes bands side by side, each as wide as what it holds (`gridFit.ts`). Held to
columns, the bands go below. The per-track view holds 4 rows on a desktop and 4 columns on a phone,
so an authored panel passes through the fold untouched.

- **A band is as wide as what it holds**, not as the grid it came from: the overflow of a 24-column
  panel that is two rows of two knobs is a two-column band. Measured on the controls and screens a
  band places, a frame not counting, and the frame clipped to the band in turn.
- **A card is as wide as its OPEN tab.** Each tab folds on its own, so each has its own width
  (`tabs[].cols`, and `tabW` on the node); sized to the widest, a narrow tab would draw beside a wall
  of empty columns. Which tab is open is then a fact the LAYOUT needs, so a host that folds holds it
  (`TrackModulesPane`'s `openTabs`, handed to `moduleRow` as `tabOf` and to `DomChains`, which
  reports each switch), and the row reflows on a switch. A card no host sizes keeps its own state.
- **A narrow card is as TALL as its open tab.** A vertical layout's pages differ in length — Surge
  XT's run from 11 rows to 28 — and a card as tall as the longest is mostly empty on every other page.
  `buildGraph` gives each tab its height (`tabH`) and `withOpenTabs` sizes the cards to the open one,
  top edge kept. The global graph applies it AFTER its layout, which made room for the longest page:
  a tab switch then moves no card, and the cables follow the bottom edge, since they hang socket to
  socket. `moduleRow` applies it before laying its row.

- **A fold never cuts through a CONTROL.** A band ends at the last line no knob, fader or button
  straddles; a control taller than the cap leaves no such line, and its band runs long rather than
  split it.
- **A frame and a screen do not count.** A `group` is a drawing around a section, so it is cut at
  the band's edge and drawn once per band, the label on the first piece. An `lcdscreen` or a
  `waveform` draws a picture scaled to its box, so it is shortened to end at its band. Counted as
  controls, Surge XT's 6- and 8-row screens and section frames would leave no legal cut in any tab,
  and its 24 × 11 panel would "fit" as 48 × 10 — wider and barely shorter than what it was.
- **Each tab folds on its own**, with the widgets outside the tabs: only one tab is drawn at a
  time, so one tab's cuts need not suit another's — pooled, sixteen tabs left no line free. That
  holds only while the shared widgets land in the same place in every tab's fold, which a header
  on top always does; when they would not, one fold serves every tab, as a shared widget cannot
  be in two places.
- **The card is resized by what its panel changed**, not recomputed, so whatever else made it
  bigger — a lane's clip list — is kept.
- **A strip is never folded.** Its fader is its height, and a fader folded beside itself is no
  longer a strip.
- **The panel is folded where it is drawn**, not in the module's files: the same module is a
  tall card in the full graph and a wide one in the per-track view, and the builder edits the
  grid as written.

## The `sub` line

Only the **shared** case earns one — "this module is in these chains" — a warning that editing it
reaches more than one. It must be computed after the merge: left at whatever the first insertion
computed, it can only ever name the chain that reached the module first, which is not the list it is
meant to show.

A chain's own name does **not** ride its first module: it would say nothing the drawing does not,
since the cable from the track is right there and the name is repeated on the track node.

## Track nodes carry a built-in UI

Their five mixer controls are authored with the same widget primitives a module UI uses. The
`@`-prefixed binds are **track intrinsics**, not plugin params: the renderer routes them to the
mixer commands and reads their live values from the track-controls channel. `@output-volume` is in dB so a
linear knob maps straight onto the fader's range, and it stops at **+6, not +12** — the engine's
track fader clamps there, so a taller knob would promise gain it cannot deliver (see `MAX_GAIN_DB`
in `@studio/song`).

A **video lane** gets one control. For picture, "mute" means hidden, and there is no solo, record
arm, gain or pan to offer — a full strip there would be four controls that do nothing.

## A RACK carries one too — a grid of pads

`rackUI` gives a rack node one button per loaded sound, bound `@rack:<symbol>` — an intrinsic in the
same family as `@mute`, routed by the renderer rather than sent to a plugin param, because a pad
**fires** where every other widget **sets**. Synthesised for the reason `TRACK_UI` is: a rack's
symbols are already known through `extends`, so a `ui.k7x` listing them would be two lists kept in
step.

**A rack is drawn by OCTAVE: a tab per octave, each a 4×3 grid of its twelve notes.** A pad sits at
its note, the lowest at the bottom left as on a pad controller, so a kit reads the same on the card
as on the hardware it is played from, and a note's place never moves when another pad is added. The
octaves drawn are those holding a sound, and for a rack that takes new pads the one above its highest
too. An empty cell there is an add tap on ITS note (`@rack+<note>`, the `node tap at` command), so a
pad is put where it will be played rather than after the highest note. One octave is one page and
draws no tab column. An SFZ kit draws no empty cells, since its pads are the kit's. It adds a row under
each pad for that pad's gain, and a column on the right for the kit's level, on every tab.

`rackGrid`, the square-ish grid of at least 2×2 and at most four wide, is what an ASSEMBLY's
boxes are laid out on (`src/assembly.ts`): those have no notes to place them by.

**A pad draws bare.** The widget still carries the symbol as its `label`, which is what a tooltip
and a right-click name it by, but `DomChains` prints it for every button *except* a pad: sixteen
three-letter words in a card this size is a wall of text where a drum machine's face should be.

An **authored** panel wins over all of this: a rack with a hand-made panel has said what it wants
its node to show, and a grid of pads bolted underneath would be the app overruling the file.

## A live INPUT carries one too, and it must

`inputUI` gives an `io: in` node three dropdowns — its socket, its width, and its monitoring.
Synthesised for the reason `TRACK_UI` and `rackUI` are (these are not the module's opinion but what
it IS), and for a second, harder one: **`@meta/IN` cannot have a `ui.k7x` at all.** A `ui.k7x`
is keyed by a library ref, and there is no `@engine` library — an engine module is a built-in with
no folder anywhere (`@studio/song`'s `uiLibrary.ts` says so outright and `moduleRootFor` throws for
it). Without `inputUI`, every live input in every project draws a card reading **"No Options"**, and
no amount of authoring can fix it.

**Everything is a dropdown, and that is a constraint rather than a taste.** Only a widget carrying
`options` can commit a module field — `setModuleField` in `ui-chains-react`'s `useNodeActions.ts` sends the picked option's
`arg`, so a knob bound to a field draws, drags, and writes nothing. `@gain` is deliberately
**absent** for that reason and only that one: a continuous trim has no options to pick. Not for want
of a verb — `node param <node> @gain <db>` exists — so what a gain knob waits on is a
commit-on-release path for a dragged intrinsic.

**Width is not a field.** Mono and stereo are not two settings — they are how wide *one* setting is,
so the width dropdown binds `@channel` like the socket does and writes the same field one channel
wider or narrower. Both dropdowns therefore send the same line — `node param <node> @channel …` —
and no state can disagree with the file. A pair is even/odd and nothing else, because the interface
groups no other way: the pair containing channel 4 is 3+4, never 4+5.

**The channel list is the machine's**, so it arrives as an argument to `buildGraph` rather than
being invented here — which inputs exist is the sound card's to say, and it differs between the
machine that wrote the song and the machine playing it. With none, the list is empty and the other
two still draw.

Each option's **`arg`** is what gets written when it differs from what is shown: the socket reads
"Input 1 + 2" and the file says `1,2`. Everywhere else the word on screen is the word in the file,
and `arg` is absent.

An **authored** panel wins over all of this, exactly as for a rack.

## One function answers "which panel", for the drawing and for the size

`stepUI` picks it: the authored grid if there is one, else a rack's pads, else an input's sockets.
Both readers go through it — the node's `ui` and `nodeSize` — and that is the whole reason it
exists. Take the node's panel from `carryStep` (the step's raw `ui`) and only its SIZE from
`stepUI`, and the one thing `stepUI` does on its own — folding the module's base list into the
authored panel (`withFolderOptions`) — is computed, measured, then dropped: every base dropdown draws
`none` and nothing else, on a panel whose author wrote exactly what the format asks for.

The list cannot live in the `ui.k7x`: which bases exist changes every time somebody snapshots one,
so a panel listing them would be a copy of a directory going stale between saves. The author writes
`bind: @base` and says nothing more; the entries are the folder's, and they arrive on the step. Same
contract as `@channel`, whose sets are the machine's — see `@studio/song`'s `docs/intrinsics.md`.
`@shader` is the same mechanism over a different folder (`docs/shaders.md`), and `withFolderOptions`
serves both from one site.

`none` comes first and always, because a chosen base has to be undoable: without an entry meaning
"back to the module's default" the only way out of a base is editing the file by hand. The `value`
is a position in the list and nothing more — `setModuleField` writes the option's LABEL, which is
the base's name, so adding a base can renumber the list without changing what any entry writes.

## An intrinsic that can be SET must be readable BACK

A module-field dropdown places **no optimistic override** — `setModuleField` sends the command and
stops. The file is the only state, so the select shows what the file says and two answers can never
disagree. The price is that the read-back path is load-bearing, and it fails **silently**: a bind
with no arm in `moduleFieldValue` writes correctly, the file changes, the graph rebuilds, and the
select snaps back to `—`. It reads as "the control is broken" while every part of it works.

That is why the function is its own file — `packages/ui-chains-react/src/moduleField.ts` — with a
case per intrinsic rather than a branch inside the renderer: `@channel` (both dropdowns, matched on
the CHANNELS through `arg`), `@monitor`, `@base`, `@shader`, `@camera`. A dropdown that writes an
intrinsic with no arm in that list is the exact shape the list guards against.

A camera's `""` reads back as **`default`** — the empty string is a lens, the machine's own, and
showing it as nothing would say the node is not a camera. Only an *absent* `camera` means that.

## `source: take` — the same canvas, a different series

A waveform widget normally draws a tap: `input` or `output`, a rolling window the engine captures
through a plugin it inserts for as long as the widget is mounted. `source: take` is the RECORDER
node's own picture — the whole take, growing — and differs in three ways that all follow from that
one:

- **it places no tap.** The recorder is already in the chain; asking for a second plugin to watch it
  would be watching the watcher;
- **it reads `recorders[pluginId]`, not `waveform[pluginId:side]`**, since the take is not a live
  signal and has no side;
- **it accumulates.** Each frame carries only the points made since the last, so `foldTake` keeps
  the total and decides when to drop it (`src/takeEnvelope.ts`).

It is DECIMATED to the canvas width, keeping the extremes: a five-minute take is ~3500 points
against a card's ~120 pixels, and averaging them would draw a quiet take — a waveform's whole job is
the peaks.

## A REHEARSAL moves, and writes nothing

`rehearsal` on `DomChains` says this graph is a card being **tried out** rather than a song being
edited — the module builder's preview is the one that sets it. Two things follow.

**Every widget answers the mouse.** `actuable` normally asks "is there anywhere to send this" —
`pluginWritable`, `trackWritable`, `offlineWritable` — and draws a widget read-only when the answer
is no, which is honest on a real graph. On the builder's card the answer is no until a plugin
happens to be loaded, so the panel being authored would be a picture: no checking that a dropdown
lists the right settings, or that a knob's range runs the right way, which is most of what looking
at the card is for. A rehearsal needs nowhere to send a value because the optimistic override IS the
value. A rack pad is the exception and still asks: it wants a *sound*, and a rehearsal cannot invent
one.

**Nothing is committed.** Both commit paths write into a file through the command line — `node param
<module> <name> <value>` and `node param <module> @<field> <label>` — and in the builder there is no
project node for either to reach, so they would write into somebody else's song or do nothing at
all. Under `rehearsal` both are skipped.

What is NOT skipped is the socket: `setPluginParam` still fires when the host wired it, because the
plugin behind a preview is an orphan instance no project owns. Turning its knobs is how you *hear*
the module, and nothing about that is saved either.

Module fields get one extra thing under rehearsal: an optimistic override. The normal path refuses
optimism on purpose — the engine learns a field by rebuilding, so the reload IS how it takes effect.
In a rehearsal there is no round-trip to guess about, and without the override a dropdown would
open, list its entries, and snap back to what it was.

## …and the clips the lane holds

Under the controls, a track node lists **what is on the lane** — the clip refs, in playing order.
Routing alone says where a track's signal *goes* and never what it *plays*, which makes "which take
is on this lane" a question you have to leave the lane to answer.

Above the list, a **mini timeline** the width of the node: one block per clip, placed where it
starts and as wide as it runs, on **white** — the strip stands for the song itself rather than for
more of the card's chrome, so the blocks read as material on tape. A block takes the **track's own
colour**, which is what tells two lanes apart at a glance; a lane authoring none falls back to the
node's accent. A **missing** clip overrides both and is red: the graph must not paint absent
material in the reassuring colour of the lane it is missing from.

### Where the lengths come from

The routing model does not have them: `loadGraph` reads track files *without opening the clips they
name*, so `Placement` carries a position and no extent (see `@studio/song`). They come from the
**compiled project** — the only thing that resolves a placement into a duration — and the file
service hands them to `buildGraphDoc` rather than compiling again, since the graph is polled and the
workspace already holds that document memoised on the revision.

- a compiled `length` of **0** means "the source's natural length", which neither side knows. The
  file service substitutes **4 beats** — the same stand-in k7's timeline draws for the same case —
  so a clip is not one width on the lane and another on the graph;
- a project that **will not compile** has no extents, and the graph still builds. It loses the
  widths, not the clips: this is the screen you fix a broken project from.

A very short clip is floored at `CLIP_MIN_W`: one bar in a six-minute song is invisible and
impossible to hover, and the timeline is only for finding things.

Its scale is **shared by every lane in the graph** (`clipSpanOf`), not each lane's own extent, and
runs to the **end** of the last clip rather than its start, or the final block — usually the longest
— would hang off the right of every node. A mini timeline is read by comparing lanes; one that
rescaled per track would draw a lane whose last clip is at bar 3 and one whose last is at bar 300
identically, with that clip hard against the right edge — worse than no timeline, because it is
believable. It draws **every** clip while the list shows the first few: a picture with clips missing
from it would say the lane is emptier than it is.

**Hovering a block bolds its row below.** That link ties the two halves together — the timeline says
where, the list says what — and it is why `ClipList` is its own component: it needs state, and the
node around it is memoised so a pan or a meter frame re-renders no card at all. The hovered row also
lifts its opacity, because bold alone reflows the row as the letters widen.

Each row is **the position, then the name** — `5:1  chorus`. Where first, because a lane is read
down its positions and they are what orders the list; a fixed-width column of tabular figures stays
a column however long the names beside it are, and the **name** is what gets ellipsed — a truncated
name still identifies a clip, a truncated timecode says nothing. Rows are separated by a **rule**, a
gap alone leaving the short rows to read as one block of text.

The list comes from `WebGraph.trackClips`, which the file service fills from the compiled track's
`placements` and **sorts by position**: authored order is whatever someone typed, and a track file
may name a clip at bar 9 before one at bar 3.

`tc` is spelled **there**, with `beatsToPosition`, and not in the browser: turning beats into bars
needs the project's meter, and a renderer dividing by four would be right for every song in 4/4 and
wrong for every waltz.

`CLIP_ROW_H` and `CLIP_LIST_PAD` have to track the CSS in `DomChains`: dagre is told the height here
and draws nothing, so a row taller than the constant reserves too little and the last clip spills
out of the card.

Three rules, each paying for itself:

- **A lane with no clips gets nothing** — no empty list, no heading. A node that has grown to say
  "0 clips" has grown to tell you nothing. Groups and strudel lanes hold no placements at all, so
  they never get one either.
- **The height is computed before layout** (`clipsOf`, added to `nodeSize`'s), because dagre is told
  the size and reserves the space. The **width is untouched**: a card is as wide as its mixer grid,
  and a long clip name is ellipsed rather than allowed to push a whole rank sideways.
- **Past `CLIP_LIST_MAX` (6) the rest is counted, not listed** (`+4`). A lane with sixty clips would
  otherwise be a node taller than the window, and this is a picture of the ROUTING.

A **missing** clip is drawn red. It is the state this list is best at catching: on a routing
diagram, a lane pointing at material that is not there looks exactly like a full one.

The list is hidden at far zoom with the widgets, for the same reason they are — at that scale a
column of clip refs is a grey smear.

## Ports

A node's sockets are decided here, not in the renderer: how many show depends on what is wired to
the node, which is a fact about the graph. `jacksFor` is the whole rule and `buildGraph` runs it in a
last pass, once every edge exists — a module is fed from its own chain *and* from whatever routes
into it from elsewhere, and the second kind is only known after every chain has been walked.

Inputs **reveal themselves**. Every mandatory port is drawn from the start: a socket that has to be
fed is a thing to say up front. Past those, exactly one free jack appears beyond the last occupied
port — so a crossfade with its flow wired offers its second input, and a module with four optional
ports and one in use does not present three empty holes to someone using one. One past the *last
occupied* port and not one past the count, or a module fed only on `b` would lose the `a` the reader
is looking for.

### Several cables into a module that declares no port

A module with no `inputs:` has one socket — the one every module has. When five lanes meet there, as
a deck and its four stem cuts do on its EQ (`@studio/song`'s docs/setProject.md), five cables
landing on one point is a knot of wires the eye cannot follow.

So it shows **one socket per bare arriving cable**, spread along its edge as the others are. That is
**drawing and nothing else**: the signal lands on the same input, there are not five inputs. A
module that declares ports is left as it is, and that is not an omission: there the sockets carry
names that mean something, and spreading cables that all aim at the same port across them would be a
lie rather than a convenience.

Each cable keeps its slot (`targetSlot`), assigned in the graph's declaration order. A stable slot
is half the benefit: a picture where cables change hole between renders would be worse than the
knot, since the eye would follow a cable that has moved. The slot rides the edge to both places that
copy it — forgetting it in either puts everyone back on socket 0, which is only visible by eye.

Measured in the `Chains/Ports/ManyIntoOne` bench: node `eqA` shows six sockets at 15, 38, 60, 83,
105 and 128 px from its left edge, and the six cables arrive at six distinct abscissae. Six and not
five — a bus chain starts at its own rendez-vous point, so its lane is a cable too.

Outputs do not reveal themselves: all show at once, because an output is offered rather than
required. Their occupancy is per SOCKET, like the inputs' — the edge carries `sourcePort` and
`link()` keys a cable on the SOCKET rather than the pair, so `deck#cue: [ phones ]` fills the `cue`
socket and leaves the others hollow. Union those destinations onto one node instead and a splitter
feeding one target from two outputs draws a single cable, out of whichever jack was seen first.

Three nodes are special. A **sink** has no output jack: it is where signal stops. A **live input**
is its mirror and has no input jack — nothing plugs into a preamp, and the socket it listens on is a
param picked on its card. `monitor` names one, because the file service sets it for an io `in` step
and nothing else. A **curve** is off the signal path entirely — it drives a knob rather than
plugging in — so it is left out of `jacksFor` (which types a jack by the signal it carries, and a
curve carries none) and the renderer gives it one mauve socket of its own, halfway down its RIGHT
edge in every layout (`curveOutPoint`) — toward the node it sits left of and drives. An **automation** edge
occupies no jack for the same reason; counted as a feeder it would reveal the next free socket for
nothing.

A **track** has an input jack — what a lane PLAYS is its clips, which is no reason nothing can
arrive on it — typed by what the lane puts on the wire, so a midi lane offers a midi socket rather
than the audio an unfed jack falls back to.

And it has **two outputs, `audio` then `midi`** — orange, then blue, left to right. A lane is not
typed by what it carries (`@studio/song`'s docs/trackModules.md): it holds events naming clips and
events naming sequences in one list, and each leaves by the port its own material fits. The list is
`TRACK_OUTPUTS`, in `@studio/graph-model` beside `splitPort` and for the same reason — the compiler
builds the lane module's ports from it and the renderer draws a jack per entry, so the sockets and
the refs cannot come to disagree about how many there are or which is first.

The ORDER is load-bearing twice over. A cable that names no port is the **first** output — that is
what `isFed`'s `i === 0 && fed.has("")` says in the compiler and what `cablePath`'s `: 0` says in
the drawing — and audio is what a bare-wired lane overwhelmingly carries. Swap them and every cable
that names no port lands on the blue socket.

A lane's outputs are also its SENDS, so an output already feeding something grows a free twin beside
it (`spare` in `jacksFor`), or a lane feeding one thing could never feed a second. The twin carries
the **same address** as the cable already on it — unnamed when that cable named no port — so a
second send off a bare-wired lane writes `gtr: [ amp, reverb ]`. Naming it would write `gtr#audio:`
beside `gtr:`, and two keys SPLIT the lane into two engine tracks: a drag for a second send would
quietly re-route the lane's material.

That is also why lifting a cable matches on `port === jack.name` **or** `no port && index 0`: a bare
cable sits on the first socket, which does have a name. Without the second half the cable is drawn
plugged into a jack that will not give it back.

> What may LAND on that socket is narrower than what may be dragged to it: a run carrying a live
> interface input, and nothing else — recording a preamp onto a lane. `graph chain connect` asks the
> same question `packages/song` asks, by walking UPSTREAM of the cable's source (`runCarriesInput`).
> Refusing every track outright would be stricter than the model it guards and leave an `IN` node in
> the graph with nowhere to go; and since the derivation splits `mic → comp` into two chains,
> reading either one's steps would answer no for every recording path with a plugin on it.

A destination naming a **track** lands on the track node itself rather than on the first module of
that track's chain: that is where a live input's signal actually arrives, ahead of the lane's
modules, and it is what `IN:in-2: [ ge.rythm ]` says. Checked before `isChain`, which says yes to
the same name — a track-fed chain is called after its track. Only inputs reach there; every other
destination is a bus (named after the module it starts at) or a sink.

The **pending** node — the module being created, drawn where it will land — is not built by
`buildGraph`: the host adds it, with its `jacks` and the two cables of the splice already decided
(k7's `apps/k7/frontend/src/pendingNode.ts`). The renderer draws those sockets and nothing that
answers a hand: it is dashed and spinning because it does not exist yet, but where its cables run
is exactly what the wait is for.

`DomChains.stories.tsx` in the react package draws each of these cases; it is the only way to look
at them without starting the engine, the supervisor, the file service and the editor.

> A curve's own vocabulary — the three types, what each is a function of, and why only a `custom`
> one has points on the wire — is `@studio/song`'s docs/curves.md.

## Assemblies — a box instead of its members

`assembly.ts` folds them in AFTER `buildGraph`, in the family of `alignModuleRank` and
`masterRunAside`: what it reads is a drawing fact, so nothing there may change what a cable means,
only where it lands. The host holds which boxes are OPEN — session state, not the document.

**Closed**, the members go and every cable between two of them goes with them; a boundary cable is
re-pointed at the box with the plug's name as its port, and the socket pass is re-run over the boxes
alone. Two members feeding one thing collapse onto ONE plug, drawn once — the edge key carries both
ports, so a box with two plugs into one target still draws two. The box's panel is `assemblyUI`, a
knob per promoted param on `rackGrid`'s shape, folded in through the same `nodeSize` every other
card is measured by. Its rank is the LOWEST of its members': the box replaces the whole column, and
`pushBelowInputs` corrects whatever that gets wrong.

**Open**, the members stay, tagged `assembly`, and the box becomes a frame. `layout` is where the
nesting happens, because layout is dagre's and only dagre's: the members are laid out by a RECURSIVE
`layoutFlat` call, the outer graph is given one node the size of that result, and the members are
offset by where it landed. So the outer graph stays flat and the rank rows, the master column and
the pins are untouched.

A frame has **no sockets**. The members are showing the real ones and the cable lands on the real
one, which is truer than a plug on the frame plus a lead to the member — and needs no cable maths of
its own.

**Every edge comes back with TWO points.** `cablePath` recomputes both ends off the sockets and
drops dagre's waypoints, so the nested pass has nothing useful to route — but the renderer skips an
edge with fewer than two (`DomChains`' test for "the layout could not place this"), and an empty
list draws **no cable at all** on a graph with a box open, the members' own included. It hands over
the two node centres instead, and none only when an end is genuinely unplaced. `assembly.test.ts`
pins it.

### What is the box's, and what merely crosses it

An open frame is a whole signal path's worth of cable, and the rest of the graph keeps running past
it. So a cable whose **both ends** are members carries `GraphEdge.assembly` and is drawn at full
strength; everything else — the feeds in, the ways out, and any cable that happens to span the frame
— is drawn at `FOREIGN_ALPHA`, half. Nothing fades while every box is shut.

The **shadow fades with it** — a full-strength shadow under a half-strength line reads as a darker
cable rather than a fainter one — and so does the label. The alpha is per cable rather than a mode
on the frame, so one faded cable does not dim the one drawn after it, and the fade holds through a
slide: the motion path reads the same flag, or every cable would snap back to full while the cards
move.

Crossing cables are **not clipped and not hidden**: the cable canvas sits behind `.dgx-world` and
the frame's fill is 2.5% white, so a cable runs right over the box and stays followable end to end.

### A folded lane still has to come alive

`computeLive` walks forward from the metered tracks' own cards, and a CLOSED box has swallowed them
— on a folded set the walk would reach nothing and **not one cable would ripple**, the master run
aside. The box carries `assemblyOf.members` for exactly this, and `computeLive` takes a `foldedAt`
map — track id → the node its signal now leaves from — so a metered lane seeds at its box. An OPEN
box needs none of it: the members' cards are back, and the walk finds them itself.

### Making room, and giving it back

An open frame is the size of a whole signal path, and it appears where a card was. On a graph nobody
has touched dagre lays the rest out around it — but a **pin outranks the layout**, and a project
that has drawn itself once has pinned every node it has, so opening a box grows one card straight
through its neighbours.

`pushAsideFrames` runs on the outer nodes BEFORE the members are placed, so a frame that steps aside
takes its contents with it. A card overlapping a frame moves to the **nearer side**, so nothing is
dragged across the frame it was already beside, and the shift is **constant per side** — the cards
keep their spacing and the picture reads the same, only spread. A member never moves: its place is
its frame's.

**Nothing about the push is recorded**, and that is what puts every card back when the box closes:
the pass simply stops running. The one thing that could break it is the graph writing a pushed
position down, so a moved card carries `pushed` — where it belongs — and k7's session memory and
its auto-pin both read THAT rather than where the card is drawn. Pin the shoved position once and
closing the box would leave the card there for good.

### A plug is not a graph.k7x address

`jackRef` answers a box's plug with the MEMBER behind it, and that one function is why no verb
changed for any of this: a cable dropped on `turntableA#mix` writes `graph chain connect fadeA OUT`.
`insertFor` resolves the same way. The box's BARE name is still its own — that is what a pin and
`graph move` address, which is why `layout`'s pin lookup reads `module` for an assembly as it does
for a module.

See `packages/song/docs/assemblies.md`.

## Cables

A cable carries what its **source** emits: the upstream module's type folder, or — from a lane — the
OUTPUT it left by. An instrument takes midi and emits audio, so the cable into it is blue and the
one out of it orange. A video lane puts picture on the wire whatever `trackSignals` says.

A lane is not typed by what it carries: it offers an `audio` and a `midi` output, and a run that
named one says so as `WebChain.fromPort` — the signal AND the jack the cable is drawn from, which is
what keeps a split lane's two cables off one socket. A run leaving the lane bare falls back to
`trackSignals`, what the lane HOLDS: midi when every event names a sequence, audio otherwise. See
@studio/song's docs/trackModules.md.

**The main output IS drawn, and it carries a fader** — `drawMainOut`, on by default and everywhere.
`MAIN_OUT_UI` is its panel: one widget, a fader bound to `Volume`, the song's output level
(@studio/song's docs/masterVolume.md). A built-in UI like `TRACK_UI`, because this node has no
`module.k7x` to declare one in — but with an ORDINARY bind rather than an `@` intrinsic, since
`node param "OUT" Volume <dB>` is a real command. So the renderer's usual write path reaches it with
nothing routed specially, and the header's fader and this one are two views of one number.

Its travel is **-60 to +12**. -60 at the bottom where the field goes to -100, matching the header's
fader: below -60 the curve is silence, and spending most of the throw on the difference between
inaudible and more inaudible leaves the useful range unusable. +12 at the top is the field's real
ceiling — this gain does not borrow Tracktion's +6 curve, which is why it is not `TRACK_UI`'s
number.

Both `MIX`/`RENDER` and `OUT`/`VIDEO_OUT` are **spelled out here rather than imported**: @studio/song
owns those names (`MIX_NODE`, `RENDER_NODE`, `VIDEO_OUT_NODE`) and this package deliberately does
not depend on it. They are taken literally elsewhere too — `nodeProject`'s `isSink` — which is why
each is a bare name rather than a shape.

The level is not in the graph document — it is a project setting — so it arrives as `mainOutVolume`,
the same way `inputDevices` does. Absent, the card still draws and its fader reads unknown rather
than claiming a level nobody supplied.

> **What turning it off would buy is arithmetic**: a card, an edge and a rank per chain that reaches
> it, repeating what the shape already says. Lanes end at `MIX` and only the master run reaches
> `OUT`, so the card costs exactly one node — and it is the node the output level lives on.

Only OUT gets the panel. Any other destination the graph cannot account for as a track, a chain or a
used module is still drawn as a plain sink, because that name has nowhere else to appear.

### The MIX sum is implicit — and RENDER is NOT

**No cable is drawn INTO `MIX`.** Every chain in the song ends at the sum — that is what a mixer is
— so those arrows say nothing the picture does not already say, one per lane and crossing it end to
end. `buildGraph` skips a destination of `MIX` (`MIX_OUT` here, `MIX_NODE` in @studio/song) and
draws only the run that LEAVES it:

```
MIX ─ [ the master chain ] ─ OUT
```

standing on its own, joined to nothing else in the drawing. The routing is untouched: this is the
picture, and the engine reads the compiled document, where every one of those lanes still arrives at
the sum.

**`RENDER`'s cables ARE drawn**, and the rule stops at MIX deliberately. A picture has a handful of
sources rather than one per lane, so the arrows are few and each says something; left implicit they
cost more than they save. In a `live-video` rig — `CAM -> RENDER`, and nothing else on the picture
side — the camera would hang off nothing and the compositor would read as unfed. The SOCKET goes
with it: `jacksFor` types a sink from what ARRIVES (`fallback ?? "audio"`), so a compositor nothing
reached grows an **audio** plug.

That is the whole of the difference: MIX is a mixer and its lanes end there by definition; RENDER is
a compositor and what reaches it is a wire somebody drew.

`MIX` is drawn **once**, as a sink, exactly as `OUT` is, and getting that wrong makes two cards. The
master run is written `from: MIX` and NAMED after the sum, so `c.from !== name` is false and it
falls through to the track branch — a lane strip with mute, solo, arm, volume and pan on the one
built-in node that deliberately carries no parameter at all (@studio/song's docs/masterChain.md),
its knobs addressing a track that does not exist, plus a pass-through card beside it labelled MIX as
well. `entryId`/`exitId` answer with the MIX card itself for a master run holding no module, and
that is what collapses the pair into the one wire above.

**Liveness has to be SEEDED there**, and that is the cost of the rule. `computeLive` walks FORWARD
from the metered tracks, so a card nothing arrives at is a card liveness cannot arrive at either,
and the master run — the one cable carrying every note in the song — would be the only still cable
on a playing graph. `cables.ts` therefore starts the walk at `MIX` as well whenever any track is
metered. Exact rather than a stand-in: every track feeds the master bus whatever its chain names
(@studio/song's docs/masterChain.md). `RENDER` is seeded the same way, off the picture's own list of
live lanes. See `computeLive` and @studio/ui-chains-react's docs/liveCables.md.

### …and UPSTREAM of the meter, which is where an input sits

The same rule leaves a second gap, and it is worse because it is on the shape the walk was written
for. A meter is on a **lane**, and a live input is *ahead* of the lane it lands on — so `IN → gtr`
is the one cable a forward-only walk can never reach, and a rig with a guitar plugged in would draw
a still wire out of the very thing making the sound.

So `computeLive` runs the walk **twice**: forward from the seeds, then backward from the same seeds.
What feeds a card that is sounding is carrying what that card is metering. Two details keep it
honest:

- **Upstream stops at another lane.** A metered card speaks for itself: if it were sounding it would
  be in the seed set, so crossing into it would light a silent lane's cables from its neighbour's
  meter.
- **The backward walk is seeded from the meters only**, never from what it reaches. Reach `IN` from
  a live lane and you must not then walk forward out of `IN` — a second lane it also feeds is
  silent, and its cable has to stay still.

**A materialised track has no lane card at all.** A `live` project authors none: the run makes its
own track, named after the chain (@studio/song's docs/liveProject.md), so `trk:IN` matches nothing
and every cable in the rig would stay still. The seed is therefore `mod:<id>` as well as
`trk:<id>` — one flat key space means a track id that names a module names the run that produced it.

That list is `liveVideoLanes`, the meters' opposite number. The engine measures sound and knows
nothing of the frame (@studio/song's docs/picture.md), so a video lane's cables have no meter to
ripple from — the one part of the graph that could never come alive by observation. What the browser
HAS is the shots and the playhead: derive it rather than observe it, the same bargain k7 strikes
for a rack's lit pads. The spans are half-open, like the compositor's own `activeAt` — a cut belongs
to the LATER shot, so two shots meeting at a boundary never both count — and they are the host's to
compute, from the same document the viewport draws.

`insertFor` offers an arrow's `+` whenever at least one end is a module, and does **not** demand
that both ends belong to the same CHAIN. `chains.k7x` states its edges outright, so an arrow IS the
address; a same-chain rule would quietly refuse a track feeding a bus or a split's branch, which are
ordinary arrows.

It offers one **between two SINKS** as well, which is the wire above: `MIX → OUT`, the master run
with nothing on it yet. A module-at-one-end rule refuses exactly the line every template writes for
something to be dropped on (@studio/song's docs/masterChain.md), leaving the one place in the graph
a master effect belongs as the one place the `+` never appears. Two TRACKS are still refused, and
that stays a defence rather than a rule anybody meets — two lanes never share an arrow.

A project that declares no master run at all has its cables into the sum skipped just the same, so
the pair is drawn anyway whenever something routes there. Not an invention: with no master chain the
two ARE one wire. A host that asked for no device card (`drawMainOut: false`) gets neither end of it
rather than half.

### …and the picture's sum is implicit for the same reason

`RENDER` and `VIDEO_OUT` (`RENDER_NODE` / `VIDEO_OUT_NODE` in @studio/song, whose
docs/videoOutputs.md is the page) are drawn by **every rule above, unchanged**: one card each, the
whole run ranked after every lane, the pair synthesised when the file declares no run, and both
devices governed together by `drawMainOut` — a picture ending nowhere beside a sound ending at a
card would be half an answer.

Three things differ, and only three:

- the wire out carries **`video`**, which is what makes the run read as picture across the graph.
  `exitSignal` answers for a sum by name, because it cannot answer by following `from`: the run is
  NAMED after the sum, so the recursion re-enters the same chain and stops on `seen`. An EMPTY
  master run would otherwise reach its device untyped — the audio one draws as audio by default and
  gets away with it, the video one does not;
- `VIDEO_OUT` gets **no panel**. `OUT` is the one built-in name with a param on it; a frame has no
  level, and a fader there would write a value `@studio/ui-eyes` never reads;
- neither name is ever typed by hand. A project with a viewport gains the run when the surface is
  created and, failing that, when it is opened.

A cable **plugs in**, and runs **straight**. dagre routes to the node's border, which is the right
target for a cable ending in an arrowhead pointing at a card; `cablePath` moves both ends onto the
sockets instead — the one the destination NAMES (`crossfade#b`) on the target side, and the one the
edge left from (`sourcePort`) on the source side, falling back to the first output when the chains
file names none.

Its waypoints are **dropped**. Kept, they bend a send around the module it skips — the right answer
for a flow chart and the wrong one for a patch bay. A rack's cables run straight between plugs and
cross where they cross, and reading one is following its ANGLE out of a socket, which a bend
destroys. dagre still places the nodes; only the routing is ours.

There is **no arrowhead** on a signal cable. The plug is the socket it disappears into — the nodes
paint over the cable layer, so the last few pixels are hidden by the plate and the cable reads as
seated. Direction is not lost with the head: the layout is left→right and every socket is on the
side its signal uses. The one arrow left is the **automation** one, and it earns its head by not
plugging into anything: it leaves the curve's socket like any other cable and then lands on a knob
in the middle of a card, where a headless line would not say which knob.

The socket's position is one rule in one place: `jackPoint` and the plate's CSS are both driven by
`PORT_PLATE`, which the renderer interpolates into its stylesheet. Two numbers here would be a cable
that ends near the hole rather than in it, and nothing would ever say so.

`link()` adds a connection once — but "once" is per SOCKET, not per pair, and the key serves two
truths at once. The same link can be expressed from either end (`A.out: [B]` and `B.from: A`) and
only one of the two carries ports, so those collapse into one arrow keeping any gain label; a
reverse edge is the same connection seen from the other end and collapses too. But a module that
splits feeds one target from several of its outputs (`sep#drums: [mix]`, `sep#bass: [mix]`), and
those are genuinely different cables that must NOT collapse — keying on the pair alone draws the
second as the first, out of the wrong jack. So an expression that names ports gets its own identity
and one that names none merges into whatever cable already joins the pair, order-independently,
since the two ends are visited in whatever order the chains happen to be in. The port is IN the edge
id, and the renderer keys on it.

What *leaves* a chain is normally its last module's output. A chain with no modules is a
pass-through: it emits whatever reached it, so the follow walks its `from` (a track's own signal, or
recursively the chain upstream). A `seen` set guards that walk — chains should not loop, but a graph
being drawn is often one the user is still fixing, and a renderer must not hang on a cycle that
`validate()` will flag.

### The `from` guard

An input link is a chain-feeds-chain link only when `from` names a **different** chain and **not** a
track. Both guards earn their place, because a chain is named after its source track when it is not
named explicitly — so `from` and the chain's own name are usually the same string:

- `!isTrack` — the track exists, so this is an ordinary source. `isChain` alone would mistake it for
  the chain of the same name.
- `!== name` — the track does **not** exist (a rename `graph.k7x` has not caught up with). `isChain`
  then finds this very chain, the link collapses to a self-loop, and `link()` drops it — taking the
  track node with it, so a stale reference makes the whole track *vanish* instead of showing up
  broken. Fall through and draw it; `validate()` says why.

## Automation edges

One curve node per binding, arrowing into the module's param. The edge carries the curve's DEPTH
(`automationDepth.ts`), its amplitude and polarity, which a knob draws as the stretch it sweeps. Each binding is its own node — a curve
id reused by two params draws twice — so the id carries the chain, the step and the param. The edge
bypasses `link()` (no collapse, no gain) and carries the automation payload the renderer draws
purple.

One node per CURVE is the tidier rule — a curve is one thing however many params it drives, and
drawing it twice makes "where is this curve" two answers. It fails because a curve node has an
INPUT: an envelope is restarted by an event, and which module fires it is per binding. One card with
two event sockets cannot say that the same shape is fired by the drums here and by the synth there;
two cards say it by standing apart. The shape is still one file on disk and the label is still the
curve's id, so the two instances are legibly the same curve.

A curve an event FIRES also gets the cable that does it, from the announcing module's note-on into
the curve's event socket (`firedByEvent`): an `adsr` curve always, and any other when one of its
conditions is an `event` — the note-ons that start or retrigger it are read from the same node. The
socket is halfway down the card's LEFT edge (`EVENT_IN_AT`); the automation out is halfway down its
right edge — in on one side, out on the other. It runs the other way to the automation edge — events in, values out
— which is what makes the pair readable as a loop. The trigger defaults to the module being
automated, which is what the compiler does (`nodeProject.ts`), and is drawn from the same field so
the picture cannot claim one source while the bake uses another. `curveSubLabel` tells `adsr` from
`custom` for the same reason: an envelope is the one curve here that is not a function of song time,
and a reader who cannot tell them apart cannot tell why one is fired with no condition naming an event.

The arrow lands on the **widget** bound to that param when the module draws one; with no widget it
points at the module's border and the param name is shown as a label.

`GraphNode.curveOf` carries the curve, the module and the param rather than letting the renderer
parse them back out of the node id, which spells the same thing: a module ref may itself contain a
colon (`synth:lead`), so `crv:env1@synth:lead:Filter Freq` has no unambiguous reading. The renderer
needs all three to write `node automate`, and a gesture that guessed them wrong would rewrite
somebody else's binding.

A curve **nothing binds** is drawn free-standing, one card, driving nothing yet. A curve is a node
like everything else here, so `curve new` has to put something on the graph: an unreferenced curve
drawing nothing at all would make the verb's result invisible and the canvas menu's "add a curve" a
promise with no picture behind it. Its id carries no binding, which is exactly what tells it apart
from an instance — one free card per curve, one bound card per binding.

### Curve cards

A bound card sits **at the left of the node it drives, under its top** (`src/curvePlacement.ts`),
on the side its events leave from. Several curves on one node stack downward. dagre sees an automation edge as one more edge and would put the card
anywhere on its row, so its spot is dropped: the card goes just left of its target, and the row
sweep sorts it immediately before that target, so the sweep parts them by making room rather than by
pushing a neighbour between them. Neither the automation edge nor the event one counts in
`pushBelowInputs` — a curve is not an input, and reading the pair as feeds would put the curve below
its node and the node below the curve.

The place is FORCED (`curvesUnderLeft`), after the pins and after the cards' remembered places: a
curve card goes where its target IS, whatever it was before. It is a detail of that node, so a
binding added to a graph you arranged lands beside it, and a node moved takes its curves along —
which is also why a curve card cannot be dragged away from its node.


**In a row** (`moduleRow`, the per-track view) a curve card is drawn only when asked (`curves`), and
then the same way: in a column just before the card it drives, under its top, the neighbours moved
apart by `CURVE_ROOM` either side to make room — the two cards it falls between no longer touch, so
the seam between them goes. Asked or not, the automation edges landing on a card in the row are kept,
the curve card missing or not: the glow on a driven knob is read off those edges, and an edge whose
curve is not drawn simply draws no cable. A card's event plugs go with its curves: hidden, there is nothing for an event
to fire, and a plug that leads nowhere is an invitation to drag a cable into a view that will not
draw it.
## Orphans are drawn

Tracks no chain mentions are drawn as orphan nodes: a node with nothing wired to it. Leaving them
absent is the worst way to show a problem — the track exists, holds its clips and still plays (dry,
straight to the main out; a chain *adds* plugins and sends, it is not what makes a track audible),
so a graph that omits it quietly claims the song has fewer tracks than it does. Rename a batch of
tracks and their chains point at the old names while the new ones are nowhere on screen.

They carry **no note** under the name. A "no chain" label is worn by every lane in a project that
routes nothing, which is most of a song before its chains are written, and a label repeated on every
card says nothing about any of them. The missing cable is the mark, and it is the one a reader is
already looking at.

They are **not dimmed** either — dim means bypassed here, and an unrouted track is playing, not
muted.

Video lanes are in the same list for the same reason: one that no chain mentions still draws
(`project.layers` composites it), so leaving it out would understate the song exactly as it does for
audio.

### A lane is a lane at BOTH ends of a cable

`isLane` — either kind — is what decides three things: whether a chain's source is drawn as a lane,
whether its signal is followed or read off the lane, and whether a run's DESTINATION is an existing
card or a sink to invent. Reading `graph.tracks` alone for that third one makes a lens wired to a
picture lane (`packages/song/docs/camera.md`) resolve to an unknown destination and get a **sink
card of its own**, named after the lane — an output node nobody asked for, sitting beside the real
lane with the camera cabled to the wrong one. A lane is never a sink: it is already on the canvas.

## Layout

The graph reads top to bottom as **inputs, tracks, modules, faders**, then the MASTER RUN (below)
and the sinks. Rank hints say so: a live INPUT at 0, the tracks at 1, lane modules at 2 + their
maximum position across all chains, chain pass-through nodes at 2. The *maximum* position matters
for a shared module — at index 0 in chain A and 2 in chain B it ranks after both, so chain A's full
pipeline is still respected.

- **An input is above the tracks** because it feeds one. Ranked as a lane module it sat below the
  track row, and `pushBelowInputs` — which never lets a card sit above what feeds it — then pushed
  that one track down out of its row: the one lane a musician plays live read as out of line.
- **Every lane's FADER is on one row, the deepest lane's.** A fader ends its lane, so on its lane's
  own depth a short lane's strip sat high and a long one's low, and reading across the levels of a
  song meant reading a staircase. What follows a fader in its chain moves down with it, so nothing
  ever ends up above its own strip. It is the same rule the mixer view applies with
  `alignModuleRank`, reached here by the ranking itself.

**Every rank ends up on its own row**, and that is `layout`'s doing rather than dagre's, which
treats the rank as a hint: its `longest-path` ranker pushes a node as LATE as it can, hugging the
sink below it, so on a fifteen-track song rank 1 spreads over SIX lines, from y=16 to y=1380 — a
first-in-chain module sitting on the mixer line, at the bottom of a column it belongs at the top of.
`snapToRankRows` makes the rank mean what it says: one row per rank, in order, each as high as the
highest thing dagre put there and never overlapping the row above. The input row, the track row
and the fader row all fall out of that same rule.

Two things follow, both found by measuring:

- **The rows are swept for collisions.** dagre places x assuming its own y, so two nodes it put on
  different lines may share a column, and collapsing them onto one row is what makes them overlap.
- **The extent is measured on the nodes**, not read off dagre, whose figure describes the picture
  before the rows move: 488px short on that same song, which is the bottom of the graph missing from
  every camera fit.

The extent has a second end, `left`/`top`, for the same reason. dagre lays out from
`marginx`/`marginy` down and right, so both are 0 for a graph nobody touched — but a **pin** can sit
anywhere, including above the first track, and `width × height` measured from the origin says
nothing about that. A camera framing the extent alone would cut off exactly the cards somebody
dragged up there, or force the drop to clamp to `0,0` instead. Both are floored at 0 (never
positive), so the box a fit reads — `width - left` by `height - top` — is the extent unchanged for
every graph that begins at the origin.

Only the y is legislated, and one column's x. The rest of the x stays dagre's, so the gap along a
row varies with what hangs under each column — right for tracks and modules, which are the tops and
middles of chains of different widths. The mixer row asks for even spacing separately
(`spaceModulesEvenly`), because a rank of channel strips is the one place it is wanted.

Layout is **top→bottom** layered. dagre returns node centres; we store top-left (what a renderer
wants), and an edge keeps its two ends only so a renderer can still draw something for a node it
cannot find.

The direction is a `rankdir`, and three things follow it: `nodesep` and `ranksep` swap axes
(siblings side by side, stages one under the next, and the numbers swap with them), `jackPoint` puts
inputs on a card's TOP edge and outputs on its bottom, spread across the width, and `cablePath`'s
straight leads run on Y. Those three have to agree with the plate positions the renderer sets inline
— the socket and the cable's end are one place drawn twice, and a disagreement reads as a cable that
misses its plug.

The one surface that stays horizontal is `moduleRow`, the Mixer's rank of strips: it lays its own
nodes out and never calls `layout`, because a row of mixer strips is a row and not a signal path.

### Pins, and where a card was drawn last time

`layout` takes two overrides and applies them AFTER the rank snap and BEFORE the extents, so a held
card both wins over the rows and still counts toward the graph's measured size.

`positions` is what somebody PINNED — `chains.k7x`'s `positions:`, keyed by chains name — and it
wins over everything the ranker decided except the one rule below; dagre only ever places what has
no entry, so a module dragged once stays put and a new one still arrives laid out. `prev` is where
each node was DRAWN last time, keyed by node id: the host's session memory, so an edit never
reorganizes the picture. Pins outrank the session because the file outranks it — another tab may
have written one. `graph organize` empties both and lets dagre speak. The name resolution is
`cables.ts`'s `jackRef`, inlined here because `cables.ts` imports this file.

### The master run is the last column, its sum on the track row

`MIX -> OUT` is the run out to the interface. Three deliberate decisions collide on it: the sum
stands where a source stands, `OUT` is an ordinary sink one past the deepest module, and no cable is
drawn into the sum. Together they leave nothing to hold `MIX` down — it sits on the track row, `OUT`
on the floor, and the one cable between them runs the height of the page. Measured on a two-deck
set: **a 1430px wire in a graph 1654px tall**, of whose 37 edges exactly one touches either card.

So the run is ranked **after every lane**: the sum one past the deepest lane module, its own modules
after it in their own order, the sinks last. That is `sumRank` / `sinkRank`, and `onMaster` is the
set it needs — the modules of any chain sourced from a sum. Ranking a master module by its position
*inside* that run is the same disease: a limiter is step 0, so it would land on the first module
row, up among the tracks.

`masterRunAside` then moves the block to the RIGHT of everything — one `nodesep` past the rightmost
thing not on it, so the sum is always the last column — and UP so the sum stands on the TRACK row,
level with the lanes it sums. Both are POSITIONS and not minimums, so a run dagre left miles out is
pulled back in. It shifts as a **block**, keeping the shape the ranks gave it, which is what keeps
`MIX -> OUT` short: the ranking put `OUT` one rank under the run's last module, and the shift moves
the two together. A graph with no lane has no track row to join, and its run goes below everything.

It runs **before** the pins, and that is the difference from the rule below: where the master column
sits is a *preference*, and a pin outranks a preference. A cable that climbs is *wrong*, and nothing
outranks that.

Two graphs `masterRunAside` leaves alone: one with no sum drawn — a chain writing `out: OUT`
directly never makes the card — and one that is nothing BUT the master run, which has no rest to
stand aside from.

`RENDER -> VIDEO_OUT` is ranked by the same arithmetic, since `onMaster` reads both sums. Only the
CORNER is `MIX`'s alone: nobody has asked for the two columns to be stacked out there, and guessing
an order for them is a decision this cannot make on its own.

### A receiver never sits above what feeds it

**A node that takes input may not be above, or level with, the things feeding it.** A cable that has
to climb is a cable drawn backwards, and one drawn sideways between two cards on the same line reads
as a cable going nowhere.

dagre gives this for free — `rankdir: "TB"` is exactly that statement — and `snapToRankRows` keeps
it, since a rank's row is never above the row before. **A pin does not.** Dragging a compressor
above the track feeding it, or writing a `positions:` entry by hand, would produce a picture whose
cables run the wrong way with nothing to say so.

So `pushBelowInputs` runs AFTER the pins, and it is the one thing a pin does not win against. It
moves a card **only as far as the rule needs** — its top to its lowest input's bottom, not one pixel
more — and never touches the x, the half of a pin this has no opinion about. So dragging a card down
drags **its consumers** with it, the constraint carrying down the chain; dragging one UP moves
nothing, because the rule only ever pushes down.

It is one pass, not a relaxation: a topological walk settles a chain of any depth in a single sweep.
Anything the walk never reaches is in a **cycle**, where "below its inputs" has no answer — those
keep their pinned position rather than the layout hanging looking for one. Self-edges and edges
naming a node the graph does not draw are skipped for the same reason.

It applies to every edge, automation included. A modulation arrow that climbs is as unreadable as a
signal cable that does.

### The mixer's row, three functions deep

`alignModuleRank` pulls the named modules onto ONE rank. The mixer view is that and nothing else:
the same graph, the same cables, the same cards, only the ranks move. Every track ends on a mixer,
but a track with a longer chain ends DEEPER, so by default the mixers sit on a staircase and no zoom
shows them all. The shared rank is the DEEPEST of theirs, never a shallower one — pulling a mixer up
would put it above modules that feed it. Sinks are pushed past it for the same reason, since they
carry a rank computed before this ran; the two SUMS are exempt, being drawn as sinks while standing
where a source does. It returns a new array, so the plain layout stays available to anything drawing
the same graph beside this one.

`spaceModulesEvenly` then gives the row one rhythm. dagre spaces a rank by what is above it — a
track with a wide chain pushes its mixer away from its neighbour — so a shared rank alone still
reads as a scattered line rather than a console. Equal GAP and not equal pitch, because the cards
are not all the same width and it is the space between them the eye reads as regular. What it costs
is upstream: the chains feeding the row are not straight columns, and they are not meant to be.
Their cables need nothing done about them, since `cablePath` reads both ends off the nodes.

### The stack view, a column per lane

`stackLayout` is the graph's other whole arrangement, the stack button left of the minimap's zoom fit
(`ui stack`): one COLUMN per lane, in the song's track order — the inputs that feed it (a live input,
a lens, a MIDI device), the lane's own card, then every module on its path (`trackModules`, so a send
out of its chain is in it), edge to edge with no air between them and every card as wide as the
column's widest. An input is as wide as its lane's column, not the stack: it belongs to that lane, and
the lane cards keep one line across columns however many inputs stand over each. What no lane
reaches — a bus, a curve, `CUE` — takes a column per chain after the lanes, and an input feeding no
lane one alone. The `MIX` heads the LAST column, always: the master run under it, then `OUT` like any
other module, as wide as its column. The sum is where every column ends up, so it closes the row
rather than standing among the lanes.

It is read top to bottom, so dagre is not used: the order is the song's, and a layout engine would
be free to choose another. Like the mixer row it is an arrangement and not a place — nothing in it is
pinned, remembered, or written to `positions:`. Cards keep their height; a socket plate is dropped,
since it hangs off a card's edge onto the one stacked against it, and a cable meets the middle of the
edge instead.

**A fork has to read, and a straight column hides one.** A module feeding two chains stacks both
branches under it, so the cable to the second runs down the column BEHIND the first branch's cards —
and leaves from the same point as the first. Two things undo that. A cable between two cards of one
column that are not stacked against each other gets a `side` lane: `cablePath` takes it out of the
source's right edge, down the outside of the column and into the target's right edge, each such cable
of a column one lane further out (`sidePath`). And a card with more than one cable leaving it keeps
its OUTPUT sockets — the one exception to the dropped plates — so its cables visibly leave from
sockets rather than from one point. A cable between columns needs neither: it is already in the open. An input is drawn as a solid bar (`.dgx-node.bar`), the edge's tint made opaque.

`moduleRow` is the standalone surface: the named modules side by side, dagre deliberately not used —
there are no cables between channel strips to route, and the ORDER is the caller's (the song's track
order), which a layout engine should not be allowed to choose. The cards come from `buildGraph`, so
each is the same card the full graph draws, live values and all; only the position is ours. Seven
rules:

- a name with no module in the graph is **skipped**, not drawn as a gap: the caller's list comes
  from the compiled project and the graph is refetched separately, so the two can be one reload
  apart and a hole in the row would be the only sign;
- **one height for the whole row**, the tallest card's — a ragged bottom reads as cards of different
  importance, and the camera fits the row's height to the view. `asDrawn` is the exception: every
  card at the width the full graph draws it, the lane's clips kept, every card as tall as the
  tallest, and a box exactly that tall, so a height fit makes that card fill the view — for a row
  that is a VIEW of the graph's nodes (one lane's path) rather than a rank of strips. A STRIP
  stretched that way spends the height on its fader (`stripWidgetRect`): the fader grows and what
  sits under it in its column moves down, so the level gets the travel and the knobs keep their
  size. Any other card leaves the extra height empty, having no control that reads better taller;
- the cards come **without their sockets**: the plates are CSS-pinned to the top and bottom edges
  while this row meets its cables on the sides, and a plug on the wrong edge is worse than none;
- its `links` option decides whether the graph's own cables come along. Off for a rank of channel
  strips — nothing runs between two channels, so every socket would be a plug into nothing. On for
  one lane's signal path, where the cables ARE the subject, and a send that skips a module shows as
  the longer cable it is. The edges are the graph's own, kept where both ends are in the row;
  nothing is invented between neighbours, because two cards side by side with no cable between them
  is the truth about a lane whose chains do not touch.
- its `gap` option is the air between two cards: a rank of strips keeps it, since a channel is not
  wired to the next, and one lane's path sets it to -1, its cards GLUED into one strip: each overlaps
  the one before by a pixel, a stack's cards likewise, so two neighbours share ONE border — side by
  side at 0 their two borders read as a line twice as thick. `rowSeams` takes a card ending on, or one
  pixel past, the next one's start as touching. `rowSeams`
  then marks each arrow between two touching cards `glued` — the renderer draws no cable for it,
  one between touching cards being a loop backwards over the seam, but the live ripple still walks
  it — and puts a `+` on that seam and one past the last card. A seam with no arrow behind it
  offers none: there is nothing to splice into.
- its `stack` option draws each of the graph's `stacks` — a chain project's subchains run in place —
  as one COLUMN, its cards one under another at the column's width and their own heights, a lone card
  still as tall as the tallest column. The arrow down a column is glued like one across a seam, and
  `rowSeams` (asked with `branch`) gives each seam whose left card is a module a second button, a
  BRANCH at `SEAM_BRANCH_AT` of its height, which stacks a new node under that card. `stacks` is in the
  graph exactly when the project is a chain project, so a `graph.k7x` project gets no branch: it has
  no subchain to make.
- its `track` option puts that LANE's own card at the **head** of the row, which one lane's signal
  path wants and a rank of channel strips has no use for. The lane is found by KIND and not by name
  — `trk:` is prefixed precisely so a lane and a module may share one — and, unless `asDrawn`, it
  arrives without its clip LIST, which is the arrangement rather than the path and stands taller
  than any card beside it. It leads nothing when the row has no module and no input in it: one card and no cable is not a
  path, and the caller has a better thing to say about a lane that reaches nothing.
- its `inputs` option, what `trackInputs` answers, puts the cards FEEDING that lane before it — the input,
  and a preamp between the input and the lane — as the stack view stands them over it. The signal
  starts at the input, and the cable onto the lane is what says this lane records from it. A run's
  `from` is a lane it leaves, never an input, so the walk upstream goes by each run's first module.

### The -Infinity extent

dagre reports `-Infinity` for a graph with no nodes — it maxes over an empty set. That is not null,
so `?? 0` never catches it, and not falsy, so a caller's `if (!width)` guard passes. Framing a
camera to that extent yields an Infinity translation and the graph is invisible for good, the view
believing it has already framed itself. A layout with nothing in it has no extent: report 0 and let
the caller decide there is nothing to frame yet.

## Zooming the graph

`zoomGesture.ts` lives here rather than in the renderer because a wheel notch and a trackpad pinch
cannot share one answer, and that is a decision with a right and a wrong result.

A mouse wheel arrives as ONE event per detent with a delta in the hundreds, so `0.001` gives a
comfortable ~10% a notch. A trackpad PINCH arrives as Ctrl+wheel, a stream of small continuous
deltas dozens a second, where the same coefficient gives a fraction of a percent each — the "very
slow" you feel with two fingers. Ten times the coefficient makes a pinch track the fingers and
leaves the wheel as it was. The pinch delta is CLAMPED first (`WHEEL_CLAMP`) because browsers
disagree about the units they report a pinch in, and one answering in hundreds would jump a decade
in a single event.

`pinchFactor` measures a two-finger spread against the spread the gesture STARTED at, not the
previous frame: a ratio of ratios accumulates rounding, so you would pinch out and back in without
returning where you began. A zero or negative spread is not a gesture and answers 1.

## The module builder's preview graph

`modulePreview.ts` builds the smallest `WebGraph` that draws one module as the card it will be in a
chain — a source, a chain, the module, a sink — from the panel being edited rather than from a
project. `PREVIEW_SOURCE` stands for "whatever will feed this", because a module editor has no
tracks and a chain's `from` has to resolve to something.

What feeds it depends on what the module TAKES: `previewSourceOf` reads the first input of its type
folder's default ports (song-schema's `MODULE_TYPES`), and an instrument or a transformer hangs off
`PREVIEW_MIDI_SOURCE`, a MIDI lane, rather than the audio `in`. The cable is coloured by its
source's signal, so an audio source would draw an audio cable into a synth — a wire that cannot
exist in a chain. The module's own `emits` is its type folder's too (`moduleEmits`), so a
transformer's cable to `OUT` stays MIDI. The MIDI source exists for this preview only: no project
has a lane by that name.

`previewPluginId` is THE one place the engine address `<chain>:<module>` is spelled. Two things
build it — the `ProjectDoc` the engine loads (the médiathèque's `engine/preview.ts`) and the graph
node — and they have to agree, or the node names a look-alike rather than the plugin that is loaded.
Nothing reports the disagreement: no type error, no failed request, just a card wired to an address
nobody answers at.

`moduleCategoryOf` reads the segment after `modules/` or `_modules/` rather than a fixed index. The
same module is named `modules/audio/reverb` by the médiathèque,
`_modules/audio/delay/tape-delay/module.k7x` by a shared library, and
`LEMO - DANSE/modules/audio/amp/module.k7x` by k7 in a workspace holding several projects — an
index would be right for one of those and wrong for the others. Anything unrecognised draws as
audio: a glyph is not worth refusing a preview over.

`visibleGrid` drops `hidden` widgets, because that flag is normally resolved away by the merge of a
module over the base it extends and there is no merge on this path. And `bases` is passed for one
reason: a widget bound to `@base` carries no entries of its own — `withFolderOptions` fills them
from the step — so without it the preview draws that dropdown holding `none` and nothing else, which
is the one widget you cannot check by looking at the panel you just wrote.
