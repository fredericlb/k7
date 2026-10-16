# DJ side: tests and measurements

The desk's design splits every decision that can be wrong into a pure module so it can be tested without React or an engine. No test mounts a desk component; a visual or interaction change has to be checked in the running app.

## Running the tests

Each package runs vitest on its own:

```bash
npm run test --workspace @studio/k7-plugins
npm run test --workspace @studio/song-schema
npm run test --workspace @studio/commands
```

From the root, `npm run test` runs `scripts/workspaces.mjs test`, which runs the `test` script of every workspace that has one (`--jobs N` to run several at once). Remember the repo's lint rules for any `.ts`/`.tsx` you touch (`npm run lint`).

## What is covered

### `packages/k7-plugins/src/turntables/`

| Test | Holds |
|---|---|
| `beats.test.ts` | `beatPhase` (circular mean, Rayleigh confidence), `alignSeek` (shorter way round, never before 0). |
| `grid.test.ts` | The media library's tempo correction over the analysis; an untouched fader follows it, a moved one does not. |
| `loop.test.ts` | Snap to nearest beat, length rounding, edges clamped into the record, **write order** of `Roll`/`LoopStart`/`LoopEnd`. |
| `deck.test.ts` | `withDecks`: platter params, stems versus record lanes, `Seek` never re-sent, the stand-in document, sync tempos, scratch throttle. |
| `metronome.test.ts` | Which deck the click follows, the bar clip. |
| `controls.test.ts` | Ids unique and per deck, ranges equal the modules' own. |
| `mapping.test.ts` | Required controls, and the schema's mapping skeleton matching the control list. |
| `mixBindings.test.ts` | Binding resolution, `also`, `invert`, offline tempo, plugin liveness, the optimistic override. |
| `cue.test.ts` | Eight cue colours, all distinct. |
| `setList.test.ts` | Resolving a playlist against the machine's cache, the three failure states, search folding and sorting, drag lookup. |
| `prewarm.test.ts` | Sequential walk, failures counted, early stop. |
| `service.test.ts` | Cache-relative and playable paths, Windows and POSIX roots. |
| `waveform.test.ts`, `shuttle.test.ts`, `dial.test.ts` | What the waveform, the shuttle and the record draw. |
| `deskLayout.test.ts`, `views/crossfadeReach.test.ts` | What fits at a given height; the crossfader reaching the cue rows. |
| `views/ChannelStrip.test.tsx` | Knob geometry (`angleOf`, `arcPath`) and icon tables — functions only. |

`views/ChannelStrip.stories.tsx` is a story for looking at the strip, not a test.

### Elsewhere

| Test | Holds |
|---|---|
| `packages/song-schema/src/playlist.test.ts` | Parsing and the text edits (append, remove, move), every refused shape. |
| `packages/song-schema/src/reference.test.ts` | Reference file rules and paths. |
| `packages/song-schema/src/stems.test.ts` | Stem names and node naming. |
| `packages/song-schema/src/yaml/mixMarkers.test.ts`, `mixYaml.test.ts` | The cue sheet: reading, and writing markers into the text. |
| `packages/song/src/scaffoldSet.test.ts`, `scaffoldLive.test.ts` | The mix and live scaffolds compile and wire what they say. |
| `packages/song/src/turntableAssembly.test.ts`, `migrateSet*.test.ts` | The deck assembly; migrations giving old sets a new set's files. |
| `packages/commands/src/playlist.test.ts`, `playlistStems.test.ts`, `systemOnnx.test.ts` | The verbs. |
| `packages/k7-plugins/src/transcription/transcribe.test.ts`, `trackTranscribe.test.ts` | SRT, and `track transcribe`'s refusals and writes. |
| The tests in `packages/audio-analysis/src/` | Decode through a stand-in engine, envelope arithmetic on a synthetic click track, the sidecar. |
| `apps/k7/backend/src/media/stems/cut.test.ts` | The library's cut. |

## Measuring against an engine: `put-on.ts`

`packages/k7-plugins/scripts/turntables/put-on.ts` measures what putting a record on an already loaded deck costs: it writes test WAVs, sends the documents `withDecks` builds to a running engine, and times the `applied` answer.

```bash
npx tsx packages/k7-plugins/scripts/turntables/put-on.ts [ws://127.0.0.1:8765] [--minutes=2] [--runs=6]
npx tsx packages/k7-plugins/scripts/turntables/put-on.ts --hold=30 [--key]
```

`--hold` loads two separated decks, starts them and holds, so the CPU of eight running platters (with or without keylock, `--key`) can be read from outside. The script's comments are in French.

As written, it imports `../src/deck`, which resolves to a folder under `scripts/` that does not exist (the module is `packages/k7-plugins/src/turntables/deck.ts`); the import needs fixing before the script runs.

Never run it against an engine you are building at the same time.
