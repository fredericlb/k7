# Looping

A loop is what repairs a mix that has slipped and what stretches an intro that is too short.
Without one there is a single attempt per transition.

## The loop lives in the platter

A deck's tracks carry `clips: []` — since the platter is a node
([platter-node-plan.md](../../../docs/platter-node-plan.md)) there is no clip to loop. The one
clip `clickBar` loops is the **metronome**'s ([metronome.md](metronome.md)).

So the loop is **in the platter**, in C++: two parameters `LoopStart` / `LoopEnd`, as a fraction
of the record like `Seek`, with the wrap in both render paths
([turntable.md](../../../engine/moteur/docs/turntable.md)). That costs more C++ and **less of
everything else**: a loop is a platter gesture like `censor`, `place` and `scratch`, none of
which is in `MIX_CONTROLS`. No module, no binding in `mix.yaml`, no surface migration.

## A length is in BEATS, and the beats are the record's

`beatSeconds` reads `natural`, never `target`. A deck pulled to 174 still loops four beats of its
own 120 grid: it is the record that has a bar, not the fader. The opposite mistake is only
audible once you have pitched — so never while writing it — and a test pins it.

That is also why the buttons are **grey with no measured tempo**: a length in beats on a record
with no grid does not exist. `canLoop` wants the tempo *and* the duration, the edges being a
fraction of the record.

## The order on the wire is the contract

Parameters arrive **one at a time** and the platter re-reads them every block. A two-message
change therefore has an intermediate state, and one of the possible orders **moves the record**:

| gesture | what goes out | why that order |
|---|---|---|
| open | `Roll`, `LoopStart`, `LoopEnd` | `Roll` first because the platter **latches it at engage**; `[newStart, oldEnd]` is `end < start`, so inert |
| resize | `LoopEnd` alone | the loop does not disengage, so a roll's shadow survives it |
| close | `LoopEnd` alone, at zero | with any start that is `end < start`, so OFF — **and a single message cannot be half-applied** |

The trap is the last row. Closing by sending `LoopStart = 0` first would leave `[0, end]` standing
for one block: a loop over the first third of the record, into which the platter would pull the
needle back. It would be heard as a jump to the top of the song, mid-set, one time in two.
`loopParams` is a pure function for that reason, and its order is tested.

## A roll returns the record where it WOULD be

A roll (`⟲`, held) is a momentary loop: on release the record resumes where it would have got to
had it never looped. The platter holds that position — a "shadow" advancing at the true rate while
playback wraps. The desk is not allowed to compute it: that would mean multiplying a wall-clock
time by a rate, which drifts by a few milliseconds and **gives a wrong answer if the fader moves
during the roll**.

And the decision "this is a roll" is **latched at engage**, never re-read on release. Otherwise
two parameters arriving one after the other are enough to turn a roll into a plain loop in
between. `TurntableLoop::aim` is the only place that reads `Roll`, and
`the_roll_decision_is_LATCHED_at_the_engage` is the test that says so.

## Quantise is one switch, for the whole desk

Drawn **once**, under the crossfader: two buttons that would always agree say less than one. It
pulls onto the grid the start of a loop, the start of a manual IN, and the landing of a beat jump.

Onto the **nearest** beat, never the next: a hand is a hair late, and `firstBeatAfter` would skip
a whole beat for that. A record with no grid is not quantised at all — `snapToBeat` then returns
the position as it stands rather than inventing a bar.

## What closes a loop without being asked

- **A cue.** Jumping to a cue while looping would wrap the needle straight back: you would have
  pressed the cue without hearing it. So `jumpCue` closes first.
- **A new record.** The edges are seconds of the record that has just left; on the next one they
  designate nothing.

## What it does not do

- **The seam is not crossfaded.** A wrap is a discontinuity, and on a beat-aligned loop it falls
  on a transient, which masks it — as common hardware does. Off-grid it clicks. A short fade
  either side of the edge would be the answer; it is not written.
- **In KEY, the seam goes through the stretcher.** Elastique holds a buffer spanning the edge, so
  the junction is smoothed rather than sharp. Neither measured nor judged: it cannot be listened
  to from here.
- **A beat jump refuses during a roll.** The roll already owes the record a position; moving it
  would be two answers to one question.
- **The downbeat is assumed 4/4.** As everywhere here, `BEATS_PER_BAR` is a constant
  ([grid.md](grid.md)).
- **Nothing is recorded.** A loop lives for the length of the set. It is not in `mix.yaml`, and
  [grid.md](grid.md)'s test says why that would be arguable both ways: the length is a mix
  decision, but it only means anything together with the place, which is one too.
