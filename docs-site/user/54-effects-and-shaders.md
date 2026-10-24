# Effects and shaders

Picture effects are **shader modules**: small GLSL programs that take a picture in and give a
picture out. You wire them like audio effects, in the graph or a chain file, and the viewport runs
them on the GPU in real time; an export runs the very same programs.

## Where a shader can go

| where | wiring | what it works on |
|---|---|---|
| a lane's run | the lane's chain passes through it on its way to `RENDER` | that lane's picture, before it is composited |
| the frame's run | between `RENDER` and `VIDEO_OUT` | the whole composited frame |
| a shot's `effect` | a stretch (a run nothing feeds, landing on the lane), named by the shot | that one shot, for as long as it is on |
| a fade's `chain` | a stretch, named by a `fadeIn` or `fadeOut` | the shot, over the fade (see [The viewport and transitions](./53-viewport.md)) |

`RENDER` is where every picture lane arrives, as every audio lane arrives at `MIX`; `VIDEO_OUT` is
the frame that leaves. A project with a viewport always has a `RENDER → VIDEO_OUT` run; one is
written into the graph when it is missing.

```js
// chains/main.k7x — the lane `main` goes through the `glow` chain before RENDER
start(true)
steps([id("main-lane").track("main"), to([chain("glow")])])

// chains/glow.k7x
ports(["audio"])
steps([
  id("glow-shader").extends("@workspace/shaders/glow"),
  to([chain("RENDER")]),
])

// chains/picture.k7x — the frame's run
start("RENDER")
steps([to([chain("VIDEO_OUT")])])
```

A bypassed step is kept and lets its picture through.

## A shot's own effect

Give one shot a look without touching the rest of its lane: write the run as a subchain of the
lane's chain file, then name it on the shot with `effect`.

```js
// chains/main.k7x
subchains([
  id("warm").steps([id("warm-grade").extends("@k7-core/shaders/grade").params({ P4: 0.7 })]),
])

// tracks/main.k7x
extends("@meta/picture-track")
events([ref("interview").start(0).length(12).effect("warm")])
```

An `effect` that names no run landing on the shot's lane is reported in the picture's warnings,
and the shot plays as it is. A shot with no source (an activation) cannot have an effect.

## The shaders shipped with k7

| module | what it does | knobs |
|---|---|---|
| `@k7-core/shaders/grade` | colour correction, each knob neutral at its middle | `P1` exposure (±2 stops), `P2` contrast, `P3` saturation, `P4` temperature (below the middle cooler, above it warmer) |
| `@k7-core/shaders/look` | a 3D LUT (`.cube` file) over the picture | `P1` strength: 0 the picture as shot, 1 the LUT's look entirely |

The grade works in linear light and leaves alpha untouched, so a graded picture-in-picture still
composites over the lane below.

### LUTs

A `look` node names its `.cube` file with `lut`, a path relative to the project. One look module
serves every LUT a song uses, since the node carries the file:

```js
id("film").extends("@k7-core/shaders/look").lut("looks/film.cube").params({ P1: 0.8 })
```

While the LUT is loading, or when the node names none, the pass lets the picture through. An
export waits for every LUT before drawing its first frame.

## Knobs: P1 to P4

Every shader has four knobs, `P1`, `P2`, `P3`, `P4`, each a number from 0 to 1 (values outside are
clamped). A module's `ui` panel can name them (`exposure` bound to `P1`, and so on), as the
shipped ones do.

## Audio-reactive picture

A shader module has an optional **audio** side input. Wire an audio lane into that port and the
shader receives that lane's live level, so the picture moves with the sound:

```js
// chains/drums.k7x — the drums go to the mix AND to glow's audio port
start(true)
steps([
  id("drums-lane").track("drums"),
  to([chain("MIX").level(1), chain("glow").port("audio").level(1)]),
])
```

The level is the engine's meter for that lane, mapped from −60..0 dB to 0..1 and smoothed. Only
the first lane wired to the port counts.

## Writing your own shader

A shader module is a module in the `shaders` category whose folder holds one or more shaders, each
a folder of two files:

```text
shaders/glow/
  module.k7x
  shaders/
    glow/
      vertex.glsl
      fragment.glsl
```

```js
// module.k7x
type("shader")
shader("glow")
params({ P1: 0.5, P2: 0, P3: 0, P4: 0 })
```

`shader` picks which of the module's shaders the node runs; a node's card offers a dropdown of
every shader the module (and the modules it extends) carries. A folder missing one of the two files
is not offered. Both stages are GLSL ES 3.00 (`#version 300 es`).

What a shader can read:

| uniform | type | meaning |
|---|---|---|
| `uTex` | `sampler2D` | the picture coming in |
| `uP1` … `uP4` | `float` | the four knobs, 0..1 |
| `uAudio` | `float` | the live level of the lane wired to the audio port, 0..1; 0 with none |
| `uTime` | `float` | the transport's position in seconds |
| `uResolution` | `vec2` | the viewport size in pixels |
| `uPresence` | `float` | in a fade's stretch, how much of the shot is on screen (rising over a fade-in, falling over a fade-out); 1 elsewhere |
| `uLut` | `sampler3D` | the node's `.cube` LUT |
| `uLutSize` | `float` | the LUT's edge size; 0 while it loads or when the node names none |

The vertex stage receives `aUnit` (the unit quad, 0..1) and passes the UV on as `vUV`; copy the
vertex stage of a shipped shader. A shader that fails to compile is reported in the browser
console with the node's name, and the pass is skipped.

A **transition** shader (a `video_transitions` module) has its own contract, since it reads two
pictures: `uFrom` (the outgoing picture, transparent when there is none), `uTo` (the incoming one),
`uProgress` (0 is `uFrom` alone, 1 is `uTo` alone), `uTime`, `uResolution`, and `uP1`…`uP4`.

## Modules of the `video_effects` category

Modules in the `video_effects` category can be wired on a picture run and are compiled with it, but
the viewport and the exports run only **shader** modules: a `video_effects` step draws nothing.
Use a shader module for any effect you want to see.
