# A SET — an l8 project with decks instead of an arrangement

An `.l8` folder like any other, read by the same loader out of the same `@studio/song`. Not a
dialect: the node project you already know, with one entity fewer and two files more.

| file | what it holds |
|---|---|
| `project.yaml` | the set's settings, plus `project_type: live` — there is no arrangement |
| `songs.yaml` | which of the médiathèque's songs this set draws on — see [songsFile.md](songsFile.md) |
| `chains.yaml` | the routing segments, exactly as in a song |
| `nodes/<name>.yaml` | its USES of the médiathèque's modules — one line each — and the DECKS, which are lanes and so nodes too ([trackModules.md](trackModules.md)) |
| `surfaces/desk.yaml` | that it draws a desk, and what each control drives — see [surfaces.md](surfaces.md) |

## Two files are what make it a set

`songs.yaml`, and a `turntables` surface. Neither needs a folder suffix to be found and neither
needs an app of its own: l8 draws the desk from its declaration exactly as it draws a timeline
or a viewport from theirs.

The surface carries its own `mapping:` ([surfaces.md](surfaces.md)), so the declaration and the
wiring are one file. The desk itself is `@studio/ui-turntables`, and l8 has an engine before it
has a surface — which is the whole of what a host owes it.

No `clips/`, no `sequences/`, no `curves/`: a set holds no material of its own. What it
plays lives in the médiathèque, and what it says about playing it is the graph.

**And no `modules/` either.** A set uses modules; it does not own any. st0 holds the only
editable catalogue, so a crossfade copied into the project would be a second crossfade
nobody maintains and nobody would notice drifting from the one everybody else uses. An
node is the whole use:

```yaml
# nodes/crossfade.yaml
extends: "@mediatek/audio/utility/crossfade"
params:
  Mix: 0.5
```

`kind`, `inputs` and `category` are inherited by NOT being stated — the two audio ports, the
second one optional, come from what it extends. That is the mechanism, not a shortcut; see
[nodes.md](nodes.md). A use of a module you do not own needs no local folder for it.

## `type:` earns its place, and does not win

Two things can say what a project is, and it matters which one is believed.

The folder's **suffix** decides. `@studio/web-protocol/projects` already answers "which app
opens this" from the name alone, and st0 asks that question of a **bare blobless git
mirror** — every path, no file bodies — so any rule that had to open a file could not run
where the question is actually asked. Making the file authoritative would put the app that
opened a folder at odds with the loader reading it.

So what is `type:` for? The case the suffix cannot cover: **a repository can BE the
project** (`"."` — see `packages/project-shell/docs/launch.md`), and then there is no suffix
anywhere. It is also what a reader sees first, and what a loader handed an absolute path
with no name to read has to go on.

`projectTypeOf` states the order in three lines: suffix, then declaration, then `l8`, which is
what a folder saying nothing is.

A folder named `.z0` that declares `type: l8` is not resolved silently. It compiles either way,
because the two signals feed different readers, and that is exactly why it is **reported** —
`projectTypeIssues`, surfaced beside `deadProjectFields`. A field that is accepted and ignored
is worse than one that is refused.

The values are `l8` and `z0`. A set declares nothing at the root: it is an `.l8`, and
`project_type: live` plus its desk surface are what say what it is.

`type` is a ROOT key, beside `trackOrder` and `markers`, and not a `project:` setting. The tier
inside `project:` is the SONG's own settings — its tempo, its rate. This is a fact about the
file's dialect, not a setting of the project.

## A deck is a lane with no arrangement

This is the one genuinely new thing, and it is small.

In a song, `nodes/bass.yaml` **is** the arrangement: the clips, where they sit, how often
they repeat. On a deck there is nothing to arrange — the material is whichever song from
`songs.yaml` was loaded onto it ten seconds ago, and it will be a different one in four
minutes. So it authors no `clips:` at all.

