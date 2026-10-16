# Getting a video ready — the probe, the plan, the copies

What a picture clip's copies are FOR is [../../song-video/docs/media.md](../../song-video/docs/media.md).
This page covers the three modules that make them: `probe.ts` asks ffprobe, `plan.ts` decides, and
`transcode.ts` runs ffmpeg.

## ffmpeg, and nothing else

Unlike a shot's sound (`packages/audio-analysis/docs/analysis.md`), a video copy has no engine
fallback: the engine decodes audio only. Without ffmpeg there is nothing to make, and the verb says
so rather than guessing. The hosted image has ffmpeg (`docs/images.md`). A desktop needs it
installed.

## The plan is pure

`planVideo` reads only the probed facts, so the rule is pinned by tests that need no file. The rule
is a short list rather than a capability query. The file service, which decides, is not the
browser, which decodes, so it cannot ask the browser what it can play. The list is therefore what
EVERY browser this app runs in decodes: H.264, VP8, VP9 and AV1, 8-bit 4:2:0. A 10-bit or 4:2:2
stream of a listed codec counts as undecodable, since that is where browsers differ most and fail
silently. The export's own check (`assertDecodable`) is the backstop for whatever the list gets
wrong.

## What the copies are

- **Optimized**: H.264, 8-bit 4:2:0, CRF 18, at the source's resolution. Near-transparent quality,
  since the export renders from it.
- **Proxy**: H.264 at 720p, CRF 26, `veryfast`.
- **Both**: no audio (a shot's sound is extracted apart), a keyframe every 30 frames so a scrub
  lands without decoding back to a distant keyframe, and `+faststart` so the preview can start
  before the file is all read.

Each copy is written to `<dest>.part` and renamed when ffmpeg finished, so an interrupted run leaves
nothing a compile would take for a finished copy.
