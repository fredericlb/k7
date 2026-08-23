# timecode.ts — extended notes

A song's times read as **`"MESURE:NOIRE:CROCHE:DOUBLECROCHE"`**, optionally followed by `.ticks`.

- **POSITIONS** (a clip's start, a loop endpoint) are 1-based: `"1:1:1:1"` is the very
  start, `"2:1:1:1"` the top of bar 2, `"1:2:1:1"` the 2nd crotchet of bar 1.
- **DURATIONS** (a length/offset/fade) are 0-based counts in the same units: `"1:0:0:0"`
  is exactly one bar, `"0:0:2:0"` two quavers, which is one beat.

The chain **halves** at every step past the bar: a metrical beat, half of one, a quarter of
one. Those names are the 4/4 ones — in 6/8 the beat is a quaver and the two levels under it
halve from there.

Missing trailing fields default to the origin, so `"2:1"` and `"2:1:1:1"` are the same place.
A level is only droppable when everything **below** it is at the origin too: `"1:1:2"` already
means half a beat, so a semiquaver is written `"1:1:1:2"` — with its quaver, at rest.

## Below the double-croche it is TICKS, not more colons

Anything finer is written `.X`, where X is a count of **ticks** at `TICKS_PER_QUARTER` = 960
to the quarter note: `"1:1:1:2.120"` is one semiquaver and half of one — a dotted 32nd.

The colon used to nest to arbitrary depth, each level dividing the last by four. An off-grid
time came out as `3:2:2:4:2:3:1:3`: eight place values, no two of them the same size, and
nobody could read the fourth. A remainder is a NUMBER, not another level of nesting.

## The two rules, and how they are told apart

The old chain divided by FOUR at each level; this one halves. They disagree from the third
field on — `"1:1:3"` is two semiquavers under the old rule and two quavers under this one —
and **no syntax separates them**. The LENGTH decides: five fields or more cannot be this
notation, so they are read the old way; four or fewer are read this way.

That is enough because a short deep chain is almost always at its own level's origin
(`"1:1:1"`, `"2:1:1"`), and an origin is 0 under either rule. Across the repo's five demo songs,
all twelve short chains were of that kind. One imported song held three that were not
(`"46:3:3"`, `"25:3:3"`, `"53:3:3"`), and `scripts/migrateTimecodes.ts` rewrote them — it reads
with `parseLegacyPosition`, which forces the old rule, because it is the one caller that knows
a file has not been converted yet.

- **960 because it divides by three.** 960 = 2⁶·3·5, so a triplet, a quintuplet and a 64th all
  land on whole ticks. A power of two would have made every triplet a rounding.
- **Ticks are absolute** — 1/960 of a quarter note, whatever the time signature — so they hang
  off whatever precedes them and need no zero sub to disambiguate: `"1:1.10"` is fine.
- **They count from zero in a position as in a duration.** The 1-based rule applies to fields;
  what is left over after them is a remainder, not an index.

**The parser still reads the deep colon form**, and always will: refusing it would make an
un-migrated song unreadable. Only the WRITER is short.

What the rewrite costs, measured on a real 60-bar song (01.danse.st0, 173 timecodes): none failed
to parse, and the worst quantisation was **0.484 ticks — about a quarter of a millisecond at
110bpm**. The old sixth level was 1/4096 of a quarter, finer than a tick, so a few times land on
the grid rather than exactly where they were.

**The dot overlaps a YAML float**, which the colon form did not: `1.5` unquoted is a number in
any YAML, where `25:1` was only a YAML 1.1 sexagesimal. That is why `TIMECODE` in
`yaml/placementSchema.ts` learned the dot in the same change as the parser — a timecode the
schema refused would be written unquoted, and read back as 1.5.

The model measures time in beats = QUARTER NOTES (Tracktion's unit; the ABC parser
agrees — "whole-note = 4 beats"). A metrical beat is `Q = 4/denominator` quarter notes;
a bar is `numerator` such beats.

## A marker map's KEYS have to be quoted

The markers are the one place in the model where a timecode is a **key** rather than a value, which
is why `yaml/edit.ts` has `setQuotedKeyMap` beside `setFileValue`. `setFileValue` takes a plain
object and `createNode` gives every key the plain style — correct under YAML 1.2 and a disaster
under 1.1, where `2:1:1` unquoted is a sexagesimal integer. `quoteTimecodes` cannot rescue it
either: it walks values under known keys.

## Rewriting a document — timecodeMigrate.ts

Edits are SPLICED by source offset rather than re-serialised: a project is hand-written YAML with
comments and a shape its author chose, and rewriting a whole file to change eight characters would
bury the migration in a diff nobody could check. Back to front, so an earlier splice cannot move a
later one's offsets.

`TIMECODE_FIELDS` spells out which fields hold a timecode and whether each counts from 1 or from 0.
A POSITION says where something sits — `start`, and a window's edges, which are positions in the
material, `"1:1"` being its beginning. A DURATION says how long something lasts. Reading one as the
other lands a whole bar out, so the pair is written down rather than guessed per file.

A STRING only: `from: 0.25` on a clip is SECONDS into a file, not a timecode, and the two spellings
mean different things on the very same key (`AudioClipSchema`).

**A value already in the canonical new spelling is left alone, and that is what makes the pass
idempotent.** Idempotence is not a nicety here: the rewrite reads with the OLD rule, so running it
twice would read its own output as something it never meant and shift the song by a sixteenth. A
second run must be a no-op or the script is a trap.

The gap it leaves: a value that is canonical in the new notation AND meant something else in the old
one would be skipped. Such a value would have to be short, sub-beat, and exactly what the writer
emits — and a scan over every project in `~/.studio/root` found none. Where one exists the two rules
disagree, which is a thing that can be searched for.

`driftBeats` compares what the NEW reader makes of what was just written against what the old one
made of what was there. That is the only comparison that says the song still sounds the same.

## A clip's window edge needs the grid

A clip's `from`/`to` is a window edge in SECONDS. A bare number already is one; a TIMECODE is a
position in the file and needs the project's tempo and signature to become one (`AudioClipSchema`).

Without a grid, `project.ts`'s `windowEdge` drops a timecode — which is what it did for EVERY
caller until the drawing needed it. `Number("2:1")` is `NaN`, so the musical spelling, the one an
imported song is full of, silently produced a clip with no window at all. `nodeProject.ts` had its
own resolver and was right; this path had none and was quietly wrong. That is why the callers that
draw a window now pass a `ClipGrid`.
