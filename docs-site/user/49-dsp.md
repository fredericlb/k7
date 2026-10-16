# DSP in JavaScript and Faust

Some modules do not host a plugin: their sound processing is described in a file inside the module
folder, which you can open and change. There are two kinds.

| Module type | File | Language | Runs as |
|---|---|---|---|
| `jsdsp` | `jsdsp.ts` | TypeScript, describing a graph of DSP blocks | The engine's DSP Graph (audio) or MIDI Graph (notes) processor |
| `faust` | `dsp.dsp` | Faust | The engine's Faust processor, which compiles it |

Both are edited in the [module builder](./45-module-builder.md)'s **dsp** tab.

## JS DSP

A `jsdsp` module's TypeScript does not run while audio plays. It runs once, when the project is
compiled, and **describes** a graph of blocks (filters, gains, delays, envelopes); the engine then
runs that graph natively. That is why it is safe to write in TypeScript, and also why you can only
use the blocks the builder offers: there is no per-sample JavaScript.

### A first module

`module.k7x`:

```js
plugin({ type: "jsdsp", name: "Trim" })
params({ Trim: 0 })
```

`jsdsp.ts` beside it:

```ts
import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const db = g.param("Trim", { min: -12, max: 12, default: 0 });
  g.output(g.amul(g.input(0), g.fromdb(db)));
};
```

`g.param` declares a parameter that a panel can bind, with its range and default. Adding `labels`
to the spec turns it into a choice of named settings (a dropdown).

When the source changes, k7 rebuilds the graph and keeps the result in `jsdsp.json` beside it. If
the new source fails, the last working graph keeps playing.

### The blocks

| Group | Blocks |
|---|---|
| Parameters | `param(name, { min, max, default, labels? })`, and `sr` (the sample rate) |
| Control values (computed once per block) | `todb`, `fromdb`, `lerp`, `linmap`, `geolerp`, `clamp`, `select`, `add`, `sub`, `mul`, `glide` |
| Analysis | `envelope(attackMs, releaseMs)` |
| Audio, per sample | `input(port)`, `output(x)`, `amul`, `aadd`, `saturate`, `delay(x, timeMs, maxMs)`, `allpass(x, baseHz, octaves)`, `lfo(shape, rateHz, spread?)`, `wire(name)` for feedback |
| Audio effects | `biquad(mode, freq, q, gainDb?)` with modes `lowpass`, `highpass`, `bandpass`, `notch`, `peak`, `lowshelf`, `highshelf`; `gain`; `mix(wet)` |
| MIDI | `midi()`, `transpose`, `velocity`, `channel`, `hold`, `strike(stepBeats, gate)`, `pattern`, `accent`, `chance`, `decay` |

Values can also be chained: `g.input(0).mul(level).out()`.

A module whose type folder is `transformers` (MIDI in, MIDI out) builds a MIDI graph; any other
builds an audio graph.

### Examples in k7-core

Read these modules' `jsdsp.ts` to see the blocks in use: `audio/auto-wah`, `audio/flanger`,
`audio/zz_utility/gain`, `trim`, `fade` and `crossfade`, the `classic` engines of `chorus`,
`phaser` and `tremolo`, the `one-knob` engines of `chorus`, `phaser`, `lowpass` and `highpass`,
`audio/eq/engines/parametric`, `audio/filter/engines/sweep`, `audio/delay/engines/echo`,
`audio/vibrato/engines/wobble`, `transformers/note-repeat`, `transformers/transpose/engines/pitch-shift`
and `cold/normalize`.

To start your own, create a module (`module new audio/mytrim`), set its `plugin` to
`{ type: "jsdsp", name: "..." }`, and write a `jsdsp.ts` beside it, starting from one of these.

## Faust

A `faust` module holds its program in `dsp.dsp`, compiled by the engine:

```js
// k7-core/modules/instruments/synth/wavetable/module.k7x
plugin({ type: "faust", name: "Wavetable" })
params({
  Table: "@k7-core/basic.wav",
  Position: 0,
  Cutoff: 8000,
})
```

Every control the Faust program declares is a parameter you can bind on the panel and automate. A
parameter whose value is a file (here `Table`, a library wavetable) is loaded for the program to
read. `k7-core` has two Faust modules: `instruments/synth/wavetable` and the `moog-ladder` engine
of `audio/lowpass`.
