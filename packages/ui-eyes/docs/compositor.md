# The compositor — which quad goes where

`compositor.ts` is the **placement**: one texture per layer, one textured quad each, composed
bottom upwards. What the GLSL does in between is [passes.md](passes.md); how the picture follows
playback is [realtime.md](realtime.md), and how a shot that MOVES is drawn on each path is
[motion.md](motion.md). The video document's vocabulary is
`packages/song-video/docs/picture.md`.

It is the **single renderer** both drivers share, because `texImage2D` takes an
`HTMLVideoElement` and a `VideoFrame` the same way: the compositor never learns which of the two
the driver has.

## It owns its canvas

A canvas handed in by React would race two GL contexts against each other on any render, so the
compositor makes its own — except for export, which passes it an `OffscreenCanvas` it owns.

Either way the **buffer** is the viewport's size in pixels, i.e. the model's, and CSS only changes
the display: `resize()` writes `style.width/height` and nothing else. Rendering is therefore
independent of screen resolution, and an export capture is identical to what is on screen.

`preserveDrawingBuffer: true` is there for export, which reads the pixels back after the draw.

## Frames and blending

The viewport's origin is **top left**, clip space's is **bottom left**: `rectToClip` converts and
flips y. Video frames also arrive top-down while GL textures are bottom-up, hence
`UNPACK_FLIP_Y_WEBGL` on upload — texture coordinates stay the obvious 0..1.

Blending is `over` in **straight** (non-premultiplied) alpha, so a shape layer's background can
blend; on an opaque video texture it is a no-op. Inside a pass chain it is off, and
[passes.md](passes.md) says why.

### …except the layer that is fading, which is PREMULTIPLIED

A layer mid-transition is composed with `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)` for that one blit,
then the function is put back. Not a matter of taste:

`mix(uFrom, uTo, p)` against a **transparent** texel gives `rgb·(1−p)` **and** `a = 1−p`. In
straight alpha the blend then multiplies that already-darkened rgb by that alpha: the fade darkens
as well as vanishing, and a crossfade dips through black. Premultiplied, both sides read as they
are and **one `mix` is both a crossfade and a fade to nothing** — which is what keeps this to one
code path. A video texture is opaque, so straight and premultiplied are identical there; only the
fading layer changes function, and an ordinary pass keeps its straight alpha (the demo song's
`pulse` says so in its fragment).

The far side of a transition is a **1×1 transparent texel**, allocated once, rather than a branch
in the GLSL: a `fade_out` has no incoming picture, and handing it an empty one is what saves it
from being a special case. What appears then is the **layer beneath**, not black — black is only
what you see when there is no layer left.

`LayerBlend` says **which slots carry a picture this frame**, instead of deducing it from
`hasFrame`: that never goes back down, so it cannot answer "now".

### A side that runs a stretch

A shot inside its fade's **stretch** goes through that run BEFORE the blend reads it
(`src/stretches.ts`). The run passes through the same ping-pong as everything else, and its result
is copied into a target of that slot's own: the blend reads both pictures at once, so neither may
still be sitting in the scratch the other one is about to use. Two targets, allocated only when a
fade in the scene names a stretch. The blend that follows is unchanged, and `over` — the kind a
stretch with no `with:` blends by — is a built-in program beside the dissolve
([transitions.md](../../song-video/docs/transitions.md)).

`draw` goes through a single `bindComposite` closure rather than two branches per layer: a layer
with its own chain has to **return** to that target after going through the scratch, and both
places must agree on which one it is.

## Shapes go through a 2D canvas

That is the whole reason a shape layer reuses the textured path: Canvas2D draws rectangles, arcs
and real **text**, and reads a CSS colour — which raw WebGL cannot do without a glyph atlas. The
render is **static**, so it happens once per scene, at viewport resolution, and the result
composes exactly like a video frame.

The conventions, declared in `scene.ts`:

| | what it means |
|---|---|
| `color` | any colour the 2D canvas can read |
| `x, y` of a square or of text | its **top-left** corner |
| `x, y` of a circle | its **centre** |
| `w` of text | a **maximum** width: the canvas condenses glyphs to fit, it does not wrap (single-line text) |

Each shape carries its own geometry, so the layer's rect is ignored: a layer of shapes covers the
whole viewport. A shape carries no time of its own; its layer's ACTIVATION spans do
(`song-video/docs/shapes.md`), and those are ordinary clips, so they extend `durationSec` like
any other. A lane of shapes stating no span is on throughout and adds nothing to it — a song of
nothing but those has no natural end to render.

## What is drawn and what is not

A layer no frame has been uploaded to yet is **skipped**: a track between two clips shows the
background, rather than a black quad or the rest of the previous frame. A shape layer is marked
drawable as soon as the scene is built, its upload having already happened.

## A picture keeps its shape — `coverUV`

One textured quad per layer, sampled over its whole face, means the texture is STRETCHED into
whatever rect the layer occupies. A webcam is 4:3 or 16:9, and the frame it lands in is whatever
the project says: the two are rarely the same, and the difference shows as a squashed face.

So the plain program takes a UV transform, `uUV = (scaleX, scaleY, offsetX, offsetY)`, and the
source is sampled through it: `texture(uTex, vUV * uUV.xy + uUV.zw)`.

**COVER, not contain.** A lane fills its rect and the overflow is cropped, evenly on both sides.
Letterboxing inside a layer would put bars in the middle of a composite, where no lane beneath can
paint over them — the FRAME's bars are the viewport's business (`VideoCanvas`'s `fit`), not a
layer's.

**The source's shape is learned from the UPLOAD, never from the document.** A camera's aspect is
the machine's and a file's is the file's; neither is anything a project could have written down.
`sourceAR` reads whatever it is handed — `videoWidth` for a `<video>`, `displayWidth` for a
`VideoFrame`, `width` for a canvas — and answers 0 when it is not said yet. 0 is identity: a layer
draws before its first frame arrives, and undistorted-or-not beats not at all.

The rect's own aspect comes the other way, off the scene: `l.w / l.h` at layer-build time.

One limit worth stating. A layer with PASSES is seeded into a viewport-sized scratch before its
chain runs, and blitted from there to its rect. The correction is applied at the seeding blit
against the layer's own rect, which is exact when that rect IS the viewport — every camera, and
every full-frame lane. A layer that is both smaller than the frame AND carries passes takes a
second scaling from the scratch that this does not account for.
