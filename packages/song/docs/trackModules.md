# Track modules — a lane IN the graph

A lane is a module. It lives in `nodes/<name>.yaml` like every other use of a module, and
what it `extends` says what kind of lane it is — which is a smaller question than it used to be:

```yaml
# nodes/melody.yaml
extends: "@studio/track"
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
  events written down     @studio/track
  events streamed         @studio/strudel-track

  neither                 @studio/group-track
```

There were five. The grid had a second axis — `audio` or `notes` — and a lane sat in one cell of
it for ever: `@studio/sequence-track` carried notes *because that is what it IS*, which was the
argument for having five rather than two.

The argument was sound and the premise was wrong. **A lane does not carry a signal — its EVENTS
do.** An event names a `clips/<id>.yaml` or a `sequences/<id>.yaml`, and that is already the whole
answer, stated once per event by the material itself. The word at the top of the lane file was a
second copy of a fact each event was carrying anyway, and its only real power was the power to
refuse: a lane could not hold both. Which is a thing songs do constantly — a guitar part where two
bars are a sampled riff and the rest is a line for a synth, a strudel pattern that is half drums
and half melody — and it cost a second lane, a second strip, a second name, and a convention
saying the two belonged together.

So the axis is gone, and with it `contentType`, `Lane.contentType`, `Track.contentType`,
`StrudelLane.contentType` and the four rules that read them. What survives is the one axis that is
genuinely about the lane and not about its material: **where the events come from** — written
down, or streamed while the transport rolls.

## Two outputs

A lane offers `audio` and `midi`, and nothing else. An event leaves by the one its material fits.

```yaml
modules:
  gtr#audio: [ amp ]      # the events naming clips
  gtr#midi:  [ synth ]    # the events naming sequences
  amp: [ OUT ]
  synth: [ OUT ]
```

The `#port` syntax is not new — it is [ports.md](ports.md)'s, already used for a stem separator's
outputs — and neither is a bare key:

```yaml
modules:
  gtr: [ amp ]            # everything this lane emits, down one chain
```

**Bare means everything.** That is what every project written before this says, and it stays
exactly what it meant: one engine track, one chain, all the lane's events. A port only has to be
named when there is a genuine choice to make, which is when the lane holds both kinds and you want
them treated differently. Nothing gained a suffix by existing.

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
its sequences through a synth is two tracks down there, and always was.

`nodeProject`'s `halvesOf` is where that happens: a lane wired on both outputs compiles to
`gtr#audio` and `gtr#midi`, each carrying the events its port fits and the plugins of the run that
left by it. A lane wired bare — or on one port only — compiles to one track called after the lane,
which is why every existing project's compiled document is unchanged.

That the split exists at all is the engine's model showing through, not the authoring model's. It
is the same relationship `Mixer` already has with the engine's fader, and the same one the whole
of `ProjectDoc` has with `nodes/`: **the engine's lanes are a compilation target.** What changed is
that the two lanes are one lane HERE, where the song is written.

Both halves take the lane's mute, its solo, its group and its colour — those are facts about the
lane, not about one of its outputs. A live interface input lands on whichever half takes audio,
which is the other refusal detyping removed: recording a guitar onto the lane you wrote the line
on used to be a `contentType: sequences` warning, and is now just an overdub.

## `deriveChains` has one exception now

A module's outputs stay **one node**: `stemsplit#drums` and `stemsplit#vocals` are one meeting
point, because `out` compiles as a parallel send and per-key counting would absorb both targets
into a run through a module that in fact splits ([ports.md](ports.md)).

A LANE's outputs are not that. They carry different material and compile to different engine
tracks, so `melody#audio` and `melody#midi` are two runs, each absorbing its own modules. That is
`srcId` in `chainsGraph.ts`, and it is the whole cost of detyping to the derivation: one predicate
the derivation already had (`isLane`) deciding whether a source key's port is part of its identity.

`Chain.fromPort` carries the port up to everyone else. `from` stays the bare lane name — a reader
asking "whose material is this" and a reader asking "which jack did it leave by" each get their
answer without parsing the other's — and the run's NAME is the id the engine track takes.

## No ports IN, still

A lane offers no input. What arrives on a lane is its events.

