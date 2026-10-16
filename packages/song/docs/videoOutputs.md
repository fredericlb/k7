# `RENDER` and `VIDEO_OUT` — the picture's two outputs

A graph has **four** built-in outputs, not two. The first pair belongs to the sound
([masterChain.md](masterChain.md)); these are their twins for the picture:

| name | what it is |
|---|---|
| `RENDER` | the **compositor's sum** — where every video track arrives, exactly as every audio track arrives at `MIX`. Carries no parameter |
| `VIDEO_OUT` | the **picture that leaves**, the one the `viewport` composes. Carries no parameter either — a picture has no level |

```yaml
# graph.yaml
modules:
  drums:  [ MIX ]
  MIX:    [ OUT ]            # the sound's master chain
  RENDER: [ VIDEO_OUT ]      # …and the picture's
```

The run between the two is the **video master chain**: its modules (`video_effects`, `shaders`)
process the whole picture. Same reason the `MIX`/`OUT` split has — with one name there is nowhere
to put a treatment on the whole. Not `video_transitions`: a transition is not a chain step at all
(below).

## What crosses this run, and what does not

A **`shaders`** module on `RENDER -> VIDEO_OUT` processes the composited frame, in GLSL, down to
the pixel ([shaders.md](../../song-video/docs/shaders.md)). The path from a `graph.yaml` to
`@studio/ui-eyes` is `src/videoChains.ts`.

One **other** form of `VideoPluginDoc` is modelled and never compiled: `video_effect` has no plugin
format behind it, so a module of that type is drawn and validated without changing the picture.

`video_transitions` has one, and it does not come through here: a transition is **named by a cut**
rather than wired, so it is never a chain step
([transitions.md](../../song-video/docs/transitions.md)).

None of this touches the sound: a folder's two compiles share no field — `loadProject` produces the
`ProjectDoc` the C++ engine reads, where no picture ever arrives, and `loadVideoProject` produces
the `VideoProjectDoc` the compositor reads ([picture.md](../../song-video/docs/picture.md)). The
video run therefore has **no owner** in `nodeProject.ts`, and what it carries cannot land on an
audio bus by accident.

## No parameter, and that is not an oversight

`OUT` is the only one of the four names that carries anything: its `Volume` is the song's output
level ([masterVolume.md](masterVolume.md)). The symmetry stops there.

A fader on `VIDEO_OUT` — a global opacity, a brightness — would be a control **wired to nothing**:
`@studio/ui-eyes` reads no global level, and writing a value no render consults is exactly the kind
of control someone adjusts for ten minutes before realising it does nothing. `node param
"VIDEO_OUT" …` is refused **by name**, with the sentence that says so, rather than left to the
generic "no plugin module".

## Added on their own — the one real difference from the sound

`MIX: [ OUT ]` is never back-filled: projects without it exist, and a script has to be run by hand.
The picture does not go through that:

| when | where |
|---|---|
| a `video` project is created | `scaffold.ts` — `videoGraph()` adds the line to the common graph |
| `project surface new viewport` | `surfaces.ts` — `createSurfaceFile` places it straight after |
| a project is **opened** | `file-service`'s `setActiveProject` → `repairVideoOutputs` |

The third is the one that counts: any project declaring a `viewport` has the run by the time
anything reads its graph, **including those written before these names existed**. A project without
a `viewport` gets nothing, and never sees either name — including in completion, which offers them
only to a project that has video tracks.

The write is **textual** rather than YAML re-read and re-emitted, for the usual reason here: a
`graph.yaml` is commented and hand-edited, and re-serialising would reformat the whole file to add
one line. The line goes at the **end** of the `modules:` map, where the signal arrives.

A block map extends over "the lines indented under the key": a comment indented with the map
belongs to it and is stepped over, only the next unindented line ends it. And `null` for a graph
with no `modules:` at all — inventing the map to house a line would write a file the project never
had.

`ensureVideoRun` **does not ask** whether the project has a viewport: the caller has already
decided, and the two callers know it differently — `createSurfaceFile` is the one writing the
surface, the file service opens a project whose surfaces it has just read. Asking again here would
mean importing `surfaces.ts`, which imports this file, and the cycle would serve to re-examine a
settled question.

`ensureVideoRun` is **best-effort** throughout: no `graph.yaml`, no `modules:` map, a read-only
folder — the project is left as it is and opens anyway. Gaining a convenience is not a condition
for opening a song.

## No cable is drawn TO `RENDER`

Same nuance as `MIX`, same motive. Every video track arrives there — that is what a compositor is —
so those arrows would say nothing the shape does not already say. Only the run **leaving** it is
drawn, `RENDER → [ chain ] → VIDEO_OUT`.

And like `MIX`, `RENDER` is drawn as a sink but **stands where a source stands**:
`alignModuleRank` exempts it from the push it applies to real sinks, without which it would end up
below the run it feeds.

`buildGraph` synthesises the pair when the file declares no run — which the file service should
have made impossible. Not belt and braces: the same code draws a graph **being typed**, the editor
re-parsing on each keystroke, and a track pointed at `RENDER` a second before the line is written
must not lose its card in the meantime.

## The layers crossed

| | |
|---|---|
| written | `graph.yaml` — a run from `RENDER` to `VIDEO_OUT`, added unasked |
| added | `src/videoOutputs.ts` — `ensureVideoRun`, called at surface creation and at open |
| derived | `src/chainsGraph.ts`: `RENDER` starts a run, like `@in`, like `MIX`, like a track |
| validated | `src/graph.ts`: `isSink` takes all four names at their word, `validate()` exempts `from: RENDER` |
| compiled | **nowhere** — and `nodeProject.ts` says so where it compiles the other pair |
| drawn | the `RENDER` and `VIDEO_OUT` cards (`@studio/ui-chains`), the second without a fader |
| refused | `@studio/commands`' `setBuiltinOutParam` — both, by name |

## Checking it

```bash
npx vitest run packages/song/src/videoOutputs.test.ts
npx vitest run packages/ui-chains/src/graph.test.ts
```

And by hand, the real test of the automatic add: take a project with a `viewport` and without the
line, open it, read its `graph.yaml` back.
