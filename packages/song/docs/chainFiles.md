# Chain files — a project kept as `chains/`

A project with a `chains/` folder is a **chain project**: its signal graph is written as one file
per chain, nodes are written INSIDE the chain that plays them, and `graph.k7x` and `nodes/` do not
exist. A project without one is read the way [nodes.md](nodes.md) describes. Both load, so a
project moves over with `scripts/migrateChainFiles.ts` and nothing else has to change at once.

Chain files are the **main layout**: a new project is born as one, its scaffold converted by the
same migration ([scaffold.md](scaffold.md)). A graph is what `mix` and the bench still write, and
what an older project keeps until it is migrated.

```
chains/ge.rythm.k7x      a chain: its steps, and where it goes
tracks/ge.rythm.k7x      a lane's own file — extends, colour, events, alternatives
vstpresets/<file>        a node's plugin state, named by its `vstpreset:` (default `<id>.vstpreset`)
assets/<file>            what a node's file-valued params name
layout.k7x               where cards sit on the graph, keyed by node id, lane name or built-in
```

## A chain

```k7x
// chains/ge.rythm.k7x
start(true)
steps([
  id("0525…").extends("@meta/IN").channel([2]), // a source first
  id("e860…").track("ge.rythm"), // the lane — tracks/ge.rythm.k7x
  id("944c…").extends("@k7-core/audio/auto-wah").bypass(true),
  [id("…").extends("…"), id("…").extends("…")], // side by side, summed into the next step
  to([chain("MIX").level(1), chain("verb").level(0.3)]),
])
```

- **A step** is one node, a lane, several nodes side by side, or — last only — the chains it links
  to. Links and nodes never share a step, and several links each carry a `level`.
- **A node is unnamed.** It is a module's fields plus `id` (a uuid, every node has one), `bypass`,
  `vstpreset` and `mapping`. Its `id` is what the engine keys the plugin by and what commands name,
  so an insert renames nothing downstream; completion shows the module and the position instead.
- **A lane** is `{ id, track, bypass? }` exactly — an input node's own `track:` field is not one.
  Its bypass is its mute. Only a chain with `start: true` holds one.
- **A picture lane** is the same `{ id, track, bypass? }` item: its `tracks/<name>.k7x` extends
  `@meta/picture-track`, and that is what marks the item picture. Its shots are read by the picture
  compile, and it is a lane to the graph and nothing to the engine, as it is in a graph project. A
  picture lane exists in a chain project only through its item. A camera or a SHAPE before it
  starts its chain, the way an input starts an audio lane's.
- **`start`** is an attribute, not a step: `true` when the chain begins at its own first node (a
  lane, an input), `MIX` or `RENDER` when it begins at that sum. A chain without one is fed by
  links, and names the `ports` it is linked into; each feeds its first node's input of that name,
  which is why the first step cannot be side by side.
- **A chain without a start that nothing links is hidden**, unless one of its cards was placed on
  the graph (`layout.k7x`). That is the state `node new` leaves a node in until it is wired.

## Subchains

A chain may hold **subchains**: steps under an `id`, listed beside the chain's own.

```k7x
// chains/gtr.k7x
start(true)
steps([
  id("lane-1").track("gtr"),
  id("amp-1").extends("@k7-core/audio/amp"),
  to([chain("wet").level(0.4), chain("MIX").level(1)]),
])
subchains([id("wet").steps([id("verb-1").extends("@k7-core/audio/verb"), to([chain("MIX")])])])
```

A subchain is a chain whose scope is its parent, and the scope is **closed both ways**: only the
parent and its other subchains link into one, and a subchain links out only to a sibling or a
built-in end. That is what makes it the parent's own: a chain file can be read, moved or duplicated
whole, and nothing outside it reaches in or is reached out to. Inside the parent a subchain's id
SHADOWS a top-level chain of that name; outside, that name is the top-level chain.

A subchain is **steps and an id, nothing else** — no `start`, `ports` or `bus_only`, no lane (a lane
is a source, and a subchain is fed by its parent), and no subchains of its own, nor a `{ sub }` step. One level keeps a
node's place readable (`gtr › wet · step 2`) and the write-back below decidable.

In memory a subchain is a chain like the others, keyed `<parent>/<id>` — no file name holds a `/` —
and its nodes carry `sub` beside `chain`, which stays the FILE (`chainScope.ts`).

**A graph edit puts a subchain back where it was**, as long as its scope still holds: the run is
named after the subchain its nodes came from, a node inserted at its head included, and returns to
its parent. An edit that breaks the scope — a cable from another chain into it, or out of it to one —
**lifts it out** to a chain of its own, `<parent>-<id>`, rather than being refused: the edit was asked
for, and a chain is still a correct way to write what it made. A library template holds none, being
one run spliced where it is put.

### Running a subchain in place

