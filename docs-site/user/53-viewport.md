# The viewport and transitions

## The viewport window

The **viewport** is the composited frame: every visible picture lane, drawn with WebGL in draw
order, against the engine's playhead. A project shows it because it declares it, in
`surfaces/viewport.k7x`:

```js
type("viewport")
layout("floating")
```

`floating` is the only layout: a window over whichever page is on screen. Toggle it with the
viewport button in the toolbar or `ui viewport`. When the project has the surface but no picture
yet, the window says which files to add.

The strip under the frame shows the frame size and frame rate. When this browser cannot encode the
default export container (for example a build without a video encoder), the strip says so in
amber; playback is not affected.

## Which lanes are on screen

A lane draws when it is not hidden:

- muting the lane hides it (its bypass in the graph, as for an audio lane);
- when any picture lane is soloed, every lane that is not soloed is hidden;
- a lane fed by a camera draws nothing while its lens is shut (see
  [Webcam and live video](./56-webcam-and-live-video.md)).

The same rule decides how the timeline draws the lanes, so the two always agree.

## Placing a lane in the frame

In the viewport window:

- **click** a lane to select it; a selection box with eight handles appears;
- **drag its body** to move it, **drag a handle** to resize it. Pressing on an unselected lane
  selects it and starts the move in one gesture;
- **Alt-click** cycles down the stack, which is how you reach a lane hidden behind a full-frame
  one;
- **Escape** drops the selection.

Each drag writes the lane's `frame([x, y, w, h])` in viewport pixels, exactly what
`picture rect <lane> <x> <y> <w> <h>` writes. A lane cannot be resized below 16 pixels a side.
Hidden lanes cannot be clicked, and lanes drawing shapes have no rectangle to grab (each shape
carries its own position).

A picture fills its lane's rectangle without being stretched.

## Transitions

A shot arrives with `fadeIn` and leaves with `fadeOut`. Without them it cuts.

### The dissolve

A number of seconds is the built-in dissolve:

```js
events([
  ref("a").start(0).length(5),
  ref("b").start(4).length(5).fadeIn(1),   // b dissolves in over a, from 4 s to 5 s
])
```

The incoming shot fades in over whatever is under it: the earlier shot on the same lane while it
still runs, or nothing (the lanes below) when there is none. A `fadeOut` fades the shot to what is
under it. A fade is never longer than its own shot.

`fadeOut` measures back from the shot's end, so the last shot of a lane cannot have a `fadeOut`
with `length: 0`: give it a length, or put a shot after it.

### The full form

The map form says more:

| key | meaning |
|---|---|
| `over` | the length in seconds |
| `with` | a transition module by name (see below); absent is the dissolve |
| `chain` | a **stretch**: a run of shaders the shot goes through for the length of the fade |

```js
ref("bars").start(3).length(5).from(1.5).fadeIn({ over: 1, chain: "iris" })
```

A fade with a `chain` and no `with` lays the stretched shot over what is under it by its own
alpha, so the shader decides what shows. Inside the stretch, the shader can read how present the
shot is (rising over a fade-in, falling over a fade-out) and draw an iris, a wipe, a blur.

A stretch is a subchain of the lane's chain file — a run of shader steps that nothing feeds and
that lands on this lane:

```js
// chains/main.k7x
start(true)
steps([id("main-lane").track("main"), to([chain("glow")])])
subchains([
  id("iris").steps([id("iris-shader").extends("@workspace/shaders/iris")]),
])
```

A `chain` that names no stretch landing on the shot's lane is reported in the picture's warnings,
and the fade plays as a dissolve.

### Transition modules

A transition module draws the change from one picture to the other with its own GLSL. It lives in
the `video_transitions` category of your modules, is named by the shot (`with: "wipe"`), and is
never wired in the graph. Its folder holds `vertex.glsl` and `fragment.glsl` directly, and its
params `P1`…`P4` (each 0..1) are its knobs. A module with the name `dissolve` overrides the
built-in one. See [Effects and shaders](./54-effects-and-shaders.md) for what such a shader
receives.

```js
ref("b").start(4).length(5).fadeIn({ over: 0.8, with: "wipe" })
```

A `with` naming no transition module plays as a dissolve rather than as a cut, so the
arrangement does not change.
