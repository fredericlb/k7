# The eurorack modules (`engine/eurorack/`)

Eight built-ins compiled from Mutable Instruments' open-source firmware: the DSP of their STM32
modules, which is MIT (the notice is in `../LICENSE`). They are built into the engine rather than
hosted as plugins, so they run wherever the engine runs, Android included, with no plugin scan,
no install and no opaque state. Every control is an automatable parameter, which puts every one
of them in the generated table (`builtinParams.md`).

| built-in | module | kind | core rate | block |
|---|---|---|---|---|
| mu-plaits | Plaits | instrument, 8 voices | 48 kHz | 12 |
| mu-braids | Braids | instrument, 8 voices + ADSR | 96 kHz | 24 |
| mu-rings | Rings | instrument, audio in excites it | 48 kHz | 24 |
| mu-elements | Elements | instrument, mono, audio in excites it | 32 kHz | 16 |
| mu-tides | Tides 2 | instrument, 8 voices + ADSR | 62.5 kHz | 8 |
| mu-peaks | Peaks (drums only) | instrument, General MIDI drum map | 48 kHz | 16 |
| mu-clouds | Clouds | audio effect | 32 kHz | 32 |
| mu-warps | Warps | audio effect, sidechain carrier | 96 kHz | 32 |

**Each is named `mu-` and the module's own name**, lowercase: `mu-plaits`, `mu-clouds`. The
prefix says whose firmware it is, and keeps the names off anything a user or another plugin
already calls "Clouds". The engine ref follows the name (`@engine/mu-plaits`); the type ids
(`studio_macro_oscillator_2`…) and the class names predate the rename and are unchanged.

## Which modules, and why not the rest

"All of them" has no meaning past these eight, and each exclusion has one of three causes:

- **No code.** Blades, Blinds, Ears, Kinks, Links, Ripples, Shades, Shelves, Veils and Volts are
  analog. Streams is too, where it matters: its firmware computes CVs for analog VCAs and filters,
  and its audio never goes through the processor.
- **Nothing to plug into.** Stages, Tides (the first), Frames, Yarns, Branches and Peaks' envelopes
  and LFOs make control voltages. The engine routes audio and MIDI, not modulation, so a CV source
  would drive nothing. Tides 2 is here because at audio rate it is an oscillator.
- **A different kind of plugin.** Marbles and Grids generate NOTES: a random sequencer and a drum
  pattern generator. They would be note sources on the transport, like the arpeggiator
  (`arpeggiator.md`), not sound modules, and are not built. Edges is 8-bit AVR code driving timer
  hardware, with no portable DSP.

## The firmware is compiled as its own desktop harnesses compile it

Two pinned archives, the firmware and its `stmlib` submodule at the commit it pins, verified by
SHA-256. Archives rather than git: a shallow clone cannot fetch a commit, and the full history is
hundreds of MB of hardware files. `stmlib` sits in a folder NAMED `stmlib` because every module
includes it as `"stmlib/..."`.

Only the DSP folders are listed in `eurorack/CMakeLists.txt`, never the drivers or UI, and they
are compiled with **`TEST` defined**. That is how each module's own `test/makefile` builds it on a
desktop, and it is what switches the ARM-only paths off (inline assembly, flash access, the CCM
section attributes).

**The cores are JUCE-free by construction, not by taste.** `stmlib.h` redefines `NULL` and defines
`CLIP`, `SLOPE`, `CONSTRAIN` and friends as macros, so a firmware header can never share a
translation unit with JUCE. Each module is split in two: `cores/<Module>Core.{h,cpp}`, where the
header is plain C++ with a pimpl and only the `.cpp` includes the firmware, and a Tracktion plugin
that includes the core's header alone. It also makes every core testable in a fast binary.

### The one upstream bug patched

`patches/eurorack.cmake` runs as the archive's `PATCH_COMMAND`. It is a CMake script rather than a
`.patch` so no `patch` binary is needed on any desktop, and each edit fails the configure when its
text is not found, since a bumped source that moved the code must be looked at.

- **Clouds' stretch mode is silent as published.** `Window::Start` never clears `done_`, which
  `Init` sets, so no WSOLA window ever plays. VCV Rack's fork carries the same one-line fix.

## Fixed rate, fixed block: `RateBridge`

**A core must be called with exactly its block size.** The firmware's envelopes and smoothers
advance once per call and assume the block their module runs: Plaits' decay is computed as
`200 * kBlockSize / kSampleRate` per call, so a 5-sample call is a faster envelope, not a shorter
block. Each core also runs at one rate, which its tables are computed for.

`RateBridge` sits between Tracktion's blocks and the core's. When the rates differ it resamples
either side with libsamplerate: **the copy Tracktion already compiles**, declared in its
`tracktion::src` namespace, which has C++ linkage there. That means no second copy, and a Tracktion
bump that changes that namespace is a link error rather than a silent difference.
`SRC_SINC_MEDIUM_QUALITY`, one converter pair per plugin rather than per voice.

