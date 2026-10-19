# Picture commands and media preparation

## The `picture …` verbs

Declared in `packages/commands/commands.yaml` (the `# --- the song's PICTURE` section) and
implemented in `packages/commands/src/verbs/`, spread into the handler table of
`packages/commands/src/commands.ts`:

| file | verbs (SID) |
|---|---|
| `verbs/picture.ts` | `picture.laneNew`, `picture.laneOrder`, `picture.mute`, `picture.solo`, `picture.rect`, `picture.move`, `picture.length`, `picture.head`, `picture.delete`, `picture.split`, `picture.add` |
| `verbs/pictureKeys.ts` | `picture.key`, `picture.unkey` |
| `verbs/pictureSpeed.ts` | `picture.speed` |
| `verbs/pictureSound.ts` | `picture.sound`, and `soundingLaneRefusal`, which stops the `event …` verbs on a sounding lane |
| `verbs/pictureMedia.ts` | `picture.prepare` |
| `verbs/pictureInterchange.ts` | `picture.interchange` (writes `exports/cut.<otio\|edl>`, a fixed path so the shell fetches it unprompted) |
| `verbs/pictureImport.ts` | `picture.import` |
| `verbs/pictureRender.ts` | `picture.render` |
| `verbs/project.ts` | `project.aspect` (rotates the frame keeping its long edge and its export fps) |

Rules every picture verb shares (`verbs/picture.ts`):

- **Addressing.** A shot is named by its lane and its start, in the lane file's own dialect:
  seconds or `m:ss`, parsed by `parseWallClock`. A musical spelling would be a second dialect for
  the same number. Two shots within half a millisecond of one start are refused, not guessed between.
- **Containment.** `laneFile` accepts one path segment and resolves inside `video_tracks/`.
- **Undo.** `put` calls `h.snapshot(abs)` before writing, so every verb is one journal entry.
- **Writers.** All edits go through `packages/song-schema/src/yaml/videoTrackFile.ts` and
  `packages/song-schema/src/yaml/videoKeys.ts`: surgical, by placement **index** (a ref may be
  placed twice; an activation has no ref), millisecond rounding. `splitVideoPlacementAt` inserts
  the tail right after the head (file order decides covering), keeps `fade_in` on the head and
  `fade_out` on the tail, cuts `animate` exactly (`splitAnimate`), and advances the tail's
  `source_from` by `head × speed`. `spliceVideoTime` serves `project add` / `project remove`.
- **Two-file act.** `picture lane new` (`createVideoTrackFile` in `packages/song/src/loader.ts`)
  writes the lane and appends it to `layers` together, refusing a name an audio lane already has.
- **Report, not refuse.** `picture add` with a ref that has no clip is written and reported: only
  the compiler reads `clips/`.

A command handler reaches the host through `CommandHost`. The picture verbs use three optional
members: `snapshot` (undo), `background(tag, work)` (returns false when a job with that tag already
runs; implemented by `packages/file-service/src/backgroundJobs.ts`), and `renderPicture` (the
server render, wired in `packages/file-service/src/engineLink.ts`). A host without `background`
runs the work inline; a host without `renderPicture` refuses `picture render`.

### Import details

`picture import` reads the file with `fromOtio` or `fromEdl` (the EDL at the project's fps, else
25), writes a `viewport` of `[1920, 1080, round(cut fps)]` when the song has none, creates one lane
per non-empty video track (`<prefix>N`, skipping taken names), and writes the events in flow style.
Its `Media` class resolves each shot's media: the path as given (relative to the imported file,
`file://` stripped, URL-decoded, and only if it stays inside the project), else by file name in
`clips/` (case-insensitive), else `clips/<name>` reported missing. A clip already declaring that
source is reused; otherwise a new `clips/<stem>.k7x` is written with a unique id.

### Interchange details

`picture interchange` compiles the picture with `loadVideoProject`, probes only the sources of
open-ended last shots (their length is the one thing the writers cannot know), and names media
relative to `exports/`, so a project folder copied whole relinks as it is.

## A shot's sound — `picture sound`

The engine plays sound and cannot read a video container on every platform, so each video clip
gets its first audio stream extracted to `<name>.sound.wav` beside the video
(`packages/audio-analysis/src/extract.ts`: ffmpeg, else the engine's `--decode`), recorded as the
clip's `sound`. Then one audio lane is created with `video_source: <lane>` and no events of its own,
plus its mixer strip. At compile, `packages/song/src/videoSound.ts` derives that lane's audio events
from the picture lane's shots: each shot heard over its visible span minus what later shots cover,
at its speed, with fades as crossfades. Rerunning does only what is missing.

## Media preparation — `packages/video-prep/`

Node-only, no dependencies beyond Node. Three subpaths:

| subpath | role |
|---|---|
| `./probe` | `probeVideo`: ffprobe's first video stream (codec, size, pixel format, fps), duration and container; `NoFfmpegError` when the binary is missing (never a guess). `FFPROBE_BIN` overrides the binary |
| `./plan` | `planVideo`: pure. Optimized copy `transcode` when the codec is not h264/vp8/vp9/av1 or the pixel format not 8-bit 4:2:0; `remux` when only the container (not mp4/webm) is wrong; a proxy when taller than 1080 lines |
| `./transcode` | `copyArgs` (pure ffmpeg arguments) and `makeCopy`; `FFMPEG_BIN` overrides the binary |

Choices that the code encodes:

- Copies are **video only** (`-an`); sound is `picture sound`'s.
- Optimized: H.264 `yuv420p`, CRF 18, preset medium, `+faststart`. Proxy: 720 lines, CRF 26,
  preset veryfast. Both with a keyframe every 30 frames, so a scrub lands without decoding far back.
- Written to `<dest>.part` and renamed on success, so a compile never sees a half copy.
- Named `<source stem>.optimized.mp4` / `.proxy.mp4` beside the source (`copyPathOf`).
- The proxy is made from whatever decodes: the optimized copy when there is one.

`verbs/pictureMedia.ts` probes each distinct video clip of a lane, says the plan's reason per clip,
and runs the work in the background under the tag `picture prepare <absolute source>`, writing
`optimized` / `proxy` into the clip file when each copy lands. The reload that follows the clip
file write is how the lane picks the copy up.

Who reads which copy is decided in `packages/k7-plugins/src/video/sceneFrom.ts`: preview reads the
proxy first, export never does.
