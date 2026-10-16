# song-strudel: pattern lanes

A lane that extends `@meta/strudel-track` plays a Strudel pattern from `algo/<name>.strudel`. The
**engine** plays it: the pattern is evaluated in QuickJS inside `engine/k7-runtime`, and nothing in
Node evaluates a pattern at run time. `packages/song-strudel` is the JavaScript the engine runs,
kept here so it can be tested under Node.

## The pieces

| Where | What |
|---|---|
| `packages/song-strudel/src/events.ts` | `queryEvents(pattern, from, to)`: a pattern's haps in `[from, to)` cycles → `{ cycle, dur, vel, orbit, note?, n?, s?, label? }`, onsets only, query ends snapped to a 2^-20 cycle grid. `labelKey` (the slug a label is matched by), `hapPitch`, `fallbackPitch` (a General-MIDI-ish drum map, else a stable hash into c3..c5), `notePitch`. |
| `packages/song-strudel/src/engineEntry.ts` | What the engine calls, installed as `globalThis.k7Strudel`: `load(code)` (evaluate with `@strudel/transpiler`; a throw keeps the previous pattern), `laneEvents`/`laneEventsJson` (one lane's events: its own label's, plus every unclaimed label for the catch-all lane), `labels`/`labelsJson`. Results cross to C++ as JSON strings. |
| `engine/k7-runtime/scripts/gen-strudel-bundle.mjs` | Bundles `engineEntry.ts` with `@strudel/core`, `@strudel/mini` and `@strudel/transpiler` (pinned at 1.1.0 in `packages/song-strudel/package.json`) into the engine. |
| `engine/k7-runtime/engine/PatternSchedule.h` | Turns cycles into time: one cycle is one bar (`beatsPerCycle` from the metre), at the edit's tempo. |
| `packages/song/src/enginePattern.ts` | The compile side: `patternPlugins` gives each half of a pattern lane a `studio_pattern` plugin carrying `patternSource`, `patternLabel` (the lane name), `patternCatchAll`, `patternClaimed`, `patternPlays` (`notes`, `samples` or `both`), `patternBanks`. `patternShares` decides the catch-all: the file's first lane by name. `patternFiles` lists the files whose save is a recompile. |

## Choices

- **The engine decides whether an event is a sample**, because it holds the banks; so `s` and `n`
  travel with every event and the pitch is computed for the case where it is a note. Banks are the
  project's `samples/`, then `$DIRT_SAMPLES`, then `$STRUDEL_SAMPLES` (`sampleBanks`).
- **The pattern's text travels in the document.** The engine parses no project files, so the source
  of the `.strudel` file is a field of the plugin, and a save of the file is a new document. The file
  service watches `*.strudel` files of the active project with chokidar for that reason.
- **A missing file is the compiler's error, an unknown label the engine's.** Whether a pattern
  contains a lane's label requires evaluating it, which only the engine does.

## Tests

`packages/song-strudel/src/engineEntry.test.ts` loads patterns through the same entry the engine
uses and checks the per-lane split and the catch-all. The scaffold tests in `packages/song`
compile the `arrangement` archetype, which has two lanes on one pattern file.
