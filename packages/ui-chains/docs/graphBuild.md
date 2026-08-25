# Building the chains graph (`graph.ts`)

Turns the compiled `WebGraph` into positioned nodes and edges, mirroring the real signal
path: a chain's input and output map to its first and last module (or to a pass-through
node when the chain has no modules), and that is what `from`/`out` connect to.

The file is deliberately **renderer-agnostic** — plain numbers, no Pixi, no DOM — which is
the seam that lets dagre own layout and lets the same geometry serve the hit areas and the
drawing by construction.

## What a node carries from its step

`CARRIED`, `FLAGS` and `Consumed` declare it once instead of copying it. Restating the fields one
by one makes "add a field" three edits in three files, and the third is the one that gets missed:
a field that reaches the browser and stops at the node sends the host re-fetching the whole graph
on a click to read a value already under the mouse, and a field forgotten on the edge copy in
`layout` — `targetPort` — puts every ported cable on the node's edge.

The `_Unplaced` guard underneath makes the three groups cover the type: a new field on
`WebChainStep` stops the build HERE, by name, until it is placed in one of them.

Most of the carried fields are carried *rather than consumed* because two readers want them —
`inputUI` turns `channel` into the node's dropdowns and the renderer needs the numbers again to
know which entry is current; `rackUI` turns `rack` into pads and the renderer needs the row again
to know what a tapped pad should sound; `withFolderOptions` turns the base and shader LISTS into a
dropdown's entries while `base`/`shader` say which of them is on. `Consumed` is the other side:
`module` becomes the label and the id, `enabled` becomes `bypassed`/`dim`, `emits` decides an
edge's signal, `automations` become nodes of their own, and `bases`/`shaders` become options.

`events` is carried and drawn as labelled sockets down the right edge, apart from `jacks.out`:
those are the signal path, and an event is not something the chain carries. One list would let a
cable be dragged from a note-on into an audio input — the drawing allowing what the model forbids.

## One track's signal path

`subgraphForTrack` narrows the graph to the chains one track enters plus everything reachable
downstream, and returns a `WebGraph` — so `buildGraph` takes it unchanged and only the input set
differs. A downstream chain fed by ANOTHER track would drag that track in, so its `from` is
dropped and the chain we pass through is kept.

`trackModules` adds the ORDER, which a node set does not carry: chain by chain from the track's
own, then step by step inside each, which is the order the song is written in. De-duplicated,
because a module shared between two of the track's chains is one module and drawing it twice would
offer two sets of controls for one thing.

## Node geometry

A node with no UI is a fixed size; one with a widget grid is sized BY that grid (`nodeSize`),
and dagre is told the real size so it reserves the space and routes edges around it. A size
it was not told is a node its neighbours overlap.

`NODE_W` is the no-panel size only, and **not** a floor under panelled nodes: as a floor it
parks dead space to the right of every grid narrower than it — a 2-column mixer strip is
84px of controls in a 160px card. A panel says how wide its module is, which is the only thing
that knows. `NODE_MIN_W` is the one floor there is, and it is
not aesthetic: below ~72px the header's padding and kind glyph leave no room for the name at
all. The name ellipses at these widths, so it carries a `title` — on a wall of identically
shaped strips, the tooltip is what tells them apart.

Every node renders a header strip plus a content area — there is no compact header-only
design — so even a module with no UI needs room for its "No Options" label.

`UI_HEADER` clears the node's name **and** its `sub` line at their existing positions, so
the header is sized for the worst case rather than per node. That is what lets a widget's
box depend only on its own col/row, keeping `widgetRect` a pure function of the widget (the
DOM renderer places each widget absolutely at that box). The cost is about 12px of unused
strip on a module with no sub line.

`CELL` fits a control *and* its caption: a usable knob is ~24px across and the caption under
it needs another ~10. Anything tighter and one of the two has to go.

### The header's name has to be readable at that width

`moduleDisplayName` keeps the LAST segment of a module ref — `@st0/audio/modulation/chorus-ense`
→ `chorus-ense` — because everything before it is where the module is filed, and spending a
card's width on a namespace every neighbour repeats leaves no room for the word that tells them
apart. The whole ref stays as the header's `title`, so the filing is one hover away.

`headerFontPx` then shrinks the size to fit. A fixed 12.5px would do while every card was
`NODE_W`, but a card is only as wide as its grid: a two-column strip is 84px, so seventeen
identically-shaped mixers would all read `vo_j…`.
Estimated from the glyph count rather than measured — this runs for every node on every layout, and
a DOM measurement per card is a reflow per card. `GLYPH_W` is the average advance of the header's
face at 1px, so a name of all `m`s still ellipses and a name of all `i`s is left smaller than it
had to be; both beat the fixed size. Never LARGER than `HEADER_MAX_PX`, because this is about
fitting a long name and not about blowing up a short one, and floored at `HEADER_MIN_PX`, below
which it is a smudge and an ellipsis is honester.

### A NOTE is sized by its text

A doc module draws its `content` as written, and `noteSize` measures the box dagre has to reserve
for it — a note that overlaps the chain it is about says nothing. Wrapped at `NOTE_MAX_W` rather
than widened without limit: one long paragraph would push every rank of the graph sideways to make
room for prose, which is the opposite of what a note is for. The height follows the WRAPPED line
count, so the box fits what is drawn. `noteOf` decides a module IS a note by asking `WebGraph`'s
`modules` map, which is keyed by doc modules and nothing else — no second field, and no lookup
table to keep in step with one.

## The `sub` line

Only the **shared** case earns one — "this module is in these chains" — a warning that
editing it reaches more than one. It must be computed after the merge: left at whatever the
first insertion computed, it can only ever name the chain that reached the module first, which
is not the list it is meant to show.

A chain's own name does **not** ride its first module: it would say nothing the drawing does
not, since the cable from the track is right there and the name is repeated on the track node.

## Track nodes carry a built-in UI

