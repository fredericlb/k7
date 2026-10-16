# DSP written in TypeScript (packages/dsp)

`packages/dsp` (`@studio/dsp`) is a builder for describing a module's DSP as a graph of blocks.
The TypeScript never runs on the audio thread: it runs once, at compile time, and emits a JSON
graph that the engine's graph processors run natively.

| Engine processor | File | Runs |
|---|---|---|
| DSP Graph (`studio_dspgraph`) | `engine/k7-runtime/engine/GraphDspPlugin.cpp` | audio graphs |
| MIDI Graph (`studio_midigraph`) | `engine/k7-runtime/engine/MidiGraphPlugin.cpp` | MIDI graphs |
| The graph model both share | `engine/k7-runtime/engine/DspGraph.h` | |

**Why a graph and not JavaScript.** A module's DSP must be editable by a user without a C++
build, yet it must run in the engine's audio callback with no garbage collector and no
interpreter. Describing the graph in TypeScript and running fixed native blocks gives both: the
author gets types and composition, the engine gets a static graph.

## The builder API

`packages/dsp/src/index.ts` exports `graph(fn)`, the `GraphBuilder` it passes to `fn`, `sr` (the
sample rate as a control value) and the JSON types (`GraphJson`, `NodeJson`, `ParamSpec`).
`packages/dsp/src/chain.ts` adds fluent handles (`ScalarNode`, `AudioNode`, `MidiNode`) so values
chain: `g.input(0).mul(mix).out()`.

| Group | Methods | JSON node types |
|---|---|---|
| Parameters | `param(name, { min, max, default, labels? })` (a duplicate name throws) | entries of `params` |
| Analysis | `envelope(attackMs, releaseMs)` | `envelope` |
| Control rate (once per block) | `todb`, `fromdb`, `lerp`, `linmap`, `geolerp` (throws on a descending numeric pair), `clamp`, `select`, `add`, `sub`, `mul`, `glide` | same names |
| Audio effects in place | `biquad(mode, freq, q, gainDb?)`, `gain`, `mix(wet)` | same names |
| Audio rate | `input(port)`, `output(x)`, `amul`, `aadd`, `saturate`, `delay(x, timeMs, maxMs, into?)`, `allpass(x, baseHz, octaves?, into?)`, `lfo(shape, rateHz, spread?)`, `wire(name)` | `ain`, `aout`, `amul`, `aadd`, `atanh`, `adelay`, `aallpass`, `alfo`, wires |
| MIDI | `midi()`, `transpose`, `velocity`, `channel`, `hold`, `strike(stepBeats, gate)`, `pattern`, `accent`, `chance`, `decay` | `mchannel`, `mhold`, `mstrike`, `mpattern`, `maccent`, `mchance`, `mdecay`... |
| Output | `build()`, `toJSON()` | |

Control values and audio wires are distinct types, so passing an audio wire where a control value
is expected is a compile error (`chain.test.ts` pins this).

The reference graphs in `packages/dsp/src/` (`autowah`, `echo`, `flanger`, `crossfade`, `fade`,
`normalize`, `chorus`, `phaser`, `sweep`, `tremolo`, `noteRepeat`) are tested there.
`npm run build -w @studio/dsp` runs `src/emit.ts`, which writes six of them to
`packages/dsp/graphs/*.json`. `autowah.json` is also the engine's fallback graph, pasted into
`GraphDspPlugin.cpp`; `autowah.test.ts` reads the C++ file and fails if the two drift.

## How a module reaches the engine

A module opts in with `plugin({ type: "jsdsp", name })` and a `jsdsp.ts` beside its module file
(fixed name: `JSDSP_TYPE` and `JSDSP_FILE` in `packages/engine-protocol/build.ts`). The source
default-exports `(g: GraphBuilder) => void`.

1. The loader (`packages/song/src/loader.ts`) finds the source for each module folder.
2. Compiling the project (`readJsDspGraph` in `packages/song/src/nodeProject.ts`) reuses
   `jsdsp.json` beside the source when it is at least as new; otherwise it runs
   `node --import tsx packages/song/src/dspRunner.mjs <source>` in a child process (30 s timeout),
   validates the JSON, and writes `jsdsp.json`. On failure it keeps the last good JSON, so a typo
   does not silence a song.
3. The graph travels inline on the plugin document. `jsdsp` maps to the engine plugin "DSP Graph",
   or "MIDI Graph" when the module emits MIDI.
4. Offline passes (`packages/audio-passes/src/processChain.ts`) read the same `jsdsp.json`.

The child process runs code from a workspace or a library on the machine that compiles the
project. Treat a `jsdsp.ts` with the same trust as the library or workspace it comes from.

`jsdsp.json` is committed beside each `k7-core` source, so a machine can play the library without
running TypeScript.

## Faust modules

`plugin({ type: "faust", name })` with a `dsp.dsp` beside it (`FAUST_TYPE`, `FAUST_FILE`,
`FAUST_PLUGIN` in `packages/engine-protocol/build.ts`). There is no build step on the TypeScript
side: `readFaustSource` sends the text, and the engine's Faust processor (`studio_faust`) compiles
it. Only the engine knows the Faust program's controls, which is why `lint:panels` skips Faust
panels.

## Adding a block

1. Implement the node in the engine's graph processor and its JSON reader (C++).
2. Add the method to `GraphBuilder` in `packages/dsp/src/index.ts` and, if it chains, to
   `packages/dsp/src/chain.ts`.
3. Test the emitted JSON in `packages/dsp/src/*.test.ts`.
4. Verify by running the engine: TypeScript cannot check that the C++ reader accepts the node.

## Tests

```bash
npm test -w @studio/dsp
```
