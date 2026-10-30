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
press *means* it is `apps/k7/frontend/src/transportPanic.ts`: a stop within `PANIC_WINDOW_MS` of
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
rate bridge on the audio thread — and, for the three that ring on (Clouds, Rings, Elements), empties
the core through its own `init()`, which lays it out again in buffers it already owns. The other
five allocate in `init()`, and hold nothing a release does not end. `scripts/eurorack-stop.ts` measures it against a running engine:
a note with no note-off in reach, through a stop and then a panic.

The **Faust host** (`FaustPlugin`) holds an instrument's voices in libfaust's voice group, which
only the audio thread may touch either: `midiPanic()` raises a flag and the next block calls
`allNotesOff(false)` — every gate drops, so each voice runs its own envelope's release rather than
being cut. Without it a Faust instrument rings on through every stop until a panic's `reset()`
clears the instance.

## A seek while playing ends the notes AND the tails

A playhead jump sends no note-off for what was sounding at the old position: Tracktion's
`PluginNode` sets `isAllNotesOff` on the block's MIDI buffer instead, and a plugin that reads only
the messages never sees it. `FourOscPlugin` reads it, and so does `FaustPlugin`.

A flag ends notes, not a reverb. So `EngineHost::seek` and `rewind`, when the transport is
PLAYING, call `releaseOnSeek` (`SeekRelease.cpp`): `midiPanic()` then `reset()` — a panic, on a
list of plugins rather than the whole edit. A jump means new material at the new position, and the
old position's tail over it is noise.

- **Only while playing**, because the transport bar's Stop sends stop then rewind: a rewind that
  cleared tails would make every Stop a panic.
- **A list**, because `reset()` means something else on a plugin with no tail. A turntable drops
  its rate and loop, a recorder is free-running, `NamPlugin` re-prepares its network on the message
  thread, and a master's limiter cleared mid-song lets a transient through. On it: Tracktion's
  Reverb, Delay, Impulse Response and 4OSC, and our Faust, DSP graph, SFZ, eurorack, MIDI graph,
  arpeggiator and pattern plugins.
- **External plugins are left out**: what a VST does with a reset is its own business.
- **A eurorack voice is CUT, not released**: Braids, Plaits and Tides allocate in `init()`, so
  `clearCore()` kills their envelopes instead, and a Plaits voice whose gate a seek dropped would
  otherwise ring through its LPG decay for a second.

- **AirWindows effects are not cleared**: Tracktion's wrapper has no `reset()`, and their state
  lives in the effect object it constructs once. A seek leaves their tail ringing.

`scripts/seek-release.ts` measures every case against a running engine.

That is the rule for anything added later: **a MIDI module with state answers `midiPanic()`**, or
the button silences everything downstream of it and nothing in it.

## Both calls arrive on the MESSAGE thread, so neither touches audio state

`te::midiPanic` calls `midiPanic()` and `reset()` on whatever thread calls it, and
`EngineHost::stop` and `EngineHost::panic` run on the message thread while the graph keeps
processing. So every plugin this engine owns answers both by **raising an atomic flag**, and the
next `applyToBuffer` clears the state before it takes in anything of its own block. Clearing it in
place is a data race on every stop: the arpeggiator zeroing its held count while the audio thread
divides by it is an integer division by zero, which is a crash.

The eurorack modules were the first to do it; `ArpeggiatorPlugin`, `MidiGraphPlugin`,
`GraphDspPlugin`, `FaustPlugin`, `TurntablePlugin`, `QuickMasterPlugin` and `MixerPlugin` do the
same, each with a private `clearState()` that only the audio thread calls, and `WaveformTapPlugin`
for its half-filled bucket. `NamPlugin` is the one
exception, and for a reason: its reset re-prepares the network, thousands of samples of inference
that must not land on the audio thread. It stays on the message thread under the lock its
`applyToBuffer` try-locks, so the audio side passes a block through dry rather than meeting a
half-reset model or convolver.

Tracktion also calls `reset()` from `initialise()` when the rate or block size changes; the flag
makes that one land on the first block too, which is where it belongs.

Tracktion's own Reverb, Delay, Impulse Response and 4OSC raise no flag: their `reset()` clears
their buffers in place, which on a seek while playing races the block being rendered — a click, or
garbage in the tail. They are not ours to change, so `releaseOnSeek` resets them holding the audio
device's callback lock (`AudioDeviceManager::getAudioCallbackLock`). The graph renders inside that
callback, so while the lock is held no block runs, and what the message thread waits for is at most
one block plus a few clears. A callback hung inside a plugin would hold it for ever, which is the
hang `docs/hangWatch.md` ends. A stop's or a panic's `te::midiPanic` on those same four is not
covered by this.
