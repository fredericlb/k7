# Track modules — a lane IN the graph

A lane is a module. It lives in `nodes/<name>.yaml` like every other use of a module, and
what it `extends` says what kind of lane it is:

```yaml
# nodes/melody.yaml
extends: "@meta/track"
color: "#c8a97e"
events:
  - { ref: melody, start: "1:1:1" }
```

…wired in `graph.yaml`'s one `modules:` map, like anything else:

```yaml
modules:
  melody: [ synth-melody ]
  synth-melody: [ OUT ]
bypassed: [ melody ]     # a lane in this list is MUTED
```

There is no `tracks/` folder, and no `tracks:` half of `graph.yaml`.

## Three, and none of them says what it carries

```
  events written down     @meta/track
  events streamed         @meta/strudel-track

  neither                 @meta/group-track
```

There is no second axis for `audio` against `notes`, because **a lane does not carry a signal —
its EVENTS do.** An event names a `clips/<id>.yaml` or a `sequences/<id>.yaml`, and that is the
whole answer, stated once per event by the material itself. A word at the top of the lane file
would be a second copy of a fact each event carries anyway, and its only real power would be the
power to refuse: a lane could not then hold both. Which is a thing songs do constantly — a guitar
part where two bars are a sampled riff and the rest is a line for a synth, a strudel pattern that
is half drums and half melody — and it would cost a second lane, a second strip, a second name,
and a convention saying the two belong together.

Nothing carries a `contentType`. The one axis that is genuinely about the lane and not about its
material is **where the events come from** — written down, or streamed while the transport rolls.

## Two outputs

A lane offers `audio` and `midi`, and nothing else. An event leaves by the one its material fits.

```yaml
modules:
  gtr#audio: [ amp ]      # the events naming clips
  gtr#midi:  [ synth ]    # the events naming sequences
  amp: [ OUT ]
  synth: [ OUT ]
```

The `#port` syntax is [ports.md](ports.md)'s, the same one a stem separator's outputs use. A bare
key works too:

```yaml
modules:
  gtr: [ amp ]            # everything this lane emits, down one chain
```

**Bare means everything**: one engine track, one chain, all the lane's events. A port only has to
be named when there is a genuine choice to make, which is when the lane holds both kinds and you
want them treated differently. Nothing needs a suffix to exist.

The one thing bare cannot do is be *wrong quietly*. A lane holding both kinds, wired bare into a
module that takes one of them, means the synth is handed the guitar clips too — so `validate()`
warns and names the two keys that split it. It is a warning rather than a refusal because the
song still plays; it just plays something nobody asked for.

And the inverse is a refusal: a lane wired ONLY to its `midi` output while holding an audio clip
has nowhere to put that clip. Dropping it silently is the one outcome worth refusing — the graph
looks right, the timeline draws the clip, and it is simply never heard — so the compile fails and
names the key to add.

## One lane, two engine tracks

The engine holds **one plugin chain per track**. So a lane running its clips through an amp and
its sequences through a synth is two tracks down there.

`nodeProject`'s `halvesOf` is where that happens: a lane wired on both outputs compiles to
`gtr#audio` and `gtr#midi`, each carrying the events its port fits and the plugins of the run that
left by it. A lane wired bare — or on one port only — compiles to one track called after the lane.

That the split exists at all is the engine's model showing through, not the authoring model's. It
is the same relationship `Mixer` has with the engine's fader, and the same one the whole of
`ProjectDoc` has with `nodes/`: **the engine's lanes are a compilation target.** The two lanes are
one lane HERE, where the song is written.

Both halves take the lane's mute, its solo, its group and its colour — those are facts about the
lane, not about one of its outputs. A live interface input lands on whichever half takes audio, so
recording a guitar onto the lane you wrote the line on is an overdub rather than a refusal.

## `deriveChains` has one exception

A module's outputs stay **one node**: `stemsplit#drums` and `stemsplit#vocals` are one meeting
point, because `out` compiles as a parallel send and per-key counting would absorb both targets
into a run through a module that in fact splits ([ports.md](ports.md)).

A LANE's outputs are not that. They carry different material and compile to different engine
tracks, so `melody#audio` and `melody#midi` are two runs, each absorbing its own modules. That is
`srcId` in `chainsGraph.ts`: one predicate (`isLane`) deciding whether a source key's port is part
of its identity.

