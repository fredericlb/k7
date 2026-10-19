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

The writer never nests past the double-croche. Nesting to arbitrary depth, each level dividing
the last by four, makes an off-grid time read `3:2:2:4:2:3:1:3`: eight place values, no two of
them the same size, and nobody can read the fourth. A remainder is a NUMBER, not another level
of nesting.

## The two rules, and how they are told apart

The DEEP chain divides by FOUR at each level; this one halves. They disagree from the third
field on — `"1:1:3"` is two semiquavers under the deep rule and two quavers under this one —
and **no syntax separates them**. The LENGTH decides: five fields or more cannot be this
notation, so they are read the deep way; four or fewer are read this way.

That is enough because a short deep chain is almost always at its own level's origin
(`"1:1:1"`, `"2:1:1"`), and an origin is 0 under either rule.

- **960 because it divides by three.** 960 = 2⁶·3·5, so a triplet, a quintuplet and a 64th all
  land on whole ticks. A power of two would have made every triplet a rounding.
- **Ticks are absolute** — 1/960 of a quarter note, whatever the time signature — so they hang
  off whatever precedes them and need no zero sub to disambiguate: `"1:1.10"` is fine.
- **They count from zero in a position as in a duration.** The 1-based rule applies to fields;
  what is left over after them is a remainder, not an index.

**The parser reads the deep colon form**: refusing it would make an unconverted song unreadable.
Only the WRITER is short.

What the rewrite costs: the deep form's sixth level is 1/4096 of a quarter, finer than a tick, so
a few times land on the grid rather than exactly where they were. The worst of it is under half a
tick — about a quarter of a millisecond at 110bpm.

**The dot overlaps a number**, where the colon form does not: `1.5` unquoted is a number, while
`25:1` unquoted does not parse. So `TIMECODE` in `packages/song-schema/src/yaml/placementSchema.ts`
accepts the dot — a timecode is the quoted string `"1.5"`, and the number 1.5 is a beat.

The model measures time in beats = QUARTER NOTES (Tracktion's unit; the ABC parser
agrees — "whole-note = 4 beats"). A metrical beat is `Q = 4/denominator` quarter notes;
a bar is `numerator` such beats.

## A marker map's KEYS are quoted

The markers are the one place in the model where a timecode is a **key** rather than a value. A
k7x key that is not a bare name is quoted, so `"2:1:1": "verse"` needs no writer of its own.

## A clip's window edge needs the grid

A clip's `from`/`to` is a window edge in SECONDS. A bare number already is one; a TIMECODE is a
position in the file and needs the project's tempo and signature to become one (`AudioClipSchema`).

Without a grid, `project.ts`'s `windowEdge` drops a timecode: `Number("2:1")` is `NaN`, so the
musical spelling — the one an imported song is full of — silently yields a clip with no window at
all. That is why every caller that draws a window passes a `ClipGrid`. `nodeProject.ts` carries a
resolver of its own and needs none.