Their five mixer controls are authored with the same widget primitives a module UI uses.
The `@`-prefixed binds are **track intrinsics**, not plugin params: the renderer routes them
to the mixer commands and reads their live values from the track-controls channel.
`@volume` is in dB so a linear knob maps straight onto the fader's range, and it stops at
**+6, not +12** — the engine's track fader clamps there, so a taller knob would promise gain it
cannot deliver (see `MAX_GAIN_DB` in `@studio/song`).

A **video lane** gets one control. For picture, "mute" means hidden, and there is no solo,
record arm, gain or pan to offer — a full strip there would be four controls that do
nothing.

## A RACK carries one too — a grid of pads

`rackUI` gives a rack node one button per loaded sound, bound `@rack:<symbol>` — an intrinsic in
the same family as `@mute`, routed by the renderer rather than sent to a plugin param, because a
pad **fires** where every other widget **sets**. Synthesised for the reason `TRACK_UI` is: a
rack's symbols are already known (merged through `extends`), so asking for a `ui.yaml` listing
them would be asking for two lists kept in step.

**The grid is at least 2×2 and at most four wide** (`rackGrid`, exported so the corners of the
rule are pinned by a test). Two decisions there:

- **Never smaller than 2×2.** Two pads in a row read as two controls; a square with slots free
  reads as a rack with slots free, which is what it is. A one-sound rack still looks like a rack.
- **Square-ish as it grows, capped at four columns.** Eight sounds are 3×3, not 4×2 — the node is
  read as a pad grid, and a wide flat block says less about the instrument. The cap is what keeps
  a sixteen-sound kit from drawing a node wider than the pane.

**A pad draws bare.** The widget still carries the symbol as its `label` — that is what a tooltip
and a right-click name it by — but `DomChains` prints it for every button *except* a pad: sixteen
three-letter words in a card this size is a wall of text where a drum machine's face should be.
The hover is where the symbol lives.

An **authored** panel wins over all of this: a rack with a hand-made panel has said what it wants
its node to show, and a grid of pads bolted underneath would be the app overruling the file.

## A live INPUT carries one too, and it must

`inputUI` gives an `io: in` node three dropdowns — its socket, its width, and its monitoring.
Synthesised for the reason `TRACK_UI` and `rackUI` are (these are not the module's opinion but
what it IS), and for a second, harder one: **`@engine/IN` cannot have a `ui.yaml` at all.** A
`ui.yaml` is keyed by a library ref, and there is no `@engine` library — an engine module is a
built-in with no folder anywhere (`@studio/song`'s `uiLibrary.ts` says so outright and
`moduleRootFor` throws for it). Without `inputUI`, every live input in every project draws a card
reading **"No Options"**, and no amount of authoring can fix it.

**Everything is a dropdown, and that is a constraint rather than a taste.** Only a widget carrying
`options` can commit a module field — `setModuleField` in `DomChains` sends the picked option's
`arg`, so a knob bound to a field draws, drags, and writes nothing. `@gain` is deliberately
**absent** for that reason and only that one: a continuous trim has no options to pick. Not for
want of a verb — `node param <node> @gain <db>` exists — so what a gain knob waits on is a
commit-on-release path for a dragged intrinsic.

**Width is not a field.** Mono and stereo are not two settings — they are how wide *one* setting
is, so the width dropdown binds `@channel` like the socket does and writes the same field one
channel wider or narrower. Both dropdowns therefore send the same line — `node param <node>
@channel …` — and no state can disagree with the file. A pair is even/odd and nothing else, because the interface groups no other
way: the pair containing channel 4 is 3+4, never 4+5.

**The channel list is the machine's**, so it arrives as an argument to `buildGraph` rather than
being invented here — which inputs exist is the sound card's to say, and it differs between the
machine that wrote the song and the machine playing it. With none, the list is empty and the other
two still draw.

Each option's **`arg`** is what gets written when it differs from what is shown: the socket reads
"Input 1 + 2" and the file says `1,2`. Everywhere else the word on screen is the word in the file,
and `arg` is absent.

An **authored** panel wins over all of this, exactly as for a rack.

## One function answers "which panel", for the drawing and for the size

`stepUI` picks it: the authored grid if there is one, else a rack's pads, else an input's
sockets. Both readers go through it — the node's `ui` and `nodeSize` — and that is the whole
reason it exists.

