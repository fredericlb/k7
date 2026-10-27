# The passes — GLSL between the frame and the screen

`compositor.ts` is the **placement**, which quad goes where, and has its own page
([compositor.md](compositor.md)). `passes.ts` is the part that runs somebody else's code. The
vocabulary — the `shaders` module, the uniforms, where `uAudio` comes from — is
`packages/song-video/docs/shaders.md`; this page is what the renderer does with it.

A `ScenePass` is text and numbers. `@studio/ui-eyes` has no idea what a module, a folder or an
audio engine is — the same boundary `scene.ts` draws, and what lets the thing be tested with no
project.

## Three shapes of frame, and the first is the commonest

```
no passes           each layer -> one quad -> the canvas
passes on a layer   the frame -> its chain (offscreen) -> the composed quad
passes on the image everything composes offscreen -> the chain -> one blit
```

A song with no shader **allocates nothing**: no offscreen target, no program, and `draw` writes
straight to the canvas.

## Two resources, two lifetimes

| | what it is | when it is cleared |
|---|---|---|
| `RenderTarget` | where layers **accumulate**, when the whole image will be treated | once per frame |
| `PingPong` | the scratch a **chain** bounces between | at every pass |

Sharing the pair would let one layer's chain clear the target the composite accumulates into:
**every layer but the last would vanish** the moment a single one gets a shader. Two lifetimes,
two resources. `RenderTarget.bind(clear)` takes a boolean for exactly that: `true` on the frame's
first draw, `false` after. `passes.test.ts` pins it.

Both resources are created **only if something asks for them**, and they **survive a scene
rebuild** as long as the viewport has not changed. That branch is worth writing: the document is
recompiled on every keystroke in the editor, and reallocating full-frame textures on every
keystroke is visible on screen — the picture stutters while you type.

`makeTarget` is shared by both classes so their filtering cannot diverge: otherwise an image
shader would soften the picture where a layer shader would not.

## Why a pair and not one target

A shader cannot sample the texture it writes — undefined in GL, and in practice it looks like an
effect that works on one machine and shimmers on another. So pass N reads `a` and writes `b`, then
they swap.

Targets are the size of the **viewport**, not of the layer's rect: a pass may sample beside the
fragment it writes (any blur does), and a target cropped to the layer would hand it the crop's
edge instead of the picture. That costs two full-frame RGBA textures per chain, once.

It is also what gives `uResolution` its meaning: a layer's chain runs at viewport size and is then
drawn into the layer's rect, so an effect is worth the same on an inset as on a full-frame layer —
it does not change character because the track was shrunk.

`runPasses` leaves the RESULT in the front texture with the framebuffer unbound: both its callers —
a layer about to be composed, and the finished image about to be blitted — then carry on the same
way.

`CLAMP_TO_EDGE` matters more here than on a video texture: without it a shader sampling past the
edge brings back the other side of the picture, which reads as a bug in the **shader** rather than
in its target.

## Blending inside a chain is OFF

A pass **replaces** the picture it was given. Leaving `over` on would compose each pass over the
previous one instead of succeeding it — which looks like every effect applied by halves. It is
turned back on for the composed quad, where blending is exactly what is wanted.

The scratch is cleared to **transparent black** and never to the scene's background: a layer's
passes run **before** compositing, so anything the shader does not write has to stay see-through,
or the layer hides everything beneath it. Same for the image target: the background is added at
the final blit, or an image shader would treat the background as if it were picture.

## The uniform contract

`PASS_UNIFORMS` is a **contract**, not a convenience. A shader is written against this list and
nothing tells its author they got a name wrong: GL silently returns a null location for an unknown
uniform — and for a merely UNUSED one too, so the two are indistinguishable from here. Writing the
list down is the only place that difference can be recorded.

`uTex` is what the pass reads: the layer's frame for a chain's first pass, the previous pass's
output after. That is all that makes them chain.

A null location in a `PassProgram` is therefore **normal** — a shader ignoring `uP3` has no `uP3`,
and writing to a null location is a no-op in WebGL, not an error.

`uPresence` is 1 for every pass except one running inside a fade's **stretch**, where it is how much
of the shot is on screen. Defaulting to 1 rather than 0 is what makes a stretch's module the
identity when it is wired as an ordinary lane effect
([transitions.md](../../song-video/docs/transitions.md)).

### `TRANSITION_UNIFORMS`, the second contract

A **transition** takes two pictures and a progress, which is a different shape: it has its own
list, `uFrom` / `uTo` / `uProgress` beside `uTime`, `uResolution` and `uP1..uP4`
([transitions.md](../../song-video/docs/transitions.md)). Two decisions worth writing down:

- **`uTex` is not in it**, deliberately. A fragment copied from a `shaders` module fails at write
  time instead of silently sampling nothing — which the rule above makes otherwise undetectable.
- **Nor is `uAudio`**: it is the only uniform of a shader that demands a **cable**, and a
  transition is named by a cut, so it has no node to read a level from.

