# Taking the record by hand

Grab the vinyl and turn it: the record follows the finger, the audio follows the record, and
going backwards is just a sign. This is what the platter exists for.

## What a hand gives is a SPEED

Not a position. A DJ does not say "go to 1:42", they push or hold back. The gesture therefore
measures the pointer's angle around the centre and derives an angular velocity, converted into a
rate by the one constant that matters: **a turn is `TURN_SECONDS` of record at rate 1**. One turn
per second IS a rate of 1.8.

Two details the geometry punishes:

- **Crossing π.** Without `shortest`, every time the pointer crosses the axis the angle
  difference jumps by 2π and the record bolts off the wrong way.
- **The bound.** ±4, the plugin's. Past that it is not a pitch, it is noise.

## The record follows the FINGER, not the integrated speed

While the hand holds, the drawing sits on the pointer's angle — not on the smoothed velocity that
animates the record the rest of the time. That is the difference between direct manipulation and
an animation trying to catch up: a held record does not coast, it is where the hand is. `held`
carries that state, and hands rotation back to its integration on release.

## Releasing gives the record back, it does not stop it

`onScratch(null)` — and `null` is not `0`. Zero would mean "stop", which is not what a hand
letting go does: it returns the record to what it was doing. The desk therefore sends the rate
the DOCUMENT would have sent, `platterRate(tempo, running)` — playback speed if the deck is
turning, 0 if it is stopped.

## The hand wins over KEY

A deck in keylock still scratches, and the record **changes pitch** while it is held. Not a
concession: it is the sound of the gesture, and no turntable does otherwise.

The platter carries a `Key` parameter, and the desk switches it off while a hand holds the
record, back on when it lets go. One rule, `platterKey(tempo, holding)`, written once and read by
the DOCUMENT as by the gesture — a document being, by definition, what the deck does when nobody
touches it.

Two details that carry:

- **Two messages per gesture, not sixty a second.** `scratching` remembers who is held, so `Key`
  only leaves on the two transitions. A parameter is a level, so resending it would cost nothing
  wrong — but sixty useless messages a second would.
- **The stretcher does not go backwards**, which is precisely half a scratch. The engine falls
  back to resampling outside its range on its own (`engine/k7-runtime/docs/turntable.md`), so the
  desk's rule and the plugin's say the same thing by two routes.

## The rate to the engine is throttled

One `pointermove` per mouse movement is 500 to 1000 a second on a modern mouse, each one a
`set-plugin-param`: a WebSocket frame, a JSON parse and a `post` on the engine's message thread,
while an ASIO callback has to be served every few milliseconds. `scratchDelay` brings that down
to one send every 16 ms, roughly sixteen out of a thousand.

Three properties, each with its reason:

- **The first movement passes immediately.** A gesture that starts one frame late sounds like a
  stuck record.
- **What arrives too early waits out the REST of the interval**, not a fixed delay, and it is the
  most recent value that leaves — the hand keeps its cadence instead of drifting a frame per
  movement, and its latest position wins.
- **The release never goes through the queue.** Delayed by a single frame, it would keep
  scratching after the hand has left the record. It also flushes what was waiting, or a stale
  value would leave again right behind it.

16 ms is far below what a mouse produces and far above what an ear resolves on a hand gesture.
The BPM fader beside it is throttled ten times harder (120 ms), a cautious figure rather than a
measured one ([bpm.md](bpm.md)).

**Why this matters beyond comfort.** Drowning the message thread while ASIO waits is exactly the
kind of load that makes an audio driver more likely to hit its own assertion — this machine has
taken `KMODE_EXCEPTION_NOT_HANDLED` bugchecks inside `FocusriteUsb.sys` with `k7-runtime` as the
current process — and that rate served nobody.

## What offers it, and what does not

The gesture is **absent** — not inert — on a deck with no platter:

| | scratchable? |
|---|---|
| a record on it, KEY on or off, split or not | yes |
| empty deck | no |

A **split** record scratches like any other: its four parts are four platters sharing one
position, and `plattersOf` names them all. The hand drags them together.

The grooves take the hand; **the label keeps its click**, being a separate element above. Picking
a track and scratching therefore never fight over the same pixel.

## What it is worth, measured

The platter was measured on a bench built for it — a constant tone is an exact tachometer under a
varispeed:

| | RMS error on the rate |
|---|---|
| bench floor | 0.000 × |
| slow gesture | 0.029 × |
| fast gesture (±2, twice a second) | 0.188 × |

The error **falls as the gesture slows**, which is the signature of the analysis window and not
of a limit in the mechanism. Numbers and method are in `engine/k7-runtime/docs/turntable.md`.

The delay between hand and audio is **a block boundary, nothing more**: median 2.2 ms for a block
of 5.3, with a spread of exactly one block — the shape that says neither the socket, nor the
engine's queue, nor the sliding adds anything. `turntable-latency.ts`, detail in
`engine/k7-runtime/docs/turntable.md`.

**What stays unverified is the listening.** That the audio is where the hand put it is measured;
that it sounds like a scratch is not, and cannot be here.
