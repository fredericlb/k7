# Track modules — a lane IN the graph

A lane is a module. It lives in `instances/<name>.yaml` like every other use of a module, and
what it `extends` says what kind of lane it is:

```yaml
# instances/melody.yaml
extends: "@studio/sequence-track"
color: "#c8a97e"
clips:
  - { ref: melody, start: "1:1:1" }
```

…wired in `chains.yaml`'s one `modules:` map, like anything else:

```yaml
modules:
  melody: [ synth-melody ]
  synth-melody: [ OUT ]
bypassed: [ melody ]     # a lane in this list is MUTED
```

There is no `tracks/` folder, and no `tracks:` half of `chains.yaml`.

## The five, as a grid

```
                clips written down     clips streamed
  audio         @studio/audio-track    @studio/audio-strudel-track
  notes         @studio/sequence-track @studio/sequence-strudel-track

  neither       @studio/group-track
```

`type: single | group | strudel` beside `contentType: audio | sequences` was that grid spelled as
two fields, and it is the whole reason `contentType` existed: `type` could not say what signal a
lane carried, so a second field had to. Flattened, both questions are read off one `extends:`, and
neither can go missing or disagree with the other — a `@studio/sequence-track` carries notes
because that is what it IS.

`trackModule.ts` builds the five from one table keyed by `{ signal, generated }` rather than five
literals, for the same reason: the grid is the vocabulary, and five hand-written copies is where
the audio and sequence halves start to drift.

## No ports but one output

A lane offers `out` and nothing else. What arrives on a lane is its clips.

