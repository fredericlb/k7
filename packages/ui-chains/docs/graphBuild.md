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

## Cables

A cable carries what its **source** emits: a track's `contentType`, or the upstream module's
type folder. An instrument takes midi and emits audio, so the cable into it is blue and the
one out of it orange. A video lane puts picture on the wire whatever `trackSignals` says.

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

Layout is left→right layered, and **dagre's routed edge points are kept**, so a send that
skips a column bends around the module in between instead of slicing through it. dagre
returns node centres; we store top-left (what a renderer wants) while the edge points stay
in the same absolute graph space.

### The -Infinity extent

dagre reports `-Infinity` for a graph with no nodes — it maxes over an empty set. That is
not null, so `?? 0` never caught it, and not falsy, so a caller's `if (!width)` guard passed.
Framing a camera to that extent yields an Infinity translation and the graph is invisible
for good, because the view believes it has already framed itself. A layout with nothing in
it has no extent: report 0 and let the caller decide there is nothing to frame yet — which
is the truth while a project is still loading.
