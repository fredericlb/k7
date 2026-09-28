# NAM: the amp, not the cabinet (`NamPlugin`)

A Neural Amp Modeler as a Tracktion built-in. It loads a `.nam` model (JSON: architecture
plus weights) and runs its inference over the track's audio.

This is the **non-linear** half of a guitar rig — the preamp and power-amp character, its
saturation, and its response to how hard you play — which convolution cannot give you at
any length: an impulse response is linear by construction, so it models the cabinet and
never the amp. The two chain up:

```
guitar -> nam (the amp) -> impulse-response (the cabinet) -> OUT
```

The model file comes from the project's shared asset library (`_library/nam/`), the same
way an IR does. `EditBuilder` calls `loadModel()` when it builds the plugin, and the loader
resolves the module's `nam:` field against the library.

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
only the second knows both rates. The model is prewarmed there too, at the rate it will run at.

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
