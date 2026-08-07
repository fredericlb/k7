# An m9 project — a SET

A `*.m9` folder is read by the same loader as a `*.l8` song, out of the same
`@studio/song`. It is not a second dialect: it is the node project you already know, with
one entity fewer and one file more.

| file | what it holds |
|---|---|
| `project.yaml` | the set's settings, plus `type: m9` at the root |
| `songs.yaml` | which of the médiathèque's songs this set draws on — see [songsFile.md](songsFile.md) |
| `chains.yaml` | the routing segments, exactly as in a song |
| `tracks/<deck>.yaml` | one file per DECK — declared here, with no arrangement |
| `instances/<name>.yaml` | its USES of the médiathèque's modules — one line each |
| `views/mix.yaml` | what each control of the Mix desk drives — see [viewBindings.md](viewBindings.md) |

No `clips/`, no `sequences/`, no `curves/`: a set holds no material of its own. What it
plays lives in the médiathèque, and what it says about playing it is the graph.

**And no `modules/` either.** A set uses modules; it does not own any. st0 holds the only
editable catalogue, so a crossfade copied into the project would be a second crossfade
nobody maintains and nobody would notice drifting from the one everybody else uses. An
instance is the whole use:

```yaml
# instances/crossfade.yaml
extends: "@mediatek/audio/utility/crossfade"
params:
  Mix: 0.5
```

`kind`, `inputs` and `category` are inherited by NOT being stated — the two audio ports, the
second one optional, come from what it extends. That is the mechanism, not a shortcut; see
[instances.md](instances.md). A use of a module you do not own needs no local folder for it.

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

`projectTypeOf` states the order in three lines: suffix, then declaration, then `l8` —
which is every song written before m9 existed, and none of them says so.

A folder named `.m9` that declares `type: l8` is not resolved silently. It compiles either
way, because the two signals feed different readers, and that is exactly why it is
**reported** — `projectTypeIssues`, surfaced beside `deadProjectFields`. A field that is
accepted and ignored is the failure mode this codebase keeps paying for.

`type` is a ROOT key, beside `trackOrder` and `markers`, and not a `project:` setting. The
tier inside `project:` is the SONG's own settings — its tempo, its rate. This is a fact
about the file's dialect. `projectSchema.ts` carries the note about what happened the last
time those two tiers were confused.

## A deck is a track with no arrangement

This is the one genuinely new thing, and it is small.

In a song, `tracks/bass.yaml` **is** the arrangement: the clips, where they sit, how often
they repeat. On a deck there is nothing to arrange — the material is whichever song from
`songs.yaml` was loaded onto it ten seconds ago, and it will be a different one in four
minutes. So `clips` is empty, and stays empty in git.

The file still exists, and that is deliberate. The alternative — inferring the decks from
`chains.yaml`'s `tracks:` keys and writing no track files at all — costs three things:

- l8 keeps a useful error for a chain naming a track that has no file, and inference
  would have to make that error conditional on the project's type;
- the file tree, the editor and the loader all work unchanged with a file there;
- the deck's **settings** need somewhere to live. Trim, cue, key-lock, which deck holds
  the master tempo: none of those are the song, all of them are the deck, and inventing a
  second home for them later is worse than having one now.

## Two decks meeting at a crossfade

The graph is the shape a chain cannot express on its own, because **a chain carries one
signal**:

```yaml
tracks:
  deckA: [ tempoA ]         # each deck through its OWN tempo first…
  deckB: [ tempoB ]
modules:
  tempoA: [ crossfade ]     # …then the FLOW into the crossfade's first input
  tempoB: [ crossfade#b ]   # a side input — lands on the port called `b`
  crossfade: [ OUT ]
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

Two instances, not one shared: each deck plays at its own BPM, and a param belongs to a use
rather than to a module. `Source BPM` is measured by the pass; `Target BPM` is what m9's
tempo fader sets.

**Nothing about two is fixed.** `scaffoldM9` writes two decks because two is what a
crossfade takes; the format holds any number, and no code special-cases the names `deckA`,
`deckB` or `crossfade`. A third deck is a third track and a second meeting point. Hardcoding
the pair into m9 would have bought nothing — the graph view draws whatever the file says —
and would have made a four-channel set unsayable.

Derived, this is **two** chains and no chain called `crossfade`: the module has a single
flow feeder, so it is a step inside deck A's run rather than a meeting point of its own.
`scaffoldM9.test.ts` pins that, which is the cheapest way to notice if `#b` is ever lost.

## What is NOT done

The engine does not yet play the set's own graph. `deckDoc` builds a one-track document in
the browser and sends it; the project's crossfade is not in it.

That is not an oversight, and it is not a small fix. `plugin: {type: jsdsp}` means the DSP
is a graph **baked into the document by the compiler**, which runs the module's source in a
child process (`nodeProject.ts`) — the engine has no crossfade plugin to name, it has a
graph host that is handed a graph. A browser cannot produce one. Playing the set's real
chains therefore means the machine's file service compiling the project and sending it,
with loading a song onto a deck becoming a project **edit** — which is how l8 already
works, and is the next étape rather than this one.

Until then the honest description is: the set list is the project's, the signal path drawn
under Mix is the deck's, and the two are not the same picture.