The file still exists, and that is deliberate. The alternative — inferring the decks from
`chains.yaml`'s keys and writing no lane files at all — costs three things:

- l8 keeps a useful error for a chain naming a node that has no file, and inference
  would have to make that error conditional on the project's type;
- the file tree, the editor and the loader all work unchanged with a file there;
- the deck's **settings** need somewhere to live. Trim, cue, key-lock, which deck holds
  the master tempo: none of those are the song, all of them are the deck, and inventing a
  second home for them later is worse than having one now.

A deck's file is now an ordinary node — `extends: "@studio/audio-track"` and its own
settings — which is the same argument arriving at the same place from the other side: a
node is exactly "one use of a module, with its own settings".

## Two decks meeting at a crossfade

The graph is the shape a chain cannot express on its own, because **a chain carries one
signal**:

```yaml
modules:
  deckA: [ tempoA ]         # each deck through its OWN tempo first…
  deckB: [ tempoB ]
  tempoA: [ crossfade ]     # …then the FLOW into the crossfade's first input
  tempoB: [ crossfade#b ]   # a side input — lands on the port called `b`
  crossfade: [ OUT ]
bypassed: [ deckB ]         # deck B is heard through the crossfade only
```

`#b` is what makes the second deck expressible; without it `tempoB` would claim the module
as its own next step and its real input would go unnoticed. The full rule is
[ports.md](ports.md). The crossfade declares its own two inputs with `mandatory: false` on
the second, because one deck loaded and the other silent is the normal state of a set, not
a half-built chain.

**The tempo comes before the fade**, and the order is the signal path: a deck whose tempo
were applied after the crossfade would be stretched post-mix, along with the other deck.

### The tempo module is COLD

`@mediatek/audio/utility/tempo` is `cold: true` and `plugin: {type: offline}` — a tempo
change is a time stretch, a stretch has to know where the file ends, and there is no engine
plugin that stretches time (the engine hosts a Pitch Shifter and nothing else of that kind;
Tracktion warps a CLIP instead). So it is the offline shape: a pass writes the stretched
audio before the render. See [coldModules.md](coldModules.md).

That is also why it belongs on a DECK specifically. The cold rule is that such a module's
chain must draw from a file input — and a deck's source is a file on the machine's disk,
which is the one input whose whole length is knowable up front.

Two nodes, not one shared: each deck plays at its own BPM, and a param belongs to a use
rather than to a module. `Source BPM` is measured by the pass; `Target BPM` is what the desk's
tempo fader sets.

**Nothing about two is fixed.** `scaffoldSet` writes two decks because two is what a
crossfade takes; the format holds any number, and no code special-cases the names `deckA`,
`deckB` or `crossfade`. A third deck is a third track and a second meeting point. Hardcoding
the pair into the desk would have bought nothing — the graph view draws whatever the file says —
and would have made a four-channel set unsayable.

Derived, this is **two** chains and no chain called `crossfade`: the module has a single
flow feeder, so it is a step inside deck A's run rather than a meeting point of its own.
`scaffoldSet.test.ts` pins that, which is the cheapest way to notice if `#b` is ever lost.

## What plays is the compiled project

The desk fetches the compiled `ProjectDoc` from the machine's file service (`GET /engine-doc`),
fills in each deck's song, and sends it to the engine over its own socket. So the chains, the
`sidechainFrom`, and the crossfade's **baked DSP graph** are the compiler's — not an imitation
built in the browser.

Loading a song is therefore NOT a project edit. The decks' tracks are declared with
`clips: []` exactly so a live choice can fill them without writing to the folder: a set list
is committed, what is on a deck right now is not.

**One thing still cannot be a module.** The tempo is `offline`, so it compiles to no plugin —
`example.l8` compiles to deckA carrying the crossfade and nothing else. The stretch stays a
warp on the clip the desk fills in, which is the only thing that stretches live. Making it a module
in fact means writing the cold pass, and that is a separate piece of work from this one.
