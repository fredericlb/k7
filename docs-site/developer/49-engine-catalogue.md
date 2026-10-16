# The engine's plugin catalogue

This page covers how plugins the engine can host become modules: the scan, the `@engine`
namespace, the built-in processors and how a module's `plugin:` is translated for the engine. The
engine itself (building, hosting, the wire) is in the engine section of this guide.

## Formats

| Source | Where it is decided |
|---|---|
| Hosted external formats: VST3, and LADSPA (effectively Linux) | `add_compile_definitions(JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_LADSPA=1)` in `engine/k7-runtime/CMakeLists.txt`, desktop builds only |
| Format names a module may write | `isExternalFormat` in `engine/k7-runtime/engine/EditBuilder.cpp`, mirrored by `EXTERNAL_PLUGIN_FORMATS` in `packages/engine-protocol/build.ts` (`vst3`, `vst`, `vst2`, `au`, `audiounit`, `clap`, `lv2`, `ladspa`, `aax`) |
| Built-in processors | `builtInPlugins()` in `engine/k7-runtime/engine/PluginScan.cpp` |
| Eurorack voices | `engine/k7-runtime/engine/eurorack/EurorackList.h` |
| AirWindows effects | `engine/k7-runtime/engine/AirWindowsList.h` |

The accepted names are wider than what is hosted: a plugin only instantiates if the scan found it,
and without the JUCE host flag for AU, LV2 or CLAP, the scan never finds one. Android hosts no
external plugin.

## The scan

`PluginScan.cpp` scans out of process (a crashing plugin takes down the scanner, not the engine)
and writes `<STUDIO_HOME>/exts.json`, listing each plugin's name, format, identifier,
manufacturer and role, plus the built-ins as format `internal`. The TypeScript side reads the same
file:

- `packages/song/src/engineCatalogue.ts` turns each entry into an `@engine/<slug>` module
  (`slugifyPluginName`), filed under `instruments`, `transformers` or `audio` by
  `categoryForRole` (`packages/song-schema/src/moduleTypes.ts`). No wrapper file mirrors the scan:
  a folder exists only for what someone authored (`module own` creates one).
- `packages/engine-client/src/pluginCache.ts` (`isPluginScanned`) is what
  `packages/file-service/src/graphDoc.ts` asks to mark a node whose plugin is absent.

The verb `system plugins scan` and the engine settings' Rescan button refresh it.

**Why the file is the contract.** The scan is expensive and the C++ engine owns it; the
compiler, the file service and the checkers all need its answer without a running engine. One
file at a fixed path, written by the engine and read by everyone, is the cheapest shared truth.

## From module to engine plugin

`packages/engine-protocol/build.ts` maps a module's `plugin.type` to what the engine loads:

| `plugin.type` | Engine plugin |
|---|---|
| `jsdsp` | DSP Graph, or MIDI Graph when the module emits MIDI, with the compiled graph inline |
| `faust` | Faust, with the `dsp.dsp` text |
| `internal` | The built-in processor named by `plugin.name` |
| an external format | The scanned plugin, addressed by its identifier |
| `offline` (`OFFLINE_TYPE`) | No engine plugin: a cold pass (`packages/audio-passes/src/coldPass.ts`) produces its outputs onto disk first |
| `not_supported` | A deliberate marker: the plugin is known and cannot load; the node is bypassed |
| anything else (for example `builtin`) | Passed through unchanged; `EditBuilder.cpp` normalises a built-in's spelling to the type name the engine creates it by |

The built-in processors are: Tracktion's (4OSC, Sampler, Volume & Pan, VCA, Level Meter,
Equaliser, Reverb, Compressor, Chorus, Delay, Phaser, Pitch Shifter, Low-Pass Filter, MIDI
Modifier, MIDI Patch Bay, Patch Bay, Aux Send, Aux Return, Text, Freeze Point, Insert, Impulse
Response); k7's own (Neural Amp Modeler, SFZ Player, Surge XT on desktop, DSP Graph, Faust, MIDI
Graph, Arpeggiator, Mixer, Recorder, Quick Master); the Eurorack ports; and the AirWindows
collection. Some processors are registered without being listed in the scan, because no module
names them directly: the waveform and broadcast taps, the turntable platter, the pattern player,
the `@mix` split and blend pair, and the master gain.

## Parameters without an engine

Panels, the builder and `lint:panels` need parameter names and ranges with no engine running.
For built-ins, `engine/k7-runtime/scripts/gen-builtin-params.mjs` instantiates each one and
writes `packages/song-schema/src/builtinParams.generated.ts`; `builtinPluginFor` in
`packages/song-schema/src/builtinParams.ts` reads it. Regenerate it when a built-in's parameters
change. External plugins are only known by instantiating them, which the engine binary does for
`lint:panels` (`--dump-params-ext`) and for the builder's "read parameters" button.

## The engine stage

Every module gets three engine-side parameters whatever it hosts: `@input-volume` and `@mix`
(audio effects) and `@output-volume` (everything), constants `INPUT_VOLUME_PARAM`, `MIX_PARAM`,
`OUTPUT_VOLUME_PARAM` and `VOLUME_RANGE` in `packages/song-schema/src/moduleTypes.ts`. When the
engine owns the blend or the levels, the plugin's own dry/wet and level parameters are held
(`ownMixSide`, `ownLevelSide`), and panels must not show them; the builder's auto layout and AI
checks drop them for that reason.
