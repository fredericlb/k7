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

## A beat is written to six decimals

Every beat a writer puts in a file or a key goes through `roundBeat` (`Math.round(x * 1e6) / 1e6`):
a drag's float tail would otherwise churn a file on a no-op write, and two spellings of one beat
would address two different notes. Six places is far below a tick (1/960 of a quarter). A site that
rounds by `toFixed(6)` instead is not the same function at the half-way case, and keeps its own.

## An event's `start` is a timecode OR a number of seconds

`start("5:1")` is musical: bar 5, and where that falls in time depends on the tempo. `start(4.5)` is
4.5 seconds from the top, and no tempo moves it — re-typing `tempo:` slides the grid under it. A
shot that must land on a frame of a picture, or a hit on a moment of a recording, is placed by the
clock; a part that follows the music is placed in bars. One lane holds both, the unit belonging to
each event rather than to the lane.

The spelling is the one a clip window's `from`/`to` already uses, and the one `video_tracks/`
places shots in: a number is seconds, a string a timecode. A `"4.5s"` suffix would have been a
third spelling of the same fact. The conversion is exact because there is one tempo and no tempo
map.

- **Read** through `startBeats`, never `parsePosition(String(start))`: that reads `4.5` as bar 4
  plus five ticks, silently. The functions that address an event by position take the tempo as a
  required argument for that reason, so the compiler names every caller.
- **Written back in its own unit.** A move, a split, a range move or inserted time computes in beats
  and writes through `startAs`, which keeps seconds as seconds, to the millisecond. A musical
  event moved by `event move` keeps the caller's own timecode, as written.
- **Addressed within half a tick.** The timeline names an event by a timecode, which lands on the
  tick grid, and a seconds start does not; `startTolerance` is exact for a timecode and half a tick
  for seconds.

Only `start` takes seconds. Fades, takes, comps and crossfades stay musical, and a pasted copy of
a seconds event lands in bars, since the clipboard carries the event's beats.
