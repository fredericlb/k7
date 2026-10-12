# Live sync: an edit reaches every replica in a fraction of a second

The decisions of the live-sync work, in one place. What is built so far is described by
`../packages/live-sync/docs/ops.md`, `../packages/live-sync/docs/sync.md`,
`../packages/file-service/docs/liveCapture.md` and `../packages/file-hub/docs/syncRelay.md`.

## The goal, and what rules out git as the live channel

A workspace is edited from several places at once: the hosted site, a desktop, a phone with no other
machine, and a second person. An edit must reach every one of them within about 100 ms. Editing with
only a phone is a supported case, offline included.

Git cannot be that channel. Commit, push, fetch and merge every few seconds on every device means:

- a conflict for every two edits to one file, even edits to different values;
- git, LFS and credentials on every device;
- hooks that Android refuses to run, and no git binary at all on iOS, where an app cannot start
  another program.

st0 has no git at all: the relay is the only channel, and its log is where history comes from.

## An edit travels as an operation

An edit is one file's change: values set or deleted at YAML key paths, or the whole text (`FileOp`,
`../packages/live-sync/src/ops.ts`). It is derived from the file's text before and after, so no writer
has to know about sync. Only a list is ever replaced whole, since its items have no identity.

## Replicas

Every place a file service runs holds a full working copy of the account's workspaces and is a
replica:

- the server's file service, one per account as today;
- each authoring machine: the standalone app, a desktop, a phone.

A browser is not a replica; it talks to one.

The server keeps a full replica. Browsing, the home page and an account with no machine online all
need the CURRENT files, and a replica is within 100 ms of them.

## The server orders

The server assigns each batch of ops a sequence number per workspace, and every replica applies
batches in that order. One order is what lets "last writer wins" mean the same thing everywhere, and
every device already reaches the server.

- **Different values, same file:** two edits merge.
- **One value, edited by someone who had not seen its current one:** the value in place stays, and
  the edit is kept as an open conflict, with who made it and when. Taking it or dismissing it is an
  ordinary batch, so the choice is in the log (`../packages/live-sync/docs/sync.md`). Every op names
  the value it replaced, which is what lets the room tell.
- **An offline replica** queues its batches with the last sequence number it saw and sends them on
  reconnecting. They are ordered on arrival and checked like any other, so an edit made an hour ago
  offline cannot silently overwrite a value changed since.

A path op is replayed on the receiver's CURRENT text, not on the sender's. When it cannot apply
there (the file is gone, or no longer parses), the receiver asks the server for the file's whole text.

## Capture is at the file, not at the writer

The file service's mutation window (`recordChange`, `../packages/file-service/src/workspace.ts`)
covers two entry points and only the active project. Most routes, the take callback and the tunnel's
uploads write around it. So capture watches the WHOLE workspace:

- a recursive watcher, with a ledger of each file's last known text;
- `fileOpFor` turns a change into an op;
- one mutation window, or a 100 ms quiet period, makes one batch.

A file a remote op just wrote is recorded in the ledger first, so the watcher does not echo it back.

## Transport

A WebSocket on st0's backend, `/api/sync`, in the same upgrade chain as the rehearsal room
(`../packages/rehearsal-server/src/rtc.ts`).

- **File services connect to it as clients,** the server's own included. A machine's file service is
  Node and dials out by itself, so the tunnel's rule that only the server opens a channel
  (`../packages/engine-tunnel/docs/tunnel.md`) does not get in the way.
- **A device authenticates with a token** issued to it for one account.
- **Browsers subscribe to the same feed** for change notices. That retires the two-second `/revision`
  poll (`../apps/st0/frontend/src/hooks/useRevision.ts`).

An op that touches the active project pushes the project to the engine, as an undo does.

## Audio

A binary file travels as a blob ref, its content hash and size, in place of its text: ordering,
conflicts, snapshots and history carry it unchanged. The bytes go to the server's content-addressed
store before the batch that names them, and a replica fetches them when it writes the ref. A rename is
a removal plus a creation that names a hash the store already holds
(`../packages/file-hub/docs/blobs.md`).

## History

The server's ordered log IS the history. Every replica already sends it every edit, and it runs on
every platform because it is only this repository's own code, where git would need a binary that iOS
does not allow.

- The room keeps every entry, not only the recent ones it needs for catching up: its log is rolled
  into segments that are never rewritten, with the files snapshotted every 1,000 entries so any
  point is rebuilt from nearby.
- A checkpoint is a named sequence number, named by a person or taken automatically after ten quiet
  minutes; a diff is the files at two numbers; going back is the files rebuilt to a number and sent
  as one batch, whose ops name what they replace so a value that moved is set aside, not
  overwritten (`../packages/file-hub/docs/history.md`).
- A conflict's alternative stays in that log after it is settled, so no value anyone wrote is lost.
- No git: a workspace has no repository, and no export to one is planned.

History is made where edits are ordered, so a replica offline has no checkpoints of its own until it
reconnects. Undo stays local and works offline.

## Phases

1. **Ops** — done: `@studio/live-sync`, with the exact-replay rule and the library corpus as its test.
2. **Capture** — done, on unless `STUDIO_LIVE_SYNC=0`: the watcher, the ledger, batches per mutation
   window and a local log (`../packages/file-service/docs/liveCapture.md`).
3. **The sequencer and relay** — done: `/api/sync` on st0's backend, rooms on disk, replicas that
   replay their own pending edits over the order (`../packages/live-sync/docs/sync.md`,
   `../packages/file-hub/docs/syncRelay.md`).
4. **Conflicts** — done: every op names what it replaced, the room sets aside one made against a
   value that moved, and a batch settles it; the file service lists and settles them
   (`GET`/`POST /sync/conflicts`).
5. **A machine replica** — done for the desktop: pairing through the system browser, the pairing kept
   per account, every workspace a replica from the start, and the rooms naming which workspaces
   exist (`../apps/st0-standalone/docs/sync.md`, `../packages/file-hub/docs/syncRelay.md`).
6. **Browser push**, replacing the polls, and the conflicts shown where the value is edited.
7. **Audio** — done: a binary file is a whole-text op whose text is a blob ref, its bytes uploaded to
   `/api/sync/blobs` before the batch and fetched by each replica (`../packages/file-hub/docs/blobs.md`).
8. **History** — done: the room's whole log, checkpoints, diff and restore, at `/api/sync/history`
   and in st0's History panel (`../packages/file-hub/docs/history.md`).
9. **The phone:** the file service in the Android app; on iOS, the editing code off `node:` first.
10. **Merging inside a list:** items matched by a natural key (a placement's start and lane, a note's
    time and pitch), so two additions to one list are two additions.
11. **A three-way merge for whole texts:** the room holds the base, so two edits to different lines of
    a non-YAML file both land.
