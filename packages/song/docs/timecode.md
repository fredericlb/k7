# timecode.ts — extended notes

A song's times read as a colon-separated timecode `"bar:beat:sub:…"`.

- **POSITIONS** (a clip's start, a loop endpoint) are 1-based: `"1:1:1"` is the very
  start, `"2:1:1"` the top of bar 2, `"1:2:1"` the 2nd beat of bar 1.
- **DURATIONS** (a length/offset/fade) are 0-based counts in the same units: `"1:0:0"`
  is exactly one bar, `"0:0:4"` one beat's worth of 16ths.

Each field past the beat subdivides the beat by 4 (a "sub" is 1/4 of a beat — a 16th in
4/4 — the next level 1/16, etc.), to arbitrary depth. Missing trailing fields default to
the origin.

The model measures time in beats = QUARTER NOTES (Tracktion's unit; the ABC parser
agrees — "whole-note = 4 beats"). A metrical beat is `Q = 4/denominator` quarter notes;
a bar is `numerator` such beats.
