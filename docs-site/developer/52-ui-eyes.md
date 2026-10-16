# ui-eyes: the WebGL compositor

`@studio/ui-eyes` (`packages/ui-eyes/`) draws a `VideoScene` with WebGL2: live against a clock, or
frame by frame into a video file. It depends only on `@studio/song-schema` (for the keyframe
evaluation and vocabulary) and `mediabunny` (demuxing, encoding, muxing). It imports none of the
Node packages, which is what lets it run in a browser.

## Public subpaths

| subpath | file | role |
|---|---|---|
| `./scene` | `src/scene.ts` | `VideoScene`, `VideoLayer`, `SceneClip`, `ScenePass`, `SceneShape`, `SceneCaptions`, `buildScene` |
| `./timeline` | `src/timeline.ts` | which clips a layer shows at `t` and the transition between them |
| `./clock` | `src/clock.ts` | `Clock`, `SeekingClock`; `EngineClock`, `TransportClock`, `FrameClock` |
| `./compositor` | `src/compositor.ts` | the GL renderer |
| `./realtime` | `src/realtime.ts` | the live driver |
| `./export` | `src/export.ts` | `exportScene`, frame-exact export |
| `./exportSupport` | `src/exportSupport.ts` | which containers this build can encode; `VIDEO_FORMATS`, `DEFAULT_VIDEO_FORMAT` (`webm`) |
| `./exportQuality` | `src/exportQuality.ts` | `low`, `medium`, `high`, `max` |
| `./renderSettings` | `src/renderSettings.ts` | `parseVideoSettings`, `parseClock` — the `size=`/`quality=`/`from=`/`to=` words |
| `./camera` | `src/camera.ts` | `matchCamera`, `localLens`, the `LensOpener` seam |
| `./renderPage` | `src/renderPage.ts` | the page a server render runs (see [Server render](./55-server-render.md)) |
| `.` | `src/index.ts` | convenience re-exports |

`exportQuality.ts`, `exportSupport.ts` and `renderSettings.ts` load no muxer on purpose: the command
line and the shell name the export's words without pulling in the heaviest module the editor has.
`export.ts` is imported dynamically, on the export itself.

## The frame rule — `timeline.ts`

The **only** place the transition rule lives; realtime calls it per animation frame and export per
output frame.

- A placement ends at `start + length`, else at the next entry's start, else never (half-open
  intervals).
- `sourceTime = sourceFrom + (t − start) × speed` — signed, so 0 freezes and negative runs back.
- Among overlapping shots the **last in file order** is on top (a completed dissolve must not snap
  back to the outgoing shot). A lane has two decoder slots, so with three active the two on top win.
- `layerFrameAt` returns up to two pictures (`from`, `to`), the transition program and progress
  when a fade runs, and each slot's stretch and presence. A fade is clamped to its own shot; a fade
  from nothing is the same branch with a transparent `from`.
- `shapesVisibleAt` applies the activation rule to a shape lane: on during an activation, always on
  when it has none.

## The compositor — `compositor.ts` and friends

One texture per layer slot, one quad per layer, composited bottom first into a canvas the
compositor owns (a React-owned canvas races two GL contexts).

| file | role |
|---|---|
| `geometry.ts` | a viewport-px rect in clip space, and the UV transform that fills a rect without stretching |
| `layerGL.ts` | one lane's GL state: slots, rects, aspects, pass programs; a shape lane rasterised once |
| `plain.ts` | the one program that draws a texture as a quad, with an affine (motion) and an opacity |
| `motion.ts` | a shot's animation at `t` as a clip-space affine; the lane rect crops it on every path |
| `slots.ts` | per slot, in order: the shot's `effect` run, its motion, its fade's stretch — each skipped and allocation-free when unneeded |
| `passes.ts` | compiling a `ScenePass`, the ping-pong framebuffers, the uniform contract |
| `stretches.ts` | one compiled chain per stretch and one target per slot (the blend reads both at once) |
| `transitions.ts` | the two built-in transitions: `dissolve` and `over`; a module of the same name overrides either |
| `rasterize.ts` | a shape lane drawn into a 2D canvas at viewport size, uploaded like a picture |
| `text.ts` | text layout (pure, testable without a canvas) and drawing: wrapping in `w`, alignment, box, shadow |
| `captionFrames.ts` | each subtitle cue drawn once into a viewport canvas and cached; nothing between cues |
| `media.ts` | pictures realtime draws without a `<video>`: stills (decoded once per URL) and caption cues |
| `luts.ts`, `cube.ts` | `.cube` parsing and upload as an RGBA16F 3D texture, once per URL |

A transition name with no program falls back to the dissolve, with one console line.

### The uniform contract

`passes.ts` declares what a shader may rely on — a contract, since GL cannot tell an unknown name
from an unused one:

| shader passes | transitions |
|---|---|
| `uTex`, `uAudio`, `uTime`, `uResolution`, `uPresence`, `uP1`…`uP4`, `uLut` (unit 2), `uLutSize` | `uFrom`, `uTo`, `uProgress`, `uTime`, `uResolution`, `uP1`…`uP4` |

Transitions deliberately do not get `uTex`, so a shader fragment pasted into a transition fails
loudly. A program that fails to compile logs the node's name and is skipped. A pass whose LUT has
not arrived sees `uLutSize = 0` and must let its picture through, as `look` does.

## Realtime — `realtime.ts`

Drives the compositor against a `SeekingClock` (`EngineClock` fed the engine's reported playhead, or
a `TransportClock` of the host's own). **One `<video>` per layer**, plus a second only on a lane
that dissolves: a lane shows one clip at a time except across a transition, so per-clip elements
would mean N decoders for one picture.

Drift between the clock and each element is corrected at two speeds: under `HARD_SEEK` (0.25 s) the
`playbackRate` is nudged (`1 − err × 1.5`, clamped to ±8%), above it the element seeks and is left
alone for 200 ms while the decoder settles. Speeds outside what browsers play (below 1/16, zero,
negative) are stepped by seeking instead. Stills and caption cues come from `media.ts` and need no
element. Cameras are opened through an injected `LensOpener` (`localLens`, or the remote lens on a
second device). With profiling on, the driver reports each lane's error and rate for the viewport's
strip.

## Export — `export.ts`

`exportScene(scene, options, onProgress)` renders frame `n` at second `from + n / fps`, pulling each
source frame **exactly** through mediabunny, so a song always yields the same file. Options:
`format` (`webm`: VP9/VP8 + Opus, the default; `mp4`: H.264 + AAC), `from`, `frameCount`, `size`
(composited at the viewport's size, then scaled), `quality`, and `audio` — an already decoded
`AudioBuffer`, sliced to the range (`sliceAudio`). Before frame 0 it checks that every source is
decodable (`assertDecodable`, naming the file) and waits for every LUT. Camera layers are skipped:
a camera has no frame at `t`.

`exportSupport.ts` probes `VideoEncoder` / `AudioEncoder.isConfigSupported` per container and
returns the codec names the encoder is then given, so the probe and the encoder cannot disagree.
`"VideoEncoder" in window` is not used as an answer: it is true in builds whose platform encoder is
missing, which then fail at frame 0 with an error naming no cause.

## Cameras — `camera.ts`

A project names a camera by its human **label**, never a `deviceId` (salted per browser and
rotating). `matchCamera` tries exact, case-insensitive, then containment either way, and falls back
to the default camera with a sentence listing what the machine has. The constraint deliberately
avoids `exact`, so a stale id falls back to a picture instead of failing.
