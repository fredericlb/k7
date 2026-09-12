# Transitions — what a shot does arriving and leaving

Sister page to [shaders.md](shaders.md): the same GLSL over the picture, but chosen by a **cut**
rather than by a cable.

```yaml
# video_tracks/main.yaml
events:
  - { ref: plan_a, start: 0,  length: 5 }
  - { ref: plan_b, start: 4,  length: 5, fade_in: 1 }                        # 1 s dissolve over plan_a
  - { ref: plan_c, start: 9,  length: 5, fade_in: { over: 1.5, with: wipe } }
  - { ref: plan_d, start: 14, length: 5, fade_out: 2 }                       # leaves towards whatever is below
```

## A bare number, or a map

`fade_in: 1` **is** `fade_in: { over: 1, with: dissolve }`. The `dissolve` is built into the
renderer, so an ordinary fade needs no file: a song with no `modules/` folder can fade.

It is **not a union** but a widening (`z.preprocess`), and the reason is measurable: on a union a
mistyped key surfaces as `Invalid input` with the real errors buried in the branches, so
`validate.ts` cannot find the line. Widened, `{ ovr: 1 }` answers `unrecognized_keys` on
`events.0.fade_in`, and the editor underlines the right place.

## The ARRIVING shot carries the transition

A transition is **one program and one progression**. If A's `fade_out` and B's `fade_in` could both
govern the same overlap, two programs would want the same pair and nothing would decide.

> In an overlap, the incoming shot's `fade_in` IS the transition.

A `fade_out` is therefore exactly the case where there is no incoming shot: the picture leaves
towards nothing, and what appears is the **layer below** (or the viewport's background for the
bottom layer). Cross-dissolve and fade-to-black are one code path; all that differs is whether a
second shot is active.

Dragging a shot over its neighbour is what creates the overlap. The gesture does not create the
transition: that would be cascade editing, and no drag here does it.

## `length: 0` — two cases, one of them refused

`length: 0` means "to the end of the source", and
[`activeAt`](../../ui-eyes/src/timeline.ts) resolves it as "to the next shot's `start`", `Infinity`
if there is none.

| shape | what `fade_out` does |
|---|---|
| `length: 0`, another event follows | works: the end is the next `start` |
| `length: 0`, **last in the list** | the end is `Infinity`: **refused**, on the line |

The refusal lives on `VideoTrackSchema` and not on the placement, because a placement alone cannot
know whether it is last. "The last shot runs to the end of its source" and "the last shot fades
out" are incompatible; give it a length and the second becomes possible again.

A `fade_in` never has this problem: it is anchored on `start`, which is always known.

A less visible corollary: a `length: 0` shot cannot be the **outgoing** half of a cross-dissolve,
since its end is by construction the next shot's start — the overlap is zero.

## A transition module's folder

```
modules/video_transitions/wipe/
  module.yaml          type: video_transition, params: P1..P4
  vertex.glsl
  fragment.glsl
  ui.yaml              the four knobs, drawn by the module builder
```

The GLSL is **flat in the module's folder**, not under `shaders/<name>/`. The extra level `shaders`
has exists to fill a **dropdown on a card** ([shaders.md](shaders.md)); a NAMED transition has no
card. A `shader:` on a transition module would mean the file says `with: wipe` and you get
`barn-door` — a second naming for a choice the placement has already made, with nothing to show it.
A module folder is therefore one transition, and one only.

If one of the two stages is missing it is not a transition. Same rule and same reason as
`isShaderFolder` — offering it would compile a program with no vertex stage, and the error would
talk about GL rather than about a file somebody has not finished.

`with:` **always** names a local module of `modules/video_transitions/`. A shared transition is
reached through a thin local module that `extends` it, exactly as a shader is:
[`ownerFolders`](../src/shaders.ts) walks the ancestry and the first folder carrying both stages
wins, so a local program masks an inherited one of the same name.

