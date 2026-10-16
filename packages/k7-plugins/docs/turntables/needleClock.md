# The drawn needle — a deck's position between two engine frames

A deck's clock is its platter's needle, reported in seconds of the record about **20 times a
second** (`Deck.platters`, `engine/k7-runtime/docs/turntable.md`), each frame landing after a different
transit. The band and the record's wedge redraw at 60 fps. Drawn verbatim, the needle moves on one
frame in three and the band steps with the network's jitter.

So what is DRAWN is the needle steered by a clock (`src/turntables/needleClock.ts`, held per deck
by `src/turntables/useDrawnNeedles.ts`), and what is WRITTEN DOWN — a cue, a shove, a loop's in
point, the sync's alignment — stays the raw needle. `DeckSet` hands out both, per deck and with
stable identities: `rawNeedle` and `drawnNeedle`.

## It is the transport's clock, given a rate

The estimator is `@studio/engine-browser/playhead-clock`, the one k7's timeline draws its playhead
with (`apps/k7/frontend/docs/playhead.md`): the rate is KNOWN, so the only unknown is the offset
between the engine's clock and this one, and the least-delayed frame of a recent window is the
best measure of it. The transport runs at one second per second; a platter runs at the `Rate` the
desk sent it (`platterRate`: the deck's tempo over its record's own, 0 when stopped). The clock
takes that rate as an input and re-bases itself when it changes, so a pitch fader moves the
needle's speed without moving where it is drawn.

## When it does not extrapolate

The clock draws the raw needle, unsteered, whenever the rate is not something the desk knows:

- **Rate 0** — the deck is stopped.
- **A hand on the record**, or a censor: the rate is the hand's, changing faster than a frame
  reports it.
- **A needle that has not moved for `STALL_MS`**, whatever its rate: a deck just started that the
  engine has not answered yet, or a record that ran out. Predicting there would draw a needle
  running ahead of a platter that is standing still.

## A jump snaps; anything smaller slides

A frame further than `NEEDLE_SEEK_EPS` from the estimate is a jump — a cue, a beat jump, a loop
that closed — and the clock is re-seeded from it. That threshold is tighter than the transport's
because a deck's jumps are short: a one-beat jump is under half a second. Under it a frame is
evidence about the offset, and the drawn offset chases the estimate slowly enough to stay
monotonic.

## A loop is folded, not seeked

A loop wraps the needle back every turn, and a short roll wraps several times a second. Read as
seeks, each wrap would re-seed the clock and the band would stutter worst exactly where a DJ is
watching it. So while a loop runs the clock lives on an UNWRAPPED axis: a raw needle inside the
loop is moved by whole turns to the one nearest the prediction (`unwrapNear`), and what is drawn is
folded back inside the loop (`foldIntoLoop`). A loop that opens or closes re-bases the axis so the
drawn position does not move.

## Read on demand, from the frames that draw

There is no subscription: the views' animation frames ask, and the clock sees a new needle when it
reads one. A frame is therefore noticed up to one animation frame after it lands, which adds to its
transit and is absorbed the same way. Two readers in one frame — the band and the wedge — advance
it by a zero delta.
