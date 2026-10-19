# One order, and each replica's own edits replayed over it

`src/room.ts` is the server's side of a workspace, `src/replica.ts` a replica's, and
`src/protocol.ts` what passes between them. The relay that carries it is
`../../file-hub/docs/syncRelay.md`. The model is the one Figma describes for its multiplayer: the
server orders, and every replica applies in that order. Where Figma lets the later write win, the room
keeps the value in place and sets the later one aside, when its author had not seen that value.

## The room applies before it relays

The room holds the CANONICAL text of every text file and applies each batch to it before relaying it.
An op that cannot apply there is set aside and left out of the relayed batch. So every op a replica
receives applies to the text the room had. A replica that is current never meets an op it cannot
apply, and one that does is not current: it asks for the room's whole state.

## A value that moved meanwhile: the one in place stays, the other is kept

Every op names the value it replaced (`was`, `ops.md`). The room applies an op only when the value at
its path is still that one. Otherwise the op is SET ASIDE as a conflict (`parked` on the entry): the
alternative, who made it, when, and the value kept in its place. An op that would make the value what
it already is collides with nothing. An op into a part someone removed is set aside the same way.

The value in place stays because it is what everyone online is already hearing, and neither side saw
the other's edit, so no rule is fairer. Nothing is lost: the alternative stays open until a batch
names it in `resolves`. Taking it is that batch with the op that writes it; dismissing it is the id
alone. Both are ordinary entries, so the choice is in the log and every replica closes it at once.

Two edits to different values of one file never collide: that is what path ops are for. In a keyed
list (`ops.md`) two added items both land, in the room's order, and edits to two items merge; an edit
inside an item someone removed is set aside. A list with no key is one value, so two edits to it
collide.

## Two whole texts made from one version are merged line by line

A file that is not k7x travels whole, so two edits to it name the same `was`. When the later one
arrives, the room merges it with what is in place against the text both were made from: a line-level
three-way merge (`node-diff3`, `src/textMerge.ts`). A clean merge is applied as a whole text holding
the merged result, so every replica, its author included, ends on the room's text. When the two
changed the same lines, or neighbouring ones, the op is set aside as any other: no conflict marker is
ever written into a file, since an engine or a renderer would read it as content.

The room needs that base, and the op carries only its hash. So the room keeps, per file, the last 20
versions it wrote (a megabyte at most), and finds the base by hash; a base it no longer has means set
aside. The versions are part of the saved state, and written only by applying entries, so replaying
the log after a restart rebuilds them. A `.k7x` file is not merged as lines: its own merge is by
path, and a line merge could leave two keys that read as one. A blob ref is not text.

`src/conflicts.ts` is the set of open conflicts, kept the same way by the room and by each replica.
A newer alternative from the same replica for the same value replaces the older one: a knob dragged
offline is one conflict, not a hundred. A welcome hands a replica the whole set, and every entry
after it updates it.

## A replica keeps the CONFIRMED text of what it has pending

Applying another replica's batch straight onto the disk would make a replica's own edit flicker. B
drags a knob; A's batch for the same file, ordered before B's, arrives first. Written straight, it
puts A's text on B's disk, B's value vanishes under the hand moving it, and comes back only when the
room answers B. The engine plays that dip.

So for every file it has unconfirmed ops on, a replica keeps that file's text as the room last
confirmed it. Another replica's batch is applied to the confirmed text, and the replica's own pending
ops are replayed on top. That is exactly the room's order: the other batch first, then its own once
it arrives. When its own batch comes back, the pending ops leave the replay. If the room set some of
them aside, the file falls back to what the room confirmed.

Every file keeps a confirmed text, whatever its kind: a whole text or a removal replays without what
came before it, but the room may have merged or set it aside, and the confirmed text is what the
replica falls back to.

## A batch can be sent twice

A replica re-sends every unconfirmed batch after a reconnect, since it cannot know whether the
socket died before or after the room ordered it. The room recognises a batch it has ordered by its
id and answers that entry again rather than ordering it twice.

## Catching up

A replica says hello at the last `seq` it applied:

- **Within the entries the room keeps** (2,000): it gets those entries.
- **Further behind, AHEAD** (the room lost state), **or at 0** (no history): it gets the whole
  canonical state and adopts it, its pending ops replayed on top. A replica at 0 always gets the
  state, never the entries, even when the room still keeps them all: its files share no history with
  the room's, and only a state lets it back up the ones that differ before they are overwritten.
- **An empty room:** asks its first replica for everything, as one batch of whole-file ops.

## Versions

Desktops and phones run whatever k7 they were last updated to, against a server updated on its own
schedule, and the log is replayed for as long as the workspace exists. So nothing written by one k7
is ever read by another on a guess. Two numbers in `src/protocol.ts` carry that rule:

- **`SYNC_PROTO`**, the level of the wire. A hello carries it as `proto`. The relay serves every
  level from `SYNC_PROTO_MIN` to its own. Below the minimum it answers `refused` with `update`; above
  its own, `refused` with `server-older`, since only the server knows ops the replica would send it.
  The refused replica stops reconnecting and says which side needs the update: a retry would be
  refused the same way. A hello without `proto` is level 1, the level every replica had before the
  field existed.
- **Level 2 is the minimum.** Level 1 is the k7 that synced YAML workspace files as `yaml` ops, which
  this build no longer applies (`RETIRED_OP_KINDS` in `src/ops.ts`). Such a replica is refused at
  hello with `update` before it sends a batch, so its pending edits wait on its disk instead of being
  silently dropped. A `yaml` op that reaches a relay anyway is answered `unknown-op`, its error naming
  the replica as the side to update, and `applyFileOp` throws a plain error for it, not `NeedsUpdate`,
  since no newer k7 would replay it either.
- **`LOG_V`**, the meaning of what is on disk. Every entry line, the saved room state and the
  segment index carry it as `v`; absent is 1. A reader meets a higher `v` with `NeedsUpdate`, and the
  room does not load at all: an entry skipped would leave the room's text wrong for every replica
  after it, and the log is the only history.

`SYNC_PROTO` goes up when a frame or an op means something an older k7 would read differently: a
new op kind, a new field an older room would drop, a new message. A new message or op a relay can
ignore without harm does not need it. `LOG_V` goes up when an entry already written would replay
differently under the new code; a new op kind alone needs `SYNC_PROTO`, since an older reader
already refuses a kind it does not know. Raising `SYNC_PROTO_MIN` is the decision to stop serving the
replicas still below it.

An op kind a replica does not know is never replayed as something else. `applyFileOp` throws
`NeedsUpdate` for it, and `Replica.remote` refuses the whole entry before its head moves, so the same
entry is read again once that k7 is updated. A relay meeting one answers `unknown-op`, and every frame
it cannot read gets a reason (`malformed`, `unknown-op`, `unknown-message`) rather than a bare error.

## The test that holds it

`src/converge.test.ts` runs 50 seeded schedules: three replicas, random edits, deletions and
re-creations, and deliveries to the room and to each replica late and interleaved. At the end every
replica's files must equal the room's. Without the replay over the confirmed text, every schedule
diverges.
