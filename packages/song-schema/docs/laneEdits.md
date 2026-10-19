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

That fork is what makes two sets two documents. Writing `["events"]` flat would mean dragging a clip
while on take 2 rewrites take 1 — the arrangement you are not looking at
(`packages/song/docs/alternatives.md`).

The fork uses `clone()` rather than a rebuild from plain values, because it is a deep copy that
brings each placement's own comments with it. An empty set is opened out into a block map rather
than left as `- {}`: a flow map keeps everything inside it on its own line, so a forked arrangement
would arrive as one 400-character row. These files are hand-edited and they are in git, so its
placements stay one per line as everywhere.

Every index-taking edit rests on one property: the index came from the list that is PLAYING, and
forking copies it in order, so it still points at the same placement.

`setTrackField` writes the module's OWN field whichever set is on, and that is deliberate:
the fields it takes are `color` and `disabled`, which describe the lane rather than the take. A set may
still override either by hand; nothing here writes one there.

## Plain values, not document nodes

`placementAt` returns plain values and not the document node, and the difference is not cosmetic:
its one caller — `movePlacementToTrack` — SPREADS what it gets into another lane's file. A node
cannot cross documents anyway — it carries a `range` into offsets of the file it was parsed from —
so no reader wants one. `placementValues` is the list to its one, and hands back plain values for
the same reason.

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
the markers.

## Halving a placement's passes

`halveSequenceLoops` is what `sequence double` calls on every lane: the material's window has just
doubled, so a placement that plays it four times must play it twice, or the arrangement grows under
an edit that was about the notes. It walks `everyEventList` for the reason `spliceTime` does — a
placement in a take or an alternative is a placement — and deletes the key rather than writing
`loop: 1`, one pass being the default. What it deliberately does not touch, and why, is
`packages/song-edit/docs/sequenceLoops.md`.

## A placement's id

`packages/song-schema/src/placementId.ts` holds it in two functions with no imports, so a BROWSER can
have the rule: it is written by the compiler, logged by the engine, carried on `/waveform`, and read
back by every surface that has to find the file behind a clip. It is kept out of `nodeProject.ts`,
which reaches for `node:fs` and `node:child_process`, for the reason `graph-model` is its own tier.

Two placements of one material are the ordinary case — a split makes a pair of them, and any lane may
drop the same sample twice — so the material's name alone cannot identify one. The start does,
because two placements cannot begin at the same beat on one lane without being the same placement.

It is `@` and the start IN BEATS. Start rather than an index into `events:`, because the list's order
is not meaningful: a split appends its tail, so an index would renumber the neighbours of every cut.
Moving a clip does change the id, and that costs nothing — `clipMoved` re-inserts on a changed
`start`, so the engine rebuilds it either way. It is readable on purpose: it is
what the engine logs and what a `/waveform` request carries.

`materialRefOf` is the inverse, for the readers that want the file rather than the placement: a
clip's own `clips/<ref>.k7x`, its onset corrections, and the editor asked to open "the clip's own
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
cut).

Deleting removes the events that START inside the span and shifts the rest back, so insert-then-
delete of the same span returns the file to what it was, byte for byte. That round trip is the
property worth having and the one the test asserts.

It walks each list descending, so removing one does not shift the address of the next, and an
unreadable `start` is one placement left alone rather than a failed splice.
