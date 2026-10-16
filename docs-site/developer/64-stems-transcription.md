# Stem separation and transcription

Two long-running jobs that feed the DJ side: cutting a song into stems, and turning a video's speech into timed text. Both are slow, both run outside the browser, and both refuse loudly rather than half-succeed.

## Stems: the vocabulary

`packages/song-schema/src/stems.ts` is the one definition three packages share:

- `STEMS = ["drums", "bass", "other", "vocals"]` **in the order the model returns them**; the output tensor carries no names, so the order is the knowledge.
- `STEMS_DIR = "stems"`: outputs go in `stems/` beside the source, as `<stem>.wav` (`stemFile`). `INSTRUMENTAL` (`instrumental.wav`) sums every stem but vocals.
- `stemsComplete` requires all four: a deck plays them in place of the record.
- `STEM_PARAM = "Gain"`, `STEM_RANGE = [0, 2]`, `STEM_NEUTRAL = 1`: the desk knob drives the stem platter's own gain.
- Node names: `stemLane`, `stemPlatter`, `deckPlatter`, `stemControl`, `stemLaneOf`, `turntableMembers`, `TURNTABLE_REF`.

Tested by `packages/song-schema/src/stems.test.ts`.

## Stems: who runs the cut

A separation runs an ONNX model on an **engine's machine**, inside the native supervisor (`engine/k7-supervisor`); no Node process here runs the model. Servers only start, track and poll jobs.

| Path | Role |
|---|---|
| `packages/stem-separation/src/separateJobs.ts` | The seam: `SeparationRunner` (`start`, `job`), `setSeparationRunner`, `startSeparate`, `separateJob`, and `separationId`, a hash of (user, source, model, outputs) so a retry joins the job already running. |
| `packages/file-service/src/remoteSeparation.ts` | The runner a hosted file service installs (`packages/file-service/src/hosted.ts`): sends the job over the bound machine's jobs channel. Finished jobs are kept 5 minutes for a last poll. |
| `packages/file-service/src/engineLink.ts` | `runColdStep` for verbs (`clip process`, `playlist stems`) polls `separateJob` until done; `stemsChain` / `instrumentalChain` read the machine's preferences on each request. |
| `packages/file-service/src/coldRun.ts`, `hosted.ts` (`/hub/cold-chain`) | Resolve which model and outputs a chain runs, for the library. |
| `apps/k7/backend/src/media/routes/stems.ts` | The library's routes: `POST /stems` (`song`, `engineId`, optional `chain`, `want: "stems" | "instrumental"`), `GET /stems/held?song=`, `GET /stems/:id`. |
| `apps/k7/backend/src/media/stems/cut.ts`, `jobs.ts` | The library drives the cut it owns: the song and model travel to the chosen engine's machine, the stems come back beside the song. Jobs are keyed by the work and kept 5 minutes. |

The library owns the cut because it holds the masters. "Already done" is always asked of the folder (`heldStems`), never of a flag, since the catalogue's `meta.stems` is a scan snapshot.

### Three ways a cut starts

1. **`playlist stems <playlist> [chain]`** (`packages/commands/src/verbs/playlist.ts`): resolves the chain against the open project (`resolveChain`, `@studio/audio-passes/processChain`), refuses one with no cold step, then for each line takes the first audio file in `songs/<line>` (`familyDir("songs")`), skips songs whose `coldOutDir` already holds audio, and runs `runColdPasses` sequentially. A per-song failure is a log line; the loop continues.
2. **The playlists panel's "Separate the stems"** (`apps/k7/frontend/src/components/PlaylistPane.tsx`): the same work through the library route (`mediatek.prepareStems`), sequential, polled every 2 s, so it can be watched and stopped. A 400 or 409 stops the run (the run is refused, not the song); anything else is a note per song. A 404 on a poll is read as a swept job and re-asked.
3. **The desk with `stems: true`** (`MixView.prepare`): on load of an unseparated record, `service.prepareStems`, then poll, guarded by a per-deck token so a later load makes it obsolete. When it lands, `useDeckSet.stemsArrived` re-sends the document with `stems: true`, which moves playback to the four stem platters. Without `stems: true`, `catchUp` still asks `/stems/held` once, so a record separated elsewhere lights up.

### Machine preferences

`system stems`, `system instrumental`, `system onnx`, `system cue` (`packages/commands/src/verbs/system.ts`) write the machine's preferences. `system stems` checks the chain against the open project when there is one; `system instrumental` additionally refuses a chain without an `instrumental` output. `system onnx` defaults to `cpu` alone: a wrong accelerated provider hangs the job rather than falling back. Tests: `packages/commands/src/systemOnnx.test.ts`.

## Transcription

The `transcription` plugin (`packages/k7-plugins/src/transcription/`) is k7's one builtin **server** plugin, installed by the file service at boot through `packages/k7-plugins/src/server.ts` (`installBuiltinPlugins`). It contributes one command, `track transcribe`, hosted in the core `track` family.

| Path | Role |
|---|---|
| `index.ts` | The `definePlugin` declaration: sid `track.transcribe`, args `track_in` (completed from `pictureLanes`) and `track_out`, `menu: ["track"]`. |
| `transcribeTrack.ts` | The handler, acting through `CommandHost` like any core verb. |
| `transcribe.ts` | `extractAudio` (ffmpeg, mono 16 kHz), `transcribeAudio` (the whisper CLIs), `parseSrt`, `srtOf`. |

Choices:

- **Everything is checked, and whisper runs, before a line is written.** A refused transcription creates no track; an existing `track_out` has its `content:` replaced (`setFileValue`), and the command journal makes the whole thing one undo.
- **The first shot of the lane** is the source, timed in its own seconds. Re-timing segments onto a lane that cuts between videos is not done.
- **SRT as the stored text**, so the content is a subtitle file as is. `parseSrt` accepts both `,` and `.` before milliseconds because the two CLIs differ.
- **Whichever whisper the machine has.** `CLIS` tries `whisper` (openai-whisper) then `whisper-cli` (whisper.cpp, which needs `STUDIO_WHISPER_MODEL`). A missing binary (ENOENT) is skipped; one that ran and failed is the error, with no fallback, to avoid a second model download. No image in this repository installs whisper, so it runs only where somebody installed it beside the file service.

Tests: `packages/k7-plugins/src/transcription/transcribe.test.ts` (SRT round trip, dialects) and `trackTranscribe.test.ts` (the verb's refusals and writes). `packages/k7-plugins/src/composition.test.ts` checks that both composition lists install into the registries cleanly and stay independent lists.
