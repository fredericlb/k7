# Live capture: every change to a workspace, as batches of ops

`liveCapture.ts` watches a whole workspace and turns each change into the ops of
`@studio/live-sync` (`../../live-sync/docs/ops.md`), grouped into batches. `liveLog.ts` keeps them;
`liveSync.ts` attaches a capture to each workspace the service opens, and `liveRelay.ts` links it to
the relay (`../../file-hub/docs/syncRelay.md`). Phases 2 and 3 of `../../../docs/live-sync-plan.md`.

## Off unless `STUDIO_LIVE_SYNC=1`

A watcher and a ledger per open workspace is a cost worth paying only when someone edits from
another replica, and only one replica per account exists until phase 4. So the flag stays off by
default. With it on and `STUDIO_SYNC_URL` set (the hub sets it), every batch also goes to the relay.
`GET /sync/log` shows what this service captured; it answers 404 while the flag is off.

## The ledger, not the writers

The file service writes through about a hundred call sites, and most bypass `recordChange`. A
take arriving, a tunnel upload or a `git pull` writes without any verb at all. So capture keeps a
ledger of the workspace and diffs a change against it, whoever made the change.

- **A YAML file** keeps its last text in the ledger: it is the only kind diffed into path ops.
- **Any other text file** keeps a content hash. It travels whole anyway, and the hash is what stops a
  file rewritten with the same content from sending anything. It is live-sync's `textHash`, not a
  sha1, because the same hash is the `was` its op carries and the room must compute it without `node:`.
- **An opaque file** — binary, or text past 5 MB — keeps only its stamp.

On the library checkout (2,142 files) the ledger holds 1.4 MB of text. Keeping every text file's
content instead held 37 MB.

## Binary is decided by CONTENT

The workspace's binary list is extensions (audio, video, images, `.vstpreset`). A library also holds
`.fxp` presets and amp models, which no extension list will ever cover. Read as UTF-8 and sent as
text, they would arrive corrupted. So a file with a NUL byte in its first 8,000 bytes is binary
whatever its name, which is git's own test.

## One recursive `fs.watch`, and sweeps behind it

One handle per workspace, for the reason `moduleWatch.md` gives against chokidar: a handle on every
directory stops its parent from being renamed on Windows, and renaming a project is routine.

A watcher can lose events. One started beside another missed a write made in its first moments
(measured on macOS, in the test that now covers it). So:

- a full sweep runs one second after a capture starts;
- another runs every five seconds.

A sweep compares stamps and reads only files that moved, so it costs a walk.

A file whose mtime has not SETTLED is re-read even when its stamp matches. A same-size rewrite inside
one timestamp tick keeps the stamp, the hazard `history.md` describes for the undo journal.

## A mutation window is one batch

`recordChange` holds the capture while a verb or a save runs, and releases it with its label. When the
last window closes, the batch comes from a full SWEEP after the next quiet period (100 ms), not from
the watcher's events. The watcher reports a window's writes after it closes, and under load late
enough to split one window into two batches. A sweep costs a walk, about 20 ms on a large workspace,
paid after the request has been answered.

A periodic sweep that falls inside a window waits for it, so it never emits half of one. Writes from
outside any window (a take, a pull) close a batch after the same quiet period, labelled `edit`.

## Applying another replica's batch

The capture does not apply anything itself. `@studio/live-sync`'s Replica decides what each file must
become (`../../live-sync/docs/sync.md`) and writes it through `writeKnown`. That records the result in
the ledger before the watcher sees it, so nothing is echoed back.

A local edit the watcher has not reported yet would be swallowed by that write. So before an entry
from another replica is applied, `captureFiles` diffs the files it touches and emits whatever local
change it finds. That batch reaches the replica, as pending, before the entry does.

When an entry rewrites a file of the open project, the project goes to the engine, as an undo does.

## Conflicts

`GET /sync/conflicts` lists what the relay set aside in this workspace, each with the value kept in
its place (`../../live-sync/docs/sync.md`). `POST /sync/conflicts/:id` settles one: with
`{ "take": true }` the alternative is written over the value in place, otherwise it is dismissed.
Either way it goes out as an ordinary batch naming the conflict in `resolves`, so the choice is in
the log and every replica closes it.

## The log lives in the account's state

`<studioHome>/.sync/<workspace>-<hash>/batches.jsonl`, beside the undo journal's folder and for the
same reason: inside the workspace it would be captured, committed and pushed with the songs. One JSON
line per batch. Past 20 MB the log is rotated once, since the server's ordered log is the one that
counts (phase 3). The replica's id is `<studioHome>/.sync/replica-id`, made once.

## Not yet

Opaque files are watched but produce no op: they travel by content hash in phase 6. Renames arrive as
removals plus whole-text creations.
