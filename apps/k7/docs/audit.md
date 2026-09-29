# Audit — stability and speed of k7

A standing audit of `apps/k7`: the Express backend over PocketBase, the SPA, and the recorder
package. Findings are either an invariant this app holds — written down so it is not broken again —
or a numbered lot still open, and why. Every entry below was read in the code, not reported second
hand; the measured ones say what was measured.

## Nothing waits on a stalled upstream for ever

PocketBase, pl8 (`mediatek.ts`, `@studio/mediatek/remote`) and Supernote are all reached with
`fetch`, and a `fetch` with no signal waits as long as the peer does. Each call is bounded by what it
carries: a JSON exchange 15–30 s, a measurement pl8 may have to compute 5 minutes, a file 10, an
upload of a whole recording 30. Only lrclib had one before. A stalled Supernote in particular held
its owner's run lock — `running` in `supernote/sync.ts` — until a restart, answering every later sync
"already running"; with a bounded call the `finally` releases it. `docs/pocketbase.md` has the
PocketBase half, the shared sign-in and the re-sign on a 401 included.

The Supernote directory pager stops on a short page, so a server ignoring `pageNo` would answer the
same full page for ever: the same page twice ends it, and so does a ceiling of 1000 pages.

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
- **A final error middleware** answers what reaches `next(err)` — malformed JSON 400, an upload past
  its ceiling 413, the rest 500 — as JSON, never Express's development page with its stack.
- **The process** logs a stray rejection and survives; an uncaught exception is logged and exits, the
  container restarting it. A SIGTERM lets in-flight requests finish before the process leaves.

## A request cannot reach another PocketBase endpoint

Ids come from URLs and the backend holds a superuser's token, so every id is ENCODED as a path
segment before it reaches PocketBase (`docs/pocketbase.md`). Filter values were escaped already.

## Lists read what they show

A session list projects seven fields instead of every envelope, and an IN-list is asked 40 values at
a time rather than as one query string PocketBase may refuse (`docs/pocketbase.md`).

## A take survives a failed upload, and a tab asks before it closes

`docs/recordings.md`: the stopped take is kept with Retry and Download, a save cannot fail once the
upload answered (so Retry never sends a take twice), and leaving the tab asks first while a take is
at risk. The server gives one request 30 minutes, where Node's default cut an hours-long upload at 5.

## The recorder's frame costs the window, not the take

`LiveWaveform` smoothed the WHOLE envelope, and reallocated its canvas, on every animation frame to
draw a 12-second window: after three hours, 54 000 samples, sixty times a second. It now smooths only
the samples the pixels read and resizes the canvas only when its size moves — the same picture.

## An editor is not reset by a status poll

A song whose pipeline is running is replaced every 2 s by its status poll, and the editor reset on
every new `song`: typed lyrics were discarded mid-edit and transpose jumped back to 0. A different
song or tab resets it; new content alone refreshes the draft only while nobody is editing.

## A take is never whole in the backend's memory, and two saves never race

A recording, a mixdown and its stems arrive on DISK (`@frediverse/http/upload`'s `diskUpload`), are
pushed to the médiathèque as file-backed Blobs (`fs.openAsBlob`, streamed by `fetch`), and are MOVED
into the cache; an appended take is concatenated by ffmpeg file to file. Only memory the size of a
chunk is ever held. Measured: a 5 MB upload lands on disk with no buffer, and nothing is left once the
request is done; a 20 MB file-backed Blob arrives byte-identical. Saves and appends to one session,
sheet uploads to one song, a favourite and a nametag each run one at a time per key (`lock.ts`) — the
read-modify-write against PocketBase has no transaction of its own.

## Expensive work is done once, and caches stay bounded

A public page's first visitors share one measurement and one download (`cache.ts`'s `once`); the
row caches are swept every minute and capped; the disk cache — copies the médiathèque refills — is
trimmed least-recently-used first past `CACHE_MAX_GB` (20 by default), never touching a temporary
file or one younger than ten minutes.

## A take survives the tab, the source and the timer

`docs/recordings.md`: chunks backed up to IndexedDB and offered back after a crash (checked in a real
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
reading as connected; a signalling message is capped at 64 KB. The image runs with
`NODE_ENV=production`, and a production process refuses to boot on the development `SESSION_SECRET`.

## Left as lots

None. What this audit has not measured, and would need a browser session on a phone to: how long an
IndexedDB write of a one-second chunk takes on a slow device over an hours-long take, and whether a
quota prompt ever interrupts one.

## What a change here should be verified with

```
npm run typecheck --workspace k7-backend && npm test --workspace k7-backend
cd apps/k7/frontend && npx paraglide-js compile --silent --emit-ts-declarations && npx tsc --noEmit -p . && npx vitest run
```

The paraglide output is generated and untracked; compiling it WITHOUT `--emit-ts-declarations` (as
`pretest` does) leaves the typecheck without the message types.
