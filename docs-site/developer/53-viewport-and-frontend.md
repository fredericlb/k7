# The viewport plugin and the frontend's picture code

## The video plugin — `packages/k7-plugins/src/video/`

The builtin plugin that owns the frame: it contributes the drawer for a `viewport` surface, in the
shell's floating window and on a second device, and exports `sceneOf` and `ViewportTab` for the
shell's own use (the export flow renders the scene too).

| file | role |
|---|---|
| `index.ts` | the plugin registration |
| `ViewportPane.tsx` | adapter between a mount's ctx (`videoDoc`) and `ViewportTab`'s props (`doc`); the shell passes track order, `readOnly` and the armed lane, a device's mount none |
| `ViewportTab.tsx` | the frame: builds the scene only when the document changes, probes export support once per viewport size, draws the "no picture yet" message, the overlay and the format strip |
| `VideoCanvas.tsx` | the React host of `ui-eyes/realtime`: an unmount guard, refs that keep callbacks fresh without rebuilding the GL context, a `ResizeObserver` on the host; owns the `EngineClock` and feeds it the engine's playhead from a raw store subscription, so the pane does not re-render per frame |
| `ViewportOverlay.tsx` | HTML selection box over the GL canvas: click selects, body drag moves, eight grips resize, Alt cycles down the stack, Escape deselects; commits through `onRect` (`picture rect`) |
| `viewportRect.ts` | the pure px arithmetic of picking and dragging (`layersAt`, `hitLayer`, `layerBelow`, `MIN_SIDE` 16, `GRIP_TOL` 8) |
| `pictureMix.ts` | which lanes are on screen: mute, the solo fold, and when a lens opens (`off` / `on` / `auto` while armed). The timeline and the frame both read it, so they cannot disagree |
| `sceneFrom.ts` | `WebVideoProject` → `VideoScene` with every URL from the caller's `urlOf`; browser-free, shared with the server render. `use: "preview"` reads `proxy ?? optimized ?? src`, `"export"` reads `optimized ?? src` |
| `scene.ts` | the browser's door to `sceneFrom`, with the file service's `/media` URLs |
| `shaderAudio.ts` | engine meter levels (−60..0 dB → 0..1, smoothed from ~20 Hz reports to 60 fps) into each pass's `uAudio`, by the lane named in `audioFrom` |
| `camera/relay.ts`, `camera/remoteLens.ts` | the remote lens: see below |

`sceneFrom` only turns **shader** docs into passes. `video_effect` docs reach the browser but are not
drawn by anything.

### The remote lens

On the desktop app, a second device on the LAN loads the page over plain HTTP: not a secure context,
so no `getUserMedia`. `RTCPeerConnection` is gated on nothing and exempt from mixed-content rules,
so the machine's own window — on the loopback origin, which is secure — opens the camera and serves
it. `apps/k7/frontend/src/camera/serveLenses.ts` answers on the machine (one peer connection per
viewer, one stream per label), `remoteLens.ts` is the `LensOpener` a device uses, and `relay.ts`
holds the signalling socket's path and frame shapes so both ends agree. No STUN: both ends are on
one LAN, possibly with no internet. Against a hosted origin none of this runs; the device opens its
own camera.

## The frontend — `apps/k7/frontend/src/`

| file | role |
|---|---|
| `hooks/useVideoDoc.ts` | fetches `GET /video-doc` on every reload key, keeping the previous object when nothing changed |
| `components/TimelineTab.tsx` | picture lane rows: shot strips, the three drags (`move`, `in`, `out`), tool clicks routed to `picture split` / `picture delete`, M/S/arm buttons, the right-click (`picture-shot`), the bars ⇄ seconds ruler |
| `hooks/useVideoEdits.ts` | commits a finished drag as a surgical rewrite of the lane file by placement index (`setVideoPlacementFieldAt`), shared with a timeline surface on a second device |
| `timelineTools.ts` | `pictureToolLine`: the timeline tools on a shot, each as a `picture …` line |
| `contextMenu.ts` | the shot's menu rows: `move`, `length`, `head`, `delete` (the verbs declaring `menu: [shot]`) |
| `keys.ts` | `m`, `s`, `r` on the picture lane under the caret |
| `localCommands.ts`, `App.tsx` | `ui viewport` and `ui picture arm [lane]`, answered by the shell itself |
| `timelineDrop.ts`, `hooks/useTimelineDrop.ts` | OS file drops: kind by extension (picture first, since `.webm` is in both lists; stills and captions are picture), clip ids from file stems, then `picture add`, `picture sound` and `picture prepare` per lane |
| `components/VideoReadersStrip.tsx` | a reader per placement for an open lane file, with Set From / Set To |
| `hooks/useVideoRecording.ts`, `videoTake.ts`, `takeSpool.ts` | camera recording: armed lane + record + play, `MediaRecorder` (WebM VP9/VP8, then MP4), chunks spooled to disk, the take filed in `clips/` and placed with a measured length via `picture add` |
| `hooks/useCameras.ts` | the cameras this browser sees, by label, for a camera node's card |
| `videoSpans.ts` | when each picture lane is on screen, so graph cables ripple for picture as they do for sound; pinned to the compositor's rule by `videoSpans.test.ts` |
| `exportArgs.ts` | parses `project export audio\|video\|timeline …`; the settings words come from `song-schema/renderSettings`, through `ui-eyes` |
| `hooks/useShare.ts`, `components/SharePanel.tsx` | the browser export: mixdown first (the engine renders it, the page decodes it), then `exportScene`, then a download; `exportTimeline` runs `picture interchange` and downloads the result |

### Drags are file edits, not commands

A finished picture drag writes the lane file directly through `useVideoEdits`, as the clip drags do;
the `picture …` verbs exist for the command bar, the CLI, the tools and the context menu. A drag
holds its live position until the reload lands, so a shot does not snap back for a round trip.
Snapping reads the ruler's drawn ticks (`snap.ts`): Ctrl snaps relative to the shot's own offset,
Shift is free.
