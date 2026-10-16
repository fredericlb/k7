# Choosing a ruler's unit

`chooseTick` takes the candidate steps a scale is allowed to subdivide to, and returns the
**coarsest** one whose ticks are at least `minPx` apart at the current zoom.

Coarsest and not finest, which is the whole decision: a ruler is unreadable when its labels
touch, and merely sparse when they are too far apart. One of those failure modes costs you
the ruler; the other costs you a glance.

## Why the candidates are the caller's

Because the two READINGS of a ruler do not subdivide the same way, and this is the seam that
lets one function serve both. k7's timeline offers both from one header button: a song is
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

## The musical ruler: its unit, its numbers, its clicks

The musical reading has three more questions, answered for the two rulers that have to agree
with each other — k7's timeline and `@studio/ui-waveform`'s canvas.

`subdivideBeats` picks the UNIT — a bar while a bar fits, then its beats, then halves of a
beat. The ladder is musical, not binary: a 4/4 bar descends to the quarter, because
dividing it by two would draw a half-note line, which is not a thing a ruler marks.

`labelStride` picks how many of those columns get a NUMBER. The lines stay readable long
after the numbers stop being: at 6px apart "17" and "18" are one smear. Thinning halves —
every 2nd, then every 4th, every 8th — so the survivors are always the round ones (bars 1,
5, 9… never 1, 4, 7). That is the whole reason it is not "fit as many as possible".

`nearestTick` answers where a CLICK goes: the closest line the ruler actually drew.

`subdivideGrid` is `subdivideBeats` for the ruler that cannot compute its own ticks. The waveform
is handed a bar/beat list by the file service (`beatGrid`) and the sub-beat times are simply not
in it, so when a column opens past `MAX_COLUMN_PX` the only thing left is to SPLIT what arrived —
same halving, same threshold, so the wave and the ruler stacked over it reach the same density at
the same zoom. Without it, zooming k7's audio clip panel in subdivides the ruler to sixteenths
while the wave underneath stays ruled in whole beats, and the pair reads as two grids.

It splits **per pair**, not once for the list: a warped clip's beats are not evenly spaced on
screen, and one count for all of them would crowd the compressed passages while leaving the
stretched ones bare. Interpolating inside a pair is exact for the same reason the projection is —
piecewise-linear between the marks, and these *are* the marks. The extra times join `gridTimes`,
so the guarantee below still holds once there are more lines than the service sent.

### Snapping is to the drawn list, not to the unit

Rounding to a multiple of the unit would be the obvious implementation and is wrong twice
over. A zoomed timeline starts at whatever beat the zoom does, so there is no origin to
round from; and the waveform is handed its grid line by line by the host, with no stride at
all. Both rulers instead pass `nearestTick` the array they just drew, which makes the
guarantee exact rather than approximate: **you can only land on a line that is on screen.**

Two consequences fall out of that and are worth stating, because both are the feature
working rather than a limitation:

- **The zoom is the resolution control.** `subdivideBeats` decides the unit, so opening the
  view up is how you reach a finer position — a click can never put the playhead somewhere
  the grid does not mark. The furthest it can move the pointer is half a column, and a
  column is capped at `MAX_COLUMN_PX`.
- **No grid, no snap.** `nearestTick` returns null on an empty list and the caller seeks
  exactly where the pointer was. This is what keeps a waveform with no musical grid — the
  rehearsal takes, the médiathèque's song player — scrubbing continuously, and it is why the behaviour
  is not gated behind a prop: the data already says whether snapping means anything here.

### Both rulers, one rule

The timeline's ruler and the waveform's sit one above the other in the clip editor. Two
different thinning rules would put a number on one and not the other at the same zoom, and
the pair would read as broken rather than as two views. So the rule lives in this package,
which both depend on, and neither gets to have an opinion about it.

They do not share a font — the timeline labels in 12px monospace DOM, the waveform in 10px
sans on a canvas. `labelMinPx` deliberately answers for the wider of the two. The waveform
is then a little sparser than it strictly needs to be, and that is the price of the two
never disagreeing.

### Why the width is estimated, not measured

`labelMinPx` multiplies a character COUNT by one character's advance. Both rulers label in
digits and dots, and every one of those is a single advance in a monospace, so the count is
the width. The canvas ruler could call `measureText` instead; the timeline could not,
because it draws DOM and measuring there means forcing a layout on every zoom frame.

A flat constant would be sized for a ONE-character label: 10px fits bar 7, not bar 129,
and "12.4" needs three times it — so past a couple of hundred bars, or at any zoom
showing beats, the numbers overlap. The width follows the label instead.

### Pass the widest the ruler CAN print

Not the widest currently on screen. The stride has to depend on the zoom alone: derive it
from the visible bars instead and panning past bar 10, then bar 100, re-thins the entire
ruler under the cursor — labels appearing and vanishing as you scroll, which is the same
flicker `labelled` counts indices from the ORIGIN to avoid.

So the timeline asks what its LAST bar is and reserves for that, and a long song is
slightly sparse at bar 1. Stable beats tight: a ruler you can pan along without it
rearranging itself is worth more than one extra number.
