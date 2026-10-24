# Transitions — what a shot does arriving and leaving

Sister page to [shaders.md](shaders.md): the same GLSL over the picture, chosen by a **cut** —
either one program that reads both shots (`with:`), or a run of ordinary shader nodes each shot
goes through on its own (`chain:`, a **stretch**).

```k7x
// nodes/main.k7x
extends("@meta/picture-track")
events([
  ref("plan_a").start(0).length(5),
  ref("plan_b").start(4).length(5).fadeIn(1), // 1 s dissolve over plan_a
  ref("plan_c").start(9).length(5).fadeIn({ over: 1.5, with: "wipe" }),
  ref("plan_d").start(14).length(5).fadeOut(2), // leaves towards whatever is below
  ref("plan_e").start(18).length(5).fadeIn({ over: 1, chain: "iris" }), // through the `iris` stretch
])
```

## A bare number, or a map

`fadeIn(1)` **is** `fadeIn({ over: 1, with: "dissolve" })`. The `dissolve` is built into the
renderer, so an ordinary fade needs no file: a song with no `modules/` folder can fade.

A map naming a `chain:` and no `with:` is `with: over` — the second kind the renderer owns, which
lays the shot over what is under it by the alpha its stretch left (below). A map naming both runs
the stretch first and then blends with the named program.

The bare number is **not a union branch** but a widening (`z.preprocess`), and the reason is measurable: on a union a
mistyped key surfaces as `Invalid input` with the real errors buried in the branches, so
`validate.ts` cannot find the line. Widened, `{ ovr: 1 }` answers `unrecognized_keys` on
`events.0.fadeIn`, and the editor underlines the right place.

## The ARRIVING shot carries the transition

A transition is **one program and one progression**. If A's `fadeOut` and B's `fadeIn` could both
govern the same overlap, two programs would want the same pair and nothing would decide.

> In an overlap, the incoming shot's `fadeIn` IS the transition.

That is a rule about the **blend**, the one program that reads both shots. A stretch is not one:
it runs on a single shot, so the outgoing shot's `fadeOut({ chain: … })` still runs under an
overlap — over its own window, measured back from its own end — while the incoming shot's
`fadeIn` decides how the two are mixed. Only the outgoing shot's `with:` goes unread there.

A `fadeOut`'s blend is therefore exactly the case where there is no incoming shot: the picture leaves
towards nothing, and what appears is the **layer below** (or the viewport's background for the
bottom layer). Cross-dissolve and fade-to-black are one code path; all that differs is whether a
second shot is active.

Dragging a shot over its neighbour is what creates the overlap. The gesture does not create the
transition: that would be cascade editing, and no drag here does it.

## `length: 0` — two cases, one of them refused

`length: 0` means "to the end of the source", and
[`activeAt`](../../ui-eyes/src/timeline.ts) resolves it as "to the next shot's `start`", `Infinity`
if there is none.

| shape | what `fadeOut` does |
|---|---|
| `length: 0`, another event follows | works: the end is the next `start` |
| `length: 0`, **last in the list** | the end is `Infinity`: **refused**, on the line |

The refusal lives in the lane compile (`compileVideoTracks`) and not on the placement, because a
placement alone cannot know whether it is last — and not on the lane's schema either, since the
module schema does not know a lane is picture. "The last shot runs to the end of its source" and "the last shot fades
out" are incompatible; give it a length and the second becomes possible again.

A `fadeIn` never has this problem: it is anchored on `start`, which is always known.

A less visible corollary: a `length: 0` shot cannot be the **outgoing** half of a cross-dissolve,
since its end is by construction the next shot's start — the overlap is zero.

## A transition module's folder

```
modules/video_transitions/wipe/
  module.k7x           type: video_transition, params: P1..P4
  vertex.glsl
  fragment.glsl
  ui.k7x               the four knobs, drawn by the module builder
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
| `uTo` | the picture ARRIVING — transparent for a `fadeOut` |
| `uProgress` | `float` 0..1 — 0 is `uFrom` alone, 1 is `uTo` alone |
| `uTime` | `float` seconds — the **transport**'s position |
| `uResolution` | `vec2` px — the viewport |
| `uP1`..`uP4` | `float` 0..1 — the module's four knobs |

`uFrom`/`uTo` rather than `uTex`/`uTex2`: it reads with `uProgress`, and above all it is **not**
`uTex`, so a fragment copied from a `shaders` module fails at write time instead of silently
sampling nothing.

**`uAudio` is deliberately absent**, and its absence is the next section's argument: it is the one
shader uniform that requires a **cable**. A transition has no node, so no `#audio` side input, so
no track whose level it could read. A picture moving with the sound is a shader on the layer, or
in a stretch, whose nodes ARE wired and take `#audio` like any shader.

