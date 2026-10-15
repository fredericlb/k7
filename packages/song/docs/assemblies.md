# Assemblies — a templated set of nodes drawn as one box

A mix set is thirty-six cards. `scaffoldSet` writes **eighteen nodes per deck** — the lane, four
stem lanes, five platters, the tempo, the trim, the EQ, the filter, the level, the echo, the fade
and the cue — and every one of them is right. Together they say "a turntable" nowhere.

An **assembly** is the file that says it: a template in the library, instanced into a project, drawn
as a black box with named plugs and a handful of knobs promoted onto its face, opened when you want
to see inside.

> **It changes nothing about the sound.** `chainsGraph.ts` never reads one, `nodeProject.ts` never
> reads one, and the engine is never told. `assemblies.test.ts`' last case is the whole claim: the
> same folder, with and without its `assemblies/`, compiles to the same `ProjectDoc` and derives the
> same chains. If that test ever fails, an assembly has started to mean something to the sound.

## Three things it is not

Each of these already exists under a name close enough to confuse, and none of them serves.

| existing | what it is | why not |
|---|---|---|
| a group LANE (`@meta/group-track`, `ProjectDoc.groups`, [mixFolding.md](mixFolding.md)) | a mixer relationship over lanes | members must be **lanes**. It holds `deckA` and the stem lanes; it cannot hold `trimA`, `platterA` or `fadeA`, which are modules. And it carries mute/solo, not topology |
| a chain TEMPLATE (a library's `chains/<ref>.yaml`) | one run of nodes, fed by what it is put after and ending at `@out` | nothing inlines one into a host graph. It is edited standalone, bounced offline (`processChain.ts`) or copied onto the bench. Its ends are unnamed and it has one of each ([sharedFolders.md](sharedFolders.md)) |
| `frozen: "inside"` ([freeze.md](freeze.md)) | one card standing for everything upstream | a **render**, not a document node. It cannot be opened, and it refuses when the region leaks |

The word is **assembly** deliberately. `group` is taken by the first row and `rack` by
`type: rack`; a name that has to be disambiguated in prose is a name that will be got wrong in
review.

## The two files

### The template — in the library, beside `modules/` and `chains/`

A library carries a third family ([sharedFolders.md](sharedFolders.md)), and a template is named
by its library like everything else in it:

```
<libraries>/k7/modules/       @k7-core/audio/utility/trim
<libraries>/k7/chains/        @k7-core/process/normalize
<libraries>/k7/assemblies/    @k7-core/turntable
```

A template is a FOLDER laid out as a project's graph is — `graph.yaml` and `nodes/` — plus one
file that is the whole of what makes it an assembly:

```yaml
# <library>/assemblies/turntable/assembly.yaml
label: Turntable
inputs: []                                     # a turntable is a SOURCE, and that is a real state
outputs:
  - { name: mix, type: audio, node: fade }     # which member's output leaves by this plug
  - { name: cue, type: audio, node: cue }
params:                                        # what is PROMOTED onto the box's face
  Trim: { node: trim, param: Trim }
  Level: { node: level, param: Gain }
```

A plug is `PortSchema` plus the member it stands for. `port` is written only when that member
declares several ([ports.md](ports.md)). Two plugs of one name on one side are refused: a plug name
is what a cable names.

The ref is spelled like a chain's — `@k7-core/turntable`, the level plus the path under the family
folder. The one this repo ships is `packages/dsp/assemblies/turntable/`, a **place to copy from and
never a seed**: nothing in this build puts files in somebody's library repository.

### The instance — a flat entity folder in the project

```yaml
# <project>.k7/assemblies/turntableA.yaml
uses: "@k7-core/turntable"
members:
  deck: deckA
  trim: trimA
  fade: fadeA
  # …
```

The id is the **filename**, as in every flat entity folder here (`surfaces/`, `clips/`, `curves/`).

`members:` maps the **template's** name to **this project's** node name, and that indirection is
what makes both halves work. `assembly new` mints `<box>_<member>`; a migration folds nodes that
already exist under the names they already have and **renames nothing**. `migrateSetAssemblies.ts`
is the whole of that: it writes one file per deck and does not touch `graph.yaml`.

## Expanded, not referenced

The nodes and their wiring are ordinary entries in `graph.yaml`. `assembly new` copies the
template's node files into `nodes/` and its segments into the graph, every name inside swapped for
the instance's; a destination the template does not own — `MIX`, `CUE` — is copied verbatim, which
is how a template says where its signal leaves to.

So `node param`, `node bypass`, `graph move`, `graph unlink`, `node replace`, a `surfaces/` mapping,
the compiler and the engine all keep working on the members with no knowledge of the box. The box's
own position is `graph.yaml`'s `positions:` under the instance's name, which needs no schema change:
one flat key space.

The alternative — one line in `graph.yaml` naming a template, expanded at load — buys a terse file
and costs everything above: nothing inside would be editable per instance, and every writer would
have to learn to address a node that has no file.

## What `validate()` refuses

The same three questions a group's membership is asked, over any node rather than over lanes:

- a `members:` value naming a node this project has not got;
- one node in two assemblies — a card cannot be in two boxes;
- a box named after a node or a module, which is the flat key space ([nodes.md](nodes.md)).

A `uses:` that resolves to nothing is a **warning**, not an error, exactly as an unresolved `@k7-core/…`
module ref is: a new library is empty. Such a box still draws, from `members:` alone, with no plugs
and no knobs — which is the honest reading of a template nobody has published yet.

## A node's name follows, where a surface's does not

A member is the one reference outside `graph.yaml` that **can** be written back, so it is:
`node replace`'s rename repoints it, and `node delete` drops it — taking the record with the last
member, since a box about nothing is not a box. A `surfaces/` mapping is the opposite case and
declines instead ([surfaces.md](surfaces.md)); the difference is only that nothing writes one back.

## On the graph

`foldAssemblies` (`@studio/ui-chains/assembly`) is a post-pass over `buildGraph`'s output, in the
family of `alignModuleRank` and `masterRunAside`. The host holds which boxes are **open** — session
state, deliberately: what you opened to look at is not a fact about the song.

**Closed**, the members and every cable between two of them are dropped; a boundary cable is
re-pointed at the box with the plug's name as its port, and the box wears a knob per promoted param.
Two members feeding one thing collapse to one cable off one plug, drawn once.

**Open**, the members stay and the box becomes a frame around them, laid out by a recursive
`layout()` call whose result gives the frame its size. The frame has **no sockets**: the members are
showing the real ones, and the cable lands on the real one. A member inside a frame is neither
pinnable nor draggable — its place is the frame's, and a `graph move` writing it would be a number
that means nothing once the box closes.

### A plug is not a `graph.yaml` address

`jackRef` is what turns a gesture into a line, and this is the one seam that keeps every verb
unchanged: for a box it answers the **member** behind the plug. A cable dropped on `turntableA#mix`
writes `graph chain connect fadeA OUT`, the file re-reads, and the cable comes back drawn on the
plug. `insertFor` resolves the same way, so `node insert` on a boundary arrow splices against the
member. Its bare name is still its own — that is what a pin and `graph move` address.

## The verbs

| | |
|---|---|
| `assembly new <ref> <name> [x,y]` | instance a template: its node files, its segments, the record, the pin |
| `assembly delete <name>` | the record **and** every node it held, each spliced out like `node delete` |
| `assembly dissolve <name>` | the record only — every node stays on the graph, wired as it was |

`dissolve` is "stop drawing these as one thing"; `delete` is "get rid of them". Two intentions, two
verbs, the same distinction `graph unlink` and `node delete` already draw.

## The builder

`@studio/ui-module-builder/assembly`, opened by `ui assembly <ref>` or from a box's right-click
menu. It lists **every member's params** with a Promote toggle each, and the plugs beside them as
text — those are two lines apiece, and a form for them would say less.

The param list comes from the template's own **graph**: an assembly folder is a graph folder, so
`GET /graph?at=<path>` resolves every member through its `extends` and hands back what it runs with.
No new route, and the same road the chains builder takes.

A promotion lives on the **template**, so two turntables cannot drift apart. A save writes into a
library, which only an admin may do and only their push publishes, so it is a button and never a
timer — the rule a shared module already follows (`apps/k7/frontend/docs/sharedModules.md`).

## Not covered

- **Nesting.** An assembly may not contain an assembly. One level, the way a `tabs` widget's pages
  are one level, and for the same reason: there is no tree to reason about.
- **A surface mapping naming a box.** `{ module: turntableA, param: Trim }` would let
  `surfaces/desk.yaml` stop spelling `trimA`. It is a small resolution step on top of what the wire
  already carries, and it can be added once the promotion has one consumer that is real.
- **Per-instance promotion.** See above: the template decides, once.

## Opening one makes room

A frame is the size of a whole signal path, and a project that has drawn itself once has PINNED
every node it has — so without help, opening a box would grow one card through its neighbours.
`pushAsideFrames` moves whatever is in the way to the nearer side, by a shift constant per side so
the cards keep their spacing.

None of it is written down, and that is what gives the position back: closing the box stops the
push. The one way to break that is to record a shoved position, so a moved card carries `pushed` —
where it belongs — and k7's session memory and its auto-pin both read that instead of where the
card is drawn. See `packages/ui-chains/docs/graphBuild.md`.

## Its own cables, and the traffic crossing it

With a box open, a cable whose **both ends** are members is drawn at full strength; every other one
— the feeds in, the ways out, and anything that merely spans the frame — is drawn at half. Nothing
fades while every box is shut. They are not clipped: a crossing cable runs right over the box and
stays followable end to end. See `packages/ui-chains/docs/graphBuild.md`.

## Two things a box has to keep working

**It can be moved.** A box is drawn as a card and pinned like one, though it is no key of
`graph.yaml`'s `modules:` — one flat key space, so `graph move turntableA 200 80` writes its name
into `positions:` beside every node's. The verb's guard reads `g.assemblies` as well as the modules
and the lanes, or it refuses the very thing the drag just addressed.

**Its cables come alive.** Liveness walks forward from the metered lanes' own cards, and a closed
box has swallowed them — so a folded set rippled nowhere until the box learned to say which lanes
it holds. See `packages/ui-chains/docs/graphBuild.md`.
