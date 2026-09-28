# Stopping, and the stop that did not work

Two gestures, one flag apart.

## Every stop lets go of the notes

Stopping the transport stops **feeding** the graph, which is not the same as ending what is already
in it. A note-on delivered a block before the stop has no note-off coming — nothing will ever send
one — so the chord hangs, and on a soft pad or an organ it hangs until something else happens to it.

So `EngineHost::stop` calls `midiPanic(edit, false)` after the transport stops: Tracktion walks
every plugin in the edit and calls `Plugin::midiPanic()` on it. `false` is the whole difference
below.

## Pressing stop AGAIN is a panic

`EngineHost::panic` is the same call with `resetPlugins = true`, which additionally calls
`reset()` on every plugin. That is what kills a reverb tail and re-seats a plugin whose own state is
stuck — the things a stop deliberately does NOT do, because a stop that killed your tails would be
unusable and you would stop pressing it.

**The gesture is the UI's, the action is the engine's.** `panic` is a `TransportAction` on the wire
like any other, so a CLI, a second device or the DJ desk can send it. What decides that a second
press *means* it is `apps/st0/frontend/src/transportPanic.ts`: a stop within `PANIC_WINDOW_MS` of
the last one is promoted. It sits at the app's single transport callback rather than on the stop
BUTTON, because the button, the key and the command bar are one gesture to a musician and a rule on
one of them would be a rule a third of the time.

A verb that can start sound in between ends it — stop, play, stop is two stops. A rewind does not:
the transport bar's Stop button sends stop then rewind on every click, and a rewind that ended the
gesture would make the button the one place a double-click never panics. And a third press inside the
window panics again: a panic is idempotent, and somebody pressing a third time is not asking for
less.

## The plugins that have to answer it themselves

`Plugin::midiPanic()` is a no-op on the base class. Tracktion's own overrides cover the common
case — `ExternalPlugin` sends all-notes-off to the VST, `FourOscPlugin` drops its voices — so a
plain instrument track is handled with nothing written here.

Ours are not, and two of them **hold notes of their own**:

- **`ArpeggiatorPlugin`** holds the chord. A panic that reached only the instrument would leave it
  playing the same notes at it again on the very next block, which is a panic that made no
  difference.
- **`MidiGraphPlugin`** holds whatever its graph does — `mhold`'s keys and `mstrike`'s clock
  (`midiGraph.md`). `DspGraph::reset()` drops both.

The **eurorack modules** (`eurorack/EurorackPlugin`) hold their voices in a firmware core that
only the audio thread may touch, and `midiPanic()` arrives on the message thread. So it raises a
flag, and the next block hands the module an All-Notes-Off through `handleMidi` — the path the
MIDI message itself takes, so each of the eight lets go the way its core already answers one: the
voices go to their release, never cut. `reset()` is a flag for the same reason, and resets the
rate bridge on the audio thread. `scripts/eurorack-stop.ts` measures it against a running engine:
a note with no note-off in reach, through a stop and then a panic.

That is the rule for anything added later: **a MIDI module with state answers `midiPanic()`**, or
the button silences everything downstream of it and nothing in it.
