# The `shaders` module — GLSL over the picture, driven by sound

```yaml
# graph.yaml
modules:
  drums:  [ MIX, glow#audio ]   # the track feeds the mix AND the shader's audio input
  MIX:    [ OUT ]
  main:   [ glow ]              # the video track crosses the shader…
  glow:   [ RENDER ]            # …before reaching the compositor
  RENDER: [ VIDEO_OUT ]
```

A `shaders` module takes **one image**, renders **one image**, and additionally accepts an
**optional audio input** whose level reaches the fragment as `uAudio`. It is the only module in the
repo whose ports carry two different signals, and that is exactly what it is for: a picture that
**moves with the sound**.

| port | signal | required |
|---|---|---|
| `in` | video | yes — this is the chain's flow |
| `audio` | audio | **no** — a shader using only its knobs is an ordinary video effect |
| `out` | video | a single output |

The audio input is never the flow: it is a **side input**, written `drums: [ glow#audio ]`, so
positional port checking fills `in` from the flow and this one from the step's `in:` — exactly like
a crossfade's second input.

## A shader's folder

```
modules/shaders/glow/
  module.yaml            type: shader, shader: pulse, params: P1..P4
  ui.yaml                the dropdown + the four knobs
  shaders/
    pulse/
      vertex.glsl
      fragment.glsl
    ripple/
      vertex.glsl
      fragment.glsl
```

A shader is a **folder**, not a file, because a shader is a **pair**: change the fragment while
keeping the vertex and you have another effect over the same geometry. Naming the pair after the
folder is what lets the menu offer `ripple` instead of two half-choices that can be mismatched.

A folder missing either stage **is not offered**: offering it compiles a program with no vertex
stage, and the failure talks about GL rather than about a file someone has not finished writing.

`shaders/` sits beside the `module.yaml` and not in `assets/`, on the model of `base/`: `assets/` is
a flat list of files that a parameter NAMES, filtered by extension (`assetExtsFor`). A shader is a
directory — it would be the only entry there that is not a file.

## The dropdown is filled by the DISK

```yaml
# ui.yaml
widgets:
  pick: { type: dropdown, col: 0, row: 0, colSpan: 4, bind: "@shader" }
```

The panel says **nothing** about its entries: which shaders exist changes the moment someone drops
in a folder, and a list written here would be a copy of a directory that goes stale between two
saves. The graph fills it from what the loader found (`moduleShaderChoices`) — the mechanism of
`@base`, over another folder.

`@shader` is a **field** and not a parameter, the distinction `base` already draws: the four knobs
drive a running program, this one decides **which program is compiled**. The renderer learns it by
rebuilding the pass.

The list is searched through the **ancestry** — the module then everything it `extends` — for the
same reason as `moduleAssetChoices`: a song points at a shared module through a thin local module
whose folder holds nothing. A local shader masks an inherited one of the same name, and `readShader`
searches in the same order: the list you choose from and the source you get must agree.

## The uniforms — the contract

| uniform | what it is |
|---|---|
| `uTex` | the incoming image: the track's frame for the first pass, the previous pass's output afterwards |
| `uAudio` | `float` 0..1 — the live level of the track wired to the audio port, 0 if there is none |
| `uTime` | `float` seconds — the **transport** position, not a render-engine clock |
| `uResolution` | `vec2` px — the viewport |
| `uPresence` | `float` 0..1 — how much of the shot is on screen: rises over a fade's stretch in, falls over one out, **1 everywhere else** ([transitions.md](transitions.md)) |
| `uP1`..`uP4` | `float` 0..1 — the four knobs |

Written down because nothing else will tell anyone: GL returns a null location for an unknown
uniform **and** for a merely unused one, so the two are indistinguishable. A typo in a uniform name
produces no error and no effect.

### Why four numbered knobs

The module cannot know what a shader will call its controls, and a shader's author cannot rename a
knob on a panel he never sees. Four is what fits on one row of the grid; 0..1 is what a GLSL uniform
wants — no shader normalises, no panel asks for units. What each one **means** is the shader's
business, and reads in its `fragment.glsl` comments.

Values are **clamped** at compile time, because they leave TypeScript for GLSL: a hand-written
`P1: 4` reaches a shader entitled to assume 0..1, and what comes out is not a wrong image but an
unrecognisable one.

## `uAudio`: from a VU meter to a uniform

The engine pushes `levels`, an **array** of dB per track, ~20 times a second — nameless, indexed on
the list of compiled tracks.

```
EngineState.levels[i]          the engine, ~20 Hz
 -> levelsForPasses()          packages/st0-plugins/src/video/shaderAudio.ts — the index comes from trackOrder
 -> levelToUnit()              -60..0 dB -> 0..1
 -> smoothLevels()             fast attack, slow release
 -> RealtimeDriver.setAudio()  @studio/ui-eyes
 -> uAudio
```

Three decisions worth stating:

- **Linear IN DECIBELS**, not in amplitude. A visual following amplitude stays pinned near zero
  except on peaks, because that is what amplitude does; the decibel is already the perceptual scale,
  and a bar VU meter is linear in dB for the same reason.
- **The floor is −60 dB**, not the engine's −100. Spreading the whole range would pack every useful
  level into the last tenth.
