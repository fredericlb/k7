# Preparing footage

The viewport plays video in your browser, and a browser decodes only some of what cameras write.
`picture prepare` looks at each video on a lane and makes the copies it needs.

```text
picture prepare main
```

It runs automatically after you drop video on a picture lane. It needs **ffmpeg** (and its
`ffprobe`) on the machine the file service runs on; without it the command says so and does
nothing.

## What it decides, per video

| the video is | what is made | written as |
|---|---|---|
| H.264, VP8, VP9 or AV1, 8-bit 4:2:0, in an MP4 or WebM file, 1080 lines or less | nothing — "ready as it is" | — |
| a playable stream in another container (H.264 in a `.mov`, say) | a stream copy into MP4, no re-encoding | `optimized` |
| another codec, or 10-bit, or 4:2:2 | a full-resolution H.264 re-encode | `optimized` |
| taller than 1080 lines | a 720-line H.264 copy for previewing | `proxy` |

A file can get both: an optimized copy and a proxy made from it.

The copies are written beside the source, as `<name>.optimized.mp4` and `<name>.proxy.mp4`, and
named on the clip:

```js
// clips/drone.k7x
source("clips/drone.mov")
optimized("clips/drone.optimized.mp4")
proxy("clips/drone.proxy.mp4")
```

- The **viewport** plays the proxy when there is one, else the optimized copy, else the source.
- **Exports** never use the proxy: they render from the optimized copy, else the source, so your
  final file is at full resolution.

Copies are video only (the sound is extracted separately by `picture sound`), with a keyframe every
second so scrubbing lands quickly. A copy only appears once ffmpeg has finished it, so an
interrupted run leaves nothing half-made.

## In the background

Transcoding takes minutes. When run against the server, `picture prepare` returns at once and each
copy is made in the background; the lane picks the copy up when it is written. Asking again for a
file already being prepared says so instead of starting a second job. Running it on a lane that is
already prepared says "already prepared" for each clip.

## Stills

An image clip (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.avif`) needs no preparation. It shows
one picture for as long as its shot lasts; a dropped still is placed with a length of five
seconds, which you then trim like any shot.
