# Choosing a ruler's unit

`chooseTick` takes the candidate steps a scale is allowed to subdivide to, and returns the
**coarsest** one whose ticks are at least `minPx` apart at the current zoom.

Coarsest and not finest, which is the whole decision: a ruler is unreadable when its labels
touch, and merely sparse when they are too far apart. One of those failure modes costs you
the ruler; the other costs you a glance.

## Why the candidates are the caller's

Because the two READINGS of a ruler do not subdivide the same way, and this is the seam that
lets one function serve both. st0's timeline offers both from one header button: a song is
placed in bars and its picture is cut in seconds, and they share a grid.

**The musical reading.** A bar halves into beats, beats halve into sixteenths; the ladder is
powers of two, anchored on a bar length that itself depends on the time signature. A `5s` step
is meaningless there.

**The wall-clock reading**, `SECOND_TICKS`: 1/2/5 per decade up to a second, then the
steps a viewer actually reads a duration in — 15s, 30s, 1m, 2m, 5m. Not powers of two,
because time does not halve: `16s` between labels is a number nobody thinks in, while
`0.25s` is a perfectly good zoom on a cut.

So the ladder belongs to the surface and the *choice* belongs here.

## Counting, not accumulating

`ticksUpTo` multiplies an index by the step rather than adding the step repeatedly.

Adding `0.1` four hundred times lands at `40.000000000000255`. The ruler's labels would
then be one ulp off the grid lines drawn from the same array, and the symptom is a
screenshot where a dashed rule sits a hair beside its number — a bug that survives every
test asserting on the values themselves.

## `nearestTick` returns null

A click that lands nowhere near a tick is not a click on tick 0. Callers use the result to
snap a marker or a seek onto a line the user can SEE, so "nothing was near enough" has to be
sayable — otherwise a click in empty space silently drops a marker at the origin.

## With a picture, the fine rungs are FRAMES

`secondTicks(fps)` replaces the seconds ladder's sub-second rungs with 1, 2, 5, 10 and 15
frames when the song has a picture. A cut can only fall on a frame, and the decimal rungs do not
land on one: at 30 fps, `0.04 s` is 1.2 frames. With frame rungs, every fine tick the ruler
draws is a frame, so every drag that snaps to the drawn ticks, every cut and every step lands on
one too. That holds on an AUDIO lane as well: a hit point is placed against a picture, so the
music lands on its frames too.

A song with no picture keeps the decimal ladder, since a frame means nothing to it.
`formatSecondTick` labels a frame tick `12f` rather than `0:01.40`. A decimal there would read
as a typed position and would round: `0:01.40` is frame 12 at 30 fps and is not a frame at 24.

## `adjacentTick` steps strictly

A step from a playhead already ON a tick moves to the next one, never to itself, or the second
press of the step key would be the first that moved anything. Past the last tick it answers null,
and the step does nothing rather than wrapping.
