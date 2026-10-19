# graphFile.ts — extended notes

graph.k7x declares SEGMENTS — one `modules:` map, each node listing where its signal goes (a LANE is a module
too, see trackModules.md, which is why there is no second half) — and the
chains are derived from them (chainsGraph.ts). Everything here follows from that: an edit is an edge rewire, and
a module is named exactly once.

The four edits the app actually makes (the honest test set):

- **bypass a module** — the graph's bypass button, many times a session
- **insert a module** — `node insert`, and the graph's drop-on-an-arrow
- **take a module out of the signal path, leaving it on the canvas** — `graph unlink`; `node delete` is the one
  that removes it, and removing its FILES is the file tree's business rather than a verb here
- **rename a module** — forking a shared module into the project (`node replace` repoints a node's `extends:`
  and never touches a chain)

## What the shape gives

- **Bypass needs no chain named.** A module is named once here, so there is one thing to toggle: no finding
  which chains hold it, no refusal when there are two, no chain name carried alongside the module in the
  frontend. That is why `bypassed` is a flat list at the root and not a field on the node: there is no second
  copy for it to get out of step with.
- **Insert is two node names, not a chain and an index.** `insertBetween` takes the two ends of one arrow,
  which is what the caller has in the first place — no position in a list to clamp so the module stays ahead
  of the sink.
- **Remove has to SPLICE.** The gap has to be closed on purpose — whatever fed the module now feeds what it
  fed — or the file still parses and the track goes quiet with nothing to point at.

## Formatting

- A node's destinations are a FLOW sequence on one line. In block style each destination is its own line, so a
  ten-module song becomes forty lines and an insert is a four-line diff; in flow it is one line per node.
- The file has to already be in the library's own flow spacing (`[ a, b ]`). Edit a file written any other way
  and every flow line in it is re-spaced — a diff on nodes nobody touched. `formatChains` emits the canonical
  form, and the migration writes it.
- A node's destinations are written `inline`, on ONE line whatever their length: at the printer's 100 columns a
  node that grew past it would be re-emitted across several lines.

## The colon

Module names carry `:` — `eq_dj:vox` is a node, `@engine/io/IN:in-1` an inherited one. They are map KEYS, and
a k7x key holding `:` is quoted, like one holding a space. A ref starting with `@` is quoted for the same reason.
The library
quotes them on its own — but `renameNode` clears the scalar's `type` when it swaps a name, or every module
renamed over a ref would keep wearing the ref's quotes.

## The derivation — chainsGraph.ts

A chain is a maximal linear run: it breaks where the signal splits and where two signals meet.

### Who is a LANE

The runs are named after the lanes, and `from` is what says so. The file cannot answer this on its own: with one
`modules:` map, `melody` and `reverb` are spelled identically and only what they EXTEND tells them apart
(trackModules.md). So the caller that holds the module map supplies `isLane`, and one that holds no project — a
chain template in the médiathèque, the editor's live re-parse — supplies nothing and gets `@in` alone, which is
exactly the lane a template has. `@in` is the source a chain TEMPLATE starts at (a lane's place, without a
lane) and `@out` stands where a song's `OUT` sink does.

`@in` is a lane wherever it appears: it is the one name that means "the signal starts here" with nothing behind
it. `MIX` is one for the same reason and by the same rule — the mixer's sum is where the MASTER run begins, it
is fed by every lane rather than by one, and a run headed by it must carry `from: MIX` or the compiler cannot
tell it from an ordinary bus. Being a lane also keeps it from being ABSORBED: every lane feeds it, so without
that the last chain to arrive would swallow the whole master run as its own next steps. `RENDER` is the third,
and every word holds for it unchanged — it is the compositor's sum, every video lane arrives there, and the run
out of it is the picture's master chain (videoOutputs.md).

`deriveChains` accepts the raw value, since project.k7x may inline it, and validates: a caller holding an
unparsed object should still get chains or a clear failure, never a half-read graph. A file in the chain-LIST
format is named precisely rather than reported as an unknown key — someone opening such a project needs the
migration, not a schema error.

`bypassedOf` has its own reader because a LANE's mute is its bypass, and the lane projection needs the set
before any chain is derived: a lane appears in `from`, never in a step, so `Step.enabled` never carries it. It
is total on garbage — a file the schema would refuse still has to draw its lanes, and "nothing is muted" is the
right answer to give while the editor reports why.

### Nodes, not ports

Everything in the derivation reasons about the NODE, never the port: `crossfade` fed twice is one meeting point,
not two nodes. The port rides along on the edge and is read back where it means something — which input of the
target this feeder lands on.

