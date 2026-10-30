# Live capture: every change to a workspace, as batches of ops

`liveCapture.ts` watches a whole workspace and turns each change into the ops of
`@studio/live-sync` (`../../live-sync/docs/ops.md`), grouped into batches. `liveLog.ts` keeps them;
`liveSync.ts` attaches a capture to each workspace the service opens, and `liveRelay.ts` links it to
the relay (`../../file-hub/docs/syncRelay.md`). Phases 2 and 3 of `../../../docs/live-sync-plan.md`.

## On by default, off with `STUDIO_LIVE_SYNC=0`

Live sync is the only way a workspace reaches another replica, so capture runs for every open
workspace. `STUDIO_LIVE_SYNC=0` turns it off, for a process that must leave no watcher and no ledger
behind. With `STUDIO_SYNC_URL` set (the hub sets it), every batch also goes to the relay.
`GET /sync/log` shows what this service captured; it answers 404 while capture is off.

## The ledger, not the writers

The file service writes through about a hundred call sites, and most bypass `recordChange`. A
take arriving or a tunnel upload writes without any verb at all. So capture keeps a
ledger of the workspace and diffs a change against it, whoever made the change.

- **A k7x file** keeps its last text in the ledger: it is the only kind diffed into path ops.
- **Any other text file** keeps a content hash. It travels whole anyway, and the hash is what stops a
  file rewritten with the same content from sending anything. It is live-sync's `textHash`, not a
  sha1, because the same hash is the `was` its op carries and the room must compute it without `node:`.
- **An opaque file** — binary, a k7x file past 5 MB, or any other text past 128 KiB — keeps its blob
  ref: the sha256 of its bytes and their length, which is the text its ops carry (`../../file-hub/docs/blobs.md`).

On the library checkout (2,142 files) the ledger holds 1.4 MB of text. Keeping every text file's
content instead held 37 MB.

## Binary is decided by CONTENT

The workspace's binary list is extensions (audio, video, images, `.vstpreset`). A library also holds
`.fxp` presets and amp models, which no extension list will ever cover. Read as UTF-8 and sent as
text, they would arrive corrupted. So a file with a NUL byte in its first 8,000 bytes is binary
whatever its name, which is git's own test.

A text file that is not k7x is opaque past 128 KiB. Such a file is data, not something a person edits:
the library's amp models are 150 KB to 1 MB of JSON each, with no NUL byte to give them away. As text,
the room holds each one in memory, in its files, its merge bases and its log: about 40 MB for the
library alone, in a backend that idles near 200 MB. As a ref, each is a line. What is lost is the line
merge of two concurrent edits, which a model never has.

## One recursive `fs.watch`, and sweeps behind it

One handle per workspace, for the reason `moduleWatch.md` gives: a handle on every directory stops
its parent from being renamed on Windows, and renaming a project is routine.

A watcher can lose events. One started beside another missed a write made in its first moments
(measured on macOS, in the test that now covers it). So:

- a full sweep runs one second after a capture starts;
- another runs every five seconds while the workspace is ACTIVE — changed, written or started in
  the last two minutes — and every sixty once it is idle.

A sweep compares stamps and reads only files that moved, so it costs a walk. On a server every
workspace of every account is captured at once, so a walk each five seconds per workspace is disk
work proportional to everything stored, active or not. An active one keeps the fast net, because
the watcher it backs up does miss: Linux's recursive one can lose a rewrite, and five seconds is
how long such an edit then waits. A write through the file service needs no sweep at all, since
its mutation window closing sweeps on its own.

### The change feed

The capture is also the one place that hears every path in the workspace, so it hands that on:
`onChange` reports each path the watcher reports, each file a sweep finds moved, and each file
written for another replica, with a generation that moves on every one. The strudel watch and the
module watch subscribe to it rather than open watchers of their own over the same folders — one
handle per workspace instead of three, and none inside a project to release before it is renamed.

It reports more than happened rather than less: a save is heard from the watcher and again from the
batch it becomes. A subscriber that acts on an event (the strudel one re-sends the song) coalesces
them; one that only counts (the module one) does not need to. With live sync off (`STUDIO_LIVE_SYNC=0`)
there is no capture, and each subscriber falls back to a recursive `fs.watch` of its own.

A file whose mtime has not SETTLED is re-read even when its stamp matches. A same-size rewrite inside
one timestamp tick keeps the stamp, the hazard `history.md` describes for the undo journal. For the
same reason a text file READ while unsettled is recorded with no stamp at all: its stamp would
otherwise be trusted once settled, and a rewrite that reused it — one the watcher dropped, on a
disk whose mtime counts whole seconds — would pass every later sweep unseen.

