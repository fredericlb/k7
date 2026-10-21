# Plugins and the k7-core catalogue

Every module ends up running a **plugin** inside the engine. This page lists what the engine can
host and the modules the `@k7-core` library offers on top of it.

## What the engine can run

| Kind | Notes |
|---|---|
| **Built-in processors** | Compiled into the engine, available on every machine. |
| **VST3 plugins** | Installed on the engine's machine and found by its plugin scan. Engines on Windows, macOS and Linux only. |
| **LADSPA plugins** | On Linux, found by the same scan. |
| **JS DSP and Faust modules** | DSP described in the module folder and run by the engine. See [DSP in JavaScript and Faust](./49-dsp.md). |

AudioUnit, LV2 and CLAP plugins are not hosted. The phone app hosts no external plugins.

### The plugin scan

The engine scans the plugins installed on its machine and keeps the result. Each plugin found
becomes a module at `@engine/<name>`, with no folder of its own: its slug is the plugin's name in
lowercase with dashes (`@engine/compressor`, `@engine/surge-xt`). The type folder follows the
plugin's role: instruments under `instruments`, MIDI effects under `transformers`, everything else
under `audio`.

After installing a plugin, rescan: the engine settings' **Plugins** section has a **Rescan** button,
or run `system plugins scan`.

A module that names a plugin this machine does not have is drawn with a `?` and plays nothing. A
song that uses an external plugin can still play on another machine through an automatic freeze
(see [Working with a node](./42-node-controls.md)).

### Built-in processors

| Family | Processors |
|---|---|
| Tracktion | 4OSC, Sampler, Volume & Pan, VCA, Level Meter, Equaliser, Reverb, Compressor, Chorus, Delay, Phaser, Pitch Shifter, Low-Pass Filter, MIDI Modifier, Impulse Response, and routing utilities |
| k7 | Neural Amp Modeler, SFZ Player, Surge XT (Windows, macOS and Linux), DSP Graph, MIDI Graph, Faust, Arpeggiator, Mixer, Recorder, Quick Master |
| Eurorack (Mutable Instruments ports) | Plaits, Braids, Rings, Elements, Clouds, Warps, Tides, Peaks |
| AirWindows | A collection of 186 effects |

## The k7-core catalogue

`@k7-core` modules group several DSPs under one name where they do the same job: each is an
**engine** of the module, and the first one listed below is the default. Switch with the card's
engine dropdown or `node engine`.

### Audio effects (`@k7-core/audio/...`)

| Module | Engines or source |
|---|---|
| `amp` | nam (Neural Amp Modeler: NAM captures, AIDA-X and Proteus models) |
| `auto-wah` | JS DSP |
| `bitcrush` | de-rez-2, bit-glitter, de-rez |
| `channel-saturator` | channel-7, buss-colors-4, channel-4, channel-5, channel-6, desk, desk-4, interstage, purest-warm, trans-desk, tube-desk |
| `chorus` | classic, airwindows, chorus-ensemble, ensemble, melt, one-knob |
| `clipper` | adclip-7, clip-only, crystal, one-corner-clip |
| `compressor` | tracktion, block-party, butter-comp, butter-comp-2, compresaturator, logical-4, podcast, podcast-deluxe, pop, pressure-4, purest-squish, pyewacket, recurve, surge, surge-tide, thunder, vari-mu |
| `delay` | tracktion, adt, echo, hombre, purest-echo, tape-delay |
| `distance` | distance-2, distance |
| `dust` | tape-dust, deckwrecka, dust-bunny |
| `eq` | parametric, air, airwindows, aura, energy, purest-air, reseq, tone-slant, tracktion |
| `filter` | biquad-2, biquad, capacitor, sweep |
| `flanger` | JS DSP |
| `gate` | soft-gate, de-hiss, gatelope |
| `guitar-conditioner` | built-in |
| `highpass` | airwindows-2, airwindows, hermepass, one-knob |
| `impulse-response` | built-in |
| `lowpass` | tracktion, airwindows, airwindows-2, average, holt, moog-ladder, one-knob |
| `mu-clouds`, `mu-warps` | Eurorack texture and meta-modulator |
| `overdrive` | drive, bass-drive, coils, cojones, density, dyno, facet, focus, high-impact, loud, mojo, nc-17, one-knob, purest-drive, spiral, spiral-2, un-box |
| `pafnuty` | built-in |
| `phaser` | classic, one-knob |
| `power-sag` | power-sag-2, power-sag |
| `rectifier` | built-in |
| `reverb` | tracktion, mv, nonlinear-space, pocket-verbs, star-child |
| `side-filter` | sidepass, side-dull |
| `tape` | to-tape-5, drum-slam, from-tape, iron-oxide-5, iron-oxide-classic, tape-fat |
| `transient` | point, swell |
| `tremolo` | classic, airwindows |
| `tube` | hard-vacuum, single-ended-triode |
| `vibrato` | vibrato, wobble |
| `vinyl` | groove-wear, crunchy-groove-wear |
| `wavefolder` | built-in |

