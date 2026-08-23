# Editing a sequence's notes

The rationale behind `packages/song-schema/src/yaml/sequenceFile.ts` — the writers behind the piano
roll, the step sequencer and `note add`. One note per line (a flow mapping), which is the shape a
recorded sequence shares with a hand-entered one.

## How a note is addressed

By (key, start), for the reason a placement is addressed by its `start`: it is what the thing on
screen knows about itself, and two notes cannot share the pair without being the same note twice.
`findNote` reads the DOCUMENT rather than a validated sequence, as `trackFile`'s `findPlacement`
does: a file with one bad field elsewhere still has notes you can point at. Two beat positions within
a millionth of a beat are the same one — the times are decimals a surface computed.

Every edit throws on a miss rather than doing nothing: a surface that points at a note that is not
there is out of date, and silently removing nothing would hide that.

## One writer, two grips

`setNoteTimeRange` moves a note and/or changes its length, because on the roll those are one gesture
with two grips: dragging the body moves `t` and keeps `d`, dragging an edge keeps `t` and changes
`d`. A `noteMove` and a `noteResize` would be two verbs that must agree about how a note is
addressed, and the second one would eventually disagree. `d` is a LENGTH and not an end: the file
states it that way and the caller does the subtraction, so nothing here has to know whether the end
moved because the note grew or because it slid.

`setNoteEffect` is one writer for the same reason: `repeat` and `skip` are the same act on the same
note, differing only in which word is written, and two functions would be two places to keep the
addressing and the clearing rule identical.

## `moveNote`

The note is MOVED, not rebuilt: only `k` and `t` are rewritten, so its length and its velocity ride
along untouched. Remove-then-add would have lost both — `sequence note new` takes no velocity at all
— and it would have been two journal steps for one act. The destination is refused when it already
holds a note: (key, start) is how every surface addresses one, so two notes sharing the pair would be
the same note twice and the next edit could not say which it meant.

## `splitNote`

The note keeps its identity and its head: `d` is shortened to `at - t`, and a SECOND note is appended
from `at` for the rest. Rewriting the first rather than removing and adding two is what keeps the
file's order and its velocity — the pair is one note that was made into two, not two notes that
replaced one.

The velocity rides onto both halves, deliberately. What a note is worth is a property of the sound,
and cutting it in half does not make the second half quieter; a split that dropped the field would
silently return the tail to full.

`at` has to be strictly INSIDE the note. On either edge there is nothing to cut: one of the two
halves would have no length, and a "split" that produced the note you started with plus nothing is a
command that did not do what it says. Refused by name rather than nudged to the nearest grid line,
because where to cut is the caller's decision and this only carries it out.

## Clearing rather than writing a default

`setNoteVelocity(…, undefined)` deletes the key rather than writing `v: 1`, so a note dragged back to
full loses the field it never had: the schema's default is 1, and a file that never mentions velocity
stays byte-identical.

`setNoteEffect(…, undefined)` deletes the key for the same reason. A pad with `repeat: 1` would be a
pad declaring it plays once, which is what every pad with no `repeat` already says — and the schema
refuses anything under 2 precisely so that state cannot be written down.

Both follow the rule `alternative:` follows when it goes back to the first set. `appendNotes` writes
a pad's effects only when there is one, so a pad with no effect does not gain two keys saying so.
`NoteIn` carries them so a note that is COPIED brings them along
(`packages/song/docs/padEffects.md`).
