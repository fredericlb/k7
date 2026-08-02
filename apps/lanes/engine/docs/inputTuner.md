# inputTuner — pitch on the interface's inputs

The I/O panel's second meter is a tuner: nearest note, and how many cents off. This is what feeds it.

## Why a separate audio tap

The level meters read Tracktion's `LevelMeasurer`, which reports dB and nothing else. A tuner needs **samples**,
so `InputTuner` registers its own `juce::AudioIODeviceCallback` on the device manager and reads the raw
interface inputs.

Independent of Tracktion's input routing on purpose: you tune a guitar *before* there is a track to plug it
into, and requiring an armed track to see a note would invert the order people actually work in.

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
