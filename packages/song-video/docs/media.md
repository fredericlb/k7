# Footage the picture can use — optimized copies, proxies and stills

```yaml
# clips/interview.yaml
source: clips/interview.mov                   # what the camera wrote: 4K HEVC, 10-bit
optimized: clips/interview.optimized.mp4      # full resolution, 8-bit H.264 — preview and export
proxy: clips/interview.proxy.mp4              # 720p — the preview alone
sound: clips/interview.sound.wav              # the shot's sound, the engine's (../../song/docs/videoSound.md)
```

`picture prepare <lane>` makes the copies (`packages/commands/src/verbs/pictureMedia.ts`), and
`@studio/video-prep` decides which ones a file needs ([../../video-prep/docs/videoPrep.md](../../video-prep/docs/videoPrep.md)).

## Two copies for two different problems

The picture is decoded by the BROWSER: a `<video>` in the preview, WebCodecs in the export
([../../ui-eyes/docs/realtime.md](../../ui-eyes/docs/realtime.md)). That gives a file two separate
ways of failing:

- **It does not decode at all.** HEVC, ProRes, DNxHD, and 10-bit or 4:2:2 H.264 are what cameras
  and phones write, and no browser this app runs in decodes all of them. The fix is an
  **optimized** copy at FULL resolution, which the export renders from too. A lower-resolution copy
  here would put the loss into the final file.
- **It decodes, but too slowly to keep up.** A browser shares a handful of hardware decoders
  between every lane, and one 4K stream can hold a lane behind its playhead. The fix is a
  **proxy**: small and quick to decode, used by the preview ALONE, so the export keeps the source's
  resolution.

A file can need both, and then the proxy is made from the optimized copy, which is the one that
decodes. A file whose stream is fine but whose container is not, such as H.264 in a `.mkv`, gets a
stream copy into mp4 rather than a re-encode: seconds rather than minutes, and no generation lost.

## Who reads which

| | reads |
|---|---|
| the preview | `proxy`, else `optimized`, else `source` |
| an export | `optimized`, else `source` — never `proxy` |
| a shot's sound | `source`, through its own extraction |

The choice is made where the scene is built (`sceneOf` in `packages/st0-plugins/src/video/scene.ts`),
so nothing downstream knows that copies exist. The clip names its copies, rather than a naming
convention implying them, for the reason `sound:` is named: a copy replaced by hand is one line to
change, and a clip that names none simply reads its source.

## The copies are made in the background

A transcode takes minutes, and a command that held the request open for that long would freeze
the command bar. `picture prepare` probes each file at once, says what it needs, and hands the
copies to the file service's background runner
([../../file-service/docs/background.md](../../file-service/docs/background.md)). When a copy is
written its clip field is set, and that write is what the views see. Running it again only makes
what is missing. A host without a runner, such as the command line, simply waits.

Dropping footage on a picture lane runs it after `picture sound`.

## The export refuses what it cannot decode, before it starts

The export asks every source whether it decodes here (`assertDecodable` in
`packages/ui-eyes/src/export.ts`), and refuses naming the file and the verb that fixes it. The
alternative is a render failing at that shot's first frame, minutes in, with every frame before
it lost.

## Stills

An image (`png`, `jpg`, `webp`, `gif`, `avif`) is a picture clip as well: one frame, held for as
long as its shot is on. It decodes once, in the preview as an image and in the export as a bitmap,
and takes no video decoder. A dropped still is placed for five seconds, since it has no length of
its own to run to. Everything else applies to it unchanged: cuts, dissolves, animation. A
Ken Burns move is a still with `scale` and `x` keys ([animation.md](animation.md)).
