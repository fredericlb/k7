# ticks — what a ruler draws, and what it numbers

Two independent questions, answered by two functions, for the two rulers that have to
agree with each other.

`subdivideBeats` picks the UNIT — a bar while a bar fits, then its beats, then halves of a
beat. The ladder is musical, not binary: a 4/4 bar descends to the quarter, because
dividing it by two would draw a half-note line, which is not a thing a ruler marks.

`labelStride` picks how many of those columns get a NUMBER. The lines stay readable long
after the numbers stop being: at 6px apart "17" and "18" are one smear. Thinning halves —
every 2nd, then every 4th, every 8th — so the survivors are always the round ones (bars 1,
5, 9… never 1, 4, 7). That is the whole reason it is not "fit as many as possible".

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
