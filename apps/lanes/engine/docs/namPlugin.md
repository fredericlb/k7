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

## Mono, deliberately

Every NAM model is one-in/one-out, so a stereo track is summed to the amp's input and the
result copied to both outputs — which is what a real amp does with a stereo source anyway.
Modelling it as stereo would mean two inferences and twice the CPU for a mono signal path.
