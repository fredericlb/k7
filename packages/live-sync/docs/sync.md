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

Two edits to different values of one file never collide: that is what path ops are for. A list is
still one value (`ops.md`), so two edits to one list do.

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

Only YAML files keep a confirmed text. Any other op is a whole-file text or a removal, and replaying
one does not need what came before it.

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

## The test that holds it

`src/converge.test.ts` runs 50 seeded schedules: three replicas, random edits, deletions and
re-creations, and deliveries to the room and to each replica late and interleaved. At the end every
replica's files must equal the room's. Without the replay over the confirmed text, every schedule
diverges.
