# song-edit: surgical writes

`packages/song-edit` changes a project in its own vocabulary — "set `Filter Freq` on node `lead`",
"split this event at beat 9", "insert two bars at bar 17" — by finding the file a name lives in and
rewriting **only the value that changes**. Every other byte stays: comments, key order, quoting,
inline lists. A knob drag is therefore a one-line diff, the file stays readable in git, and the
live-sync layer can express the change as a key-path operation instead of a whole-file replace
([live-sync](./38-live-sync.md)).

Its callers are the verbs of `packages/commands` (for example `packages/commands/src/verbs/track.ts`,
`crossfade.ts`, `preset.ts`, `eventTakes.ts`, `engine.ts`), which every surface — the command bar,
the timeline, the mixer, the chains view — goes through.

## The primitives

| Layer | File | What it does |
|---|---|---|
| One value in one file | `packages/song/src/yaml/edit.ts` | `setFileValue(file, path, value)`, `deleteFileValue`: one key path set or removed on the file's k7x document, so the rest of it is reproduced byte for byte; an inline list stays inline. |
| Writers per file kind | the `*File.ts` modules of `packages/song-schema/src/yaml/` | Functions over a `K7Scope`: `trackFile` (events), `sequenceFile` (notes), `videoTrackFile`, `takeFile`, `curveFile`, `graphFile` (segments), `chainFile`, `moduleFile`. Browser-safe, because editor panes apply them to unsaved buffers too. |
| The k7x document | `packages/k7x/src/edit.ts` | `K7Document` with `setIn`/`deleteIn`/`applyIn` on key paths, rewriting only the span of the value. |
| The door | `packages/song/src/yaml/workspaceDoc.ts` | `wsEdit(path, edit)` runs a writer on the file's document and writes it back atomically, skipping a write that changes nothing (`packages/song/docs/k7xFiles.md`). |

## Modules

| Module | Purpose |
|---|---|
| `projectEdit.ts` | Changing a project by name: finds the file a module, node or lane lives in (graph or chain layout) and hands the change to its writer. |
| `graphEdit.ts` | The graph verbs, as pure transforms over `graph.k7x`, or — in a chain project — over its chain files read as segments and written back. |
| `trackMix.ts` | Mixer mutations: volume, pan, mute, solo of a lane, written in place. |
| `eventGain.ts` | One audio event's `gain`, ±6 dB, rounded to 0.1, deleted at 0. |
| `eventLoop.ts` | An event's loop switched on or off and its two points moved (the points are the window). |
| `clipResize.ts` | "This event should span these beats" turned into the window (`from`/`to`) and `start`/`loop`. |
| `crossfade.ts` | A crossfade between neighbouring events: overlap them by its length and fade each over it. |
| `materialCut.ts` | Cutting and merging material: `event split` writes two sequences, `selection consolidate` one. |
| `materialWindow.ts` | A DAW's (start, length, offset, loop region) turned into a material window and a placement count — used by imports. |
| `sequenceLoops.ts` | After a sequence is doubled, halve the loop count of each placement so the arrangement does not move. |
| `insertTime.ts` | Insert or delete a span of song time across everything positioned in it: events, takes, alternatives, markers, curve points. |
| `takeEdit.ts` | An event's takes on disk: pick a comp span, drop or add a take, write a MIDI take as its own sequence. |
| `onsets.ts` | A clip's onsets: the engine's detection plus the `onsets.added/removed` corrections. |
| `rackTaps.ts` | A rack node's taps (note and sample), written into the node's file, never the module's. |
| `tapChain.ts` | A tap's subchain edited from the tap: add, remove, move a module; the last removal deletes the subchain. |
| `presets.ts` | A node's presets: listed from every preset tree it can see, applied onto the node, saved from what it resolves to. |
| `alternativeSwitch.ts` | Switch a node to another alternative, and say whether the switch reaches a running engine as plain values. |
| `engineSwitch.ts` | Run a module as another engine by writing `engine:` on the set that is on. |

## Choices

- **A document in, values changed.** Writers take a `K7Scope` and change values in it, so the
  browser can run the same writer on a buffer that has not been saved, and a test compares text.
- **Write where the value belongs.** A rack's taps go into the node, not the module it extends; an
  event's window goes on the placement, not the clip (a clip file describes bytes, a placement
  describes a use).
- **Delete defaults.** A value set back to its default (`gain: 0`, `mute: false`) is removed rather
  than written, so a file states only what is unusual.

## Tests

`npm test` in the package. Each module has a `*.test.ts` that writes a small project to a temporary
folder (or works on a literal text), applies the edit, and compares text: the assertion that matters
is that unrelated lines and comments are unchanged. `packages/song-edit/src/projectEndToEnd.test.ts`
loads a project, runs the writers over it, and checks it still compiles.
