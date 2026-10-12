# A workspace's history

`../historyLog.ts` keeps a room's whole log on disk; `../historyRoutes.ts` serves it to the account's
browser at `/api/sync/history`, behind the session. The relay that writes it is `syncRelay.md`, the
plan `../../../docs/live-sync-plan.md`.

## The relay's log is the history

st0 has no git. Every edit made on any replica already reaches the relay as a batch, and the relay
already gives it a place in one order. That ordered log is therefore the only complete account of
what happened to a workspace, and it is kept whole rather than a second record being built beside
it. It is this repository's own code on every platform, which a git binary is not.

History lives where edits are ordered, so it is the server's. A replica offline has none of its own
until it reconnects; undo stays local and works offline.

## Segments, never truncated

The relay saves a room whole every 200 entries and starts its working log again. The entries are
not dropped at that point: the working log is ROLLED into `log/<firstSeq>.jsonl`, a segment that is
never rewritten or deleted. A segment is named by its first `seq`, so a range is read from the
segments that can hold it and no index is needed.

Loading a room on restart reads the saved state and the working log only, as it would without any
history: the segments are for reading the past, never for catching up.

## Snapshots, so a point is rebuilt from nearby

Every 1,000 entries the files are written whole to `snapshots/<seq>.json`. The files at any point
are the nearest snapshot at or before it with the entries after it replayed, never a replay from
seq 1. With no snapshot before a point, the empty room at seq 0 is the base, which holds only when
the log reaches back to 1. A point the kept entries cannot reach is answered `410`, not guessed.

A room saved before it had segments gets its saved catch-up log as its first segment and its saved
files as its first snapshot when it is next loaded.

## Checkpoints

A checkpoint is a named `seq` in `checkpoints.json`: nothing is copied, since the log already holds
the point. Named by a person, it records their email. The relay also takes one, named `auto`, when a
room has been edited and then left alone for ten minutes, at most one per quiet period, so a session
of work has a point to come back to without anyone thinking of naming it.

## A restore is an ordinary batch

Restoring rebuilds the files at a point and submits ONE batch to the live room the relay holds:
the whole text of every file that differs from now, and a removal of every file the point did not
have. It is ordered, written and relayed exactly as a replica's batch, so every device online
applies it at once, one offline gets it on catching up, and it lands in the history itself — a
restore can be undone by restoring to the point before it.

Every op names the text it replaces (`was`), so a value that moved between the rebuild and the
order is set aside as a conflict rather than overwritten (`../../live-sync/docs/sync.md`). Open
conflicts are left as they are: a restore is not a resolution.

## What is not kept here

A binary file travels as a blob ref: a text starting with a NUL byte that names a content hash. The
log keeps the ref; the bytes live in the blob store (`blobs.md`). A diff never compares refs as
text and only says a binary file changed.

Diffs are whole texts before and after, per file. Comparing them is the browser's affair.