- **Smoothing is asymmetric** — fast rise, slow fall. This is what every VU ballistic and every
  compressor release does: symmetric smoothing gives either a soft attack or a flickering decay, and
  no constant avoids both.

The compiled document carries the **track's name** (`audioFrom`) and not a number: the number moves,
and freezing it into a cached document would freeze it for good.

## Where a pass may go: both

```yaml
modules:
  main:   [ glow ]         # on a TRACK — the layer is processed before being composited
  glow:   [ RENDER ]
  RENDER: [ grade ]        # on the IMAGE — the whole frame, once the layers are composited
  grade:  [ VIDEO_OUT ]
```

One implementation, allowed anywhere a video cable goes. Both are ordinary chains; only where the
result is stored differs — `VideoTrackDoc.plugins` on one side, `VideoProjectDoc.framePlugins` on
the other, the latter being the picture's `masterPlugins` ([../../song/docs/videoOutputs.md](../../song/docs/videoOutputs.md)).

A track's chain runs at **viewport** size and is then drawn into the track's rectangle, rather than
running at the rectangle's size. That is what makes an effect have the same character on an inset as
on a full-frame track: an effect does not change nature because the track carrying it was shrunk.

## What breaks nothing

Three states where the effect is **lost and the image kept**, deliberate in all three:

- `shader:` absent — a node just added;
- `shader:` naming a folder that is not there — a committed song whose files are not synced yet;
- GLSL that does not compile — a shader being **written**.

In all three the node keeps its card, its knobs and its menu — a half-typed fragment must not take
the viewport with it, the posture `presetFor` holds against a vanished base. The error names the
**node** (`glow`) and not the file, because the node is what is on screen and what one would click.

An unreadable `graph.yaml` is treated the same: compiling the picture is *best-effort*, because the
song compiler already reports the error, in the editor, on the offending line. Losing the effects is
recoverable by reading that message; losing the frame is a black screen with no explanation.

## What compilation decides in silence

`videoChains.ts` takes five decisions that read nowhere else:

- **A step whose module is not found returns `null`, without throwing.** `validate()` already
  reports the broken reference, by name, on its line; discovering a missing module while compiling
  the picture would drop the whole frame over one step.
- **A module that is not a picture module on a video wire is neither compiled nor reported here**:
  port checking already refuses video into an audio module, and it speaks of a cable rather than of
  a frame that failed to draw.
- **Bypassed steps are KEPT in the compiled run.** The renderer must *draw* a disabled pass, not
  receive a shorter list it could not tell from a shorter chain. Bypassing the WHOLE chain
  (`enabled: false` on the run) removes it instead: the run itself was withdrawn, and a stack of
  disabled commands would draw the settings of something that is not there.
- **Only the run that actually LEAVES for the device is the frame's chain.** A run leaving the sum
  and ending elsewhere is not one, and treating it as such would apply a pass the picture never
  reaches.
- **A video effect's parameters are filtered to numbers** — `params:` may carry a string naming a
  file, which means nothing to a renderer. The same sort `nodeProject` does before the audio wire.
  For a shader, a `P1..P4` the module does not mention is **0** and not "absent": the uniform exists
  in the program whatever the file says, and leaving it undefined would hand the shader whatever GL
  had there before.

Of a step's `in:`, what is retained for `audioFrom` is the **node**, the port being dropped — the
renderer needs a name to go read a level, and which socket it landed on is already settled by having
landed. The first source only: a shader declares exactly one audio port, so a second source is a
wiring error port checking already reports.

## The layers crossed

| | |
|---|---|
| written | `modules/shaders/<name>/` + a video run in `graph.yaml` |
| declared | `src/moduleTypes.ts` — `MODULE_TYPES.shaders`, `SHADER_PARAMS`, `SHADERS_DIR` |
| read | `src/shaders.ts` — `moduleShaderChoices` / `readShader`, ancestry included |
| derived | `src/chainsGraph.ts`: a video track is a track, so `main: [ glow ]` is a run |
| compiled | `src/videoChains.ts` -> `VideoPluginDoc`, the GLSL **inline** |
| the wire | `@studio/web-protocol`'s `WebVideoPlugin` |
| offered | `packages/file-service/src/graphDoc.ts` — `shader` + `shaders` on the step |
| drawn | the menu and the four knobs, `@studio/ui-chains`' `stepUI` |
| written back | `@studio/commands`' intrinsic `@shader` -> `setModuleShader` |
| executed | `@studio/ui-eyes`' `src/passes.ts` + `src/compositor.ts` |

The GLSL travels **inline** in the document rather than behind a URL: a browser cannot open a
folder, a shader fits in a page of text, the picture document is already cached by revision, and one
more route would mean the picture can draw before its programs have arrived.

## Checking it

```bash
npx vitest run packages/song-video/src/shaders.test.ts packages/song-video/src/videoChains.test.ts
npx vitest run packages/ui-eyes/src/passes.test.ts
npx vitest run packages/st0-plugins/src/video/shaderAudio.test.ts
```

These prove the document, the pass order and the level conversion. **None proves a pixel changed** —
there is no WebGL2 in the runner, and `passes.test.ts` states itself what a fake context can
establish. The rest is done with the eyes: open `demos/video-demo.st0`, start playback, and watch
the picture breathe with the drums. Switching the menu from `pulse` to `ripple` must change the
effect without touching the wiring.
