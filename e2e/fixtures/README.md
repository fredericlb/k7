# Feature fixtures

One project per feature, written into the e2e account's `E2E` workspace before every run
(`src/fixtures.ts`). Each is the smallest project that exercises its feature and nothing else, so a
failure names the feature. `specs/app/fixtures.spec.ts` asks the server whether each one compiles;
`specs/app/features.spec.ts` opens it in the browser, checks what it draws, and plays it. A fixture
whose feature is what the ENGINE builds from it has a spec of its own, named in the last column,
which reads the engine document the project compiles to before it plays.

Everything here runs on the engine alone, or on a WAV or an MP4 committed beside it. The
`kick.wav` and `snare.wav` the `clip-*` and `library-module` fixtures play are silent (peak 0), so
those lanes are checked for playing, not for sound.

| fixture | feature | what the browser spec checks |
|---|---|---|
| `clip-lane.k7` | audio clips on a lane: event gain, a disabled event, a windowed clip (`from`/`to`) | the lane, then play |
| `clip-loop.k7` | an event looped four times over a one-beat window | the lane, then play |
| `clip-fades.k7` | fade in and fade out on an event | the lane, then play |
| `clip-warp.k7` | a warp map on a clip, and one event opting out with `.warp(false)` | the lane, then play |
| `cold-normalize.k7` | a cold `normalize` (Target −6) on a lane playing a −12 dBFS tone | `specs/app/effects.spec.ts`: sent unmeasured (`Peak` 0) and plays; `clip process tone drums` repoints the clip at a bounce peaking at −6 dBFS |
| `note-lane.k7` | a note sequence into the built-in 4OSC, with a velocity | the lane, then play |
| `edit-undo.k7` | a note lane to edit: the tempo typed in the editor, and events copied, pasted and split from the command bar | `specs/app/editing.spec.ts`: the footer bpm, a one-line diff on disk, project undo/redo, Ctrl+Z/Ctrl+Y, `ui ruler`, `selection copy/paste/split` |
| `strudel-lane.k7` | a Strudel pattern split over two lanes by `.label()` | the lane, then play |
| `group-lane.k7` | a group lane holding two lanes | both lanes and the group, then play |
| `curves.k7` | automation: a custom curve and an LFO bound to the synth's params | the lane, then play |
| `rack.k7` | a drum rack with three symbols and a sequence that uses it | the lane, then play |
| `library-rack.k7` | `k7-rack` on its `samples` engine, its taps three `@k7-core` library samples | `specs/app/engines.spec.ts`: a `sampler` with the three taps resolved, then the lane and play |
| `ports.k7` | two lanes into the two inputs of one module (`#b`) | both lanes, then play |
| `doc-note.k7` | an `@meta/doc` note wired from a lane | "Toggle docs" is enabled |
| `mute-solo.k7` | a bypassed lane, a soloed lane, a highlighted lane | the mute and solo buttons' pressed state |
| `mixer-strip.k7` | an `@meta/audio/mixer` strip at the end of a lane | "Mix panel" is enabled |
| `master-chain.k7` | a module between `MIX` and `OUT` | the lane, then play |
| `mastering.k7` | the `mastering` surface over one quick-master node | the strip draws; `specs/app/surfaces.spec.ts`: Width written to `nodes/master.k7x` (`test.fail`: master-run modules are not found by `node param`) |
| `surge-synth.k7` | a chord into Surge XT on the library's default patch, no `base` set | `specs/app/surge.spec.ts`: the engine document names `Pads/Bell Pad`, then the lane and play |
| `eurorack.k7` | Mutable Instruments engines: mu-macro-osc on plaits (into mu-clouds) and on braids, and mu-rings, one lane each | `specs/app/engines.spec.ts`: the engine document names `mu-plaits`, `mu-clouds`, `mu-braids`, `mu-rings`, then the lanes and play |
| `eurorack-surge.k7` | a Plaits node and a Surge XT node in one project: Surge's renamed plaits/clouds/stmlib must not clash | `specs/app/engines.spec.ts`: `mu-plaits` and `Surge XT` on `Pads/Bell Pad`, then both lanes and play |
| `faust.k7` | notes into the Faust wavetable synth through the Faust moog-ladder engine of `lowpass` | `specs/app/engines.spec.ts`: both nodes are `Faust` with their source inline, then the lane and play |
| `sampler.k7` | notes into `@k7-core/instruments/sampler` (Tracktion's Sampler) | `specs/app/engines.spec.ts`: the node is a Sampler (`test.fail`: type `builtin` is dropped), then the lane and play |
| `library-module.k7` | a node extending an `@k7-core` library module | the lane, then play |
| `jsdsp-fx.k7` | jsdsp library effects in series after a synth: chorus and phaser (`classic`), overdrive (`one-knob`), auto-wah | `specs/app/effects.spec.ts`: four `DSP Graph` plugins with their graphs' params, then the lane and play |
| `airwindows.k7` | Airwindows leaves (To Tape 5, the Airwindows chorus) and a Console 6 pair: the channel on the lane, the buss between `MIX` and `OUT` | `specs/app/effects.spec.ts`: the lane's plugin types and `Console 6 Buss` in `masterPlugins`, then the lane and play |
| `transformers.k7` | arpeggiator, note repeat and transpose between a note lane and the synth | `specs/app/effects.spec.ts`: `Arpeggiator` and two `MIDI Graph` plugins before `4osc`, then the lane and play |
| `video-lane.k7` | a video lane under an audio lane, and the viewport surface | the Viewport window; `specs/app/surfaces.spec.ts`: the viewport canvas is non-blank |
| `markers-settings.k7` | markers, tags, 3/4 at 96 bpm, the metronome on | the tempo and metronome |
| `chains-only.k7` | no surface at all: the project draws only the graph | no Timeline pane |
| `chains-edit.k7` | a Surge XT node to edit in the Chains view | `specs/app/chains.spec.ts`: a library effect spliced onto MIX→OUT from the module picker, and a factory preset switching `base`, both read back on disk and undone |
| `broken-unresolved.k7` | a node extending a module that does not exist | the error is shown, not a blank page |
| `broken-sequence.k7` | a sequence that fails its schema (velocity out of range) | the error is shown |

At the workspace root: `_modules/` (the `@workspace` modules the projects extend, copied from
`demos/_modules`), `_references/` (one reference track), `_playlists/` (one playlist naming a song
the library does not have) and `TODOS.md`, read by `specs/app/workspace.spec.ts`.

## Not covered here

These features need what a fixture cannot carry. Some have a spec that builds what it needs at run
time instead:

- **a camera or an input**: `specs/app/recording.spec.ts` records a picture lane from Chromium's
  fake camera, an audio lane from the engine's input channel 1, and a take on the live rig's
  recorder node; `specs/app/surfaces.spec.ts` draws `live-video`'s webcam viewport. The bench
  (`@banc`) has no spec.
- **songs in the media library**: `specs/app/surfaces.spec.ts` files a generated song and resolves
  the playlist a turntables surface names.
- **a render on the server's engine**: `specs/app/shares.spec.ts` publishes a share and opens it
  signed out, playing it where the instance has a server engine.
- **Web MIDI**: a MIDI input lane, a controller map. No spec.
- **an installed plugin**: a VST3 node, other than its "missing" state. No spec.