**A LANE keyed on more than one output is the one exception**, and the whole of what detyping costs the
derivation. A module's outputs are one signal path as far as the engine is concerned (`out` compiles as a
parallel send — ports.md), so `stemsplit#drums` and `stemsplit#vocals` must stay one node or the two would
absorb their targets into runs that in fact split. A lane's two outputs are not that: they carry different
MATERIAL, and the engine can perfectly well hold a track for each. So `melody#audio` and `melody#midi` are two
runs, each absorbing its own modules, and each compiling onto its own engine track. Only when both are written:
a lane keyed once — every lane that plays one kind of thing — is its bare name, so nothing carries a suffix it
does not need.

`soleLanePort` is the other half of that. A lane wired only to its midi output is not split — its identity is
still its bare name — but it did say which jack, and the compiler needs to hear it: that is what decides whether
the lane's audio events have anywhere to go.

A module may be keyed with a port on the SOURCE side too (`deck#cue: [...]`), so its destinations are the UNION
of every key naming it; keying on the raw string would split one module into two nodes that never meet. The
key's port is kept on each edge as `fromPort` — the union decides the module's IDENTITY, it does not have to
cost which jack the cable left from, and a module with several outputs (a stem separator) is unsayable without
it (ports.md).

A destination keeps BOTH ports: `to` carries which input it lands on (downstream reads the bare name with
`splitPort`), `fromPort` which output it left from. Separate fields because they are separate facts — the
target's jack is part of the address, the source's is part of the source.

### Absorption

Every edge is recorded on its DESTINATION as the source's out-degree. Both halves of "does this node continue
the run it is in" read off that one map: how many things feed it (the list's length) and whether the one that
does feeds anything else.

Only BARE destinations count as flow. A destination naming a port is a side input, and counting it would make a
module absorbed into a run that only feeds its second port — the run would claim it as its next step and its
real flow input would go unnoticed. The out-degree is the SOURCE's, which for a module is its node whatever port
a key names: one split across its outputs (`sep#drums:` and `sep#bass:`, a key apiece) has two lists of one, and
per-key counting would call each edge an only child, absorbing both targets into a single run through a module
that in fact splits. A split LANE is the exception `srcId` makes — its two outputs are two runs, so each counts
its own.

What feeds a module through a NAMED port is collected separately, in the order the file lists it. These are the
wires past the chain flow — a chain carries one signal, and a second input has to arrive from somewhere else —
so they land on the step as `in`, which `validate()` checks against the module's port list.

So `absorbed(n)` holds only when all three do: exactly one thing feeds it (two would make it a meeting point, a
bus), that one thing feeds nothing else (a split ends the run before it), and it has somewhere to go (a node the
signal stops at is the run's DESTINATION, which is what `out` means). **A LANE is never absorbed, whatever feeds
it**: a live interface channel routed into one
satisfies all three, so without the guard the input's run would swallow the lane as its next step and the chain
that OWNS the lane's material would cease to exist.

The walk steps on NODES; a port only ever decorates the edge that got here. A single destination carrying one is
not followed at all, since `absorbed` reads the flow feeders and a side input contributes none. `fromPort` never
gates the walk either — it says where the edge came from, and a module with one output that names it is still a
plain run.

### The three passes

**Lanes first**, claimed whether or not they are wired: a lane is where a run begins, so it is never a step in
somebody else's. `from` is the whole difference — the run takes the lane's name, and that name is its identity
downstream (routing target, bus track, the prefix of every plugin id under it). The run is named after the
SOURCE and `from` after the lane, which are the same string unless the lane split; then the name carries the
port (`melody#midi`) and `fromPort` says which one, so a reader asking "whose material is this" and a reader
asking "which jack did it leave by" each get their answer without parsing the other's.

There is no "both a track and a module" refusal: with one `modules:` map a name is one node, so the collision
such a check would guard against cannot be written.

**Then every module that starts a run of its own** — a bus (several things feed it), the far side of a split, or
a node nothing feeds at all.

**Then the cycles.** A cycle has no root, so its modules are still unplaced; breaking it at the first one keeps
them visible, and `validate()` reports the cycle. `placed` is what stops the walk there — absorption alone
decides which run claims a module everywhere else.

### Two answers on the side

`isParked` is a chain holding one module wired to nothing at either end — a node placed but not connected. It is
a real state in a graph editor (drop a module in, wire it after), so the wiring checks skip it: telling someone
their brand-new input feeds no track is an answer to a question they haven't asked yet.

`chainSteps` is the modules a segments file puts the signal through, in order, deduplicated. What a PLAYER needs
and a drawing does not: the graph shows the segments as they branch, while playing or bouncing one is a single
track carrying a plugin per step. Derived from the same parse the drawing uses, so the chain that is seen and
the chain that is heard cannot be two different chains — which is why it lives beside the derivation rather than
in whichever surface plays it. The médiathèque draws a variant with it; k7's `track process` and `clip process`
bounce one with it. `@in` and `@out` are dropped, being the ends rather than treatments, and unreadable text is
an empty list rather than a throw — the pane showing the file is what reports why.
