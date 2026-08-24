# graph.yaml — the shape, and the edits

The rationale behind `packages/song-schema/src/yaml/graphSchema.ts`,
`packages/song-schema/src/yaml/graphFile.ts` and their test. The compile side lives in
`packages/song/docs/graphFile.md`; this page is about the FILE — what it declares, and what each
edit has to preserve.

## The name, and the one map

`graph.yaml` and not `chains.yaml`: what it holds is the whole TOPOLOGY — which nodes exist, what
feeds what, which are silenced, and where each one sits. Chains are DERIVED from its `modules:` map
(`chainsGraph.ts`), so naming the file after one of the things read out of it had it wearing the
name of its own output. Positions live here for the same reason: where a node sits is a fact about
the graph, not about the node. It is `.yaml` like every other file in a project; the resolver takes
`.yml` too (`yaml/moduleIO.ts`'s `EXTS`), so a hand-written one still reads, but this is what gets
WRITTEN.

There is ONE map, because a lane is a module too (`packages/song/docs/trackModules.md`): every node
is declared in `modules:` and nowhere else, so `hasNode` is one question with one answer and no edit
has to carry a section around. Two halves would mean a lane's destinations could be written into the
wrong one and unwire it silently.

A library CHAIN uses this same file name. It is not a second kind of document that happens to look
like a graph — it IS one: a folder holding this file and a `nodes/` beside it, differing only in
having no `project.yaml` and in naming its ends `@in`/`@out`.

## The three sections

`modules:` is each node's next hop(s), LANES INCLUDED, since a lane is where a run starts and
nothing else about it is different. A key with `[]` is a node in the graph wired to nothing yet,
which is how a module exists before it is placed.

`bypassed:` is the modules the signal passes through untouched. A flat list, so a bypass is one name
appearing or disappearing — and since a module is named ONCE in this file, there is only ever one
thing to toggle. On a LANE it reads as "produces nothing" rather than "passes through": a source has
no input to pass through. That is what a lane's mute IS, and it is why the lane carries no mute field
of its own — one state, one place.

`positions:` is where a node SITS on the graph, in world px, written when someone drags its header
and absent for every node the layout still places (dagre lays out only what has no entry here). It
is cosmetic on purpose: nothing about the signal reads it, so a file without it is the same song —
which is why it is a sibling of `modules:` rather than a field inside it.

## Ports on a destination

A destination may name a PORT on its target: `crossfade#b` feeds the input called `b`. Bare, it
feeds the FIRST input, which is what every chains file written so far says and what a one-input
module means (`packages/song/docs/ports.md`). The port is not validated in the schema — it knows
nothing about modules, and whether `b` exists is a question for `validate()`, which has the module
map. What IS refused is a ref that is all separator (`#b`, `x#`): those are typos with no reading,
and letting them through would make the node name empty.

## The YAML options

Version 1.2, so `5:1:1` stays a string, and no wrapping, keeping a node's destinations on ONE line.
`toString` takes only the rendering half of those, the version being a parse concern.

## What an edit must preserve

Three properties:

- the model survives — nodes, destinations, bypass;
- an EDIT keeps the file — comments, layout, one-line diffs;
- removing a module from the MIDDLE joins what fed it to what it fed, or the signal is cut with
  nothing pointing at the cut.

The canonical form — one node per line, destinations as a flow sequence — IS the contract. A file
spaced any other way is re-spaced by the first edit, and then every node shows up in the diff.

A name like `eq_dj:vox` is a map KEY here, which is where `:` is most dangerous: it is YAML's own
key/value indicator. It survives (1.2 allows it inside a plain scalar when no space follows), but
nothing about that is obvious, and it is the first thing that would break silently.

## The list format is NAMED

A project still carrying a top-level `chains:` list needs the migration, not
`unrecognized key: chains`. So that shape is reported by name rather than as an unknown key.

## The edits, one by one

`addNode` puts a module in the graph wired to nothing. An empty destination list is not a
placeholder — it is what a PLACED module looks like, so a module can exist first and be connected
after, which is how a graph editor is used. Already-known nodes are left alone, so re-adding cannot
silently unwire one.

`setModuleEnabled` joins or leaves the root `bypassed` list, and the list disappears when it empties
— so bypassing and un-bypassing returns the file to what it was. Otherwise a project that has never
bypassed anything carries `bypassed: []`, and the empty list reads as a setting rather than as an
absence. It needs no chain to be named: a module appears exactly once in this file, so there is one
thing to toggle however many runs it sits in.

`insertBetween` is one arrow, one rewire — which is the whole reason the file declares SEGMENTS
rather than paths: there is no chain to find, no position in it, and no index to clamp against the
sink.

`connectNodes` draws a NEW arrow — the graph editor's patch cable. Either end may carry a `#port`
suffix, exactly as the file spells them: the KEY carries the source's port, the destination string
the target's. `from` gains `to` in its destinations, created as a key if the file never listed it (a
node can appear only as somebody's destination until its first outgoing cable). Nothing else moves:
unlike `insertBetween`, no existing arrow is required or touched, which is the difference between
plugging a cable and splicing into one.

`disconnectNodes` is its mirror, and nothing else moves: a source left with no destinations keeps
its key as `[]`, because an unwired node is still a PLACED node — deleting a cable must not also
delete the module it fed from the graph.

`spliceOut` rejoins what fed a module to what it fed. Splicing rather than merely dropping the key
is the point: a module in the middle of a run has an upstream and a downstream, and cutting it out
without reconnecting them would silently cut the signal — the file would still parse, and the track
would go quiet with nothing to point at. The module's own destinations take its place, deduped: two
branches that both rejoined through it must not leave the survivor listed twice.

`unlinkNode` takes a module out of the signal path and LEAVES IT IN THE GRAPH. Every node is in the
graph (`packages/song/docs/nodes.md`): a node with no entry in this file is loaded and drawn nowhere,
and a node vanishing from the canvas reads as a delete, which unlinking is not. Its cables go, its
entry stays as `modules: { <node>: [] }`, and so does its pin: a node that jumped to
wherever the layout put it would have moved for a reason nobody asked for. Its `bypassed:` flag stays
too — it is still a node, and still silenced or not.

`removeNode` takes it out ENTIRELY — the entry, its bypass and its pin. It is what `node delete`
writes once the node's files are gone; nothing may name a node with no file, since that is precisely
what stops the project loading. A name left in `bypassed` after its module is gone is a reference to
nothing, and the next module given that name would come up silently bypassed. A position for a node
that is gone is a key nothing can read.

`renameNode` renames in place, keeping its position: a module has a place in the signal path, and
removing then re-adding it loses that. Only the name changes; what feeds it and what it feeds are
the slot, not what fills it. The key's scalar VALUE is swapped rather than the entry re-added, so the
module keeps its line, its position and any comment on it — and its quoting style is dropped with
it, since a ref like `@engine/…` HAD to be quoted (`@` is reserved) and a plain name does not, so
keeping the old style would leave every renamed module wearing the quotes of the one it replaced. Its
pin follows the rename in place, for the same reason: the node did not move.

## The positions writes

`setNodePosition` rounds to whole px — a hand-editable file has no business carrying thirteen
decimals of a pointer position — and writes a one-line flow map, the destination lists' own style.
Releasing the last pin drops the section, so a fully auto graph leaves no trace behind.

`setNodePositions` pins MANY nodes in one write, which is what a freshly drawn graph records about
itself. A batch rather than a loop, and not for speed: a graph draws sixty-odd nodes, and sixty
writes would be sixty entries in the undo journal for one picture that was never rearranged by hand.
One write is one thing that happened. Existing pins are LEFT ALONE — the caller sends the nodes the
layout had to place itself, and a node already carrying a pin was not placed by the layout, so
overwriting it would move a card somebody put somewhere on purpose.

`clearNodePositions` drops the whole section: `graph organize`'s write, every node handed back to the
layout at once and the file left as if nobody had ever dragged a card.

`dropPosition` is guarded, because `deleteIn` THROWS on a path through a section the file never had.
