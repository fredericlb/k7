# Doubling a sequence that is LOOPED

`sequence double` makes a sequence twice as long and plays its notes twice
(`packages/song-schema/docs/noteEdits.md` holds that half). This page is the other half: what
happens to the placements, which is where the arrangement is.

A placement states `loop: N` — how many times the material's window is played, back to back — and
the compiled clip's length is `window × N` (`packages/song/src/nodeProject.ts`). Double the window
and leave `N` alone, and every looped placement of that sequence becomes **twice as long**. Four
bars of a one-bar pattern would become eight bars, pushing nothing but overrunning whatever was
written after it.

So the halving is part of the same act: **the window doubles, the passes halve**. Four passes of
one beat become two of two, the same span plays, and the two halves can now differ — which is the
whole reason to press ×2 on a loop.

## What it does NOT touch, and why each one is left

Two placements are left exactly as they were, and each is REPORTED by lane and start rather than
being quietly adjusted — a placement whose length just changed is worth a line.

- **An odd number of passes.** Three passes of one beat is three beats; after doubling there is no
  whole number of two-beat passes that is three beats long. Rounding would be the app choosing
  between a bar too many and a bar too few in somebody's arrangement, so it does neither and says
  the placement is now twice as long.
- **A placement with a window of its own.** `from`/`to` on the event intersect the material's
  (`nodeProject.ts`), so an event that states either did not grow when the sequence did — its
  window is still what it was, and halving its passes would halve what plays.

A placement with no `loop` is not touched either, and needs no line: one pass of a doubled pattern
is exactly what ×2 means when nothing repeats.

## Every list, and the default is written by not writing it

The walk is `everyEventList` — the lane's own events and every ALTERNATIVE's — for the reason
`spliceTime` uses it: a placement in an alternative is a placement, and one missed there is a lane
that plays differently the day it is selected.

Halving 2 to 1 **deletes the key** rather than writing `loop: 1`. One pass is the default, and
every writer in this codebase deletes rather than writes a default, so a file that never mentioned
looping does not acquire the word on its way back through.

The lane is snapshotted before it is overwritten, through a callback the caller hands in, so one
press of ×2 is one Ctrl+Z across the sequence file and every lane it reached.
