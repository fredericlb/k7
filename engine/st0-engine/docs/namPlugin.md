# The neural amp: the amp, not the cabinet (`NamPlugin`)

A neural amp as a Tracktion built-in. It loads a model — a `.nam` (Neural Amp Modeler), or an
AIDA-X or Proteus `.json` run by RTNeural (below) — and runs its inference over the track's audio.

This is the **non-linear** half of a guitar rig — the preamp and power-amp character, its
saturation, and its response to how hard you play — which convolution cannot give you at
any length: an impulse response is linear by construction, so it models the cabinet and
never the amp. The two chain up:

```
guitar -> nam (the amp) -> impulse-response (the cabinet) -> OUT
```

The model file is named by the module's `model:` param: one it carries in its `assets/`, or one
of a library's shared `models/` as `@<library>/<path>` (`packages/song/docs/libraryFiles.md`). `EditBuilder` calls `loadModel()` when it builds the plugin.

## Levels: `Normalize`, `Input`, `Output`

A model is trained at whatever level its author played at, and a `.nam` file records that
level in its `metadata.loudness`. Nothing forces two models to agree, and they don't:
`Two-Rock_Studio Overdrive_SM7b_All Flat_Overdrive.nam` declares **-24.65 dB**, and played
back untouched it lands 6.6 dB below where a model at the reference level would. What that
sounds like is "the plugin does nothing" — a level drop is easy to mistake for a plugin
that failed to load, especially on an amp sim, which is *supposed* to change the sound.

So the plugin exposes three parameters, all ordinary automatable ones:

| Name | Range | Default | |
|---|---|---|---|
| `Input` | ±20 dB | 0 | before the model — a **drive** control, since how hard you hit a modelled amp is half its sound |
| `Output` | ±20 dB | 0 | after the model — pure make-up gain |
| `Normalize` | off / on | **on** | levels the model to `targetLoudnessDb` (-18 dB) using its declared loudness |

`Normalize` is on by default because "every profile arbitrarily quiet, differently" is the
bug it exists to fix; with it on, swapping one model for another stops being a volume
change. -18 dB is the figure the official NAM plugin normalizes to, chosen so a profile
that sat right there sits right here.

A model that declares **no** loudness (older files, or a trainer that skipped the
measurement) gives `Normalize` nothing to work from, and its output stays wherever it was
trained. `EditBuilder` warns in that case — but only when `Normalize` is on, since a module
that turned it off has already said it doesn't care.

Both gains are folded into one ramp per block, applied to the mono buffer: they are knobs,
and `Normalize` in particular is a several-dB step the moment you toggle it, so a gain that
jumped between blocks would click.

## A model runs at the rate it was trained at

A NAM model is a recurrent filter clocked per SAMPLE: run at another rate, every delay inside it is
another length of time, and it is another amp. Not subtly — `scripts/nam-rate.ts` renders one
sawtooth through one 48 kHz model at 48 and at 44.1 kHz, and the harmonic profile moves by
**2.9 dB on average and 13 dB at worst**. Most models are trained at 48 kHz and the machine's own
speakers commonly run at 44.1, so this is the ordinary case rather than an edge.

So the plugin converts: the engine's rate down to the model's, the model run in fixed blocks of 32 at
its own rate, and back up. The converter is eurorack's `RateBridge` — the same Tracktion copy of
libsamplerate, the same FIFOs, the same measured latency — because the problem is the same one: a
core that must run at one rate inside a host at another. Measured by the same harness afterwards:
**0.04 dB** mean at 44.1 kHz, 0.01 dB at 88.2 and 96. When the rates agree the bridge is idle and the
model is run straight on the host's blocks, exactly as before.

What it costs is latency: **130 samples, 2.95 ms** for a 48 kHz model on a 44.1 kHz engine, logged
as `[nam] … +130 samples` when the bridge is prepared. The plugin REPORTS it (`getLatencySeconds`), so
playback is compensated and the lane stays in time; what it adds to is live MONITORING through the
amp, and only on a device not at the model's rate. Setting the interface to 48 kHz removes it.

The bridge is prepared on the MESSAGE thread, under the lock the audio thread only ever tries, both
when a model loads and when the engine initialises the plugin — they arrive in either order, and
only the second knows both rates.

A LOADED model is prewarmed before it is swapped in, at the rate it will run at, while nothing but
the loader can see it: the prewarm is thousands of samples of inference, and under the lock the
audio thread would pass the guitar through dry for all of it. The lock covers the pointer swap and
the bridge's buffers, and the old model is freed after it is released. An `initialise` that changes
the rate has no such luck — it must re-prepare the model that is playing — so that one prewarm
stays under the lock, as does a panic's (`docs/panic.md`).

## A cabinet IR after the model

A NAM capture is often the amp alone, and an amp without a cabinet is a fizz no speaker ever made.
So the module convolves an IR after its model when the document names one (`irFile`, from the
module's `ir:` param — a file in a library's `irs/`, `packages/song/docs/libraryFiles.md`), the
way the official NAM plugin does. It runs at the ENGINE's rate, after the rate bridge: JUCE's
`Convolution` resamples the IR to that rate when it loads, so a 44.1 kHz IR and a 48 kHz model mix
without either being told.

