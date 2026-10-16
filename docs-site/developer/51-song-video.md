# song-video: the picture compile

`@studio/song-video` (`packages/song-video/`) turns a project folder into a `VideoProjectDoc`. It
is Node-only (it reads files) and depends on `@studio/song` (the loader, the graph) and
`@studio/song-schema`. Consumed as raw TypeScript through its `exports` subpaths:

| subpath | file |
|---|---|
| `./videoDoc` | `src/videoDoc.ts` — the document types |
| `./videoProject` | `src/videoProject.ts` — `loadVideoProject`, `parseWallClock`, markers |
| `./videoTracks` | `src/videoTracks.ts` — lanes and placements |
| `./shaders` | `src/shaders.ts` — shader discovery and reading |
| `./videoTransitions` | `src/videoTransitions.ts` — transitions and stretches |
| `./interchange/*` | `src/interchange/` — OTIO and EDL, both directions |

`src/videoChains.ts` and `src/captions.ts` are internal.

## The document

`VideoProjectDoc` (`src/videoDoc.ts`):

| field | content |
|---|---|
| `viewport`, `fps` | from `project.viewport: [w, h, fps?]`; fps defaults to 30 and is used by export only |
| `videoTracks` | `VideoTrackDoc[]`, already in `layers` draw order, then the lane-less camera layers on top |
| `markers` | project markers read as wall-clock points, sorted |
| `framePlugins` | the `RENDER → VIDEO_OUT` run |
| `transitions` | every transition a fade names, by name, GLSL inline; the built-in dissolve is absent |
| `stretches` | every run a fade's `chain` or a shot's `effect` names, by head node |
| `warnings` | what compiled but will draw nothing |

The split between **throw** and **warning** is deliberate: a throw is a picture that cannot be
built (no `viewport`; `layers` naming a missing lane, naming one twice, or missing one), a warning
is a picture that builds and then draws less than asked (a ref with no clip, a shape wired to no
lane, shots on a lane of shapes, an unknown stretch, an unreadable subtitle block). A blank lane
must be able to say why.

A `VideoTrackDoc` draws one of three things, never a mix: its `clips`, its `shapes`, or a `camera`.
A `VideoClipDoc` carries absolute paths (`source`, `optimized`, `proxy`), `still` for an image
source, `fadeIn` / `fadeOut` normalised to `{ over, with, chain? }`, `animate` as sorted keys,
`speed` only when it is not 1, `effect`, and `captions` for a subtitle clip.

## The lane compile — `videoTracks.ts`

`compileVideoTracks` checks `layers` against `video_tracks/` (the three errors above), resolves
solo from the project's `soloed` list (the same list audio reads; each compile keeps its own lanes),
fills a lane with no rect to the whole frame, and maps each placement through
`videoPlacementToClip`:

- no `ref` → an **activation** (empty id and source), used by shape lanes;
- `readFade` normalises the bare-seconds sugar: a number is `{ over, with: "dissolve" }`, a map
  with a `chain` and no `with` blends `over`, a zero-length fade is no fade;
- `readAnimate` validates with `AnimateSchema` and sorts keys;
- a caption clip's file is read **at compile time** by `parseCaptions` (`src/captions.ts`): SRT and
  WebVTT, `HH:MM:SS,mmm` / `MM:SS.mmm`, markup stripped, header/`NOTE`/`STYLE`/`REGION` skipped,
  broken blocks returned as problems.

## The chain compile — `videoChains.ts`

`compileVideoChains(dir, graph)` walks the graph's chains once per concern:

1. **Cameras** — a chain containing an `io: camera` module: if its outputs land on picture lanes
   the first camera per lane wins (`cameraByLane`, `cameraMonitorByLane`); if none, the camera
   becomes a layer of its own (`cameras`), full frame unless the node has `frame`.
2. **Shapes** — steps whose module is in the `shapes` category, compiled by `compileShape` into
   `ShapeDoc`s on every lane the chain lands on; none landing is a warning.
3. **Runs** — a stretch (`isStretch` from `@studio/song/graph`: fed by nothing, landing on a lane)
   goes to `stretches` keyed by its head node, with `stretchLanes`; a chain starting at `RENDER`
   and reaching `VIDEO_OUT` is the frame's run; a chain starting at a picture lane is that lane's.

`stepDoc` turns a step into a `VideoPluginDoc`: a `shaders` module becomes a `shader` pass with its
GLSL read, its params clamped to 0..1 (`SHADER_PARAMS`), `audioFrom` (the first node on its audio
port) and `lut` (resolved to an absolute path); a `video_effects` module becomes a `video_effect`
doc with its numeric params; anything else is dropped without a throw. Bypassed steps are kept with
`enabled: false`.

`loadVideoProject` runs the chain compile **best-effort**: an unreadable graph yields empty chains,
so the lanes still draw.

## Shaders and transitions

`src/shaders.ts` discovers shaders: a module offers every folder under its `shaders/` holding both
`vertex.glsl` and `fragment.glsl`, walking the `extends` ancestry nearest first (capped at 16
levels as a cycle backstop). `readShader` refuses names outside `[A-Za-z0-9_-]` before building a
path, and returns null rather than throwing.

`src/videoTransitions.ts` handles the other folder shape: a `video_transitions/<name>` module holds
its two stages loose in its own folder, because it is named by a placement and never has a card to
put a dropdown on. `collectTransitions` reads each named transition once, off the ref map rather
than the graph, so a broken graph cannot delete every wipe. `resolveStretches` checks each fade's
`chain` and each shot's `effect` against the stretches landing on that shot's lane; a miss is a
warning, and the fade falls back to a dissolve (the shot plays without its effect). In a chain
project, `chainStretchHead` maps a subchain id of the lane's chain file to its first node.

## Interchange — `src/interchange/`

| file | role |
|---|---|
| `flatten.ts` | one lane as sequential, non-overlapping segments plus dissolves, by the lane's own covering rule; drops activations and captions; reports an open-ended last shot with unknown length. Both writers start here |
| `otio.ts` | `toOtio`: one video track per lane, OTIO 1 schemas (`Timeline.1`, `Clip.1`, `Gap.1`, `Transition.1`, `LinearTimeWarp.1`, `FreezeFrame.1`), times rounded to frames |
| `edl.ts` | `toEdl`: one lane as CMX 3600, record timecodes from `01:00:00:00`, dissolve pairs, `M2` speed lines, `FROM CLIP NAME` comments |
| `imported.ts` | the `ImportedCut` both readers produce, and `dissolveIntoFadeIn` (a centred transition turned into the incoming shot's `fade_in`) |
| `fromOtio.ts` | reads video tracks, `Clip.1` and `Clip.2` media references, gaps, time warps; skips audio and nested items, listing them |
| `fromEdl.ts` | reads `V` events at a caller-given fps, dissolve pairs, `M2`, clip-name comments; measures record time from the first event |

The fixture `src/interchange/fixtures/otio-0.18.otio` was written by the OpenTimelineIO 0.18
library, which pins the `Clip.2` reading against a real file rather than against this package's own
writer. The verbs that use these are in [Picture commands](./54-picture-commands.md).