A subchain can also be RUN where a step would be, with a `{ sub: <id> }` step: the signal goes
through it in series and on to the parent's next step.

```k7x
steps([
  id("lane-1").track("gtr"),
  sub("amp"), // amp-1, then eq-1, then on to strip-1
  id("strip-1").extends("@k7-core/audio/strip"),
  to([chain("MIX")]),
])
subchains([
  id("amp")
    .steps([id("amp-1").extends("@k7-core/audio/amp"), id("eq-1").extends("@k7-core/audio/eq")]),
])
```

Such a subchain is a STRETCH of its parent's run, which decides the rest: it has no `to:` (its output
returns), nothing links to it, it is run once, from the parent's own steps and never as the first one
(that step is a node, its ports what the chain is linked into), and it holds at least one node. It
compiles inline (`expandCalls`) and not again as a chain of its own.

It is what the per-track row draws as a COLUMN — the stretch's cards one under another — and what the
branch button on a seam makes (`node stack`, `chainStack.ts`): the card and the new node become a subchain
run in the card's place, or the new node joins the one the card already sits in. The new node must be
loose, as `node new` leaves it; its own chain file goes.

**A graph edit writes the stretch back** (`regroupCalls`): the run is rebuilt from segments, so the
nodes that sat in the subchain are found by where they WERE, and put back as the same `{ sub }`. A new
node inserted between two of them joins; one inserted before or after stays in the parent. The
subchain's nodes name the parent's run, not the subchain, so a run never takes a stretch's name.

### A picture lane's subchains are its fades' STRETCHES

```k7x
// chains/main.k7x
start(true)
steps([id("7d14…").track("main"), to([chain("RENDER")])])
subchains([
  id("iris") // a fade on `main` names it: `chain: iris`
    .steps([id("8a82…").extends("@workspace/shaders/iris")]),
])
```

A subchain of a picture lane's chain that nothing links and that links nowhere is a **stretch**: the
run a fade puts a shot through (`packages/song-video/docs/transitions.md`). The file is its scope,
which is the scope a stretch needs — a fade on `main` can name only `main`'s — and it is named by its
id, so a fade reads `chain: iris` rather than a node's uuid. In the segments it is the cable from
its last node INTO the lane, the shape a graph project writes it in; written back, a run of picture
passes that nothing feeds and whose only way out is a picture lane returns to that lane's file
under the id it had, or under the leaf of what its head extends. Without the write-back taking it
out first, the lane would be absorbed into the run feeding it, and its chain would lose its start.

## A template's input

`input({ channel: [1, 2] })` — or a preferences label — is a library TEMPLATE's: the interface input
a bench opened on it feeds its IN from (`apps/k7/frontend/docs/frozenChains.md`). It names a socket,
which a project's own chains get from their input nodes, so a project's compile reads nothing of it.

## Hidden chains

`hidden: true` on a chain sets it aside WHOLE: `readChainProject` keeps it under `hidden` and out of
`chains` and `nodes`, so its lane has no timeline row, its nodes no graph card, and nothing of it is
compiled or sent to the engine. It is how `track hide` takes a lane out without deleting it, and
`track unhide` removes the key. The lane's `tracks/` file and every item stay as written; a new lane
cannot take its name, the file being still there. A hidden lane leaves `soloed` too, since a solo no
one can see would silence every other lane; `trackOrder` keeps it, so it comes back where it was.

This is not the other kind of hidden, a chain without a start that nothing links: that one is still
part of the project, and shows the moment something links it or places one of its cards.

**A graph edit leaves alone every chain it neither showed nor touched** — a hidden one, and one only
a hidden lane fed. Rebuilt from segments, such a chain's nodes would come back as one loose chain
each, so its file is not rewritten, and no new chain may take its name.

## Why the files compile into SEGMENTS

Everything downstream — the compile, the engine, the graph view, every graph edit — reads the
segment graph of [graphFile.md](graphFile.md). `chainProject.ts` builds that graph from the chain
files (`toSegments`), keyed by lane name or node id, and writes one back (`fromSegments`). So a
graph edit is still a transform over segments, run on the graph read from `chains/` and written
back; the second direction is the migration too. The pair must round-trip, and
`chainProject.test.ts` holds it to that.

Writing back keeps what segments cannot say: a chain's name (the chain that held its head node),
each link's `level`, and every unchanged item's own source, comments included. A run breaks
where the signal splits or meets, and a split that meets again one step later is written as a
side-by-side step.

## A link's level

