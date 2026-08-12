# Building the chains graph (`graph.ts`)

Turns the compiled `WebGraph` into positioned nodes and edges, mirroring the real signal
path: a chain's input and output map to its first and last module (or to a pass-through
node when the chain has no modules), and that is what `from`/`out` connect to.

The file is deliberately **renderer-agnostic** — plain numbers, no Pixi, no DOM — which is
the seam that lets dagre own layout and lets the same geometry serve the hit areas and the
drawing by construction.

## Node geometry

A node with no UI is a fixed size; one with a widget grid is sized BY that grid (`nodeSize`),
and dagre is told the real size so it reserves the space and routes edges around it. A size
it was not told is a node its neighbours overlap.

`NODE_W` is the no-panel size only. It used to be a floor under panelled nodes too, which
parked dead space to the right of every grid narrower than it — a 2-column mixer strip is
84px of controls, and it was drawn in a 160px card. A panel now says how wide its module is,
which is the only thing that knows. `NODE_MIN_W` is all that is left of the floor, and it is
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

## The `sub` line

Only the **shared** case earns one — "this module is in these chains" — a warning that
editing it reaches more than one. It must be computed after the merge: left at whatever the
first insertion computed, it could only ever name the chain that reached the module first,
which is why a shared module never actually showed the list it was supposed to.

A chain's own name used to ride its first module too. That said nothing the drawing didn't:
the cable from the track is right there, and the name is repeated on the track node.

## Track nodes carry a built-in UI

Their five mixer controls are authored with the same widget primitives a module UI uses.
The `@`-prefixed binds are **track intrinsics**, not plugin params: the renderer routes them
to the mixer commands and reads their live values from the track-controls channel.
`@volume` is in dB so a linear knob maps straight onto the fader's range, and it stops at
**+6, not +12** — the engine's track fader clamps there, so a taller knob promised gain it
could not deliver (see `MAX_GAIN_DB` in `@studio/song`).

A **video lane** gets one control. For picture, "mute" means hidden, and there is no solo,
record arm, gain or pan to offer — a full strip there would be four controls that do
nothing.

## …and the clips the lane holds

Under the controls, a track node lists **what is on the lane** — the clip refs, in playing
order. The graph said where a track's signal *goes* and never what it *plays*, so "which take
is on this lane" was a question about the lane that you had to leave the lane to answer.

Above the list, a **mini timeline** the width of the node: one marker per clip, where it sits.

It shows **positions, not durations**, and that is a limit rather than a choice of style — the
graph reads track files *without opening the clips they name*, so a clip's extent is not a fact
it has (see `Placement` in `@studio/song`). A marker is therefore a tick of fixed width centred
on the start, and drawing blocks would mean inventing lengths.

Its scale is **shared by every lane in the graph** (`clipSpanOf`), not each lane's own extent. A
mini timeline is read by comparing lanes; one that rescaled per track would draw a lane whose
last clip is at bar 3 and one whose last is at bar 300 with that clip hard against the right
edge in both — worse than no timeline, because it is believable.

The timeline draws **every** clip while the list shows the first few: a picture of the lane with
clips missing from it would say the lane is emptier than it is.

**Hovering a marker bolds its row below.** That link is what ties the two halves together — the
timeline says where, the list says what — and it is why `ClipList` is its own component: it needs
state, and the node around it is memoised so a pan or a meter frame re-renders no card at all.
The hovered row also lifts its opacity, because bold alone reflows the row as the letters widen.

Each row is **the position, then the name** — `5:1  chorus`. Where first, because a lane is read
down its positions and they are what orders the list; a fixed-width column of them with tabular
figures stays a column however long the names beside it are. The timecode never shrinks and the
**name** is what gets ellipsed: a truncated name still identifies a clip, a truncated timecode
says nothing at all.

Rows are separated by a **rule**, and the list by one from the controls above it. A gap alone
left the short rows reading as one block of text.

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

