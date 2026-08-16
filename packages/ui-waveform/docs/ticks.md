# ticks — what a ruler draws, what it numbers, and what a click lands on

Three questions, answered by three functions, for the two rulers that have to agree with
each other.

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
the same zoom. Before it, zooming l8's audio clip panel in subdivided the ruler to sixteenths
while the wave underneath stayed ruled in whole beats, and the pair read as two grids.

It splits **per pair**, not once for the list: a warped clip's beats are not evenly spaced on
screen, and one count for all of them would crowd the compressed passages while leaving the
stretched ones bare. Interpolating inside a pair is exact for the same reason the projection is —
piecewise-linear between the marks, and these *are* the marks. The extra times join `gridTimes`,
so the guarantee below still holds once there are more lines than the service sent.

## Snapping is to the drawn list, not to the unit

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
  exactly where the pointer was. This is what keeps a waveform with no musical grid — k7's
  rehearsal takes, st0's song player — scrubbing continuously, and it is why the behaviour
  is not gated behind a prop: the data already says whether snapping means anything here.

## Both rulers, one rule

The timeline's ruler and the waveform's sit one above the other in the clip editor. Two
different thinning rules would put a number on one and not the other at the same zoom, and
the pair would read as broken rather than as two views. So the rule lives in this package,
which both already depend on, and neither gets to have an opinion about it.

They do not share a font — the timeline labels in 12px monospace DOM, the waveform in 10px
sans on a canvas. `labelMinPx` deliberately answers for the wider of the two. The waveform
is then a little sparser than it strictly needs to be, and that is the price of the two
never disagreeing.

## Why the width is estimated, not measured

`labelMinPx` multiplies a character COUNT by one character's advance. Both rulers label in
digits and dots, and every one of those is a single advance in a monospace, so the count is
the width. The canvas ruler could call `measureText` instead; the timeline could not,
because it draws DOM and measuring there means forcing a layout on every zoom frame.

The constant was a flat 10px before, which is what a ONE-character label needs. Bar 7 fit;
bar 129 did not, and "12.4" needed three times it — so past a couple of hundred bars, or
at any zoom showing beats, the numbers overlapped. The width now follows the label.

## Pass the widest the ruler CAN print

Not the widest currently on screen. The stride has to depend on the zoom alone: derive it
from the visible bars instead and panning past bar 10, then bar 100, re-thins the entire
ruler under the cursor — labels appearing and vanishing as you scroll, which is the same
flicker `labelled` counts indices from the ORIGIN to avoid.

So the timeline asks what its LAST bar is and reserves for that, and a long song is
slightly sparse at bar 1. Stable beats tight: a ruler you can pan along without it
rearranging itself is worth more than one extra number.
