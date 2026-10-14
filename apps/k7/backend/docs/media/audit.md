# Audit — stability and speed of the media library's backend

A standing audit of `apps/k7/backend/src/media/`: the routes over the library volume, inside k7's
backend. The screens' half is `packages/ui-library/docs/audit.md`. Findings
are either an invariant this code holds — written down so it is not broken again — or a numbered lot
still open, and why. Every entry below was read in the code, not reported second hand; the measured
ones say what was measured.

## An upload is never whole in memory

`PUT /file`, `POST /song`, `/variant`, `/recording` and a share's `PUT /:key/file` take up to 512 MB
each. They stream the body to a temporary file (`apps/k7/backend/src/media/upload.ts`) on the volume it will land
on, and the write MOVES it into place — mediatek's `putFile` takes `{ file }` as readily as bytes
(`packages/mediatek/docs/index.md`). Holding it as a Buffer cost 512 MB of heap per request in
flight. The temporary file goes when the response closes, a refusal and a hang-up included, and the
upload folders are emptied at boot. A body the app-wide JSON parser already read is refused with a
415 rather than waited on. Measured: a 50 MB song lands byte for byte, and nothing is left in
`.uploads/` after an accepted upload, an empty one or a refused one.

## A share's file names are checked before they are paths

The draft's manifest names the files the upload will send, and each name is `join`ed onto the
share's folder, by the PUT and by the unauthenticated reads. The names are checked when the draft
opens (`shares.md`): a `../` in `docs` was a write anywhere on the volume, and a public read of
another person's index — tokens included. The per-person index is written beside and renamed, so a
crash never leaves the list that revokes every link empty.

## A decode is shared, and never more than two run

`analysisGate.ts` sits in front of every decode (`analysis.md`): one per file, shared by whoever asks
during it, two at once across the routes and the sweep. A decode holds the file's whole mono signal,
so ungated routes were a memory ceiling set by how fast someone clicks through songs. A fresh
sidecar is answered without queueing.

## A FLAC is transcoded once, however many ask

A browser's `<audio>` element opens several Range requests on a file it has not got yet, and each
started its own ffmpeg. They now share one run (`streaming.md`). A failed run leaves no `.part` in
the cache, and one past ten minutes is killed. Measured with a counting stand-in for ffmpeg: five
concurrent requests, one run; a failing run, nothing left in `.cache/stream/`.

## The sweep asks whether a sidecar exists without reading it

`missing()` parsed every song's sidecar — five arrays of thousands of floats — to learn it was
there, synchronously, every five minutes. `sidecarPresent` answers the same question from the
file's first bytes and its last (`analysis.md`), and agrees with the full read on every shape the
tests cover: missing, whole, truncated, too old, empty, hand-formatted, garbage. Measured on 2 000
sidecars of 349 KB: 1.56 s of blocked event loop per pass before, 32 ms after.

## Every error is answered, and none ends the process

- **`wrap`** (`@frediverse/http/route.ts`) and **`engineErrorHandler`**, mounted last, answer a failed
  handler and a malformed or oversized body as JSON; a caller that hung up is logged as a warning.
- **`streamFile`** (`@frediverse/http/stream.ts`) serves every file, stream and share with Range and
  `stream.pipeline`: an aborted seek closes its file, and a file unlinked mid-request is a 500 rather
  than an unhandled `'error'` (`packages/rehearsal-server/docs/audit.md` has the measurement).
- **The process** logs a stray rejection and survives; an uncaught exception is logged and exits, the
  container restarting it. A request gets 30 minutes, where Node's default cuts a slow 512 MB upload at 5.

## A deploy lets the uploads in flight finish

`server.ts` owns SIGTERM and SIGINT, the registry being mounted with `exitOnSignal: false`: the
registry says goodbye, the account file services stop, then `server.close` drains what is in flight,
within the 8 s that fit inside Docker's 10 before its SIGKILL.

## Nothing outside waits for ever

slskd, MusicBrainz and Deezer are fetched with a timeout, yt-dlp runs under one and is probed once.
An SFTP transfer that stalls after connecting is abandoned after 20 minutes, where it held one of
the person's four hunt slots until a restart. A job sent to an engine's machine fails the moment its
tunnel closes.

## The public write is bounded

A comment is capped in size, per share, and per address — ten per ten minutes, keyed on the real
client address since `trust proxy` is set by `@frediverse/oidc`. The comments live in SQLite with
WAL (`comments.md`), so the public reader and the author's writer never block each other.

## Left as lots

1. **A decode still holds the whole file.** `decodeMono` keeps the mono signal for `buildEnvelope`,
   ~1.4 GB for two hours at 48 kHz, and the envelope is ~220 ms of synchronous work. The gate caps
   it at two; an envelope built as the chunks arrive would retire the ceiling.
2. **A hunt's download passes through memory.** `sftp.get` and yt-dlp's result are read into a
   Buffer before `addSong`; a `fastGet` to a temporary file and `{ file }` would stream them.
3. **Abandoned share drafts stay on disk.** A folder with `pending.json` and some bytes is never
   reachable, and never removed either; a sweep of drafts older than a day would.

## What a change here should be verified with

```
cd apps/k7/backend && npx tsc --noEmit -p . && npm test
cd packages/mediatek && npx vitest run
```
