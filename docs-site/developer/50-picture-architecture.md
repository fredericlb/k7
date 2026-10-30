# The picture pipeline: architecture

A song's picture — video lanes, shots, shaders, titles, subtitles, cameras — is compiled, drawn
and rendered by a pipeline that runs **beside** the audio one and never inside it. This page is
the map; the following pages go package by package.

| page | covers |
|---|---|
| this page | the shape of the pipeline, the decisions behind it, where everything lives |
| [song-video](./51-song-video.md) | the picture document, the lane and chain compile, shaders, captions, OTIO/EDL |
| [ui-eyes](./52-ui-eyes.md) | the WebGL compositor, realtime playback, frame-exact export |
| [Viewport plugin and frontend](./53-viewport-and-frontend.md) | `k7-plugins/src/video`, the timeline's picture lanes, drops, camera recording |
| [Picture commands and media preparation](./54-picture-commands.md) | the `picture …` verbs, the file writers, `video-prep`, a shot's sound |
| [Server render](./55-server-render.md) | `picture render`: headless Chromium driven by the file service |
| [Extending and testing](./56-extending-and-testing.md) | adding a field, a uniform, a shape, a transition; the tests |

## Data flow

```text
project folder (project, picture lanes in nodes/ or tracks/, clips/, graph or chains/, modules)
   │  loadVideoProject()                 packages/song-video/src/videoProject.ts
   ▼
VideoProjectDoc   (seconds, absolute paths, GLSL inlined, warnings)
   │  Workspace.videoProjectDoc()        packages/file-service/src/workspace.ts
   ▼
WebVideoProject   GET /video-doc         packages/web-protocol/timelineTypes.ts
   │  sceneFrom() / sceneOf()            packages/k7-plugins/src/video/sceneFrom.ts
   ▼
VideoScene        (plain structural type, media URLs, mute/solo/lens already folded)
   │
   ├─ realtime.ts   → the viewport, against the engine's playhead
   └─ export.ts     → a webm/mp4 file, frame by frame (browser, or headless Chromium on the server)
```

The engine is never handed any of it. The C++ engine plays the song's sound, including a shot's
sound through an ordinary audio lane (see [Picture commands](./54-picture-commands.md)), and reports
its playhead and meter levels; the browser does everything picture.

## Decisions and what forced them

**A second document, not a section of `ProjectDoc`.** The picture is a second compile of the same
folder (`GET /video-doc` beside `/project-doc`). A song has a tempo; its picture has a viewport,
and the engine must never receive the latter's fields. It also lets a song's sound compile without
loading any of `song-video`, which is why that package was split out of `@studio/song`.

**Seconds everywhere.** Picture is cut against the wall clock. Every time in a lane file and in
`VideoProjectDoc` is a decimal second; the timeline converts with the song's single tempo
(`beats per second`), which is exact because there is one tempo. Changing the tempo slides the bar
grid under a shot rather than moving it.

**The renderer knows nothing of the brain.** `@studio/ui-eyes` imports none of the Node packages:
it takes a `VideoScene` and a clock. The adapter from the document to the scene lives in
`k7-plugins/src/video`, and its browser-free half (`sceneFrom.ts`) is shared with the server render,
so a browser export and a server render build the very same scene.

**One renderer, three drivers.** Realtime playback, browser export and server render all run the
same `Compositor` and the same timeline rule (`ui-eyes/src/timeline.ts`). WebGL's `texImage2D`
takes an `HTMLVideoElement` and a `VideoFrame` alike, so the compositor never learns which driver
feeds it.

**GLSL travels inline.** The compile reads every shader, transition and stretch program off disk
and carries the source in the document: the browser cannot open a module folder.

**Cameras are the browser's.** A lens is opened with `getUserMedia`, recorded with `MediaRecorder`,
and its arm state is per browser. The engine never hears about a camera.

**Files are edited surgically.** Lane files carry comments; every writer in
`packages/song-schema/src/yaml/videoTrackFile.ts` changes values in place rather than
re-serialising the file, and rounds times to the millisecond so a drag and a verb leave the same
bytes.

## Where the code lives

| path | role |
|---|---|
| `packages/song-schema/src/yaml/entitySchemas.ts` | `VideoClipSchema`, `CaptionClipSchema` |
| `packages/song-schema/src/yaml/placementSchema.ts` | `PlacementSchema` (one event, a sound event or a shot), `FadeSchema`, `SHOT_KEYS` |
| `packages/song/src/pictureLanes.ts` | which lanes are picture lanes (`@meta/picture-track`), and each one's file |
| `packages/song-schema/src/yaml/projectSchema.ts` | `viewport` (draw order is `trackOrder`'s picture rows, top in front), the `video` and `live-video` archetypes |
| `packages/song-schema/src/yaml/moduleSchema.ts` | the picture module fields: `shader`, `shape`, `font`, `align`, `background`, `shadow`, `camera`, `frame`, `lut`, `video_source` |
| `packages/song-schema/src/moduleTypes.ts` | `RENDER`, `VIDEO_OUT`, `CAM`, the `shaders` / `shapes` / `video_transitions` / `video_effects` categories, `SHADER_PARAMS`, `DISSOLVE`, `OVER` |
| `packages/song-schema/src/keyframes.ts` | the `animate` schema and its evaluation |
| `packages/song-schema/src/yaml/videoTrackFile.ts`, `packages/song-schema/src/yaml/videoKeys.ts` | surgical writers for lane files |
| `packages/song-schema/src/aspect.ts` | the `16:9` / `9:16` shapes |
| `packages/song-video/` | the picture compile and OTIO/EDL |
| `packages/song/src/videoOutputs.ts` | writing the `RENDER → VIDEO_OUT` run into a project that lacks it |
| `packages/song/src/videoSound.ts` | a picture lane's sound clips derived from its shots — its own `#audio` half, or a chain project's `video_source:` lane |
| `packages/song/src/pictureSoundMigrate.ts` | at a node project's open, folds a `video_source:` lane into its picture lane's `#audio` half (format level 4) |
| `packages/song/src/surfaces.ts` | `isVideoProject`, `hasPicture` |
| `packages/song/src/scaffold.ts`, `packages/song/src/scaffoldLive.ts` | the `video` and `live-video` archetypes' files |
| `packages/ui-eyes/` | the WebGL compositor, realtime and export |
| `packages/video-prep/` | ffprobe / ffmpeg: optimized copies and proxies |
| `packages/k7-plugins/src/video/` | the viewport surface, the scene adapter, picture mute/solo/lens rules, the camera relay |
| `packages/commands/src/verbs/picture*.ts` | the `picture …` verbs |
| `packages/file-service/src/pictureRender.ts` | the server render |
| `apps/k7/frontend/src/` | the timeline's picture lanes, drops, camera recording, `project export video` |

