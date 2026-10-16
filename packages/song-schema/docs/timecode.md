# timecode.ts — implementation notes

The NOTATION is written up in `packages/song/docs/timecode.md`: what a position and a duration
mean, why the chain halves, why anything finer than the double-croche is ticks, and how the old
÷4 chain is told apart from this one. This page holds only what is about
`packages/song-schema/src/timecode.ts` as code.

## Everything in TICKS, rounded ONCE at the top

`fromBeats` converts to ticks first and then divides with integers. Rounding each sub-beat remainder
on its own lets a remainder just under a whole beat round UP to one — a quaver field holding two
quavers, a whole beat that should have carried into the crotchet beside it. Such a spelling lands on
the right moment, so it plays correctly and reads wrong, which is the failure nothing catches. One
rounding at the top, then pure integer division, and no level can overflow.

## What the writer leaves off

A trailing level at its own origin is dropped, so a bare beat keeps its short form — but a level is
only droppable when everything BELOW it is at the origin too: `"1:1:2"` says half a beat, and
writing a sixteenth without its quaver would say a quarter of one. Below the semiquaver it is the
remainder, and a remainder is a number rather than another level of nesting: six colons deep was a
place value nobody could read. Ticks are absolute (1/960 of a quarter), so `1:2.120` needs no zero
levels to be unambiguous.

## A deep chain reads by the ÷4 rule

`levelBeats` divides by four instead of halving when the chain is the deep notation. A chain LONGER
than four fields cannot be the current notation, so its length is what decides. A SHORT chain is
always read by the halving rule: there is no flag to force the other one, since everything must
read what is on disk today.

The PARSER still accepts a chain deeper than four fields, and always will — refusing it would make
such a song unreadable. Only the WRITER stops at the double-croche.

## Ticks are never shifted

`fields()` returns the ticks unshifted by the 1-based rule: they are a REMAINDER past the last
field, not an index into anything, so "the first tick" is 0 in a position exactly as it is in a
duration.
