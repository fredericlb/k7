# An audio event's own gain

`gain:` on a placement is that event's trim in dB, −6 to +6, absent at unity. `src/eventGain.ts`
writes it; `event gain <track> <at> <dB>` is the verb, and the audio clip panel's header slider is
the gesture that sends it.

## Why the event, and why so little range

What this is for is BALANCE between events on one lane: a take that came in hotter than the others,
a sample a little quiet next to its neighbours. The lane's fader moves them all and is the wrong
tool for that, and a module per event would be a chain per event. **±6 dB** is a trim, not a fader:
an event that needs more than that needs re-recording or the lane's own level, and a wider range
would make the slider coarse exactly where it is used.

It is **rounded to a tenth of a dB**, since every pixel of a slider is not a level anyone chose, and
**deleted at 0**, which is unity — the house rule that a default is written by not writing it.

## Audio only

The compile turns it into the clip's `gainDb`, which the engine applies on the clip itself
(`setGainDB`), so the event's fades and loop are under the same level and the lane's chain comes
after it. A **MIDI event has none**: every event of a lane plays through the lane's one instrument,
so there is no signal that is one event's alone to turn up. Scaling its notes' velocities would be a
different thing called by the same name — how loud a velocity sounds is the instrument's to decide —
so the verb refuses a MIDI event and the compile refuses a `gain:` written on one by hand, rather
than ignoring it.

## A change re-inserts the clip

The engine diffs documents, and a clip's gain is set when the clip is built, like its fades: a new
value re-inserts that one clip (`engine/k7-runtime/engine/ProjectDiff.cpp`'s `clipMoved`). The
slider therefore commits once, on release, rather than streaming every value it passes through.
