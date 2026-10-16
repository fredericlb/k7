# Audit — stability and speed of the rehearsal pages

A standing audit of the rehearsal recorder: this package's routes over its SQLite store, mounted in k7's
backend; the pages of `packages/ui-rehearsal`, mounted in k7's SPA; and `packages/recorder`.
Findings are either an invariant they hold — written down so it is not broken again —
or a numbered lot still open, and why. Every entry below was read in the code, not reported second
hand; the measured ones say what was measured.

## Nothing waits on a stalled upstream for ever

The media library (`mediatek.ts`, `@studio/mediatek/remote`) is reached with `fetch`, and a `fetch`
with no signal waits as long as the peer does. Each call is bounded by what it carries: a JSON
exchange 15–30 s, a measurement the media library may have to compute 5 minutes, a file 10, an
upload of a whole recording 30. The store is in this process ([store.md](store.md)) and has no
peer to wait on.

## A file is served without ever crashing the process

`streamFile` (`@frediverse/http/stream.ts`, shared with phare) serves every recording, clip and stem
with Range support. It uses `stream.pipeline`: a seek ABORTS the previous range, and `.pipe()` left
each aborted file open; a file unlinked between the `stat` and the open emitted an `'error'` event
nothing listened to, which ends a Node process. The range end is clamped to the file, so a
`Content-Length` never promises bytes the body cannot deliver, and a suffix range `bytes=-500` reads
the LAST 500 bytes. Measured on a 100 KB file: every range answers what it should, and 50 aborted
requests leave no descriptor open (61 before, 56 after).

## Every error is answered, and none ends the process

- **`wrap`** (`@frediverse/http/route.ts`) answers a failed handler with a 500 — unless it had
  already answered, in which case it closes the socket: answering twice throws out of its `catch` as
  an unhandled rejection.
- **A final error middleware** on this package's router (`src/mount.ts`) answers what reaches `next(err)` — malformed JSON 400, an upload past
  its ceiling 413, the rest 500 — as JSON, never Express's development page with its stack.
- **The process** is k7's backend, and its own rules hold: a stray rejection is logged and survived,
  an uncaught exception is logged and exits, the container restarting it, and a SIGTERM lets
  in-flight requests finish (`apps/k7/backend/src/server.ts`).

## An id from a URL reaches no other file

A sheet's id names its file under `sheets/`, so the store refuses one that is not a single plain
segment, and a filter's field name must be a plain word before it enters a JSON path
([store.md](store.md)). Values are bound, never spliced into the SQL.

## Lists read what they show

A session list projects seven fields instead of every envelope, which passes 100 KB for a long take.

## A take survives a failed upload, and a tab asks before it closes

`packages/ui-rehearsal/docs/recordings.md`: the stopped take is kept with Retry and Download, a save cannot fail once the
upload answered (so Retry never sends a take twice), and leaving the tab asks first while a take is
at risk. k7's server gives one request 30 minutes, where Node's default cuts an hours-long upload at 5.

## The recorder's frame costs the window, not the take

`LiveWaveform` (`packages/recorder`) draws a 12-second window, and after three hours the envelope
holds 54 000 samples: smoothing all of them sixty times a second, or reallocating the canvas every
frame, is a cost that grows with the take. It smooths only the samples the pixels read and resizes
the canvas only when its size moves.

## An editor is not reset by a status poll

A song whose pipeline is running is replaced every 2 s by its status poll; an editor that reset on
every new `song` would discard typed lyrics mid-edit and send transpose back to 0. A different song
or tab resets it; new content alone refreshes the draft only while nobody is editing.

## A take is never whole in the backend's memory, and two saves never race

A recording, a mixdown and its stems, a song's sheets and its reference track arrive on DISK (`@frediverse/http/upload`'s `diskUpload`, with the limits in [serving.md](serving.md)), are
pushed to the médiathèque as file-backed Blobs (`fs.openAsBlob`, streamed by `fetch`), and are MOVED
into the cache; an appended take is concatenated, and a moment cut, by ffmpeg file to file, a few at
a time across the process and each killed past its deadline ([audio.md](audio.md)). Only memory the size of a
chunk is ever held. Measured: a 5 MB upload lands on disk with no buffer, and nothing is left once the
request is done; a 20 MB file-backed Blob arrives byte-identical. Saves and appends to one session,
sheet uploads to one song, a favourite and a nametag each run one at a time per key (`lock.ts`) — a
read-modify-write spans awaits (an upload, a fetch), so a transaction of the store alone would not cover it.

## Expensive work is done once, and caches stay bounded

A public page's first visitors share one measurement and one download (`cache.ts`'s `once`); the
row caches are swept every minute and capped; the disk cache — copies the médiathèque refills — is
trimmed least-recently-used first past `CACHE_MAX_GB` (20 by default), never touching a temporary
file or one younger than ten minutes.

## A take survives the tab, the source and the timer

`packages/recorder/docs/recorder.md`: chunks backed up to IndexedDB and offered back after a crash (checked in a real
Chrome: a take's chunks are listed, read back in order and forgotten); a source that ends mid-take
pauses the recorder with a reason; the envelope keeps recorded time in a hidden tab.

## The page and its polls do not outlive their use

- **The microphone goes off on every failure path** — a session that could not be created or
  refetched stops the stream it acquired, and a page that unmounts while a permission prompt is up
  stops the stream that arrives after it (StrictMode's mount, unmount, mount included).
- **A song pipeline's poll stops with its page**, and a page reopened on the same song waits for the
  old run to wind down instead of starting a second one; a page that left records no failure.
- **The session page's list is built when its moments change**, not on every playhead frame, and a
  moment's audio loads only when played; a range played after another is no longer stopped by the
  first one's listener.

## The relay and the secret

The RTC relay pings every 15 s and closes a socket that missed a pong, so a sleeping phone stops
reading as connected; a signalling message is capped at 64 KB. A production process
(`NODE_ENV=production`) refuses to boot on the development `SESSION_SECRET` (`src/env.ts`): the RTC
tickets and the personal tokens both derive from it.

## Left as lots

None. What this audit has not measured, and would need a browser session on a phone to: how long an
IndexedDB write of a one-second chunk takes on a slow device over an hours-long take, and whether a
quota prompt ever interrupts one.

## What a change here should be verified with

```
npm run typecheck -w @studio/rehearsal-server && npm test -w @studio/rehearsal-server
npm run typecheck -w @studio/ui-rehearsal && npm test -w @studio/ui-rehearsal
npm run typecheck -w @studio/recorder
```

The paraglide output is generated and untracked; both `ui-rehearsal` scripts compile it first, with
`--emit-ts-declarations`, without which the typecheck has no message types.