## A STRETCH — a transition made of nodes

```k7x
// chains/main.k7x — a chain project
start(true)
steps([id("7d14…").track("main"), to([chain("RENDER")])])
subchains([
  id("iris") // `fadeIn({ over: 1, chain: "iris" })`
    .steps([id("8a82…").extends("@workspace/shaders/iris")]),
])
```

```k7x
// graph.k7x — a graph project, the same stretch
modules({
  "@workspace/shaders/iris": ["main"], // fed by nothing, lands on the lane
  "@workspace/shaders/zoom": ["@workspace/shaders/dim"],
  "@workspace/shaders/dim": ["main"],
})
```

A **stretch** is a run of picture passes (`shaders`, `video_effects`) that **nothing feeds** and that
**lands on a picture lane**. A fade's `chain:` names it by its **head node**, and over the fade the
shot runs through it before it is blended. It is the same run a lane's own chain is made of, so a
stretch is drawn on the graph as cards with knobs, can be bypassed step by step, and needs no new
kind of file.

In a CHAIN project — the main layout — a stretch is a **subchain of the lane's chain file**, and a
fade names it by its id: `chain: iris` (`packages/song/docs/chainFiles.md`). The file is the scope,
so a fade can reach only its own lane's stretches. Read into segments, that subchain IS the cable
from its last node into the lane, so everything downstream sees the same graph either way, and the
compile turns the id into the node the run starts at.

In a GRAPH project there are no subchains, and the equivalent of "a run scoped to one owner" is a
run whose only edge is the one into that owner, named by its head node. The cable INTO the lane is
what scopes it: a fade on another lane naming it is refused (below), as is a stretch something else
feeds — that is then a lane's run, and the head would have two signals.

### `uPresence` — one number for both directions

A pass in a stretch is handed **`uPresence`**: how much of the shot is on screen. It rises 0 → 1 over
a `fadeIn` and falls 1 → 0 over a `fadeOut`, and it is **1 everywhere else** — so a stretch's
module, wired as an ordinary lane effect, is the identity. One number rather than a progress and a
direction is what lets the same `iris` open a shot in and close one out: `alpha *= step(d, uPresence)`
is right both ways.

It is a uniform and not an automation curve. A curve is a function of SONG time, baked in beats for
the engine; a fade is a function of the placement, in seconds, and drawn by the browser.

### What a stretch can say, and what it cannot

A per-shot pass sees one picture. That covers every transition whose result is, per pixel, a mix of
the two shots by a weight that depends on position and progress: a dissolve (`alpha *= p`), every
wipe, iris and clock (`alpha *= step(edge(x), p)`), a luma wipe off a mask, a dip to black, a
slide or push (translate by `p`), and cross-zoom, blur-through or glitch-through (each shot
distorted by its own presence, then mixed).

It cannot say a transition that needs **both shots in one fragment**: B displaced by A's content,
A's brightness used as the matte that reveals B, a morph. Those stay programs, named by `with:`.

### `over`, and straight alpha

A stretch's output is **straight** alpha, as every pass's is. The built-in `over` reads both sides
that way and writes the PREMULTIPLIED result the blended layer is composited with
([compositor.md](../../ui-eyes/docs/compositor.md)), so a stretch that only writes alpha mixes the
two shots correctly without the premultiplied trick a `mix()` needs. A named program reads a stretched
side as it is; a program that assumes opaque inputs, the dissolve included, is exact only where the
stretch left the alpha at 1.

### A `chain:` that runs nothing

A fade naming no stretch landing on ITS lane — a typo, a stretch wired to another lane, an
unreadable `graph.k7x` — compiles as a **dissolve** of the same length (a named `with:` is kept),
and says so in the picture's `warnings`. The reason is the one below for a missing program: dropping
the fade would move the cut.

## Named, not cabled

A transition PROGRAM **never** appears in `graph.k7x`; a stretch, above, is the cabled way. It is named by a placement, as `clips/<ref>.k7x`
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
The `ui.k7x` sitting beside the module is therefore rendered by `@studio/ui-module-builder` — the
**Builder** button on a `module.k7x`'s toolbar — which already draws knobs and menus from that
file.

## What breaks nothing

A `with:` naming nothing known **does not bring the frame down**: the transition is simply absent
from the document and the render falls back on the built-in `dissolve`. That is a deliberate
divergence from [shaders.md](shaders.md), whose posture is "lose the effect, keep the picture":
here keeping the picture by deleting the transition would **move the cut**, that is, lose the
*arrangement*. Falling back on a fade keeps the duration the author wrote and loses only the
character.