### Utilities (`@k7-core/audio/zz_utility/...`)

`a-quick-voice-clip`, `bite`, `brass-rider`, `c-strip`, `crossfade` (two inputs, `Mix` from A to
B), `curve`, `dc-voltage`, `de-esser` (de-bess, de-ess), `ed-is-dim`, `electro-hat`, `fade`,
`faust`, `floor`, `gain` (a level in dB, -60 to +6), `golem`, `mid-side`, `monitoring`
(monitoring, lefto-mono, mo-noam, peaks-only, righto-mono, slew-only, subs-only), `noise`,
`phase-nudge`, `pitch-shift` (whole semitones, tempo unchanged), `quick-master`, `raw-glitters`,
`remap`, `slew` (slew-2, acceleration, slew), `smooth`, `stereo-trim` (every-trim, herme-trim),
`stereo-width` (wider, stereo-fx), `sub-bass` (dub-sub, bass-kit, dub-center, fathom-five),
`trim` (-12 to +12 dB), `u-law-decode`, `u-law-encode`, `vca` (tracktion, bit-shift-gain,
purest-gain), `voice-of-the-starship`, `voice-trick`, `volume-pan`.

### Instruments (`@k7-core/instruments/...`)

| Module | What it is |
|---|---|
| `k7-4osc` | Tracktion's 4OSC synthesizer. |
| `k7-rack` | A drum rack, one engine per kit: naked-drums (default), big-rusty-drums, naked-drums-room, retro-casio-rz1, retro-casio-sk1, retro-drumtraks, retro-mfb-512, retro-roland-cr8000, retro-yamaha-mr10, and `samples` (your own library samples, one per pad). |
| `sampler` | Tracktion's sampler: one sample played across the keyboard. |
| `keys/piano` | A sampled concert grand (Salamander Grand Piano), downloaded on demand from the engine settings' **Downloads**. |
| `keys/electric-keys` | stereo-rhodes, clavinet, clavinet-v, stage-73-v2, wurli-v2, wurt. |
| `keys/organ` | b-3-v2, farfisa-v, vox-continental-v2. |
| `synth/surge-xt` | Surge XT with 608 factory patches. Engines on Windows, macOS and Linux only. |
| `synth/wavetable` | A Faust wavetable synth reading a library wavetable. |
| `synth/mu-elements`, `mu-macro-osc` (plaits, braids), `mu-peaks`, `mu-rings`, `mu-tides` | Eurorack voices. |
| `synth/art-*` | Faces for Arturia instruments (Analog Lab V, ARP 2600 V3, Augmented Strings, Augmented Voices, Buchla Easel V, CMI V, CS-80 V4, CZ V, DX7 V, Emulator II V, Jun-6 V, Jup-8 V4, MS-20 V, Matrix-12 V2, Mellotron V, Mini V3, Modular V3, OP-Xa V, Piano V3, Prophet-5 V, Prophet VS V, SEM V2, Solina V2, SQ80 V, Synclavier V, Synthi V, Vocoder V). These need the plugin installed on the engine's machine. |

Several keys engines with a `-v` suffix are likewise faces for installed plugins.

### MIDI transformers (`@k7-core/transformers/...`)

| Module | What it does |
|---|---|
| `arpeggiator` | Plays a held chord one note at a time on the song's grid: rate, octaves, direction, or a drawn pattern. |
| `note-repeat` | Retriggers notes (JS DSP). |
| `transpose` | pitch-shift, tracktion. |

### Cold modules (`@k7-core/cold/...`)

| Module | What it does |
|---|---|
| `normalize` | Brings the loudest sample of a file to `Target` (default -1 dBFS). |
| `stemsplit` | Splits a mix into drums, bass, other and vocals. Runs offline and takes minutes. |
| `instrumental` | A stem split that keeps the instrumental. |
| `tempo` | Plays a file at a chosen tempo, keeping its pitch. |

### Consoles (`@k7-core/console/...`)

Channel and buss halves of summing consoles: `atmosphere`, `c5-raw`, `console-4`, `console-5`,
`console-5-dark`, `console-6`, `pd`, `purest-console`. They are placed by the project's console
setting, not wired by hand.

### Other library material

| Folder | Contents |
|---|---|
| `chains/` | `live/vocals` (compressor then reverb), `process/normalize`, `instrumental`, `stems`, and the blind-test chains. |
| `assemblies/` | `turntable`. |
| `models/` | Amp models for `amp`. |
| `irs/` | Impulse responses. |
| `samples/` | Drum samples. |
| `wavetables/` | Wavetables for `synth/wavetable`. |
| `presets/` | Presets for the library's modules. |
