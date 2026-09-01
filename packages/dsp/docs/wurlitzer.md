# The Wurlitzer: where its numbers come from, and what is missing to hear it

`modules/instruments/synth/wurlitzer/` is a Faust module — `plugin: {type: faust}` and a
`dsp.dsp`. This page is its provenance: there is **no** Wurlitzer in Faust in the official
distribution, so it is a port, and everything below is checkable line by line against the source
it came from.

## A port, not a transcription

The Faust distribution's `examples/physicalModeling/faust-stk/` — Romain Michon's Faust-STK, where
such a model would live if it existed — holds twenty instruments and **no electric piano**:
`piano.dsp`, `piano1.dsp` and `harpsi.dsp` are the only keyboards. Nothing in `synths.lib` either,
which has a DX7 emulation but no Wurlitzer.

The **Synthesis ToolKit** from CCRMA does have a `stk::Wurley` class, in C++: "two simple FM pairs
summed, also known as TX81Z algorithm 5". That is where this module comes from.

## The correspondence table

Everything comes from `Wurley.cpp` (constructor, `noteOn`, `tick`) and from `FM.cpp` for the gain
table and the two-zero.

| STK | here | value |
|---|---|---|
| `setRatio(0, 1.0)` | pair A carrier | `freq` |
| `setRatio(1, 4.0)` | pair A modulator | `freq * 4` |
| `setRatio(2, -510.0)` | pair B carrier | **510 Hz fixed** |
| `setRatio(3, -510.0)` | pair B modulator | **510 Hz fixed** |
| `fmGains_[i]` | `fmGain(i)` | `0.933033 ^ (99 - i)` |
| `adsr_[0..1]->setAllTimes` | `e0`, `e1` | `0.001, 1.50, 0.0, 0.04` |
| `adsr_[2]->setAllTimes` | `e2` | `0.001, 0.25, 0.0, 0.04` |
| `adsr_[3]->setAllTimes` | `e3` | `0.001, 0.15, 0.0, 0.04` |
| `twozero_.setGain(2.0)`, `setB2(-1)` | `tz` | `2·(x − x[n−2])` |
| `vibrato_.setFrequency(8.0)` | `vib` | 8 Hz |
| `control1_`, `control2_` | `Index`, `Tine` | 1 at rest, range 0–2 |
| `lastFrame_[0] = temp * 2.0` | `out` | ×2 |

A **negative** ratio in STK does not mean "backwards": it means an absolute frequency in Hz
instead of a multiple of the note. That is why pair B does not transpose, and it is the heart of
the sound — the hammer noise on the reed belongs to the mechanism, not to the note played. A port
reading `-510` as a ratio makes an instrument that sounds right in the bass and wrong everywhere
else, with nothing to flag it.

## `pm` is taken, and nothing says so before a compiler does

`pm` is the alias for `physmodels.lib` in `stdfaust.lib`, and Faust refuses a redefinition:

```
stdfaust.lib:30 ERROR : redefinition of symbols are not allowed : pm
```

Defining `phasemod` under that name therefore survives writing, review, commit, the push into the
account's library and the display in the builder **without ever compiling once**. That is exactly
what "the engine has no compiler" costs. The `stdfaust.lib` aliases occupy some thirty names, all
two or three letters, so a local helper must be named longer.

## It exceeds 0 dBFS on one note, and that is STK

Measured: a note at velocity 100 peaks at **1.027**. Above unity, so clipped unless something
attenuates it before the output — and at velocity 127 it will be more.

That is not a porting error: `Wurley::tick` ends on `lastFrame_[0] = temp * 2.0`, and that factor
of two is carried over as is. STK is a research library, not a console strip; level there is the
caller's business. Lowering the factor here would diverge the model from its source for a mixing
reason, which is exactly what the node's mixer is for.

## The three accepted departures

1. **`waves_[3]` uses `fwavblnk.raw` in STK, a sine here.** That is a wavetable shipped with STK;
   it cannot be embedded in a source file, and a module is a folder you copy. The attack is
   therefore slightly cleaner than the original's.
2. **`gains_[2]` is `fmGains_[92]` in the constructor and `fmGains_[82]` in `noteOn`.** `noteOn`
   always runs, so [82] is the effective value and it is the one here. The constructor's [92] is
   never heard — that is a reading, not a choice.
3. **The vibrato is at zero at rest.** STK's `modDepth_` is zero until a controller opens it, so
   `Wurley` does not vibrate either until asked. The knob is there so that you can, not so that it
   does.

## What is missing to hear it — two things, not one

**The compiler.** `FaustPlugin` receives the source and passes audio through unchanged;
`engine/st0-engine/docs/faust.md` holds the three ways of filling it in and what each costs.

**The INSTRUMENT seam**, which does not exist at all and which this module is the first to want.
The Faust seam laid so far is an effect's: audio in, audio out, and the plugin is catalogued with
the role `audioEffect`. An instrument wants three more things:

- `takesMidiInput()` true, and the note stream read in `applyToBuffer` — Tracktion's render
  context carries it already, and none of our built-in plugins reads it;
- `producesAudioWhenNoAudioInput()` true, without which nothing runs on a track with no input;
- a **voice allocator**. It is what fills `freq`, `gain` and `gate` — the three names `dsp.dsp`
  declares and that the module's `params:` deliberately leaves out. Faust provides one
  (`mydsp_poly`), but it comes with the compiler: with no compiler there are no voices to
  allocate.

The third is why none of this is written ahead: it cannot be tested. Speculative MIDI code against
a class that compiles nothing will look right until the day it is exercised. So the module is
written in the convention `mydsp_poly` expects — the decidable part — and the rest waits for the
compiler.

## Sources

- [stk::Wurley](https://ccrma.stanford.edu/software/stk/classstk_1_1Wurley.html) — the class and its algorithm
- [Wurley.cpp](https://github.com/thestk/stk/blob/master/src/Wurley.cpp) — the numbers in the table above
- [faust-stk](https://github.com/grame-cncm/faust/tree/master-dev/examples/physicalModeling/faust-stk) — the folder it is not in
- [Faust-STK, Michon & Smith, DAFx-11](https://ccrma.stanford.edu/~rmichon/publications/doc/DAFx11-Faust-STK.pdf) — what that collection covers
- [envelopes.lib](https://faustlibraries.grame.fr/libs/envelopes/) and [oscillators.lib](https://faustlibraries.grame.fr/libs/oscillators/) — the signatures used
