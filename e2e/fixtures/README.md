# Feature fixtures

One project per feature, written into the e2e account's `E2E` workspace before every run
(`src/fixtures.ts`). Each is the smallest project that exercises its feature and nothing else, so a
failure names the feature. `specs/web/fixtures.spec.ts` asks the server whether each one compiles;
`specs/web/features.spec.ts` opens it in the browser, checks what it draws, and plays it.

Everything here runs on the engine alone, or on a WAV or an MP4 committed beside it.

| fixture | feature | what the browser spec checks |
|---|---|---|
| `clip-lane.k7` | audio clips on a lane: event gain, a disabled event, a windowed clip (`from`/`to`) | the lane, then play |
| `clip-loop.k7` | an event looped four times over a one-beat window | the lane, then play |
| `clip-fades.k7` | fade in and fade out on an event | the lane, then play |
| `clip-warp.k7` | a warp map on a clip, and one event opting out with `.warp(false)` | the lane, then play |
| `note-lane.k7` | a note sequence into the built-in 4OSC, with a velocity | the lane, then play |
| `strudel-lane.k7` | a Strudel pattern split over two lanes by `.label()` | the lane, then play |
| `group-lane.k7` | a group lane holding two lanes | both lanes and the group, then play |
| `curves.k7` | automation: a custom curve and an LFO bound to the synth's params | the lane, then play |
| `rack.k7` | a drum rack with three symbols and a sequence that uses it | the lane, then play |
| `ports.k7` | two lanes into the two inputs of one module (`#b`) | both lanes, then play |
| `doc-note.k7` | an `@meta/doc` note wired from a lane | "Toggle docs" is enabled |
| `mute-solo.k7` | a bypassed lane, a soloed lane, a highlighted lane | the mute and solo buttons' pressed state |
| `mixer-strip.k7` | an `@meta/audio/mixer` strip at the end of a lane | "Mix panel" is enabled |
| `master-chain.k7` | a module between `MIX` and `OUT` | the lane, then play |
| `mastering.k7` | the `mastering` surface over one quick-master node | the strip draws — **known to fail** |
| `library-module.k7` | a node extending an `@k7-core` library module | the lane, then play |
| `video-lane.k7` | a video lane under an audio lane, and the viewport surface | the Viewport window |
| `markers-settings.k7` | markers, tags, 3/4 at 96 bpm, the metronome on | the tempo and metronome |
| `chains-only.k7` | no surface at all: the project draws only the graph | no Timeline pane |
| `broken-unresolved.k7` | a node extending a module that does not exist | the error is shown, not a blank page |
| `broken-sequence.k7` | a sequence that fails its schema (velocity out of range) | the error is shown |

At the workspace root: `_modules/` (the `@workspace` modules the projects extend, copied from
`demos/_modules`), `_references/` (one reference track), `_playlists/` (one playlist naming a song
the library does not have) and `TODOS.md`, read by `specs/web/workspace.spec.ts`.

## Not covered here

These features need what a fixture cannot carry, and have no project yet:

- **an audio input or a webcam**: the `live` and `live-video` archetypes are only scaffolded and
  compiled (`specs/web/archetypes.spec.ts`), arming and recording a lane, the bench.
- **songs in the media library**: the `mix` archetype, a turntables surface, a resolved playlist.
- **a render on the server's engine**: shares.
- **Web MIDI**: a MIDI input lane, a controller map.
- **an installed plugin**: a VST3 node, other than its "missing" state.