The one thing that may be routed INTO a lane is a live interface channel, and that is still the
special case it always was (`validate`'s out-check): the flat model the engine plays cannot
express routing into a lane's input, so the compiler LANDS the input on the lane rather than
feeding a port. That is an engine ceiling, not a name-space artefact, and neither merging the two
name spaces nor detyping moved it. What detyping DID move is where it lands: on the half that
takes audio, since that is what an interface input carries.

A group offers no output either. It holds member names and carries no signal — the same fact its
old `type: group` stated, said with a port list instead of a word, which is why `isGroupTrack`
asks the ports rather than the ref. It is the one lane kind detyping left exactly as it was: a
group was never typed by its material, having none.

## Bypass is the mute

A lane's mute is its module's bypass: one name in `graph.yaml`'s `bypassed:`, written by the
same `node bypass` the graph's bypass button has always run.

On a source, bypass reads as **produces nothing** rather than *passes through untouched* — a
source has no input to pass through. That is the one semantic worth stating out loud, and it is
why the lane file carries no `mute:` for the two to disagree over.

**Solo is PROJECT STATE**: `soloed:` at project.yaml's root lists the soloed lanes, several at
once, and the ENGINE resolves the relationship (any soloed track silences every non-soloed one —
`applySoloMute`, which had implemented exactly this all along; `TrackDoc.solo` was the field
nothing set). The compiler stamps the flag onto the listed lanes — a group's entry folds onto its
members there, since the engine resolves across tracks alone — and `track solo` toggles
membership, deleting the key with the last entry: absent means nobody, like every other default.

It used to be written nowhere — derived, as the set of bypasses soloing produces. That could not
hold two solos at once, rewrote N files to say one fact, and read in `graph.yaml` as a wall of
mutes nobody asked for. One list at the root says it now, and mute stays what it was: the lane's
own bypass, untouched by anyone's solo.

## One name space

A lane and a module share one set of names, because they are the same kind of thing. `chainsGraph`
used to throw when a name was in both `tracks:` and `modules:` — a chain's name is an identity
(the routing target, the bus's track, the prefix of every plugin id under it), so the two could
not share one. With a single map the collision cannot be written down, and the refusal is gone.

The practical cost is the one thing to know when moving a project over: a lane and the instrument
it feeds that happened to share a name have to be told apart. The repo's own demos took the
obvious road — the lane keeps its name, the synth is named for the lane it serves
(`pad` → `synth-pad`).

## Every lane is a node of a built-in

None of the three has a file anywhere, which makes them the third such set in the repo after the
synthesised `@engine/…` plugins ([moduleNamespaces.md](moduleNamespaces.md)) and `@studio/doc`
([docModules.md](docModules.md)). A lane costs exactly one file — its own.

The alternative is what settled it, and it is the argument `@studio/doc` already made: a
project-local `modules/tracks/track/module.yaml` would be a file every project must scaffold
before its first lane, and every old project would have to create it by hand.

A lane being a *node* is not a trick — it is what a node already is here: one USE of a
module with its own settings. Its settings happen to be an arrangement.

## `kind` grew a fourth value

`ModuleKind` was `"io" | "plugin" | "doc"`. A lane is none of the three.

`io` was the tempting one, since a lane is a source. It would have been wrong the way calling a
doc an `io` sink would have been: every question asked about an io source is about a physical
input or a file on disk — which channel, whether you monitor it, its trim, whether the rig has
one — and none of it means anything about a lane.

Widening it made the compiler point at each place that assumed three. That was the point.

## What the engine still sees

`ProjectDoc`/`TrackDoc` are unchanged, and so is the C++ engine. The engine's lanes are a
**compilation target**, not the authoring model — exactly the relationship the `Mixer` module
already has with the engine's fader.

Detyping needed nothing from the engine, and that is worth stating: `EditBuilder` has dispatched
per CLIP for as long as it has existed (`c.type == ClipType::Midi ? insertMidiClip : insertClip`),
and `TrackDoc.contentType` is read into `ProjectDoc.h` and then used by nothing at all. The engine
never believed a track was typed. Only the authoring model did.

`contentType` on the wire has documented three values all along — `"audio" | "notes" | "audio
notes"` — and only ever carried two. The third is what a bare-wired detyped lane is, so the field
finally says something: it is what `patternClock` asks to find which half of a lane a streamed
event lands on, without needing a new field to ask it with.

`graph.ts`'s `Track` survives as a *projection* of a track module, and `trackModule.ts`'s `Lane`
is the one place that projection is computed: `graph.ts` turns it into what every surface draws
(timecodes parsed to beats) and `nodeProject.ts` compiles it for the engine (placements kept as
authored). Both ask the same question of the same module, and a second copy of "is this a group"
is exactly how the two would come to disagree. Neither carries a `contentType` any more —
`Placement.kind` already said it, per event, and was right.

The measurement: the compiled `ProjectDoc` for `synth-demo.st0` came out identical across detyping
in every field but one — `kit`, a strudel lane wired to nothing, now reads `"audio notes"` where it
read `"audio"`. It is unwired, so nothing says what it carries and it streams whatever the pattern
gives it; the old value was the old vocabulary's best guess. Every track id, every clip, every
plugin is byte-for-byte what it was.

## Which nodes are lanes has to be TOLD

With one `modules:` map, `melody` and `reverb` are spelled alike and only what they extend tells
them apart — so `deriveChains` takes an `isLane` predicate. A caller holding the module map
supplies it; a caller holding no project (a chain TEMPLATE in the médiathèque, the editor's live
re-parse) supplies nothing and gets `@in` alone, which is exactly the lane a template has.

That is why `loadGraph` and `compileNodeProject` both fold the local modules *before* deriving the
chains. The fold is pure and in memory; doing it twice costs a walk over a few dozen structs and
buys the derivation the one fact `graph.yaml` no longer states.

A lane is never ABSORBED into another run, whatever feeds it. A live channel routed into one
satisfies every absorption test — one feeder, feeding nothing else, and the lane goes somewhere —
so without that rule the input's run would swallow the lane as its next step, and the chain that
owns the lane's material would cease to exist.

## Migrating

There is no migration code, deliberately, and every schema is `.strict()` — so a file carrying an
old field says so by name and by line rather than being read and dropped. This is the outcome this
repo keeps choosing (see [nodes.md](nodes.md), which made the same call).

| was | is |
|---|---|
| `extends: "@studio/audio-track"` | `extends: "@studio/track"` |
| `extends: "@studio/sequence-track"` | `extends: "@studio/track"` |
| `extends: "@studio/audio-strudel-track"` | `extends: "@studio/strudel-track"` |
| `extends: "@studio/sequence-strudel-track"` | `extends: "@studio/strudel-track"` |
| `extends: "@studio/group-track"` | unchanged |
| two lanes, one audio and one sequences, for one part | one lane, and `#audio:` / `#midi:` in `graph.yaml` if the two need different chains |

A lane that streams (`@studio/strudel-track`) is the one case where the wiring has to say what the
file no longer does: it holds nothing until the transport rolls, so `pad#midi: [ synth ]` is the
only place "these events are notes for the synth" is written down. An authored lane says it by
holding events.

`LEGACY_TRACK_REFS` in `moduleTypes.ts` keeps the four old spellings as NAMES, so a diagnostic can
say which one a file means. Nothing resolves them — the same call
[moduleNamespaces.md](moduleNamespaces.md) made for `@mediatek/…`.

No migration CODE, and a migration SCRIPT, which is the distinction this repo keeps drawing
(`migrateChains`, `migrateNamespace`, `migrateModules`, …). The loader refuses, once, by name and
by line; a one-shot rewrites the files and is then done with:

```bash
npx tsx packages/song/scripts/migrateTracks.ts <project-or-workspace>          # dry run
npx tsx packages/song/scripts/migrateTracks.ts <project-or-workspace> --write
```

It reports every STREAMING lane it touched separately, because that is the one case it cannot
finish: a written-down lane says what it carries by holding events, and a streaming one holds
nothing until it rolls — so `graph.yaml` has to name the output, and only a person knows which.

And the older move, from before lanes were modules at all:

| was, in `tracks/<id>.yaml` | is, in `nodes/<id>.yaml` |
|---|---|
| `type: single` \| `strudel` | `extends:` one of the two above |
| `contentType:` | **gone** — the events say it |
| `type: group` | `extends: "@studio/group-track"` |
| `events:`, `color:`, `disabled:`, `tracks:`, `strudel:` | unchanged, on the node |
| `mute: true` | the name in `graph.yaml`'s `bypassed:` |
| `solo: true` | the name in project.yaml's root `soloed:` list |
| the `tracks:` entry in `graph.yaml` | the same line, under `modules:` |

`st0 migrate chains` still handles the chain-list → segments step, and now reports the lanes it
saw (`ChainsMigration.tracks`) — the old `{ track: … }` heads are the last place that is written
down, and a caller that threw it away could not derive the chains it had just written.

## What went away, to come back another way

`alternatives:`/`alternative:` and `frozen:` came off the lane rather than being ported: both are
worth having and neither belonged on the lane in the shape it had. **Both came back**, generalised
to the module — which is the same feature arriving where it belongs, a lane being a module now.

- [alternatives.md](alternatives.md) — a MODULE's other sets of attributes, not a lane's other clip
  lists. Gone with the old shape: `trackAlternatives.ts`, `TrackAlternatives.tsx`,
  `track alternative select|create|copy`. The timeline gutter says which set a lane is playing
  again, and clicking it opens the lane node's own ⋮ menu — so the picker came back as one menu
  reached from two places, running the `module` verbs
  (`apps/st0/frontend/docs/timeline.md`).
- [freeze.md](freeze.md) — a render standing in for everything UPSTREAM of a module, that module
  included, rather than for one lane and its own modules. Gone with the old shape: `frozenRender`,
  `frozenTracks` on the graph wire, `FreezeOverlay.tsx`, `track freeze`, and `freezeTrackRender`,
  whose neutralisation pass the new one does not need — gain and pan are a module now, so where
  they sit relative to the freeze point already says whether they bake in.

`video_source` is simply gone: it is sayable — a song carries picture ([picture.md](../../song-video/docs/picture.md)) —
and nothing reads it.

`contentType` went in two steps, and the second is the interesting one. It came off the FILE first,
folded into `extends:` so it could not go missing or disagree with `type:`. That was right about
the redundancy and wrong about where the fact lived: it moved a lane's material from one word to
another word, when the material was never the lane's to state. The second step took the word away
altogether. Which is the shape of most of the good moves in this repo — not "say it once instead of
twice" but "notice that the thing already says it".
