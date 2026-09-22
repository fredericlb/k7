# Streaming a FLAC

`GET /api/mediatek/stream` answers exactly like `/file` — same query param, same Range support
— except a `.flac` path is served as its MP3 transcode instead of the source bytes. Any other
extension passes straight through to `/file`'s own code, unchanged.

## The transcode is cached, not repeated

`transcode.ts`'s `ensureStreamable` writes the MP3 under `.cache/stream/`, mirroring the
source's own relative path with the extension swapped — the same "derived, never a source"
zone the waveform sidecars and the scan's own index live in (`packages/mediatek/docs/index.md`).
A cached copy newer than the source is reused; ffmpeg only runs once per FLAC, not once per
request.

## Why the source stays FLAC

Nothing here re-encodes a song in place, or writes an MP3 into the catalogue beside its master.
The library's own copy — what the engine plays, what a variant is declared against — is
untouched; the MP3 exists only to answer `/stream`, and deleting `.cache/` loses nothing a
re-transcode cannot rebuild.

## Who calls this instead of `/file`

Nobody yet. `remoteLibrary`'s `download()` (`packages/mediatek/src/remote.ts`) — what
file-service's médiathèque cache and any archival copy use — deliberately keeps hitting `/file`:
that mirror has to hold the master byte-for-byte, not a lossy stand-in. A client whose job is
*playing* the file, not holding a faithful copy of it, is the one that should ask `/stream`
instead — nothing does yet, so today this route exists and works but nothing on either end
(k7, st0) has been pointed at it.
