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
along untouched. Remove-then-add would lose both — `sequence note new` takes no velocity at all —
and would be two journal steps for one act. The destination is refused when it already
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

## …and one writer for a RECTANGLE

`mapNotesInRegion` is the same edit over a box rather than a note: two keys inclusive, a half-open
beat span, and `fn` answering `null` to remove. The four `sequence notes …` verbs — remove,
transpose, quantize, velocity — are four short functions over it.

It exists because a bulk edit has to be **one journal entry**. Calling the singular writers N times
is N of them, and half could land while the rest throw: a rectangle transposed by twelve would
then undo a fifth of the way back, which is worse than either doing it or refusing it. One
document pass also means one parse and one serialise, where N calls re-read the file N times.

A note is in when it **starts** inside, the rule the roll's rectangle already copies by
(`apps/k7/frontend/src/clipboard.ts`). Taking them by overlap would put the same note in two
adjacent boxes. `repeat` and `skip` are never touched, so a pad crossed by a transposition keeps
its effects, and a line the parse cannot read as a note is left alone rather than rewritten.

An empty region answers `{ changed: 0 }` and hands the text straight back rather than throwing.
That is the one place this file departs from "throw on a miss", and the reason is that the caller
is a rectangle rather than an address: a box holding nothing is a thing a person can draw, not a
surface being out of date. The COMMAND is what refuses it by name.

## `moveNotes`, for a selection that does not map onto keys

A dragged step-grid selection is not a rectangle verb: its rows are rack sounds in the rack's
order, so "two rows down" sends each note to a different key offset. `moveNotes` takes every
note's own destination instead — `sequence notes move <sequence> [[k,t,nk,nt],…]` — and still
writes once, for the reason above. Every index is read BEFORE any write, so a note is never found
again at the place it just moved to. A destination is free when the note there is itself moving
away; one that stays makes the whole move refuse, as do two notes landing on one place, a missing
source, and a start before the sequence. Nothing is written when any of it refuses.

## Twice as long, playing twice

`doubleSequence` is the ×2 in a note grid's header (`apps/k7/frontend/docs/clipEditors.md`), and
almost all of it is one question: **what a sequence's LENGTH is**. It is the WINDOW, and a sequence
states one in either of two ways — a `from`/`to` pair of timecodes, or nothing at all, in which
case the length is the notes' extent **rounded up to the bar**. That second rule is the compiler's
(`packages/song/src/nodeProject.ts`), and it is restated here rather than approximated: a doubling
that read the last note's end as the length would move the copies by three beats where the sequence
plays four, and every pass after the first would drift.

Three decisions follow from it:

- **A window the file does not state is left unstated.** The copies land one extent later, so the
  new extent is exactly twice the old — the rounding makes that exact, since a bar-aligned window
  plus a bar-aligned extent rounds to their sum. Writing a `to` would say what the file already
  says, and give the same length two places to be right in.
- **A stated `to` moves out by the window's length** and is spelled back as a timecode, because
  that is what the field holds. `from` never moves: the sequence still starts where it started.
- **The copies are the notes the window HOLDS**, by the same "in when it STARTS inside" rule the
  rectangle follows above. A note sitting past `to` sounds in no pass, so copying it would double
  something nobody can hear; it is left exactly where it is. `repeat` and `skip` ride along, or the
  second half would be a different sound from the first (`@studio/song docs/padEffects.md`).

A LOOPED placement of the sequence needs the other half of the act — the window doubled and the
passes halved, or four bars of a one-bar pattern become eight. That is `halveSequenceLoops` in
`trackFile.ts`, walked across the project by `@studio/song-edit`, and
`packages/song-edit/docs/sequenceLoops.md` is where it is reasoned out.

An empty sequence and a window holding nothing are both **refused by name**. Doubling nothing is a
sequence that got longer with no more in it — the shape of a command that reports success and does
nothing, which is the one failure this codebase says everywhere else it will not have.

### What the four verbs decided

- **quantize moves the onset and keeps the length.** Moving the end too would be two edits under
  one verb, and a run of notes would grow or shrink as a side effect of being lined up.
- **transpose CLAMPS onto the keyboard**, where `pasteNotes` drops what falls off and says so. The
  difference is that a paste is new material and a transpose is notes that exist: losing one
  silently would leave the rest moved and no way to say what went. The engine's own `transpose`
  node clamps for a harder reason still — a dropped note leaves its note-off behind and hangs the
  voice (`engine/k7-runtime/engine/DspGraph.cpp`).
- **velocity is absolute, and 1 clears the field**, exactly as the singular verb does: a region set
  to full leaves a file that never mentions velocity, which is what an untouched sequence looks
  like. A relative factor would be a fifth verb, not a flag on this one.
