# Editing the placements on a lane

The rationale behind `packages/song-schema/src/yaml/trackFile.ts` — the app's most frequent edit,
since every clip drag writes a placement's `start`. Reading and validating the file is
`moduleFile.ts`'s job, a lane being an ordinary module
(`packages/song/docs/trackModules.md`); what is here is the clip list, and WHICH list.

## Which list an edit means

A lane is a module node, so its takes are that module's attribute sets: `events:` can exist at the
top of the file (set "1") and once more inside each entry under `alternatives:`. Which one an edit
means is whichever set is ON — and reading and writing do not always agree, which is why there are
two questions:

- `eventsIn` is what an edit ADDRESSES. A set that states no `events:` of its own inherits the
  module's, so that is what is on screen and what a clip is picked out of.
- `eventsToEdit` is where the edit LANDS: always the selected set, forking the inherited list into it
  on the first write.

That fork is the whole fix. Every edit here used to write `["events"]` flat, so dragging a clip while
on take 2 rewrote take 1 — the arrangement you were not looking at — and the two takes were never
separate documents at all (`packages/song/docs/alternatives.md`).

The fork uses `clone()` rather than a rebuild from plain values, because it is a deep copy that
brings each placement's own comments with it. An empty set was written `- {}`, and a flow map keeps
everything inside it on its own line — so a forked arrangement would arrive as one 400-character
row. These files are hand-edited and they are in git, so the set opens out and its placements stay
one per line as everywhere.

Every index-taking edit rests on one property: the index came from the list that is PLAYING, and
forking copies it in order, so it still points at the same placement.

`setTrackField` writes the module's OWN field whichever set is on, and that is deliberate:
`TrackFields` is `color` and `disabled`, which describe the lane rather than the take. A set may
still override either by hand; nothing here writes one there.

## Takes

A take is the same thing `events:` is — a list of placements — put aside. So all three writers are
moves between two seqs, never a rebuild: a placement carries its own comments and its own spelling,
and it should read the same after being set aside as it did before
(`packages/song/docs/takes.md`). `takesToEdit` follows `eventsToEdit`'s rule, so an alternative's
takes are its own.

`pushEventsToTake` is what recording over an event does before the new one is placed. The events are
MOVED — the same nodes, appended to `takes:` — so a take reads exactly like the arrangement it was.
A lane holding nothing makes no take: an empty one would be a row that says nothing.

`selectTake` is one exchange, both ways at once: the lane's arrangement becomes take `n` and take `n`
becomes the arrangement, which is what makes it reversible by running it again — nothing is lost by
looking at another take. An `n` nothing answers to throws rather than writing, so a stale menu cannot
empty a lane.

`removeTake` takes the events it held with it, a take being where they live, and the last one leaves
no empty list behind: absent is how a lane with no takes reads. `removeAllTakes` is deliberately one
act rather than a loop of `removeTake` at the call site — "keep this one" is a decision about the
whole list, and half of it applied is a state nobody asked for.

## Plain values, not document nodes

`placementAt` returns `toJSON()` and not the document node, and the difference is not cosmetic: it
used to return the node (`getIn(…, false)`), which its own summary and its return type both denied.
Its one caller — `movePlacementToTrack` — spreads what it gets, and spreading a YAMLMap copies the
MAP's fields rather than the placement's, so dragging an event onto another lane wrote
`{ items: […], flow: true, range: […] }` into the file. The lane then failed to compile and took the
whole timeline with it, which is a long way from a drag. A node cannot cross documents anyway — it
carries a `range` into offsets of the file it was parsed from — so there was never a reader that
wanted one. `placementValues` is the list to its one, and hands back plain values for the same
reason.

Both of them read the DOCUMENT rather than a validated lane, as `findPlacement` does: a file with one
bad field elsewhere still has events you can point at, and refusing a drag because something
unrelated is wrong would be a worse failure than the one being reported.

## Writing a placement

`addPlacement` takes no `length`: how long a placement sounds is the material's window times `loop`
(`PlacementSchema`). Everything else that schema allows IS written — a paste puts down the event it
copied, window and fades included — and `quoteTimecodes` is what keeps `from: "2:1"` from being
written bare and read back as a sexagesimal. A raw object stored via `setIn` stays plain until
stringify, invisible to the quoting visitor, so `put` calls `createNode` first.

`copyPlacementAt` is what a SPLIT writes for the second half. A copy rather than a fresh
`{ ref, start }`, because everything else the placement carries is still true of the half that was
cut off: its `warp: false`, its `disabled`, its `to`, and whatever a later schema adds. Rebuilding it
from the two fields this knows about would quietly drop the rest, and the loss would only show when
the tail played differently from the head. `undefined` in the patch CLEARS a field, the same rule
`setPlacementField` follows. The copy is built from the placement's VALUES, so a comment written
beside the original stays with the original — which is right: it was written about that event, and
the second half is new.

## Reaching every list at once

`everyEventList` is not `eventsToEdit`'s question, which is "where does an edit to what is PLAYING
go" and answers with the selected set alone. Inserting time is not an edit to the arrangement — it is
a change to the song's clock — so it has to reach what is playing, every take of it, and every
alternative's own events and takes. An alternative you switch to next week has to still line up with
the markers. It is exported for the other operation with the same reach: moving a material's window
down onto every placement of it (`packages/song-edit/src/windowDescend.ts`). A migration that missed a
take would leave that take playing the whole file the day you swapped it back onto the lane.

## A placement's id

`packages/song-schema/src/placementId.ts` holds it in two functions with no imports, so a BROWSER can
have the rule: it is written by the compiler, logged by the engine, carried on `/waveform`, and read
back by every surface that has to find the file behind a clip. It lived in `nodeProject.ts`, which
reaches for `node:fs` and `node:child_process` — the same reason `graph-model` was split out.

Two placements of one material are the ordinary case — a split makes a pair of them, and any lane may
drop the same sample twice — so the material's name alone cannot identify one. The start does,
because two placements cannot begin at the same beat on one lane without being the same placement.

It is `@` and the start IN BEATS. Start rather than an index into `events:`, because the list's order
is not meaningful: a split appends its tail, so an index would renumber the neighbours of every cut.
Moving a clip does change the id, and that costs nothing — `clipMoved` already re-inserts on a
changed `start`, so the engine was going to rebuild it either way. It is readable on purpose: it is
what the engine logs and what a `/waveform` request carries.

`materialRefOf` is the inverse, for the readers that want the file rather than the placement: a
clip's own `clips/<ref>.yaml`, its onset corrections, and the editor asked to open "the clip's own
definition" from a right-click. All are properties of the material, shared by every placement of it.
It splits on the LAST `@` and only when what follows is a number — a ref may legitimately contain
one, nothing forbidding it in an entity name — and a string it cannot parse is returned whole, which
is the right answer for the material names it is also handed directly.

## `spliceTime`

The rule for an event straddling the cut is the house one: **by its `start`**. An event whose start
is at or after the point moves; one already playing across it stays where it is and plays over the
inserted silence. That is what `moveTrackPlacementsInRange` and `selection consolidate` both already
do, and the alternative — cutting at the point — would make inserting time a verb that writes new
material and renders audio (`packages/song/docs/materialCut.md` on why there is no free, reversible
cut any more).

Deleting removes the events that START inside the span and shifts the rest back, so insert-then-
delete of the same span returns the file to what it was, byte for byte. That round trip is the
property worth having and the one the test asserts.

It walks each list descending, so removing one does not shift the address of the next, and an
unreadable `start` is one placement left alone rather than a failed splice.
