# inputTuner — pitch and level on the interface's inputs

The I/O panel's second meter is a tuner: nearest note, and how many cents off. This is what feeds it — and,
since `channelLevelsDb` moved here, the input LEVELS beside it.

## Why a separate audio tap

A tuner needs **samples**, and Tracktion's `LevelMeasurer` reports dB and nothing else, so `InputTuner`
registers its own `juce::AudioIODeviceCallback` on the device manager and reads the raw interface inputs.

Independent of Tracktion's input routing on purpose: you tune a guitar *before* there is a track to plug it
into, and requiring an armed track to see a note would invert the order people actually work in.

**The level meters now take the same tap, for a stronger version of the same argument.** They used to read
`WaveInputDevice::levelMeasurer`, and a device only measures anything once it is ENABLED and has an INSTANCE on
a playback context. Obtaining either is not a small thing: `setEnabled` rebuilds the entire wave-device list —
destroying every `WaveInputDevice`, reloading every context's devices and restarting playback on every Edit —
and `addWaveInputDeviceInstance` reallocates that context's graph. The I/O picker polls at 8 Hz for every input
on the rig, so it was asking for that twenty times a second. Doing it once per device instead of once per poll
is not enough either: one batch of twenty is already too much.

Reading the tap costs a max over the block, touches no Edit, and measures every channel the interface delivers
whether or not anything is routed to it — which is what the panel is FOR. You are looking for which input the
guitar is on.

### A repeated channel used to build an empty ring

`watch()` rebuilds its map of channel → ring, moving each surviving ring across rather than restarting its
history. A channel asked for **twice** broke that: the second take found the key still in the old map with its
ring already moved from, and carried that across — a `Ring` whose `data` is empty. The audio thread then wrote
`ring.data[ring.write]` and took `% ring.data.size()` on it: an out-of-bounds write and an integer divide by
zero, every block, on the audio thread.

The callers repeat themselves and are right to. The I/O panel asks about channel 1 alone *and* about the pair
1+2, and `channelPitches` passes the first channel of each set — so `[1,2,3,4,1,3]` is the normal shape of that
list, not a malformed one. `watch()` takes each channel once, and the audio thread skips an empty ring anyway,
because the cost of being wrong there is not a wrong reading but a dead engine.

### The trap in being a second callback

`AudioDeviceManager` gives the **first** callback the real output buffer and every later one an
**uninitialised** temp buffer, whose contents it then ADDS into the real output
(`juce_AudioDeviceManager.cpp`, around the `callbacks.size()` loop). A callback that ignores its output
therefore feeds uninitialised memory to the speakers.

`InputTuner` clears its output buffers first thing every block, before any early return. That is correct in
either position, so it does not depend on registration order.

## The estimator

`detectPitch` is the cumulative-mean-normalised difference function (YIN), not plain autocorrelation. On a
plucked string the first harmonic correlates about as strongly as the fundamental, so autocorrelation reports
the octave below often enough to be useless. YIN's normalisation is what suppresses that.

- **Decimated to ~12 kHz.** The band searched is 30–700 Hz (a 5-string bass's low B to a guitar's 12th-fret high
  E), so the native rate is pure cost. No anti-alias filter: an aliased partial lands somewhere unrelated and
  does not survive the dip test, while the fundamental is far below the new Nyquist.
- **2048-sample window**, ~170 ms at that rate — long enough to resolve the lowest note, short enough to follow
  a peg being turned.
- **Parabolic interpolation** around the minimum. Without it the reading quantises to whole samples, which near
  the top of the range is ~40 cents — useless for the one job a tuner has.

Measured against synthesised strings (fundamental plus decaying harmonics plus noise): every guitar and bass
string within 1 cent, a deliberately sharp A within 3.

## Three gates, and why each exists

A tuner's failure mode is showing a *wrong* note, which is worse than showing none. Each of these was added
against an observed false reading, not defensively:

1. **Silence gate** — RMS below ≈ −40 dBFS reports nothing. Not silence in the absolute sense but "nobody is
   playing": an open preamp on an unplugged input sits well above true zero, and at −56 dBFS its hiss resolved
   to a confident 308 Hz on a dead channel. A plucked string is −20 dBFS or louder, so the gate costs nothing.
2. **Priming** — a ring buffer that has not been round once still holds startup zeros, and the join between
   those zeros and the first real audio is a step the difference function reads as a period. Observed: a
   confident 31.8 Hz on an input metering −100 dB, on the first poll after opening the panel.
3. **Confirmation** — a reading is reported only once two consecutive polls agree within 3%. Nothing else
   separates a real note from a lucky window: both can be loud and periodic, but only the real one is still
   there 100 ms later.

With all three, 60 consecutive polls of four silent inputs produce no note at all.

## On the wire

The estimates ride the existing `io-levels` reply (`pitches`, `clarity`) rather than taking a command of their
own — it is the same panel asking about the same channels, and a second command would have doubled its round
trips. The tap attaches on the first request and follows the channel sets asked for, so an engine nobody is
tuning through never adds an audio callback at all.

**Hz only.** Naming the note and computing cents is presentation and lives in `IoPanel.tsx` (`noteOf`), which is
where a wrong note would be born and where the tests for it are.