The IR is loaded mono like the model, trimmed of its leading silence, and **normalised**: a cabinet
is its shape, not its level, and two IRs recorded at different gains would otherwise make swapping
one for the other a volume change — the problem `Normalize` already solves for the model. Loading
happens off the audio thread (JUCE's own background loader), and the stage is skipped entirely until
an IR is there.

`scripts/nam-ir.ts` checks what reaches the sound: a sawtooth through the model with and without
the IR, and the change at each harmonic against the IR's own frequency response there. They agree
to 0.01 dB — the cabinet heard is the one named, not merely some filter.

Picking another model or another IR is a REPLACE in the diff (`projectDiff.md`), since both are
loaded when the plugin is created.

## Mono, deliberately

Every NAM model is one-in/one-out, so a stereo track is summed to the amp's input and the
result copied to both outputs — which is what a real amp does with a stereo source anyway.
Modelling it as stereo would mean two inferences and twice the CPU for a mono signal path.

## Two kinds of model, one plugin

A `.nam` is one setting of one amp. What it lacks is KNOBS: turning a captured amp's gain means
another capture. AIDA-X and GuitarML's Proteus train small recurrent nets (one LSTM or GRU layer
and a dense output) with the knob positions as extra INPUTS beside the sound, so a knob moves the
amp the way the real one moves. Those nets are run by **RTNeural** (BSD-3).

They are the same plugin, not a second one. Everything around the model — the rate bridge, the
cabinet, the trims, the swap the audio thread never waits on — is the same job, and a second plugin
would be a second copy of it to keep in step. `AmpModel.h` is the seam: `NamModel.cpp` holds the
NAM half, `RtNeuralModel.cpp` the RTNeural half, and `loadAmpModel` picks by the FILE — `.nam` for
NAM, any other JSON tried as RTNeural, which tells AIDA-X (`in_shape` + `layers`) from Proteus
(`model_data` + `state_dict`) by their keys. The plugin keeps its type id and the wire keeps
`namFile`, so no project and no protocol changed for it; a module names either kind with the one
`model:` param.

### The knobs

`Knob 1`, `Knob 2`, `Knob 3`, 0..1, default 0.5. Generic names, because what a knob does is the
model's: one is trained with gain, another with gain and tone. ONE module serves every model: its
panel carries the three knobs and its `widgets.js` hides those the loaded model lacks, from the
count the file service reads off the file (`packages/song/src/ampModel.ts`,
`packages/ui-chains-react/docs/lcdScreen.md`). A module forked per model is only for naming its
knobs, which neither format declares. They are fixed
because a Tracktion plugin's parameters are fixed when it is created; a model reads the first
`inputs − 1` of them, in the order it was trained with, and a `.nam` or a knobless model ignores all
three. Three is the most AIDA-X's trainer produces plus one.

A knob GLIDES to where it is set, one pole per sample, 10 ms: the net reads it every sample, and a
step on a recurrent net is a click. The glide is per sample rather than per block so it is the same
through the bridge's 32-sample blocks as through the host's.

### The formats, as read

Written from the files and their documentation, not from AIDA-X's or Proteus's own code: both
plugins are GPL-3, and this engine is not.

| | AIDA-X (Keras export) | Proteus (PyTorch `state_dict`) |
|---|---|---|
| inputs | last of `in_shape` | `model_data.input_size` |
| net | RTNeural's own Keras JSON | `rec.` (one LSTM or GRU layer), `lin.` (dense) |
| skip (output = net + input) | `in_skip`, default off | `model_data.skip`, default ON |
| gains | `in_gain`, `out_gain` in dB | none |
| rate | `metadata.samplerate` (a string), else 48 kHz | `sample_rate`, else 44.1 kHz |

With a skip, `out_gain` is NOT applied: AIDA-X applies it only without one, and a model should sound
here as its author heard it there. Proteus models are refused above one layer; Proteus itself plays
none.

### Compiled shapes, and the rest

RTNeural runs a net either as a `ModelT` whose shape is a template, unrolled and with fixed-size
Eigen, or as a generic `Model` built at load. The compiled shapes are the ones AIDA-X's trainer
offers — LSTM or GRU, hidden 8 to 64, one to four inputs — and anything else runs generic, which
the log says (`… (generic)`). Measured here (Apple Silicon, one core, 48 kHz): LSTM 12 0.5 %,
LSTM 40 1.3 % with or without knobs, GRU 20 0.5 %, a generic LSTM 48 1.8 %. Cheaper than a
standard WaveNet `.nam`.

It is fetched pinned to a commit (there are no tags) and never built: its headers are compiled
with the engine's Eigen, as NAM's are. It bundles nlohmann/json 3.11.1 behind the same include
guard as ours; `RtNeuralModel.cpp` includes ours first, so one copy exists.

A fresh net is run on 4096 samples of silence before it is heard, as NAM's `Reset` prewarms: its
state starts at zero, and the bias alone moves it.

### No loudness

Neither format declares the output loudness a `.nam` records, so `Normalize` has nothing to level
them to and leaves them at their trained level, and EditBuilder does not warn about it — the
warning is for a `.nam` missing what it should carry. The trims are how such a model is levelled.

### What proves it

- `tests/AmpModel_test.cpp`, a fast binary: tiny models with random weights, against outputs
  computed by `tests/data/ampmodel/gen_fixtures.py` from PyTorch's and Keras's cell equations —
  written apart from RTNeural, so a weight layout read wrong fails. Both formats, a knob, a skip,
  the gains, a shape that is not compiled in, a refused file.
- A real AIDA-X model (an LSTM 12) against the input and output batch it carries: an
  error-to-signal ratio of 9·10⁻⁸.
- `scripts/amp-knobs.ts`: a knob at 0 and at 1 through the whole plugin, at the model's rate and
  through the bridge. A render is deterministic, so any difference is the knob; the fixture's one
  knob moves its harmonics by 0.08 dB, and its absent second knob by exactly 0.
- `scripts/nam-rate.ts` takes a `.json` as it takes a `.nam`: the same AIDA-X model at 44.1 kHz
  matches its 48 kHz self to 0.00 dB.
