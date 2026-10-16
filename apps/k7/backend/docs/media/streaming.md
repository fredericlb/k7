# Streaming a FLAC

`GET /api/mediatek/stream` answers exactly like `/file` — same query param, same Range support
— except a `.flac` path is served as its MP3 transcode instead of the source bytes. Any other
extension passes straight through to `/file`'s own code, unchanged.

## The MP3 is the one beside the FLAC

`/stream` serves the same-named MP3 the sweep writes beside every FLAC
([derivedMp3.md](derivedMp3.md)). A FLAC the sweep has not reached yet — uploaded a second ago —
gets its MP3 made on the spot by the same `ensureMp3`, so ffmpeg runs once per FLAC either way —
and not once per CONCURRENT request either: an `<audio>` element opens several Range requests on a
file it has not got yet, and they all wait on the one transcode running. A run that fails leaves no
`.part` behind, and one that runs past ten minutes is killed as stuck.

## Why the source stays FLAC

Nothing re-encodes a song in place. The library's own copy — what the engine plays, what a variant
is declared against — is untouched, and the MP3 beside it is hidden from every listing, change
token and manifest, so it is never a master and never reaches a machine's mirror.

## Who calls this instead of `/file`

The rehearsal server's `mediatek.ts` — `downloadStreamable`, which is `remoteLibrary`'s `stream`, used everywhere it caches a file for a browser
to *play* (the songbook track and instrumental, a release's mixdown and stems). The médiathèque's
player (`packages/ui-library/src/playback/PlaybackProvider.tsx`) and k7's playlist pane
(`songUrl` in `apps/k7/frontend/src/api.ts`) load it as their `<audio>` source. `download()`
(`remoteLibrary`, `packages/mediatek/src/remote.ts`) is untouched and still hits `/file`: what
file-service's médiathèque cache and any archival copy use, because that mirror has to hold the
master byte-for-byte, not a lossy stand-in. A session's own recordings and a moment's clip stay
on `/file` too — the browser records them as WebM/Opus itself, so nothing there is ever a FLAC
`/stream` would touch.

## A replay costs a 304

`/file` and `/stream` answer through `streamFile`, which stamps a weak `ETag` from the file's size
and time, a `Last-Modified`, and `Cache-Control: private, no-cache` — keep the bytes, ask before
each use, since a song can be replaced in place (`commons/packages/http/docs/stream.md`). A player
seeking or replaying a song it already holds asks with `If-None-Match` or `If-Range` and gets a
304, or the piece it asked for, instead of the whole file through the one Node process again.
