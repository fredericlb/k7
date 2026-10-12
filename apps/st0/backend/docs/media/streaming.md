# Streaming a FLAC

`GET /api/mediatek/stream` answers exactly like `/file` — same query param, same Range support
— except a `.flac` path is served as its MP3 transcode instead of the source bytes. Any other
extension passes straight through to `/file`'s own code, unchanged.

## The transcode is cached, not repeated

`transcode.ts`'s `ensureStreamable` writes the MP3 under `.cache/stream/`, mirroring the
source's own relative path with the extension swapped — the same "derived, never a source"
zone the waveform sidecars and the scan's own index live in (`packages/mediatek/docs/index.md`).
A cached copy newer than the source is reused; ffmpeg only runs once per FLAC, not once per
request — and not once per CONCURRENT request either: an `<audio>` element opens several Range
requests on a file it has not got yet, and they all wait on the one transcode running. A run that
fails leaves no `.part` behind, and one that runs past ten minutes is killed as stuck.

## Why the source stays FLAC

Nothing here re-encodes a song in place, or writes an MP3 into the catalogue beside its master.
The library's own copy — what the engine plays, what a variant is declared against — is
untouched; the MP3 exists only to answer `/stream`, and deleting `.cache/` loses nothing a
re-transcode cannot rebuild.

## Who calls this instead of `/file`

The rehearsal server's `mediatek.ts` — `downloadStreamable`, used everywhere it caches a file for a browser
to *play* (the songbook track and instrumental, a release's mixdown and stems). `download()`
(`remoteLibrary`, `packages/mediatek/src/remote.ts`) is untouched and still hits `/file`: what
file-service's médiathèque cache and any archival copy use, because that mirror has to hold the
master byte-for-byte, not a lossy stand-in. A session's own recordings and a moment's clip stay
on `/file` too — the browser records them as WebM/Opus itself, so nothing there is ever a FLAC
`/stream` would touch. Neither the editor nor the library's own screens call it: their `<audio>`
plays what `/file` serves.