Both compilations go through one `linkProgram` — the same `bindAttribLocation` before the link,
the same `finally` releasing the stages, the same fallback to `null` with a warning naming the
node. A transition and a pass cannot diverge on how they are built, only on the list they ask for.

## The attribute is bound to location 0 BEFORE the link

```ts
gl.bindAttribLocation(prog, 0, PASS_ATTRIB);
gl.linkProgram(prog);
```

All passes share the single vertex buffer the compositor already set up. Without this line, a
shader declaring its attributes in another order reads the quad from whatever location the linker
chose — so draws nothing, on some machines only.

## A pass at its identity knobs is skipped, not removed

A pass may declare `identity`, the knobs at which it changes nothing. There, `runPasses` skips it,
and a layer with no other pass keeps the direct path, asked per frame. It stays in the scene: a
knob set live (`setParam`) needs a pass to move, and a scene without it would wait for the next
`setScene`. What it costs is the scratch pair, allocated once for the viewport.

## `setLive` is separate from `setScene`

`uAudio` moves at the engine's meter rate (~20 Hz), `uTime` at the transport's, and a scene is
rebuilt when the **document** changes. Folding them into the scene would mean recompiling every
program twenty times a second.

Levels are **pushed** by the host, never pulled: that is this package's boundary. The driver keeps
them between reports, and most frames reuse one — that reuse **is** the smoothing, seen as a hold
rather than a jump.

`uTime` is the **transport**'s position, supplied by the loop that already reads the clock. A
clock of the renderer's own would drift from playback within a bar.

Levels are given per pass, **keyed on the pass's identifier** — the compiled `<owner>:<index>` —
because that is what survives renaming everything else. A pass nobody supplied a level for keeps
the one it had, i.e. the 0 it was compiled with when no audio is wired.

## A broken shader takes nothing with it

`compilePass` returns `null` and one console line. A pass that did not compile is simply absent
from the chain; the layer draws as though it did not exist. A shader is source someone is **in the
middle of editing**, and a half-typed fragment must not black out the viewport. Same stance the
whole picture path takes against a missing shaders folder: lose the effect, keep the frame.

The message names the **node** (`glow`), not the file: the node is what is on screen and what you
would click to fix it.

Both stages are deleted once attached: the program keeps them alive until its own deletion, and
without that a scene rebuild would leak one shader object per pass per rebuild.

## Checking it

```bash
npx vitest run packages/ui-eyes/src/passes.test.ts
```

Against a **fake** GL context, and the file says why itself: there is no WebGL2 in this runner, and
adding a native context would be a heavy dependency for a handful of assertions. What a fake does
prove is the part that breaks for real — the ORDER of binds, clears and draws. The two bugs pinned
there (a layer's chain clearing the composite, blending inside a chain) are sequencing, and neither
needs a pixel to be caught.

What it does not prove is that a shader draws the right picture. That check is done with the eyes:
open `demos/video-demo.k7` and look.

## What the export is written in

**WebM — VP9 for the picture, Opus for the sound.** It is the one pair every build that runs this
app can encode: Chromium ships VP9 and Opus in the open-source tree, and so does Firefox, which
has H.264 through the platform encoder and has never had an AAC encoder at all. An mp4 default
makes the sound the first thing to fail, on a browser where everything else works.

`project export video mp4` still writes an mp4, and that is what the option is for: the rest of
the world takes an mp4 and does not always take a WebM. The cost is that it needs an H.264 *and*
an AAC encoder, which a browser may perfectly well have neither, one, or both of. The cost of the
default is the other way round: VP9 is encoded in software where H.264 is often the GPU's, so a
long export is slower.

## What "can this export?" actually asks

`"VideoEncoder" in window` answers the wrong question. It is true in every Chromium while saying
nothing about the platform encoder behind it (Media Foundation, VideoToolbox, OpenH264, libvpx). A build with WebCodecs and no encoder for the
codec asked fails at frame 0, *after* the progress bar has drawn, with a `NotSupportedError` that
names no cause.

So `exportSupport.ts` asks `VideoEncoder.isConfigSupported` at the scene's own size — codec
support is level-dependent, so 4K is a different question from 720p — and
`AudioEncoder.isConfigSupported` for the container's sound codec. The answer distinguishes three
cases, because they need three different sentences: no WebCodecs at all, no video codec (nothing
can be rendered), no audio codec (the file cannot carry the sound).

**The answer NAMES the codecs**, and `export.ts` hands mediabunny exactly those. Any ONE video
entry is enough — VP9 else VP8, any H.264 profile — and a probe that blessed one codec while the
encoder was given another would be a `NotSupportedError` at frame 0 again, which is the failure
this file exists to catch. A false negative would hide an export that works, which is worse still.

An absent `AudioEncoder` is the same answer as one that refuses the codec: the sound cannot go in,
and saying so beats a muxer throwing halfway through.

`ViewportTab` runs it once per viewport size, off the render path, for the container and the sound
its own button would ask for. It gates the WORDS rather than the pane: realtime works either way.