## The uniforms — the contract

Written out for the reason that already applies to `PASS_UNIFORMS`: GL returns a null location for
an **unknown** uniform and for a merely **unused** one, so a typo produces neither an error nor an
effect.

| uniform | what it is |
|---|---|
| `uFrom` | the picture LEAVING — a transparent texel when there is none |
| `uTo` | the picture ARRIVING — transparent for a `fade_out` |
| `uProgress` | `float` 0..1 — 0 is `uFrom` alone, 1 is `uTo` alone |
| `uTime` | `float` seconds — the **transport**'s position |
| `uResolution` | `vec2` px — the viewport |
| `uP1`..`uP4` | `float` 0..1 — the module's four knobs |

`uFrom`/`uTo` rather than `uTex`/`uTex2`: it reads with `uProgress`, and above all it is **not**
`uTex`, so a fragment copied from a `shaders` module fails at write time instead of silently
sampling nothing.

**`uAudio` is deliberately absent**, and its absence is the next section's argument: it is the one
shader uniform that requires a **cable**. A transition has no node, so no `#audio` side input, so
no track whose level it could read. A picture moving with the sound is a shader on the layer, not a
transition.

## Named, not cabled

A transition **never** appears in `graph.yaml`. It is named by a placement, as `clips/<ref>.yaml`
is: material, not a station on the signal's route. Three reasons:

- **There is no station.** A chain runs from a source to a sink; a transition happens *between two
  placements on one track*, which is a fact about the track's arrangement and not about where its
  output goes.
- **It has no second cable to take.** `MODULE_TYPES.video_transitions` declares **one** video
  input, and that single input is the admission: the type was modelled before anyone asked where
  the second picture came from. The
  [crossfade](../../dsp/src/crossfade.ts) is there to show that a
  two-wire effect must declare its own ports — and a transition still could not, because the second
  picture is not on a cable: it is the next entry in `events:`.
- **The uniform contract says so** (`uAudio`, above).

`video_transitions`' ports stay **declared** all the same, and that is not an oversight: emptying
them would not forbid them, it would make them *unconstrained* — `normalizeInputs` treats an empty
list as "no check". And the key stays in `MODULE_TYPES` because `moduleKeyFromPath` uses it to
recognise the folder; removing it would lose `modules/video_transitions/` for the editor and the
module builder.

## Its knobs are drawn by the module BUILDER

A card and its parameters belong to a **chain step**, and a module named by a placement has none.
The `ui.yaml` sitting beside the module is therefore rendered by `@studio/ui-module-builder` — the
**Builder** button on a `module.yaml`'s toolbar — which already draws knobs and menus from that
file.

## What breaks nothing

A `with:` naming nothing known **does not bring the frame down**: the transition is simply absent
from the document and the render falls back on the built-in `dissolve`. That is a deliberate
divergence from [shaders.md](shaders.md), whose posture is "lose the effect, keep the picture":
here keeping the picture by deleting the transition would **move the cut**, that is, lose the
*arrangement*. Falling back on a fade keeps the duration the author wrote and loses only the
character.

An unreadable `graph.yaml` costs no transition either: transitions are read off the **ref map**
(`loadModuleRefs`) and not off the graph, outside the `try/catch` that makes chain compilation
best-effort.

## A video track's schema is a guard

`loadVideoTracks` goes through `readYamlEntities`, like `clips/`, so the refusal above exists for
real and a track carrying an unknown key fails saying so. Without it `ENTITY_SCHEMAS.video_tracks`
would be declared and dead on the compilation path, and a mistyped key in a `video_tracks/*.yaml`
silently ignored.

## The render, in one function

Everything the compositor, the realtime driver and the export need fits in `layerFrameAt`
(`packages/ui-eyes/src/timeline.ts`): pure, no GL and no DOM, so it is **the only place the rule
lives** and realtime and frame-by-frame rendering cannot read it two ways.

