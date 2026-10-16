# Rendering the picture

A rendered video is the composited frame, frame by frame, with the song's mixdown as its
soundtrack. Every frame is drawn exactly, from the same programs the viewport runs, so a song
always renders to the same picture. There are two ways to render:

| | `project export video` | `picture render` |
|---|---|---|
| where it runs | in your browser | on the server, in a browser with no window |
| the file | downloaded when it is done | written into the project's `exports/` |
| your browser | must stay open on the project until it finishes | can be closed; the render runs in the background |
| speed | uses your GPU | slower: the server draws on its CPU |

Both take the same words.

## From the browser

Open the **Share** panel (`ui share`) and choose **Export WEBM** (shown on a project that has
picture), or type the command:

```text
project export video webm
project export video mp4 mp3
project export video webm none size=720p quality=medium
project export video mp4 from=0:30 to=1:15
```

The words, in order:

1. the container: `webm` (VP9 or VP8 video, Opus sound) or `mp4` (H.264 video, AAC sound);
2. optionally, the sound: `wav` (the default) or `mp3` — which mixdown is rendered and then
   encoded into the container — or `none` for a silent film;
3. optionally, any of these settings:

| setting | meaning | default |
|---|---|---|
| `size=720p` | a height in pixels, the width following the frame's shape | the viewport's size |
| `size=1280x720` | an exact width and height | |
| `quality=low\|medium\|high\|max` | the encoder's quality preset | `high` |
| `from=<time>` | where to start, seconds or `m:ss` | the start of the song |
| `to=<time>` | where to stop | the end of the last shot |

A range that ends before it starts is refused. The status line counts frames as they render
("rendering 1200 / 4500 frames…"). The file is named after the project.

The sound is rendered first, by the engine, so a mixdown failure stops the export before any frame
is drawn. Whether this browser can encode the container is checked before anything starts; when it
cannot, the viewport's strip says why.

## On the server

```text
picture render
picture render mp4
picture render webm none
picture render mp4 wav size=1080p quality=max from=1:00 to=2:00
```

The words are the browser export's: an optional container (`webm` by default), optionally `wav` or
`none` for the sound (`mp3` is not offered here: the sound is always taken from a WAV mixdown), and
the same settings. The command returns at once, saying the render is running in the background;
the file appears as `exports/<project>.webm` (or `.mp4`) when it is done. Only one picture render
runs at a time: asking for a second while one runs is refused.

The project rendered is the workspace's active project (the one playing in the engine). A project
that draws no picture is refused.

The server needs a Chromium browser installed. The hosted k7 has one; on your own server, install
Chromium or point the `STUDIO_CHROMIUM` environment variable at a Chromium or Chrome executable.
A host that cannot render (for example the command line without a file service) says to use
`project export video` in the browser instead.

## What a render includes

Every visible lane, its shots, speeds and animations, transitions, shapes, titles and subtitles,
every shader run including the frame's, and LUTs. Hidden lanes (muted, or soloed away) are left
out, as in the viewport. Exports read each video's optimized copy when it has one and never its
proxy (see [Preparing footage](./57-preparing-footage.md)). Cameras are live and are not part of a
render; record a camera take first (see [Webcam and live video](./56-webcam-and-live-video.md)).