An unreadable `graph.k7x` costs no transition either: transitions are read off the **ref map**
(`loadModuleRefs`) and not off the graph, outside the `try/catch` that makes chain compilation
best-effort.

## A picture lane's schema is a guard

A picture lane is a module, so `loadVideoTracks` reads it through the module schema, whose
`events:` are `PlacementSchema`: a shot carrying an unknown key fails saying so, on its line,
rather than being silently ignored.

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
`fadeIn` asks for it).

## Fade to black, and to which black

The preview clears to the `--sh-background` token and the **render to true black**. The asymmetry
is deliberate: an empty frame already shows the application's background, so the preview stays
consistent with itself, whereas an exported file that had baked the chrome's grey into its frames
would be wrong for everybody. A `fadeOut` on an upper layer does not descend to black anyway but
to **the layer below**.

## What is not there

- **Three overlapping shots.** A track has two decoders; three simultaneous shots are not
  renderable, and the top two win.
- **A `fadeOut` revealing the shot below on the SAME track.** A reveal belongs to the incoming
  shot, and its `fadeIn` is at its own `start`.
- **Per-placement parameters.** `P1..P4` belong to the module, and a stretch's knobs to its nodes:
  two placements naming one stretch share its knobs. Two wipe directions are two modules, one of
  which `extends` the other, or two stretches.

## The layers crossed

| | |
|---|---|
| written | `fadeIn` / `fadeOut` on an event of a picture lane (`nodes/<lane>.k7x`, `tracks/` in a chain project), `modules/video_transitions/<name>/`, and a stretch's run in `graph.k7x` |
| declared | `packages/song-schema/src/moduleTypes.ts` — `TRANSITION_CATEGORY`, `DISSOLVE`, `OVER`, `isPicturePass` |
| validated | `packages/song-schema/src/yaml/placementSchema.ts` — `FadeSchema` and the widening; `src/videoTracks.ts` — the refusal of an endless `fadeOut` |
| guarded | `packages/song/src/entities.ts` — `loadVideoTracks` goes through the module schema; `packages/song/src/graph.ts` — `isStretch`, and a stretch's head counted as fed in `checkChainInputs` |
| read | `src/videoTransitions.ts` — the ancestry from `src/shaders.ts`, and `resolveStretches`; `src/videoChains.ts` — the stretches |
| compiled | `src/videoTracks.ts` -> `VideoClipDoc.fadeIn`, and `src/videoProject.ts` -> `VideoProjectDoc.transitions` and `.stretches`, the GLSL **inline** |
| on the wire | `packages/web-protocol/timelineTypes.ts` — `WebVideoFade`, `WebVideoTransition`, `WebVideoProject.stretches` |
| served | `packages/file-service/src/workspace.ts` — `toWebVideoTracks`, `videoProjectDoc` |
| adapted | `packages/k7-plugins/src/video/scene.ts` -> `packages/ui-eyes/src/scene.ts` |
| decided | `packages/ui-eyes/src/timeline.ts` — `layerFrameAt`, the only rule |
| decoded | `packages/ui-eyes/src/realtime.ts` and `packages/ui-eyes/src/export.ts` |
| drawn | `packages/ui-eyes/src/compositor.ts` + `packages/ui-eyes/src/passes.ts` + `packages/ui-eyes/src/stretches.ts`, the built-in `dissolve` and `over` in `packages/ui-eyes/src/transitions.ts` |
| completed | `packages/song-schema/src/yaml/fields.ts` — the two words of a fade's map |

## Checking it

```bash
npx vitest run packages/song-video/src/videoTransitions.test.ts packages/song-video/src/videoStretches.test.ts
npx vitest run packages/song-schema/src/yaml/videoTrackYaml.test.ts
npx vitest run packages/ui-eyes/src/timeline.test.ts packages/ui-eyes/src/compositor.test.ts
```

The first proves the folder read, the ancestry, the two refusals and the knob clamping, then that the
graph takes a stretch, that the sound's compile ignores it, which stretches the picture carries and
how a fade naming nothing falls back; the second,
the two spellings of a fade, the **located** error of a mistyped key, and the refusal of an endless
`fadeOut`; the third, the frame rule — each side's stretch and presence included — and the order
of GL calls: which blend function is in force for which draw, which texture on which unit, that the
blend reads a STRETCHED picture rather than its slot, and what is allocated.

**None of them proves a pixel changed**: there is no WebGL2 in the runner, and
`compositor.test.ts` says so itself. The remaining check is done with the eyes — open
`demos/video-demo.k7`, overlap two shots, give the second a `fadeIn`, and watch the cut become a
fade. The demo's second shot on `main` already arrives through the `iris` stretch.