Segments carry no gain, so `toSegments` returns each link's `level` beside the graph, keyed
`<from>><to>` (`<to>` with its `#port`), and `linkLevels.ts` lays it onto the derived chains' `out`
gains — once in the compile and once in the graph view, so the two cannot disagree. The engine
document has a level for a SEND and nowhere else: a link to a bus plays at its level. A level on a
link to `MIX` would scale the dry path alone, and a track's dry path has no gain field — the volume
is a module at the end of the chain, and the engine taps every send after it. Likewise a link into
a `#port` (a side input), to `OUT`, `RENDER`, `VIDEO_OUT` or `CUE`. Those levels are not played,
and the graph's warnings say so by chain rather than letting a written number go silent.

## How an unnamed node is shown

A node's name stays its uuid everywhere a name is SENT: commands, the wire, the graph's keys. What
a person reads is the module it extends — the card's header already shows that — and where it
sits, `chain · step n` (`n.k` for the k-th node of a side-by-side step), counted from 1 as a
person counts. The graph carries that as a step's optional `place`, the card draws it wherever it
would have drawn the uuid, and completion offers the uuid labelled `<module> · <place>`
(`nodePlace.ts`). A lane needs none of this: its name is its own.

Every other text that names a node reads the same `<module> · <place>`, the module by its leaf as
the header spells it (`@studio/ui-chains`'s `shownName.ts`): the chains sidebar's rows and steps,
what a screen reader hears on an insert `+`, the preset popup's save field. A chain the graph
derives from a run that STARTS at an unnamed node is keyed by that node's uuid, so the sidebar
shows it by that node too. The uuid is still what each of those sends when it acts.

A TRACK the compile makes for a run — a bus return, a live input landing on no lane — is keyed by
the run's head, its uuid, and **labelled by the chain file holding it**: the mixer's strip reads
`IN` or `verb`, which is what the person named, while every send and every plugin id keeps the key
that does not move.

A node whose card has no module to name — no `extends`, and so nothing a header could say — shows
its place instead. A step that also carries no plugin plays nothing at all; its card says **empty
step**, the place one hover away, so a stray one is seen for what it is and deleted.

## What the migration carries over

Beside nodes and lanes: a **picture lane** becomes its item, a node a graph named by a module REF
with no node file becomes an item extending that ref, a new chain is named after the leaf of what
its head extends, and a fade naming a stretch by its head node is rewritten to the stretch's
subchain id. It reads and moves files through the workspace door, so a `.k7x` folder migrates as
it is.

## What the migration refuses

A project whose `assemblies/`, `views/` or `surfaces/` name nodes, and a `nodes/` holding anything
but node files, presets, `assets/` and `base/`. Each of those refers to a node by the NAME the
migration takes away, and carrying it over is work of its own — refused by name rather than left
pointing at nothing.

## Writing to a chain project

Every writer that knows node files and `graph.k7x` writes a chain project too, through the same
text transforms; only where the text comes from changes (`chainItemEdit.ts`, `chainGraphEdit.ts`,
`chainCreate.ts`).

- **A node's edit sees the whole item**, as a node file would hold it, block style. `id`, `bypass`,
  `vstpreset` and `mapping` belong to the USE, not the module, so whatever a transform does to them
  is put back. An edit that would leave the chain file unreadable is refused: a chain that fails is
  left out whole, every node of it with it.
- **A lane's edit lands in `tracks/`.** A time edit also reaches a node item holding events of its
  own.
- **A graph edit runs on the segments** read from the chain files and is written back. A node the
  result no longer names is kept, as a loose chain, unless the edit deleted it: a hidden chain is
  absent from the segments it was edited through, and silence must not delete it. A run split in
  two names its new chain after what its head extends.
- **Only a lane is renamed.** Its file, its item and a chain named after it follow. Any other node
  is its id, so renaming one succeeds and changes nothing.
- **Deleting a node** takes its default `<id>.vstpreset` when no other item names that file; a
  preset chosen by name may be shared on purpose, and stays.
- **The name a creation is given names the chain**, and the node is a fresh id, returned. A chain
  holding one node stands for that node in every graph verb, so a caller still holding the name it
  asked for places and wires what it made. A new node is hidden until placed or wired; unlinking
  one hides it too, unless its card has a place in `layout.k7x`.
- **A new lane** is its `tracks/` file and a `start: true` chain of its own; its strip is the next
  item of that chain.
- **Assemblies are refused**, like the migration refuses them: a box names its members.
- **The picture's run** is a chain starting at `RENDER`, written when no chain does.
- **A duplicated lane** is a new `tracks/` file and a `start: true` chain copied from the lane item
  on: what feeds the lane — an input before it — is not copied, since two lanes on one input would
  record it twice. Every copied item takes a fresh id, so the engine never keys two plugins alike.
  A chain fed by the lane's chain alone is copied with it, and one fed by others is a bus and stays
  shared; links keep their levels.
- **A copy owns its preset** unless the preset is shared. The engine writes a plugin's state back
  into its file, so two items naming one file overwrite each other: a file only the original names
  is copied to `<new id>.vstpreset`, and one that several items already name was shared on purpose
  and the copy joins them.