`Chain.fromPort` carries the port up to everyone else. `from` stays the bare lane name — a reader
asking "whose material is this" and a reader asking "which jack did it leave by" each get their
answer without parsing the other's — and the run's NAME is the id the engine track takes.

## No ports IN

A lane offers no input. What arrives on a lane is its events.

The one thing that may be routed INTO a lane is a live interface channel, and that is a special
case (`validate`'s out-check): the flat model the engine plays cannot express routing into a
lane's input, so the compiler LANDS the input on the lane rather than feeding a port. That is an
engine ceiling. It lands on the half that takes audio, since that is what an interface input
carries.

A group offers no output either. It holds member names and carries no signal — said with a port
list rather than with a word, which is why `isGroupTrack` asks the ports rather than the ref. A
group is not typed by its material, having none.

## Bypass is the mute

A lane's mute is its module's bypass: one name in `graph.yaml`'s `bypassed:`, written by the
`node bypass` the graph's bypass button runs.

On a source, bypass reads as **produces nothing** rather than *passes through untouched* — a
source has no input to pass through. That is the one semantic worth stating out loud, and it is
why the lane file carries no `mute:` for the two to disagree over.

**Solo is PROJECT STATE**: `soloed:` at project.yaml's root lists the soloed lanes, several at
once, and the ENGINE resolves the relationship — any soloed track silences every non-soloed one,
`applySoloMute`. The compiler stamps the flag onto the listed lanes — a group's entry folds onto
its members there, since the engine resolves across tracks alone — and `track solo` toggles
membership, deleting the key with the last entry: absent means nobody, like every other default.

One list at the root rather than a derived set of bypasses. Derived, solo cannot hold two at once,
rewrites N files to say one fact, and reads in `graph.yaml` as a wall of mutes nobody asked for.
Mute stays the lane's own bypass, untouched by anyone's solo.

## One name space, held by nodes alone

A lane is a node — `nodes/<name>.yaml` like any other use — so a lane and an insert share one flat
folder rather than two maps that could disagree. A DAW names the track after the instrument on it,
so an import can arrive with a lane `polysynth` and an insert that plays a `polysynth` plugin; the
filesystem itself is what keeps them apart, since the insert is filed under a name of its own
(`polysynth-inst`, or whatever `freeNodeName` proposes) rather than the lane's.

**A module is named by its ref, never by a bare name a lane could take.** A module lives at a named
level — `@workspace`, one of the account's libraries, or `@engine` — and `extends:` always spells the
level: an insert node written by the importer says `extends: "@workspace/instruments/polysynth"`,
whatever the lane beside it is called. So nothing can shadow: a collision between a lane's bare name
and a module answering to that same bare name cannot arise when a module has no bare spelling at
all.

## Every lane is a node of a built-in

None of the three has a file anywhere, which makes them the third such set in the repo after the
synthesised `@engine/…` plugins ([moduleNamespaces.md](moduleNamespaces.md)) and `@meta/doc`
([docModules.md](docModules.md)). A lane costs exactly one file — its own.

The alternative is what settles it, and it is the argument `@meta/doc` makes too: a
project-local `modules/tracks/track/module.yaml` would be a file every project must scaffold
before its first lane.

A lane being a *node* is not a trick — it is what a node already is here: one USE of a
module with its own settings. Its settings happen to be an arrangement.

## `kind` has a fourth value

`ModuleKind` is `"io" | "plugin" | "doc" | "track"`. A lane is none of the first three.

`io` is the tempting one, since a lane is a source. It would be wrong the way calling a doc an
`io` sink would be: every question asked about an io source is about a physical input or a file on
disk — which channel, whether you monitor it, its trim, whether the rig has one — and none of it
means anything about a lane.

## What the engine sees

`ProjectDoc`/`TrackDoc` know nothing of any of this. The engine's lanes are a **compilation
target**, not the authoring model — exactly the relationship the `Mixer` module has with the
engine's fader.

The engine does not believe a track is typed: `EditBuilder` dispatches per CLIP
(`c.type == ClipType::Midi ? insertMidiClip : insertClip`), and `TrackDoc.contentType` is read
into `ProjectDoc.h` and then used by nothing at all. Only the authoring model could have.

`contentType` on the wire has three values — `"audio" | "notes" | "audio notes"` — and the third
is what a bare-wired lane is. That is what the pattern compile reads to know which half of a lane
plays a pattern's notes and which its samples (`enginePattern.ts`), so no second field is needed.

`graph.ts`'s `Track` is a *projection* of a track module, and `trackModule.ts`'s `Lane` is the one
place that projection is computed: `graph.ts` turns it into what every surface draws (timecodes
parsed to beats) and `nodeProject.ts` compiles it for the engine (placements kept as authored).
Both ask the same question of the same module, and a second copy of "is this a group" is exactly
how the two would come to disagree. Neither carries a `contentType` — `Placement.kind` says it,
per event.

## Which nodes are lanes has to be TOLD

With one `modules:` map, `melody` and `reverb` are spelled alike and only what they extend tells
them apart — so `deriveChains` takes an `isLane` predicate. A caller holding the module map
supplies it; a caller holding no project (a chain TEMPLATE in the médiathèque, the editor's live
re-parse) supplies nothing and gets `@in` alone, which is exactly the lane a template has.

That is why `loadGraph` and `compileNodeProject` both fold the local modules *before* deriving the
chains. The fold is pure and in memory; doing it twice costs a walk over a few dozen structs and
buys the derivation the one fact `graph.yaml` does not state.

A lane is never ABSORBED into another run, whatever feeds it. A live channel routed into one
satisfies every absorption test — one feeder, feeding nothing else, and the lane goes somewhere —
so without that rule the input's run would swallow the lane as its next step, and the chain that
owns the lane's material would cease to exist.

## Retired spellings

There is no migration code, deliberately, and every schema is `.strict()` — so a file carrying a
retired field says so by name and by line rather than being read and dropped. This is the outcome
this repo keeps choosing (see [nodes.md](nodes.md), which makes the same call).

| a file may hold | write instead |
|---|---|
| `extends: "@meta/audio-track"` | `extends: "@meta/track"` |
| `extends: "@meta/sequence-track"` | `extends: "@meta/track"` |
| `extends: "@meta/audio-strudel-track"` | `extends: "@meta/strudel-track"` |
| `extends: "@meta/sequence-strudel-track"` | `extends: "@meta/strudel-track"` |
| `extends: "@meta/group-track"` | unchanged |
| two lanes, one audio and one sequences, for one part | one lane, and `#audio:` / `#midi:` in `graph.yaml` if the two need different chains |

A lane that streams (`@meta/strudel-track`) is the one case where the wiring has to say what the
file cannot: it holds nothing until the transport rolls, so `pad#midi: [ synth ]` is the only
place "these events are notes for the synth" is written down. An authored lane says it by holding
events.

Nothing resolves the retired spellings: a file naming one names a module that does not exist,
which the loader reports as such — the same call [moduleNamespaces.md](moduleNamespaces.md) makes
for `@mediatek/…`.

And for a project whose lanes are still files in `tracks/`:

| in `tracks/<id>.yaml` | write instead, in `nodes/<id>.yaml` |
|---|---|
| `type: single` \| `strudel` | `extends:` one of the two above |
| `contentType:` | nothing — the events say it |
| `type: group` | `extends: "@meta/group-track"` |
| `events:`, `color:`, `disabled:`, `tracks:`, `strudel:` | unchanged, on the node |
| `mute: true` | the name in `graph.yaml`'s `bypassed:` |
| `solo: true` | the name in project.yaml's root `soloed:` list |
| the `tracks:` entry in `graph.yaml` | the same line, under `modules:` |

## Two things a lane does not carry itself

`alternatives:`/`alternative:` and `frozen:` belong to the MODULE, which is what a lane is:

- [alternatives.md](alternatives.md) — a module's other sets of attributes, not a lane's other clip
  lists. The timeline gutter names the set a lane is playing, and clicking it opens a menu of the
  lane node's sets — the same `node alternative` verbs the graph's badges run
  (`apps/k7/frontend/docs/timeline.md`).
- [freeze.md](freeze.md) — a render standing in for everything UPSTREAM of a module, that module
  included, rather than for one lane and its own modules. It needs no neutralisation pass: gain and
  pan are a module, so where they sit relative to the freeze point already says whether they bake
  in.

A lane may say `video_source:` instead of `events:`: it then plays a picture lane's shots, its
clips derived from them at compile time ([videoSound.md](videoSound.md)).