## A mutation window is one batch

`recordChange` holds the capture while a verb or a save runs, and releases it with its label. When the
last window closes, the batch comes from a full SWEEP after the next quiet period (100 ms), not from
the watcher's events. The watcher reports a window's writes after it closes, and under load late
enough to split one window into two batches. A sweep costs a walk, about 20 ms on a large workspace,
paid after the request has been answered.

A periodic sweep that falls inside a window waits for it, so it never emits half of one. Writes from
outside any window (a take, a tunnel upload) close a batch after the same quiet period, labelled `edit`.

## Applying another replica's batch

The capture does not apply anything itself. `@studio/live-sync`'s Replica decides what each file must
become (`../../live-sync/docs/sync.md`) and writes it through `writeKnown`. That records the result in
the ledger before the watcher sees it, so nothing is echoed back.

A local edit the watcher has not reported yet would be swallowed by that write. So before ANY entry
is applied, `captureFiles` diffs the files it touches and emits whatever local change it finds. That
batch reaches the replica, as pending, before the entry does. A replica's own batch coming back is no
exception: the replica settles its files then, rewriting each to the confirmed text plus what is
pending, so an edit made between sending the batch and hearing it back would otherwise be reverted.

When an entry rewrites a file of the open project, the project goes to the engine, as an undo does.

Every path another replica names is resolved through `../src/livePath.ts` before it is read or
written, in the workspace and in the confirmed mirror alike: one that is not a sync path
(`../../live-sync/docs/ops.md`) or resolves outside the folder throws. The relay refuses such a path
too, but a desktop's relay is a server it does not control. A frame that throws is logged and
dropped, never let stop the service.

## Conflicts

`GET /sync/conflicts` lists what the relay set aside in this workspace, each with the value kept in
its place (`../../live-sync/docs/sync.md`). A workspace with no relay answers an empty list with
`linked: false` rather than an error: the client asks on every change notice, and a 404 there is a
red line in the console for a state that is not a fault. `POST /sync/conflicts/:id` settles one: with
`{ "take": true }` the alternative is written over the value in place, otherwise it is dismissed.
Either way it goes out as an ordinary batch naming the conflict in `resolves`, so the choice is in
the log and every replica closes it.

## The log lives in the account's state

`<studioHome>/.sync/<workspace>-<hash>/batches.jsonl`, beside the undo journal's folder and for the
same reason: inside the workspace it would be captured and synced with the songs. One JSON
line per batch. Past 20 MB the log is rotated once, since the server's ordered log is the one that
counts (phase 3). The replica's id is `<studioHome>/.sync/replica-id`, made once.

## Binaries travel as refs

An opaque file's op is a whole text whose text is its ref, and `read` answers the ref, so the Replica
treats it as any other file. The bytes go through the blob store before the batch does, and a ref
written for another replica waits, PENDING, until its bytes are here (`../../file-hub/docs/blobs.md`).
The cache of bytes in flight is `<log folder>/blobs/`, beside the confirmed texts.

## Up to date

A project is not OPENED until the copy here is the room's (`projectSyncState` in `../src/liveSync.ts`,
`GET /sync/project`), and `/open` refuses with 409 until then. Opened earlier, a project compiles
against what has arrived so far, which on a first download is text naming audio whose bytes are not
here yet: "audio clip … file missing" on every lane, and an error that is gone a minute later.

Two things have to be true, and they arrive apart:

- **The text is current** (`RelayLink.textState`): the workspace was welcomed on the socket now open,
  and its head has reached what that welcome promised. A new socket forgets the promise, since what
  was missed in between is exactly what it does not know. A link that has never connected reads as
  connecting for a few seconds rather than offline, or a service just started would open every
  project on stale text.
- **No file of the project waits for bytes**: the files PENDING in the blob cache's `pending.json`,
  counted under the project's folder only, so a take downloading in another song holds nothing up.

**Offline** — the relay unreachable, with a history here — opens on what is here, since the alternative
is a machine that cannot work without the server. Except when a file of the project never got its
bytes: that would open broken, so it waits, and says why.

**Refused** — the relay does not serve this k7's level, or sent an op it does not know — is never
opened, and the link stops reconnecting: its edits could not reach the server until one side is
updated, and the wait screen is where the user learns which (`../../live-sync/docs/sync.md`,
"Versions").

