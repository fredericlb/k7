# Chain files — a project kept as `chains/`

A project with a `chains/` folder is a **chain project**: its signal graph is written as one file
per chain, nodes are written INSIDE the chain that plays them, and `graph.yaml` and `nodes/` do not
exist. A project without one is read the way [nodes.md](nodes.md) describes. Both load, so a
project moves over with `scripts/migrateChainFiles.ts` and nothing else has to change at once.

```
chains/ge.rythm.yaml     a chain: its steps, and where it goes
tracks/ge.rythm.yaml     a lane's own file — extends, colour, events, alternatives
vstpresets/<file>        a node's plugin state, named by its `vstpreset:` (default `<id>.vstpreset`)
assets/<file>            what a node's file-valued params name
layout.yaml              where cards sit on the graph, keyed by node id, lane name or built-in
```

## A chain

```yaml
# chains/ge.rythm.yaml
start: true
steps:
  - { id: 0525…, extends: "@meta/IN", channel: [ 2 ] }      # a source first
  - { id: e860…, track: ge.rythm }                          # the lane — tracks/ge.rythm.yaml
  - { id: 944c…, extends: "@st0/audio/auto-wah", bypass: true }
  - [ { id: …, extends: … }, { id: …, extends: … } ]        # side by side, summed into the next step
  - to: [ { chain: MIX, level: 1 }, { chain: verb, level: 0.3 } ]
```

- **A step** is one node, a lane, several nodes side by side, or — last only — the chains it links
  to. Links and nodes never share a step, and several links each carry a `level`.
- **A node is unnamed.** It is a module's fields plus `id` (a uuid, every node has one), `bypass`,
  `vstpreset` and `mapping`. Its `id` is what the engine keys the plugin by and what commands name,
  so an insert renames nothing downstream; completion shows the module and the position instead.
- **A lane** is `{ id, track, bypass? }` exactly — an input node's own `track:` field is not one.
  Its bypass is its mute. Only a chain with `start: true` holds one.
- **`start`** is an attribute, not a step: `true` when the chain begins at its own first node (a
  lane, an input), `MIX` or `RENDER` when it begins at that sum. A chain without one is fed by
  links, and names the `ports` it is linked into; each feeds its first node's input of that name,
  which is why the first step cannot be side by side.
- **A chain without a start that nothing links is hidden**, unless one of its cards was placed on
  the graph (`layout.yaml`). That is the state `node new` leaves a node in until it is wired.

## Why the files compile into SEGMENTS

Everything downstream — the compile, the engine, the graph view, every graph edit — reads the
segment graph of [graphFile.md](graphFile.md). `chainProject.ts` builds that graph from the chain
files (`toSegments`), keyed by lane name or node id, and writes one back (`fromSegments`). So a
graph edit is still a transform over segments, run on the graph read from `chains/` and written
back; the second direction is the migration too. The pair must round-trip, and
`chainProject.test.ts` holds it to that.

Writing back keeps what segments cannot say: a chain's name (the chain that held its head node),
each link's `level`, and every unchanged item's own YAML node, comments included. A run breaks
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

## What the migration refuses

A project whose `assemblies/`, `views/` or `surfaces/` name nodes, and a `nodes/` holding anything
but node files, presets, `assets/` and `base/`. Each of those refers to a node by the NAME the
migration takes away, and carrying it over is work of its own — refused by name rather than left
pointing at nothing.

## Writing to a chain project

Every writer that knows node files and `graph.yaml` writes a chain project too, through the same
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
  one hides it too, unless its card has a place in `layout.yaml`.
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