- **A generator is pulled on demand.** It renders exactly enough core blocks to cover the host
  block, so an instrument adds no latency beyond the converter's filter. A note lands at the core
  block boundary after its sample: at most one core block late, 0.25 ms for Braids, 0.5 ms for
  Rings.
- **A processor lags, by an amount measured rather than computed.** At `prepare`, an identity core
  is run through the same plumbing: first to find the worst shortfall over two block patterns, which
  becomes the priming, then with an impulse to find where it comes out. That is what
  `getLatencySeconds` reports, and Tracktion compensates it: a click through Clouds at 48 kHz, fully
  dry, comes back **2 samples** from where it went in.

## Per-module choices

**Levels.** Every polyphonic voice sits at -6 dB, so a chord of full-scale voices has room before
the mixer. Elements is brought down 6 dB because it runs hot into its own soft limiter, and Clouds
is brought UP 6 dB because its codec conversion (`SoftConvert`) halves the level and the module's
output stage makes it back. Its fully dry path is then the equal-power crossfade's -3 dB.

**mu-plaits** plays its low-pass gate from the keyboard. A note-on is the TRIG input, and
`Envelope` decides LEVEL: `gate` patches it with the velocity while the key is held, so the gate
follows the note and releases through `Decay`. `ping` leaves it unpatched, so the gate is struck
and decays whatever the key does. The three envelope depths are the module's attenuverters, fed by
its internal decay as they are when TRIG is patched. A voice that has been silent for 250 ms after
its release is not computed until its next note.

**mu-braids** is an oscillator and nothing else, so each voice gets an ADSR (`Adsr.h`), which
also reaches TIMBRE and COLOR once per block the way the module's AD does. The bit and rate
reduction are the firmware's own, from its render loop, since they are half of its sound.

**mu-rings.** A note sets the pitch and STRUMS, and its voices are its own (1, 2 or 4). A strum
moves to the next voice and lets the last one ring, and with more than one voice odd voices come
out left and even ones right. The strummer ignores a strum within 10 ms of the last, so notes wait
in a queue and leave one per 10.5 ms: a chord is strummed rather than collapsed into one note.
**Its setters re-initialise every resonator** (`set_polyphony` sets `dirty_` unconditionally), so
they are called on change only. Called per block, nothing rings for more than 20 ms.

**mu-elements** is monophonic like the module: last note wins, a new note over a held one
drops the gate for one block so the exciter re-strikes, and releasing it falls back to the
previous held key without one. The firmware seeds its noise from the chip's unique id; a fixed
seed makes a render repeatable.

**mu-clouds.** The module's one BLEND knob switches between four settings; here each of
dry/wet, spread, feedback and reverb is its own parameter. `Prepare()` is called before every
block: the firmware calls it in its main loop, it only does work when the mode or quality changed,
and in stretch mode it advances the correlator's search by a quarter each call. A note fires a
grain (TRIG), and `Follow notes` adds its distance from C4 to the pitch.

**mu-warps** runs at the module's own 96 kHz, although `Modulator::Init` takes a rate: only
part of the code honours it, and the oscillator's pitch table is normalised to 96 kHz, so at the
host's rate every note is off by the rate's ratio. The track's audio is the MODULATOR. The carrier
is the internal oscillator, which notes play, or the sidechain (`sidechain.md`), which is what makes
its vocoder usable on a voice.

**mu-tides** leaves out the module's gates mode, whose outputs are DC gate levels, not audio.
The four outputs are mixed as 1+3 left and 2+4 right.

**mu-peaks** folds the General MIDI drum map onto Peaks' four drums: kick on 35-36, snare on
37-40, hi-hat on 42, 44 and 46, and the FM drum on every other note, so the toms land somewhere.
Each drum takes the module's four "expert mode" parameters; the hi-hat has none on the module.

## What is covered, and what is not

`tests/Eurorack_test.cpp` (`studio_eurorack_tests`, fast, JUCE-free) drives every core directly:
pitch at A4 for each, a string still ringing after half a second, the dry path's level, voice
stealing, and the envelope's time-to-silence.

Not covered by any suite: the plugin layer, meaning the resampling, the MIDI cut, the latency
priming and the sidechain. It needs a live `te::Edit`, which no suite builds. It was measured
through `--render` instead: pitch at 44.1 and 48 kHz host rates, every model and shape producing
sound, the click's round trip, the sidechain vocoder silent without its carrier.

Open:

- **Only the macOS build is verified.** The firmware was written for an embedded GCC. MSVC and the
  Android NDK have not compiled it yet.
- **mu-rings and mu-elements are filed as instruments**, so st0 gives them a MIDI input and
  no audio input port. The engine hands them the track's audio either way: that is how the renders
  above excited them with noise bursts. Whether a chain can wire audio INTO one is st0's port model
  to decide (`packages/song-schema/src/moduleTypes.ts`).
- **CPU.** Not measured per module. Voices are skipped when idle for mu-plaits, and when
  their envelope is done for the other polyphonic cores.