Two sites would agree about everything except the one thing `stepUI` does on its own: fold the
module's base list into the authored panel (`withBaseOptions`). Take the node's panel from
`carryStep` (the step's raw `ui`) and only its SIZE from `stepUI`, and a widget bound to
**`@base`** has its entries computed, measured, then dropped — every base dropdown drawing `none`
and nothing else, on a panel whose author wrote exactly what the format asks for and has no way
to see it is not working.

The list cannot live in the `ui.yaml`: which bases exist changes every time somebody snapshots
one, so a panel listing them would be a copy of a directory going stale between saves. The author
writes `bind: @base` and says nothing more; the entries are the folder's, and they arrive on the
step. Same contract as `@channel`, whose sets are the machine's — see `@studio/song`'s
`docs/intrinsics.md`. `@shader` is the same mechanism over a different folder (`docs/shaders.md`),
and `withFolderOptions` serves both from one site, because a shader module's panel is an ordinary
authored `ui.yaml` and a second fold-in would be a second thing to remember.

`none` comes first and always, because a chosen base has to be undoable: without an entry meaning
"back to the module's default" the only way out of a base is editing the file by hand. The `value`
is a position in the list and nothing more — `setModuleField` writes the option's LABEL, which is
the base's name, so adding a base can renumber the list without changing what any entry writes.

## A REHEARSAL moves, and writes nothing

`rehearsal` on `DomChains` says this graph is a card being **tried out** rather than a song being
edited — the module builder's preview is the one that sets it. Two things follow.

**Every widget answers the mouse.** `actuable` normally asks "is there anywhere to send this" —
`pluginWritable`, `trackWritable`, `offlineWritable` — and draws a widget read-only when the
answer is no, which is the honest thing on a real graph. On the builder's card the answer is no
for as long as no plugin happens to be loaded, so the panel being authored would be a picture
until somebody opened the plugin behind it: no checking that a dropdown lists the right
settings, or that a knob's range runs the right way, which is most of what looking at the card is
for. A rehearsal needs nowhere to send a value because the optimistic override IS the value, so
its widgets move regardless. A rack pad is the exception and still asks: it wants a *sound*, and
a rehearsal cannot invent one.

**Nothing is committed.** Both commit paths write into a file through the command line — `node
param <module> <name> <value>` for a plugin param, `node param <module> @<field> <label>` for a
module field — and in the builder there is no project node for either to reach, so they would
write into somebody else's song or do nothing at all. Under `rehearsal` both are skipped.

What is NOT skipped is the socket: `setPluginParam` still fires when the host wired it, because
the plugin behind a preview is an orphan instance no project owns. Turning its knobs is how you
*hear* the module, and nothing about that is saved either.

Module fields get one extra thing under rehearsal: an optimistic override. The normal path
refuses optimism on purpose — the engine learns a field by rebuilding, so the reload IS how it
takes effect and showing the value early would be a guess about a round-trip. In a rehearsal
there is no round-trip to guess about, so without the override a dropdown would open, list its
entries, and snap back to what it was.

## …and the clips the lane holds

Under the controls, a track node lists **what is on the lane** — the clip refs, in playing
order. Routing alone says where a track's signal *goes* and never what it *plays*, which makes
"which take is on this lane" a question about the lane you have to leave the lane to answer.

Above the list, a **mini timeline** the width of the node: one block per clip, placed where it
starts and as wide as it runs, on **white** — the strip stands for the song itself rather than
for more of the card's chrome, so the blocks have to read as material on tape.

A block is drawn in the **track's own colour**, which is what makes two lanes tellable apart at a
glance; a lane authoring none falls back to the node's accent. A **missing** clip overrides both
and is red: the graph must not paint absent material in the reassuring colour of the lane it is
missing from.

### Where the lengths come from

The routing model does not have them. `loadGraph` reads track files *without opening the clips
they name*, so `Placement` carries a position and no extent (see `@studio/song`). The lengths
come from the **compiled project** instead — the only thing that resolves a placement into a
duration — and the file service hands them to `buildGraphDoc` rather than compiling again: the
graph is polled, and the workspace already holds that document memoised on the revision.

Two consequences worth knowing:

- a compiled `length` of **0** means "the source's natural length", which neither side knows.
  The file service substitutes **4 beats** — the same stand-in st0's timeline draws for the same
  case — so a clip is not one width on the lane and another on the graph;
- a project that **will not compile** has no extents, and the graph still builds. It loses the
  widths, not the clips: this is the screen you fix a broken project from.

A very short clip is floored at `CLIP_MIN_W`. One bar in a six-minute song is a fraction of a
percent — invisible, and impossible to hover — and the timeline is only for finding things.

Its scale is **shared by every lane in the graph** (`clipSpanOf`), not each lane's own extent. It
runs to the **end** of the last clip rather than its start, or the final block — usually the
longest — would hang off the right of every node. A
mini timeline is read by comparing lanes; one that rescaled per track would draw a lane whose
last clip is at bar 3 and one whose last is at bar 300 with that clip hard against the right
edge in both — worse than no timeline, because it is believable.

The timeline draws **every** clip while the list shows the first few: a picture of the lane with
clips missing from it would say the lane is emptier than it is.

**Hovering a block bolds its row below.** That link is what ties the two halves together — the
timeline says where, the list says what — and it is why `ClipList` is its own component: it needs
state, and the node around it is memoised so a pan or a meter frame re-renders no card at all.
The hovered row also lifts its opacity, because bold alone reflows the row as the letters widen.

Each row is **the position, then the name** — `5:1  chorus`. Where first, because a lane is read
down its positions and they are what orders the list; a fixed-width column of them with tabular
figures stays a column however long the names beside it are. The timecode never shrinks and the
**name** is what gets ellipsed: a truncated name still identifies a clip, a truncated timecode
says nothing at all.

Rows are separated by a **rule**, and the list by one from the controls above it. A gap alone
leaves the short rows reading as one block of text.

The list comes from `WebGraph.trackClips`, which the file service fills from the compiled
track's `placements` and **sorts by position**: authored order is whatever someone typed, and a
track file may name a clip at bar 9 before one at bar 3.

`tc` is spelled **there**, with `beatsToPosition`, and not in the browser. Turning beats into
bars needs the project's meter, and a renderer dividing by four would be right for every song in
4/4 and wrong for every waltz — which is exactly where nobody would look. One function spells a
position in this app; the graph carries its answer.

`CLIP_ROW_H` and `CLIP_LIST_PAD` have to track the CSS in `DomChains`: dagre is told the height
here and draws nothing, so a row taller than the constant reserves too little and the last clip
spills out of the card.

Three rules, each paying for itself:

- **A lane with no clips gets nothing** — no empty list, no heading. A node that has grown to
  say "0 clips" has grown to tell you nothing. Groups and strudel lanes hold no placements at
  all, so they never get one either.
- **The height is computed before layout** (`clipsOf`, added to `nodeSize`'s), because dagre is
  told the size and reserves the space. A list added after layout would spill out of the card.
  The **width is untouched**: a card is as wide as its mixer grid, and a long clip name is
  ellipsed rather than allowed to push a whole rank sideways.
- **Past `CLIP_LIST_MAX` (6) the rest is counted, not listed** (`+4`). A lane with sixty takes
  would otherwise be a node taller than the window, and this is a picture of the ROUTING — the
  timeline is where a full clip list belongs.

A **missing** clip is drawn red. It is the state this list is best at catching: on a routing
diagram, a lane pointing at material that is not there looks exactly like a full one.

The list is hidden at far zoom with the widgets, for the same reason they are — at that scale a
column of clip refs is a grey smear.

## Ports

A node's sockets are decided here, not in the renderer: how many show depends on what is wired
to the node, and that is a fact about the graph. `jacksFor` is the whole rule and `buildGraph`
runs it in a last pass, once every edge exists — a module is fed from its own chain *and* from
whatever routes into it from elsewhere, and the second kind is only known after every chain has
been walked.

Inputs **reveal themselves**. Every mandatory port is drawn from the start: a socket that has to
be fed is a thing to say up front. Past those, exactly one free jack appears beyond the last
occupied port — so a crossfade with its flow wired offers its second input, and a module with
four optional ports and one in use does not present three empty holes to someone using one. One
past the *last occupied* port and not one past the count, or a module fed only on `b` would lose
the `a` the reader is looking for.

### Plusieurs câbles sur un module qui ne déclare aucun port

Un module sans `inputs:` n'a qu'une prise — celle que tout module a. Quand cinq lanes s'y donnent
rendez-vous, comme une platine et ses quatre coupes de stem sur son EQ
(`@studio/song`'s docs/setProject.md), les cinq câbles atterrissaient au même point : un nœud de
fils sur un seul trou, et l'œil ne pouvait plus suivre aucun d'eux.

Il montre donc **une prise par câble arrivant à nu**, réparties sur son bord comme le sont les
autres. C'est du **dessin et rien d'autre** : le signal atterrit sur la même entrée, il n'y a pas
cinq entrées. Un module qui déclare des ports est laissé tel quel, et ça n'est pas une omission :
là les prises portent des noms qui veulent dire quelque chose, et étaler sur elles des câbles qui
visent tous le même port serait un mensonge plutôt qu'une commodité.

Chaque câble garde son rang (`targetSlot`), attribué dans l'ordre de déclaration du graphe. Un
rang stable est la moitié du bénéfice : une image où les câbles changent de trou d'un rendu à
l'autre serait pire que le nœud, puisque l'œil suivrait un câble qui a bougé. Le rang est porté
par l'arête jusqu'aux deux endroits qui la recopient — l'oublier dans l'un des deux remet tout le
monde sur la prise 0, ce qui est exactement l'ancien comportement et ne se voit qu'à l'œil.

Mesuré dans le banc `Chains/Ports/ManyIntoOne` : le nœud `eqA` montre six prises à 15, 38, 60, 83,
105 et 128 px de son bord gauche, et les six câbles arrivent à six abscisses distinctes. Six et non
cinq — une chaîne de bus part de son propre point de rendez-vous, donc sa lane est un câble aussi.

Outputs do not. All of them show at once, because an output is offered rather than required and
there is no progression to disclose. Their occupancy is per SOCKET, like the inputs': an edge
records which jack it left from (`sourcePort`), so `deck#cue: [ phones ]` fills the `cue` socket
and leaves the others hollow.

Two things make that work: the edge carries `sourcePort`, and `link()` keys a cable on the
SOCKET rather than the pair. Union those destinations onto one node instead and a module's
outputs all read the same — a splitter feeding one target from two outputs drawing a single
cable, from whichever jack was seen first.

Three nodes are special and each for its own reason. A **sink** has no output jack: it is where
signal stops. A **live input** is its mirror and has no input jack — nothing plugs into a preamp,
and the socket it listens on is a param picked on its card, not a hole on its edge. `monitor` is
what names one, because the file service sets it for an io `in` step and for nothing else. A
**curve** is off the signal path entirely — it drives a knob rather than plugging in — so it is
left out of `jacksFor` (which types a jack by the signal it carries, and a curve carries none)
and the renderer gives it one mauve socket of its own. An **automation** edge occupies no jack
for the same reason; counted as a feeder it would have revealed the next free socket for nothing.

A **track** has an input jack — what a lane PLAYS is its clips, which is no reason nothing can
arrive on it — typed by what the lane puts on the wire, so a midi lane offers a midi socket
rather than the audio an unfed jack falls back to.

And it has **two outputs, `audio` then `midi`** — orange, then blue, left to right. A lane is not
typed by what it carries (`@studio/song`'s docs/trackModules.md): it holds events naming clips and
events naming sequences in one list, and each leaves by the port its own material fits. The list
is `TRACK_OUTPUTS`, in `@studio/graph-model` beside `splitPort` and for the same reason — the
compiler builds the lane module's ports from it and the renderer draws a jack per entry, so the
sockets and the refs cannot come to disagree about how many there are or which is first.

The ORDER is load-bearing twice over. A cable that names no port is the **first** output — that is
what `isFed`'s `i === 0 && fed.has("")` says in the compiler and what `cablePath`'s `: 0` says in
the drawing — and audio is what a bare-wired lane overwhelmingly carries. Swap them and every
cable that names no port lands on the blue socket.

A lane's outputs are also its SENDS, so an output already feeding something grows a free twin
beside it (`spare` in `jacksFor`), or a lane feeding one thing could never feed a second. The twin
carries the **same address** as the cable already on it — unnamed when that cable named no port —
so a second send off a bare-wired lane writes `gtr: [ amp, reverb ]` the way the first was
written. Naming it would write `gtr#audio:` beside `gtr:`, and two keys SPLIT the lane into two
engine tracks: a drag for a second send would quietly re-route the lane's material, which is not
what anybody reaches for a spare socket to do.

That is also why lifting a cable matches on `port === jack.name` **or** `no port && index 0`: a
bare cable sits on the first socket, which does have a name. Without the second half the cable
is drawn plugged into a jack that will not give it back.

> What may LAND on that socket is narrower than what may be dragged to it: a run carrying a live
> interface input, and nothing else — recording a preamp onto a lane. `graph chain connect` asks
> the same question `packages/song` asks, by walking UPSTREAM of the cable's source
> (`runCarriesInput`). Refusing every track outright would be stricter than the model it guards
> and leave an `IN` node in the graph with nowhere to go; and since the derivation splits
> `mic → comp` into two chains, reading either one's steps would answer no for every recording
> path with a plugin on it.

A destination naming a **track** lands on the track node itself rather than on the first module of
that track's chain: that is where a live input's signal actually arrives, ahead of the lane's
modules, and it is what `IN:in-2: [ ge.rythm ]` says. Checked before `isChain`, which says yes to
the same name — a track-fed chain is called after its track. Only inputs reach there; every other
destination is a bus (named after the module it starts at) or a sink.

The **pending** node — the module being created, drawn where it will land — gets no sockets at
all, because it is not built by `buildGraph`. That is the right answer rather than an oversight:
it is dashed and spinning because it does not exist yet, and a socket would claim otherwise.

`DomChains.stories.tsx` in the react package draws each of these cases; it is the only way to
look at them without starting the engine, the tray, the file service and the editor.

> A curve's own vocabulary — the three types, what each is a function of, and why only a `custom`
> one has points on the wire — is `@studio/song`'s docs/curves.md.

## Cables

A cable carries what its **source** emits: the upstream module's type folder, or — from a lane —
the OUTPUT it left by. An instrument takes midi and emits audio, so the cable into it is blue and
the one out of it orange. A video lane puts picture on the wire whatever `trackSignals` says.

A lane is not typed by what it carries: it offers an `audio` and a `midi` output, and a run that
named one says so as `WebChain.fromPort`, which is the signal AND the jack the cable is drawn from
— that is what keeps a split lane's two cables apart instead of stacking them on one socket. A run
leaving the lane bare falls back to `trackSignals`, which is what the lane HOLDS: midi when every
event names a sequence, audio otherwise. See @studio/song's docs/trackModules.md.

**The main output IS drawn, and it carries a fader** — `drawMainOut`, on by default and on
everywhere. `MAIN_OUT_UI` is its panel: one widget, a fader bound to `Volume`, which is the song's
output level (@studio/song's docs/masterVolume.md). A built-in UI like `TRACK_UI`, because this
node has no `module.yaml` to declare one in — but with an ORDINARY bind rather than an `@`
intrinsic, since `node param "OUT" Volume <dB>` is a real command. So the renderer's usual write
path reaches it with nothing routed specially, and the header's own fader and this one are two
views of one number.

Its travel is **-60 to +12**. -60 at the bottom where the field goes to -100, matching the header's
fader: below -60 the curve is silence, and spending most of the throw on the difference between
inaudible and more inaudible leaves the useful range unusable. +12 at the top is the field's real
ceiling — this gain does not borrow Tracktion's +6 curve, which is why it is not `TRACK_UI`'s
number.

Both `MIX`/`RENDER` and `OUT`/`VIDEO_OUT` are **spelled out here rather than imported**: @studio/song
owns those names (`MIX_NODE`, `RENDER_NODE`, `VIDEO_OUT_NODE`) and this package deliberately does
not depend on it. They are taken literally elsewhere too — `nodeProject`'s `isSink` — which is why
each is a bare name rather than a shape.

The level is not in the graph document — it is a project setting — so it arrives as
`mainOutVolume`, the same way `inputDevices` does. Absent, the card still draws and its fader reads
unknown rather than claiming a level nobody supplied.

> **What turning it off would buy is arithmetic**: a card, an edge and a rank per chain that
> reaches it, repeating what the shape already says. Lanes end at `MIX` and only the master run
> reaches `OUT`, so the card costs exactly one node — and it is the node the output level lives
> on.

Only OUT gets the panel. Any other destination the graph cannot account for as a track, a chain or
a used module is still drawn as a plain sink, because that name has nowhere else to appear.

### The sum is implicit

**No cable is drawn INTO `MIX`.** Every chain in the song ends at the sum — that is what a mixer
is — so those arrows say nothing the picture does not already say: one per lane, crossing it end
to end, and tying every run in the song to a single rank. `buildGraph` skips a destination of
`MIX` (`MIX_OUT` here, `MIX_NODE` in @studio/song) and draws only the run that LEAVES it:

```
MIX ─ [ the master chain ] ─ OUT
```

standing on its own, joined to nothing else in the drawing. The routing is untouched: this is the
picture, and the engine reads the compiled document, where every one of those lanes still arrives
at the sum.

`MIX` is drawn **once**, as a sink, exactly as `OUT` is, and getting that wrong makes two cards.
The master run is written `from: MIX` and NAMED after the sum, so `c.from !== name` is false and
it falls through to the track branch — a lane strip with mute, solo, arm, volume and pan, on the
one built-in node that deliberately carries no parameter at all (@studio/song's
docs/masterChain.md), its knobs addressing a track that does not exist; the empty run then adds a
pass-through card beside it, labelled MIX as well. `entryId`/`exitId` answer with the MIX card
itself for a master run holding no module, and that is what collapses the pair into the one wire
above.

**Liveness has to be SEEDED there**, and that is the cost of the rule. A cable ripples when signal
reaches it, and `computeLive` walks FORWARD from the metered tracks — so a card nothing arrives at
is a card liveness cannot arrive at either, and the master run — the one cable carrying every note
in the song — would be the only still cable on a playing graph. `cables.ts` therefore starts the
walk at `MIX` as well as at the tracks whenever any track is metered. Exact rather than a stand-in: every track
feeds the master bus whatever its chain names (@studio/song's docs/masterChain.md). `RENDER` is
seeded the same way, off the picture's own list of live lanes — which is derived from the shots
and the playhead, nothing metering a frame. See `computeLive` and
@studio/ui-chains-react's docs/liveCables.md.

That list is `liveVideoLanes`, and it is the meters' opposite number. The engine measures sound and
knows nothing of the frame (@studio/song's docs/picture.md), so a video lane's cables have no meter
to ripple from — the one part of the graph that could never come alive by observation.
What the browser HAS is the shots and the playhead, which is the same bargain st0 already strikes
for a rack's lit pads: derive it rather than observe it. The spans are half-open, like the
compositor's own `activeAt` — a cut belongs to the LATER shot, so two shots meeting at a boundary
never both count — and they are the host's to compute, from the same document the viewport draws.

`insertFor` offers an arrow's `+` whenever at least one end is a module, and does **not** demand
that both ends belong to the same CHAIN. `chains.yaml` states its edges outright, so an arrow IS
the address; a same-chain rule would quietly refuse a track feeding a bus or a split's branch,
which are ordinary arrows.

It offers one **between two SINKS** as well, which is the wire above: `MIX → OUT`, the master run
with nothing on it yet. A module-at-one-end rule refused exactly the line every template writes for
something to be dropped on (@studio/song's docs/masterChain.md), leaving the one place in the graph
a master effect belongs as the one place the `+` never appeared. Two TRACKS are still refused, and
that stays a defence rather than a rule anybody meets — two lanes never share an arrow.

A project that declares no master run at all has its cables into the sum skipped just the same,
so the pair is drawn anyway whenever something routes there.
Not an invention: with no master chain the two ARE one wire. A host that asked for no device card
(`drawMainOut: false`) gets neither end of it rather than half.

### …and the picture's sum is implicit for the same reason

`RENDER` and `VIDEO_OUT` (`RENDER_NODE` / `VIDEO_OUT_NODE` in @studio/song, whose
docs/videoOutputs.md is the page) are drawn by **every rule above, unchanged**: no cable into the
sum, one card each, the sum ranked where a lane is rather than where a sink is, the pair
synthesised when the file declares no run, and both devices governed together by `drawMainOut` —
which is what a host asking for it means, "do not draw where the signal leaves", and a picture
ending nowhere beside a sound ending at a card would be half an answer.

Three things differ, and only three:

- the wire out carries **`video`**, which is what makes the run read as picture across the graph.
  `exitSignal` answers for a sum by name, because it cannot answer by following `from`: the run is
  NAMED after the sum, so the recursion re-enters the same chain and stops on `seen`. An EMPTY
  master run would otherwise reach its device untyped — the audio one draws as audio by default
  and gets away with it, the video one does not;
- `VIDEO_OUT` gets **no panel**. `OUT` is the one built-in name with a param on it; a frame has no
  level, and a fader there would write a value `@studio/ui-eyes` never reads;
- neither name is ever typed by hand. A project with a viewport gains the run when the surface is
  created and, failing that, when it is opened.

A cable **plugs in**, and runs **straight**. dagre routes to the node's border, which is the right
target for a cable ending in an arrowhead pointing at a card; `cablePath` moves both ends
onto the sockets instead — the one the destination NAMES (`crossfade#b`) on the target side, and
the one the edge left from (`sourcePort`) on the source side, falling back to the first output
when the chains file names none.

Its waypoints are **dropped**. Kept, they bend a send around the module it skips — the right
answer for a flow chart and the wrong one for a patch bay. A rack's cables
run straight between plugs and cross where they cross, and reading one is following its ANGLE
out of a socket, which a bend destroys. dagre still places the nodes; only the routing is ours.
No short leads squaring each exit either: they exist only to fight a curve that is not drawn.

There is **no arrowhead** on a signal cable. The plug is the socket it disappears into — the
nodes paint over the cable layer, so the last few pixels are hidden by the plate and the cable
reads as seated. Direction is not lost with the head: the layout is left→right and every socket
is on the side its signal uses. The one arrow left is the **automation** one, and it earns its
head by not plugging into anything: it leaves the curve's socket like any other cable and then
lands on a knob in the middle of a card, where a headless line would not say which knob.

The socket's position is one rule in one place: `jackPoint` and the plate's CSS are both driven
by `PORT_PLATE`, which the renderer interpolates into its stylesheet. Two numbers here would be
a cable that ends near the hole rather than in it, and nothing would ever say so.

`link()` adds a connection once — but "once" is per SOCKET, not per pair, and the key has to serve
two truths at the same time. The same link can be expressed from either end (`A.out: [B]` and
`B.from: A`) and only one of the two carries ports, so those must collapse into one arrow, keeping
any gain label; chains cannot loop, so a reverse edge is the same connection seen from the other
end and collapses too. But a module that splits feeds one target from several of its outputs
(`sep#drums: [mix]`, `sep#bass: [mix]`), and those are genuinely different cables that must NOT
collapse — keying on the pair alone draws the second as the first, leaving one arrow out of the
wrong jack. So an expression that names ports gets its own identity and one that names none merges
into whatever cable already joins the pair, order-independently, because the two ends are visited
in whatever order the chains happen to be in. The port is IN the edge id, and the renderer keys on
it.

What *leaves* a chain is normally its last module's output. A chain with no modules is a
pass-through: it emits whatever reached it, so the follow walks its `from` (a track's own
signal, or recursively the chain upstream). A `seen` set guards that walk — chains should
not loop, but a graph being drawn is often one the user is still fixing, and a renderer must
not hang on a cycle that `validate()` will flag.

### The `from` guard

An input link is a chain-feeds-chain link only when `from` names a **different** chain and
**not** a track. Both guards earn their place, because a chain is named after its source
track when it is not named explicitly — so `from` and the chain's own name are usually the
same string:

- `!isTrack` — the track exists, so this is an ordinary source. `isChain` alone would
  mistake it for the chain of the same name.
- `!== name` — the track does **not** exist (a rename `graph.yaml` has not caught up with).
  `isChain` then finds this very chain, the link collapses to a self-loop, and `link()`
  drops it — taking the track node with it. A stale reference made the whole track *vanish*
  instead of showing up broken. Fall through and draw it; `validate()` says why.

## Automation edges

One curve node per binding, arrowing into the module's param. Each binding is its own node —
a curve id reused by two params draws twice — so the id carries the chain, the step and the
param. The edge bypasses `link()` (no collapse, no gain) and carries the automation payload
the renderer draws purple.

One node per CURVE is the tidier rule — a curve is one thing however many params it drives, each
binding an edge out of the same card, and drawing it twice makes "where is this curve" two
answers. It fails because a curve node has an INPUT: an envelope is restarted by an event, and
which module fires it is per binding. One card with two event sockets cannot say that the same
shape is fired by the drums here and by the synth there; two cards say it by standing apart. The
shape is still one file on disk and the label is still the curve's id, so the two instances are
legibly the same curve.

An `adsr` curve therefore also gets the cable that FIRES it, from the announcing module's note-on
into the curve's event socket. It runs the other way to the automation edge — events in, values out
— which is what makes the pair readable as a loop. The trigger defaults to the module being
automated, which is what the compiler does (`nodeProject.ts`), and is drawn from the same field so
the picture cannot claim one source while the bake uses another. `curveSubLabel` tells `adsr` from
`custom` for the same reason: an envelope is the one curve here that is not a function of song
time, and a reader who cannot tell them apart cannot tell why one has a socket on its left.

The arrow lands on the **widget** bound to that param when the module draws one; with no
widget it points at the module's border and the param name is shown as a label.

`GraphNode.curveOf` carries the curve, the module and the param rather than letting the renderer
parse them back out of the node id, which spells the same thing: a module ref may itself contain a
colon (`synth:lead`), so `crv:env1@synth:lead:Filter Freq` has no unambiguous reading. The renderer
needs all three to write `node automate`, and a gesture that guessed them wrong would rewrite
somebody else's binding.

A curve **nothing binds** is drawn free-standing, one card, driving nothing yet. A curve is a node
like everything else here, so `curve new` has to put something on the graph: an unreferenced curve
drawing nothing at all would make the verb's result invisible and the canvas menu's "add a
curve" a promise with no picture behind it. Its id carries no binding, which is exactly what tells
it apart from an instance — one free card per curve, one bound card per binding.

## Orphans are drawn

Tracks no chain mentions are drawn as orphan nodes: a node with nothing wired to it. Leaving
them simply absent is the worst way to show a problem — the track exists, holds
its clips and still plays (dry, straight to the main out; a chain is what *adds* plugins and
sends, not what makes a track audible), so a graph that omits it quietly claims the song has
fewer tracks than it does. Rename a batch of tracks and their chains point at the old names
while the new ones are nowhere on screen.

`sub` carries the reason, so the node says what is unusual about it rather than leaving the
reader to notice a missing cable. They are **not dimmed** — dim means bypassed here, and an
unrouted track is playing, not muted.

Video lanes are in the same list for the same reason: one that no chain mentions still
draws (`project.layers` composites it), so leaving it out would understate the song exactly
as it does for audio.

## Layout

Rank hints go to dagre: track nodes at 0, modules at 1 + their maximum position across all
chains, sinks one past the deepest module, and chain pass-through nodes at 1. Taking the
*maximum* position matters for a shared module — at index 0 in chain A and 2 in chain B it
ranks after both, so chain A's full pipeline is still respected.

**Every rank ends up on its own row**, and that is `layout`'s doing rather than dagre's. The
ranks are computed here and handed over; dagre treats them as a hint. Its `longest-path` ranker
pushes a node as LATE as it can, hugging the sink below it, so on a fifteen-track song rank 1
spreads over SIX lines, from y=16 to y=1380 — a first-in-chain module sitting on the mixer
line, at the bottom of a column it belongs at the top of. That is what a stretched chain looks
like: the mixers pinned deep, and the one module above them dragged down to meet them.

So `snapToRankRows` makes the rank mean what it says. One row per rank, in order, each as high
as the highest thing dagre put there and never overlapping the row above. Tracks are rank 0, so
the source line falls out of the same rule rather than needing one of its own.

Two things follow, and both were found by measuring rather than by reasoning:

- **The rows are swept for collisions.** dagre places x assuming its own y, so two nodes it put
  on different lines may share a column — collapsing them onto one row is what makes them
  overlap. One such pair on that same song, a module nested inside another. Each row is walked
  left to right and anything landing on its neighbour is pushed past it by `nodesep`.
- **The extent is measured on the nodes**, not read off dagre. Its figure describes the picture
  before the rows move: 488px short on that song, which is the bottom of the graph missing from
  every camera fit.

The extent has a second end, `left`/`top`, and it exists for the same reason. dagre lays out from
`marginx`/`marginy` down and right, so both are 0 for a graph nobody touched — but a **pin** can
sit anywhere, including above the first track, and `width × height` measured from the origin says
nothing about that. A camera framing the extent alone would cut off exactly the cards somebody
dragged up there, or force the drop to clamp to `0,0` instead. Both are floored at 0
(never positive), so the box a fit reads — `width - left` by `height - top` — is the extent
unchanged for every graph that begins at the origin.

Only the y is legislated. The x stays dagre's, so the gap along a row varies with what hangs
under each column — right for tracks and modules, which are the tops and middles of chains of
different widths. The mixer row asks for even spacing separately (`spaceModulesEvenly`), because
a rank of channel strips is the one place it is wanted.

Layout is **top→bottom** layered. dagre's routed edge points are computed and then **not used**
— see the cable section above for why a straight line beats a bend here. dagre returns node
centres; we store top-left (what a renderer wants), and an edge keeps its two ends only so a
renderer can still draw something for a node it cannot find.

The direction is a `rankdir`, and three things follow it: `nodesep` and `ranksep` swap axes
(siblings side by side, stages one under the next, and the numbers swap with them),
`jackPoint` puts inputs on a card's TOP edge and outputs on its bottom, spread across the
width, and `cablePath`'s straight leads run on Y. Those three have to agree with the plate
positions the renderer sets inline — the socket and the cable's end are one place drawn
twice, and a disagreement reads as a cable that misses its plug.

The one surface that stays horizontal is `moduleRow`, the Mixer's rank of strips: it lays its
own nodes out and never calls `layout`, because a row of mixer strips is a row and not a
signal path.

### Pins, and where a card was drawn last time

`layout` takes two overrides and applies them AFTER the rank snap and BEFORE the extents, so a
held card both wins over the rows and still counts toward the graph's measured size.

`positions` is what somebody PINNED — `chains.yaml`'s `positions:`, keyed by chains name. Those win
over everything the ranker decided, and dagre only ever places what has no entry: a module dragged
once stays where it was put, a new one still arrives laid out. `prev` is where each node was DRAWN
last time, keyed by node id — the host's session memory, so an edit (a cable pulled, a module
dropped in) never reorganizes the picture. Pins outrank the session, because the file outranks it:
another tab may have written one. `graph organize` is the command that empties both and lets dagre
speak. The name resolution is `cables.ts`'s `jackRef` — a module by its chains name, the rest by
label — inlined here because `cables.ts` imports this file.

### The mixer's row, three functions deep

`alignModuleRank` pulls the named modules onto ONE rank. The mixer view is that and nothing else:
the same graph, the same cables, the same cards, only the ranks move. Every track ends on a mixer,
but a track with a longer chain ends DEEPER, so by default the mixers sit on a staircase and no
zoom shows them all. The shared rank is the DEEPEST of theirs, never a shallower one — pulling a
mixer up would put it above modules that feed it, and an edge that has to climb is a cable drawn
backwards. Sinks are pushed past it for the same reason, since they carry a rank computed before
this ran; the two SUMS are exempt, being drawn as sinks while standing where a source does. It
returns a new array, so the plain layout stays available to anything drawing the same graph beside
this one.

`spaceModulesEvenly` then gives the row one rhythm. dagre spaces a rank by what is above it — a
track with a wide chain pushes its mixer away from its neighbour — so a shared rank alone still
reads as a scattered line rather than a console. Equal GAP and not equal pitch, because the cards
are not all the same width and it is the space between them the eye reads as regular. What it costs
is upstream: the chains feeding the row are not straight columns, and they are not meant to be. Their cables need nothing done about them, since `cablePath` reads both ends off the nodes.

`moduleRow` is the standalone surface: the named modules side by side, dagre deliberately not used
— there are no cables between channel strips to route, and the ORDER is the caller's (the song's
track order), which is not a thing a layout engine should be allowed to choose. The cards come from
`buildGraph`, so each is the same card the full graph draws, live values and all; only the position
is ours. A name with no module in the graph is skipped rather than drawn as a gap: the caller's list
comes from the compiled project and the graph is refetched separately, so the two can be one reload
apart and a hole in the row would be the only sign. One height for the whole row, the tallest card's
— a ragged bottom reads as cards of different importance, and the camera fits the row's height to
the view. The cards come WITHOUT their sockets: the plates are CSS-pinned to the top and bottom
edges while this row meets its cables on the sides, and drawing a plug on the wrong edge would be
worse than drawing none.

Its `links` option decides whether the graph's own cables come with them. Off for a rank of channel
strips — nothing runs between two channels, so every socket would be a plug into nothing. On for
one lane's signal path, where the cables ARE the subject: they say what feeds what, and a send that
skips a module shows as the longer cable it is. The edges are the graph's own, kept where both ends
are in the row; nothing is invented between neighbours, because two cards side by side with no
cable between them is the truth about a lane whose chains do not touch.

### The -Infinity extent

dagre reports `-Infinity` for a graph with no nodes — it maxes over an empty set. That is
not null, so `?? 0` never caught it, and not falsy, so a caller's `if (!width)` guard passed.
Framing a camera to that extent yields an Infinity translation and the graph is invisible
for good, because the view believes it has already framed itself. A layout with nothing in
it has no extent: report 0 and let the caller decide there is nothing to frame yet — which
is the truth while a project is still loading.

## Zooming the graph

`zoomGesture.ts` lives here rather than in the renderer because a wheel notch and a trackpad pinch
cannot share one answer, and that is a decision with a right and a wrong result.

A mouse wheel arrives as ONE event per detent with a delta in the hundreds, so `0.001` turns that
into a comfortable ~10% a notch. A trackpad PINCH arrives as Ctrl+wheel — a stream of small
continuous deltas, dozens a second — where the same coefficient gives a fraction of a percent each,
which is the "very slow" you feel with two fingers. Ten times the coefficient makes a pinch track
the fingers and leaves the wheel exactly as it was. The pinch delta is CLAMPED first (`WHEEL_CLAMP`)
because browsers disagree about the units they report a pinch in, and one answering in hundreds
would jump a decade in a single event.

`pinchFactor` measures a two-finger spread against the spread the gesture STARTED at, not the
previous frame: a ratio of ratios accumulates rounding, so you would pinch out and back in without
returning where you began. A zero or negative spread is not a gesture and answers 1.

## The module builder's preview graph

`modulePreview.ts` builds the smallest `WebGraph` that draws one module as the card it will be in a
chain — a source, a chain, the module, a sink — from the panel being edited rather than from a
project. `PREVIEW_SOURCE` stands for "whatever will feed this", because a module editor has no
tracks and a chain's `from` has to resolve to something.

`previewPluginId` is THE one place the engine address `<chain>:<module>` is spelled. Two things
build it — the `ProjectDoc` the engine actually loads (the médiathèque's `engine/preview.ts`) and
the graph node — and they have to agree, or the node names a look-alike rather than the plugin that
is loaded. Nothing would report the disagreement: no type error, no failed request, just a card
wired to an address nobody answers at.

`moduleCategoryOf` reads the segment after `modules/` or `_modules/` rather than a fixed index. The
same module is named `modules/audio/reverb` by the médiathèque,
`_modules/audio/delay/tape-delay/module.yaml` by a shared library, and
`LEMO - DANSE/modules/audio/amp/module.yaml` by st0 in a workspace holding several projects — an
index would be right for one of those and wrong for the others. Anything unrecognised draws as
audio: a glyph is not worth refusing a preview over.

`visibleGrid` drops `hidden` widgets, because that flag is normally resolved away by the merge of a
module over the base it extends and there is no merge on this path. And `bases` is passed for one
reason: a widget bound to `@base` carries no entries of its own — `withFolderOptions` fills them
from the step — so without it the preview drew that dropdown holding `none` and nothing else, which
is the one widget you cannot check by looking at the panel you just wrote.