Outputs do not. All of them show at once, because an output is offered rather than required and
there is no progression to disclose. Their occupancy is per SOCKET, like the inputs': an edge
records which jack it left from (`sourcePort`), so `deck#cue: [ phones ]` fills the `cue` socket
and leaves the others hollow.

That was not always so — this page described the earlier state, where the derivation unioned
those destinations onto one node and a module's outputs all read the same. Two things changed
with it: the edge carries `sourcePort`, and `link()` keys a cable on the SOCKET rather than the
pair, so a splitter feeding one target from two outputs draws two cables instead of one drawn
from whichever jack was seen first.

Three nodes are special and each for its own reason. A **track** has no input jack: what arrives
on a lane is its clips, and there is no socket to look for. A **sink** is the mirror image. A
**curve** is off the signal path entirely — it drives a knob rather than plugging in — so it is
left out of `jacksFor` (which types a jack by the signal it carries, and a curve carries none)
and the renderer gives it one mauve socket of its own. An **automation** edge occupies no jack
for the same reason; counted as a feeder it would have revealed the next free socket for nothing.

The **pending** node — the module being created, drawn where it will land — gets no sockets at
all, because it is not built by `buildGraph`. That is the right answer rather than an oversight:
it is dashed and spinning because it does not exist yet, and a socket would claim otherwise.

`DomChains.stories.tsx` in the react package draws each of these cases; it is the only way to
look at them without starting the engine, the tray, the file service and the editor.

## Cables

A cable carries what its **source** emits: a track's `contentType`, or the upstream module's
type folder. An instrument takes midi and emits audio, so the cable into it is blue and the
one out of it orange. A video lane puts picture on the wire whatever `trackSignals` says.

**The main output is not drawn** — `drawMainOut`, which l8's song graph turns off. Reaching the
sound card is what the END of a chain means there: a mixer sits at it and its whole job is the
level going out, so a card saying "OUT" adds a node, an edge and a rank to every chain in the
song to repeat what the shape already says. Only OUT: any other destination the graph cannot
account for as a track, a chain or a used module is still drawn as a sink, because that name has
nowhere else to appear.

It stays ON by default, because the other pictures built from this pipeline are not songs. The
module preview is one module between a source and a sink, with no mixer in it to imply anything,
and there the sink is what says which way the signal runs. st0's chain view and m9's graph also
still draw it — one argument each if they should follow l8.

A cable **plugs in**, and runs **straight**. dagre routes to the node's border, which was the
right target while a cable ended in an arrowhead pointing at a card; `cablePath` moves both ends
onto the sockets instead — the one the destination NAMES (`crossfade#b`) on the target side, and
the one the edge left from (`sourcePort`) on the source side, falling back to the first output
when the chains file named none.

Its waypoints are **dropped**. They used to be kept, so a send bent around the module it
skipped — the right answer for a flow chart and the wrong one for a patch bay. A rack's cables
run straight between plugs and cross where they cross, and reading one is following its ANGLE
out of a socket, which a bend destroys. dagre still places the nodes; only the routing is ours.
The short leads that used to square each exit went with the curve they existed to fight.

There is **no arrowhead** on a signal cable. The plug is the socket it disappears into — the
nodes paint over the cable layer, so the last few pixels are hidden by the plate and the cable
reads as seated. Direction is not lost with the head: the layout is left→right and every socket
is on the side its signal uses. The one arrow left is the **automation** one, and it earns its
head by not plugging into anything: it leaves the curve's socket like any other cable and then
lands on a knob in the middle of a card, where a headless line would not say which knob.

The socket's position is one rule in one place: `jackPoint` and the plate's CSS are both driven
by `PORT_PLATE`, which the renderer interpolates into its stylesheet. Two numbers here would be
a cable that ends near the hole rather than in it, and nothing would ever say so.