It returns at most two shots, and the **last in file order wins**. Without that a cross-dissolve
would finish and then **snap back** to the outgoing shot for the rest of the overlap. So "a cut
belongs to the FOLLOWING shot" holds only for abutting shots; under overlap the rule is "at most
two, the last is the incoming one".

The rest is in [compositor.md](../../ui-eyes/docs/compositor.md) (premultiplied alpha and the
transparent texel), [passes.md](../../ui-eyes/docs/passes.md) (the second uniform contract) and
[realtime.md](../../ui-eyes/docs/realtime.md) (the second `<video>`, and why it exists only where a
`fade_in` asks for it).

## Fade to black, and to which black

The preview clears to the `--sh-background` token and the **render to true black**. The asymmetry
is deliberate: an empty frame already shows the application's background, so the preview stays
consistent with itself, whereas an exported file that had baked the chrome's grey into its frames
would be wrong for everybody. A `fade_out` on an upper layer does not descend to black anyway but
to **the layer below**.

## What is not there

- **Three overlapping shots.** A track has two decoders; three simultaneous shots are not
  renderable, and the top two win.
- **A `fade_out` revealing the shot below on the SAME track.** A reveal belongs to the incoming
  shot, and its `fade_in` is at its own `start`.
- **Per-placement parameters.** `P1..P4` belong to the module: two wipe directions are two modules,
  one of which `extends` the other.

## The layers crossed

| | |
|---|---|
| written | `fade_in:` / `fade_out:` on an event of `video_tracks/<lane>.yaml`, and `modules/video_transitions/<name>/` |
| declared | `packages/song-schema/src/moduleTypes.ts` — `TRANSITION_CATEGORY`, `DISSOLVE` |
| validated | `packages/song-schema/src/yaml/entitySchemas.ts` — the widening, and the refusal of an endless `fade_out` |
| guarded | `packages/song/src/loader.ts` — `loadVideoTracks` goes through the schema |
| read | `src/videoTransitions.ts` — the ancestry from `src/shaders.ts` |
| compiled | `src/videoTracks.ts` -> `VideoClipDoc.fadeIn`, and `src/videoProject.ts` -> `VideoProjectDoc.transitions`, the GLSL **inline** |
| on the wire | `packages/web-protocol/types.ts` — `WebVideoFade`, `WebVideoTransition` |
| served | `packages/file-service/src/workspace.ts` — `toWebVideoTracks`, `videoProjectDoc` |
| adapted | `apps/st0/frontend/src/scene.ts` -> `packages/ui-eyes/src/scene.ts` |
| decided | `packages/ui-eyes/src/timeline.ts` — `layerFrameAt`, the only rule |
| decoded | `packages/ui-eyes/src/realtime.ts` and `packages/ui-eyes/src/export.ts` |
| drawn | `packages/ui-eyes/src/compositor.ts` + `packages/ui-eyes/src/passes.ts`, the built-in fade in `packages/ui-eyes/src/transitions.ts` |
| completed | `packages/song-schema/src/yaml/fields.ts` — the two words of a fade's map |

## Checking it

```bash
npx vitest run packages/song-video/src/videoTransitions.test.ts
npx vitest run packages/song-schema/src/yaml/videoTrackYaml.test.ts
npx vitest run packages/ui-eyes/src/timeline.test.ts packages/ui-eyes/src/compositor.test.ts
```

The first proves the folder read, the ancestry, the two refusals and the knob clamping; the second,
the two spellings of a fade, the **located** error of a mistyped key, and the refusal of an endless
`fade_out`; the third, the frame rule and the order of GL calls — which blend function is in force
for which draw, which texture on which unit, and what is allocated.

**None of them proves a pixel changed**: there is no WebGL2 in the runner, and
`compositor.test.ts` says so itself. The remaining check is done with the eyes — open
`demos/video-demo.st0`, overlap two shots, give the second a `fade_in`, and watch the cut become a
fade.
