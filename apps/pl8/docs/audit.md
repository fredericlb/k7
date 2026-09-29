# Audit — stability and speed of pl8

A standing audit of `apps/pl8`: the Express backend over the library volume, and the SPA. Findings
are either an invariant this app holds — written down so it is not broken again — or a numbered lot
still open, and why. Every entry below was read in the code, not reported second hand; the measured
ones say what was measured.

## An upload is never whole in memory

`PUT /file`, `POST /song`, `/variant`, `/recording` and a share's `PUT /:key/file` take up to 512 MB
each. They stream the body to a temporary file (`backend/src/upload.ts`) on the volume it will land
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
  than an unhandled `'error'` (k7's audit has the measurement).
- **The process** logs a stray rejection and survives; an uncaught exception is logged and exits, the
  container restarting it. A request gets 30 minutes, where Node's default cut a slow 512 MB upload at 5.

## Nothing outside waits for ever

slskd, MusicBrainz and Deezer are fetched with a timeout, yt-dlp runs under one and is probed once.
An SFTP transfer that stalls after connecting is abandoned after 20 minutes, where it held one of
the person's four hunt slots until a restart. A job sent to an engine's machine fails the moment its
tunnel closes.

## The public write is bounded

A comment is capped in size, per share, and per address — ten per ten minutes, keyed on the real
client address since `trust proxy` is set by `@frediverse/oidc`. The comments live in SQLite with
WAL (`comments.md`), so the public reader and the author's writer never block each other.

## The page's polls do not stack

The library's revision poll, the hunt list and the host player's transport all go through
`frontend/src/poll.ts`: the next tick is scheduled when the last one ENDS, so a slow server slows
the poll rather than stacking requests behind it on the browser's six connections per host — the
same connections the audio's Range requests need. The library and the hunt list rest while the tab
is hidden and tick at once on its return; the player's does not, since mpv going idle is what
advances the queue. A listing that lands after the user changed section is dropped: drawn, it would sit under the
new section and be marked as current.

## Every call from the page has a budget, and an upload has a cancel

Every request `api.ts` makes goes through one `request()`: 30 s by default, 10 s for the host's
transport, ten minutes for an analysis that may queue behind the decode gate, and a sentence
rather than a `DOMException` when one runs out. An upload has NO time budget — a 500 MB file over a
slow link is legitimate, and only the person sending it knows it is not — but takes a signal: the
song dialogue's Cancel cuts the upload in flight, and the recordings button becomes the way to stop
a batch while it sends. The server removes what a cut upload left. The registry's own calls, in
`@studio/engine-browser`, are the exception: they are shared with st0 and z0, and unbudgeted.

## The catalogue screen is split by concern

`Library.tsx` draws; what it shows of the volume and the poll are `useLibraryData.ts`, the rows
built from a listing `libraryTree.ts` (pure, tested alone), the menus `treeActions.ts` and the
middle pane `LibraryContents.tsx` (`library.md`). Every file is under 500 lines. Checked in a real
Chrome against a live backend: the previous build and this one render the same text on the songs,
samples and recordings sections and on a song's deep link, with no page error.

## Left as lots

1. **A deploy cuts in-flight uploads.** `serve()` in `@studio/engine-registry` exits on SIGTERM at
   once. Letting `server.close` drain first belongs in that shared package, and st0 runs it too.
2. **A decode still holds the whole file.** `decodeMono` keeps the mono signal for `buildEnvelope`,
   ~1.4 GB for two hours at 48 kHz, and the envelope is ~220 ms of synchronous work. The gate caps
   it at two; an envelope built as the chunks arrive would retire the ceiling.
3. **A hunt's download passes through memory.** `sftp.get` and yt-dlp's result are read into a
   Buffer before `addSong`; a `fastGet` to a temporary file and `{ file }` would stream them.
4. **Abandoned share drafts stay on disk.** A folder with `pending.json` and some bytes is never
   reachable, and never removed either; a sweep of drafts older than a day would.
5. **The registry's calls from the page are unbudgeted.** `@studio/engine-browser`'s access
   client fetches with no timeout; a budget there belongs to that package and its three hosts.

## What a change here should be verified with

```
cd apps/pl8/backend && npx tsc --noEmit -p . && npm test
cd apps/pl8/frontend && npx tsc --noEmit -p . && npx vitest run
cd packages/mediatek && npx vitest run
```