A workspace linked to no relay has nothing on its way and is always ready. The wait itself, and its
screen, are the shell's (`packages/project-shell/docs/launch.md`, "Waiting for sync").

## Several servers

An account may sync with several servers (`../../file-hub/docs/syncRelay.md`): one link per server
(`../src/liveServers.ts`), and each workspace on ONE of them. Which one is the workspace's own, kept
in its log folder (`server.json`: the server's origin and the room's name there); with none recorded
it is the main server's under its own name, which is what every workspace synced before secondaries
is, and a new workspace goes there too. A workspace whose server is no longer paired stays captured
here and syncs nowhere until it is paired again.

On a server the main one is its OWN relay, by the hub secret (`own` in `liveServers.ts`), and the
servers it is paired with sit beside it as on a machine: it still joins every room its own relay
holds, and no other's. The page knows the server by the origin it reached it at, not by its loopback
relay, so the routes translate one into the other (`toPage`, `fromPage`).

Two servers may each hold a workspace of the same name, and a machine has one folder per name: the
second brought down lands as `<room>.<host>` (`localNameFor`) — `@` would read better, and the
workspace-name rule refuses it — and syncs with its room under its real name. It takes that name
back once nothing here holds it — after a move, and at every start (`restoreRoomName`): the folder,
its sync history and its active marker are renamed together, sync letting go first so the rename is
not captured as every file removed and added again.

**A move** (`../src/liveMove.ts`, `POST /workspaces/sync/move`) is refused unless the workspace is up
to date here (above) with nothing of its own unconfirmed, and unless the target holds no workspace of
that name. It then runs on its own, the list saying so (`moving`):

1. The target's room is seeded from a fresh replica: everything here, the bytes put on the target's
   store before the batch is sent. A room left empty by an earlier move answers with its empty state,
   and the replica sends every file as only its own — the same end.
2. Only once the target has confirmed all of it is the old room emptied: one batch removing every
   file. Off that server's list, and every device synced with it removes it too; its history keeps it.
3. The target's history becomes the workspace's, its record names the target, and it is linked there.

Edits made during a move are held and sent to wherever it is linked at the end — the target, or the
server it stayed on when the move failed. A failed move leaves the target with what it got: the next
attempt is refused by the name until that room is emptied there, which is a choice for the person.

**A copy** (`POST /workspaces/sync/copy`) is a move's step 1 alone, under the same refusals, and the
list says so the same way (`moving`, with `copy`). Nothing is held: the workspace stays linked where
it was, its edits go on to that server, and the target's room starts from what was here when the copy
began. From then on they are two workspaces of the same name on two servers, which never hear of each
other; bringing the copy down here lands it as `<room>.<host>`, as above. One move or copy at a time
per workspace, since both seed the target under the room's name.

## A large workspace is learned in slices

`prepare` builds the ledger a slice of about 10 ms at a time, yielding to the event loop between
them, and `start` then only watches. The hub learns the libraries that way, because it serves every
request while it does (`../../file-hub/docs/fileHub.md`). A file service still learns a workspace in
one go: it is opened by a request that waits for it anyway. Each file is `stat`ed once while learning.
On Windows a `stat` is the expensive part of a file nobody reads.

## A file's hash outlives the process

A ledger is built at every start, and an opaque file is known by its sha256, so a start would read
every take again: about 0.4 s per gigabyte from the page cache, more from a cold disk. The hashes
are kept in `<log folder>/blob-index.json` (`../src/liveLedger.ts`), by workspace path and stamp
(size and `mtimeMs`), rewritten atomically after a start and after each batch. A file whose stamp
matches is known by the hash recorded; any other is hashed. On the library checkout the ledger
build went from about 95 ms to 60 ms warm, and four 256 MB takes from 360 ms to under 1 ms.

A text file other than k7x is recorded there too, by its `textHash`, so a start reads only the k7x
files, whose text the ledger keeps. The texts sit under their own key, `texts`, beside `files`: a k7
that reads only `files` must never take a text's hash for a blob's.

Against a baseline, a file whose content on disk is the baseline's keeps the walk's entry, real
stamp included. With an empty stamp instead, the first sweep would read and hash every text file a
second time.

A stamp whose mtime has not settled is never recorded, for the same-size-rewrite hazard above. A
file about to be SENT is still copied and hashed whole, since the ref must name the bytes uploaded.

## Not yet

Renames arrive as removals plus creations; a renamed binary costs no upload, since the store already
holds its bytes.