The one thing that may be routed INTO a lane is a live interface channel, and that is still the
special case it always was (`validate`'s out-check): the flat model the engine plays cannot
express routing into a lane's input, so the compiler LANDS the input on the lane rather than
feeding a port. That is an engine ceiling, not a name-space artefact, and merging the two name
spaces did not move it.

A group offers no output either. It holds member names and carries no signal — the same fact its
old `type: group` stated, said with a port list instead of a word, which is why `isGroupTrack`
asks the ports rather than the ref.

## Bypass is the mute

A lane's mute is its module's bypass: one name in `chains.yaml`'s `bypassed:`, written by the
same `module bypass` the graph's bypass button has always run.

On a source, bypass reads as **produces nothing** rather than *passes through untouched* — a
source has no input to pass through. That is the one semantic worth stating out loud, and it is
why the lane file carries no `mute:` for the two to disagree over.

**Solo is written nowhere.** It is a session state the surface derives: soloing a lane bypasses
every other one, and turning solo off un-bypasses them. There is no prior state to restore and no
`soloed:` list to keep in step — solo IS the set of mutes it produces, which is what you can
already see. `TrackDoc.solo` survives on the wire as a field nothing sets, to be deleted with the
C++ struct.

## One name space

A lane and a module share one set of names, because they are the same kind of thing. `chainsGraph`
used to throw when a name was in both `tracks:` and `modules:` — a chain's name is an identity
(the routing target, the bus's track, the prefix of every plugin id under it), so the two could
not share one. With a single map the collision cannot be written down, and the refusal is gone.

The practical cost is the one thing to know when moving a project over: a lane and the instrument
it feeds that happened to share a name have to be told apart. The repo's own demos took the
obvious road — the lane keeps its name, the synth is named for the lane it serves
(`pad` → `synth-pad`).

## Every lane is an instance of a built-in

None of the five has a file anywhere, which makes them the third such set in the repo after the
synthesised `@engine/…` plugins ([moduleNamespaces.md](moduleNamespaces.md)) and `@studio/doc`
([docModules.md](docModules.md)). A lane costs exactly one file — its own.

The alternative is what settled it, and it is the argument `@studio/doc` already made: a
project-local `modules/tracks/audio/module.yaml` would be a file every project must scaffold
before its first lane, and every old project would have to create it by hand.

A lane being an *instance* is not a trick — it is what an instance already is here: one USE of a
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

`graph.ts`'s `Track` survives as a *projection* of a track module, and `trackModule.ts`'s `Lane`
is the one place that projection is computed: `graph.ts` turns it into what every surface draws
(timecodes parsed to beats) and `nodeProject.ts` compiles it for the engine (placements kept as
authored). Both ask the same question of the same module, and a second copy of "is this a group"
is exactly how the two would come to disagree.

The compiled `ProjectDoc` for `synth-demo.l8` came out byte-identical across this change but for
the one deliberate rename, which is the measurement that says the engine's half was untouched.

## Which nodes are lanes has to be TOLD

With one `modules:` map, `melody` and `reverb` are spelled alike and only what they extend tells
them apart — so `deriveChains` takes an `isLane` predicate. A caller holding the module map
supplies it; a caller holding no project (a chain TEMPLATE in the médiathèque, the editor's live
re-parse) supplies nothing and gets `@in` alone, which is exactly the lane a template has.

That is why `loadGraph` and `compileNodeProject` both fold the local modules *before* deriving the
chains. The fold is pure and in memory; doing it twice costs a walk over a few dozen structs and
buys the derivation the one fact `chains.yaml` no longer states.

A lane is never ABSORBED into another run, whatever feeds it. A live channel routed into one
satisfies every absorption test — one feeder, feeding nothing else, and the lane goes somewhere —
so without that rule the input's run would swallow the lane as its next step, and the chain that
owns the lane's material would cease to exist.

## Migrating

There is no migration code, deliberately, and every schema is `.strict()` — so a file carrying an
old field says so by name and by line rather than being read and dropped. This is the outcome this
repo keeps choosing (see [instances.md](instances.md), which made the same call).

| was, in `tracks/<id>.yaml` | is, in `instances/<id>.yaml` |
|---|---|
| `type: single` + `contentType: audio` | `extends: "@studio/audio-track"` |
| `type: single` + `contentType: sequences` | `extends: "@studio/sequence-track"` |
| `type: strudel` + `contentType: audio` | `extends: "@studio/audio-strudel-track"` |
| `type: strudel` + `contentType: sequences` | `extends: "@studio/sequence-strudel-track"` |
| `type: group` | `extends: "@studio/group-track"` |
| `clips:`, `color:`, `disabled:`, `tracks:`, `strudel:` | unchanged, on the instance |
| `mute: true` | the name in `chains.yaml`'s `bypassed:` |
| `solo: true` | nothing — derived by the surface |
| the `tracks:` entry in `chains.yaml` | the same line, under `modules:` |

`l8 migrate chains` still handles the chain-list → segments step, and now reports the lanes it
saw (`ChainsMigration.tracks`) — the old `{ track: … }` heads are the last place that is written
down, and a caller that threw it away could not derive the chains it had just written.

## What went away, to come back another way

`alternatives:`/`alternative:` and `frozen:` are removed rather than reimplemented: both are
worth having and neither belongs on the lane in the shape it had.

**Alternatives came back**, generalised — see [alternatives.md](alternatives.md). They are a
MODULE's other sets of attributes now, not a lane's other clip lists, which is the same feature
arriving where it belongs: a lane is a module, so a lane's takes are one use of it. What went with
the old shape:

- `trackAlternatives.ts`, `TrackAlternatives.tsx`, `track alternative select|create|copy`;
- `frozenRender`, `frozenTracks` on the graph wire, `GraphNode.frozen`, `FreezeOverlay.tsx`,
  `track freeze`. `freezeTrackRender` in `@studio/commands` is KEPT and unused — it is the half
  that does not depend on where the state lived, and its neutralisation pass is the part that is
  silent when it is wrong. It is listed in `docs/inventaire.md` so it is not mistaken for live
  code.

`contentType` and `video_source` are simply gone: the first is what the module type says, and the
second has been read by nothing since picture became its own `.v1` project.
