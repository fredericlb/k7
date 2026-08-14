# timecode.ts — extended notes

A song's times read as `"bar:beat:sub"`, optionally followed by `.ticks`.

- **POSITIONS** (a clip's start, a loop endpoint) are 1-based: `"1:1:1"` is the very
  start, `"2:1:1"` the top of bar 2, `"1:2:1"` the 2nd beat of bar 1.
- **DURATIONS** (a length/offset/fade) are 0-based counts in the same units: `"1:0:0"`
  is exactly one bar, `"0:0:4"` one beat's worth of 16ths.

One field past the beat: the **sub**, 1/4 of a beat — a semiquaver in 4/4. Missing trailing
fields default to the origin, so `"2:1"` and `"2:1:1"` are the same place.

## Below the sub it is TICKS, not more colons

Anything finer is written `.X`, where X is a count of **ticks** at `TICKS_PER_QUARTER` = 960
to the quarter note: `"1:1:2.120"` is one sub and half of one — a dotted 16th.

The colon used to nest to arbitrary depth, each level dividing the last by four. An off-grid
time came out as `3:2:2:4:2:3:1:3`: eight place values, no two of them the same size, and
nobody could read the fourth. A remainder is a NUMBER, not another level of nesting.

- **960 because it divides by three.** 960 = 2⁶·3·5, so a triplet, a quintuplet and a 64th all
  land on whole ticks. A power of two would have made every triplet a rounding.
- **Ticks are absolute** — 1/960 of a quarter note, whatever the time signature — so they hang
  off whatever precedes them and need no zero sub to disambiguate: `"1:1.10"` is fine.
- **They count from zero in a position as in a duration.** The 1-based rule applies to fields;
  what is left over after them is a remainder, not an index.

**The parser still reads the deep colon form**, and always will: every file written before this
spells its sub-beats that way, and refusing them would make those songs unreadable. Only the
WRITER is short. Nothing on disk changes until something edits it.

What that costs, measured on a real 60-bar song (178 timecodes): none failed to parse, 137
rewrote with no loss at all, and the worst quantisation was **0.484 ticks — about a quarter of a
millisecond at 120bpm**. The old sixth level was 1/4096 of a quarter, finer than a tick, so a few
times land on the grid rather than exactly where they were.

**The dot overlaps a YAML float**, which the colon form did not: `1.5` unquoted is a number in
any YAML, where `25:1` was only a YAML 1.1 sexagesimal. That is why `TIMECODE` in
`yaml/placementSchema.ts` learned the dot in the same change as the parser — a timecode the
schema refused would be written unquoted, and read back as 1.5.

The model measures time in beats = QUARTER NOTES (Tracktion's unit; the ABC parser
agrees — "whole-note = 4 beats"). A metrical beat is `Q = 4/denominator` quarter notes;
a bar is `numerator` such beats.