`link()` adds a connection once. The same source→target can be expressed twice (a chain's
`from` and the upstream chain's `out`), so they collapse, keeping any gain label. Chains
cannot loop, so a reverse edge is the same connection seen from the other end and collapses
too — one arrow, not a pair.

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
- `!== name` — the track does **not** exist (a rename `chains.yaml` has not caught up with).
  `isChain` then finds this very chain, the link collapses to a self-loop, and `link()`
  drops it — taking the track node with it. A stale reference made the whole track *vanish*
  instead of showing up broken. Fall through and draw it; `validate()` says why.

## Automation edges

One curve node per binding, arrowing into the module's param. Each binding is its own node —
a curve id reused by two params draws twice — so the id carries the chain, the step and the
param. The edge bypasses `link()` (no collapse, no gain) and carries the automation payload
the renderer draws purple.

The arrow lands on the **widget** bound to that param when the module draws one; with no
widget it points at the module's border and the param name is shown as a label.

## Orphans are drawn

Tracks no chain mentions are drawn as orphan nodes: a node with nothing wired to it. They
used to be simply absent, which is the worst way to show a problem — the track exists, holds
its clips and still plays (dry, straight to the main out; a chain is what *adds* plugins and
sends, not what makes a track audible), so a graph that omits it quietly claims the song has
fewer tracks than it does. That is exactly how a batch of renamed tracks went unnoticed:
their chains pointed at the old names, and the new ones were nowhere on screen.

`sub` carries the reason, so the node says what is unusual about it rather than leaving the
reader to notice a missing cable. They are **not dimmed** — dim means bypassed here, and an
unrouted track is playing, not muted.

Video lanes are in the same list for the same reason: one that no chain mentions still
draws (`project.layers` composites it), so leaving it out would understate the song exactly
as it did for audio.

## Layout

Rank hints go to dagre: track nodes at 0, modules at 1 + their maximum position across all
chains, sinks one past the deepest module, and chain pass-through nodes at 1. Taking the
*maximum* position matters for a shared module — at index 0 in chain A and 2 in chain B it
ranks after both, so chain A's full pipeline is still respected.

**Every rank ends up on its own row**, and that is `layout`'s doing rather than dagre's. The
ranks are computed here and handed over; dagre treats them as a hint. Its `longest-path` ranker
pushes a node as LATE as it can, hugging the sink below it, so on a fifteen-track song rank 1
was spread over SIX lines, from y=16 to y=1380 — a first-in-chain module sitting on the mixer
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
  before the rows moved: 488px short there, which is the bottom of the graph missing from every
  camera fit.

Only the y is legislated. The x stays dagre's, so the gap along a row varies with what hangs
under each column — right for tracks and modules, which are the tops and middles of chains of
different widths. The mixer row asks for even spacing separately (`spaceModulesEvenly`), because
a rank of channel strips is the one place it is wanted.

Layout is **top→bottom** layered. dagre's routed edge points are computed and then **not used**
— see the cable section above for why a straight line beats a bend here. dagre returns node
centres; we store top-left (what a renderer wants), and an edge keeps its two ends only so a
renderer can still draw something for a node it cannot find.

The direction is a `rankdir`, and three things follow it: `nodesep` and `ranksep` swap axes
(siblings are now side by side, stages one under the next, so the numbers swapped with them),
`jackPoint` puts inputs on a card's TOP edge and outputs on its bottom, spread across the
width, and `cablePath`'s straight leads run on Y. Those three have to agree with the plate
positions the renderer sets inline — the socket and the cable's end are one place drawn
twice, and a disagreement reads as a cable that misses its plug.

The one surface that stays horizontal is `moduleRow`, the Mixer's rank of strips: it lays its
own nodes out and never calls `layout`, because a row of mixer strips is a row and not a
signal path.

### The -Infinity extent

dagre reports `-Infinity` for a graph with no nodes — it maxes over an empty set. That is
not null, so `?? 0` never caught it, and not falsy, so a caller's `if (!width)` guard passed.
Framing a camera to that extent yields an Infinity translation and the graph is invisible
for good, because the view believes it has already framed itself. A layout with nothing in
it has no extent: report 0 and let the caller decide there is nothing to frame yet — which
is the truth while a project is still loading.
