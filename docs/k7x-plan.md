# k7x — the plan

Every YAML file of a workspace becomes a `.k7x` file: the same data, written in a syntax that reads
like Strudel and is never evaluated. The language and why it is shaped that way:
[packages/k7x/docs/language.md](../packages/k7x/docs/language.md).

## What "every text file" covers

The YAML files, which are the files a person writes and the UI edits: project, graph, modules, nodes,
sequences, curves, surfaces, chains, assemblies, playlists, ui panels. Out of scope, each for its own
reason:

| files | why they stay |
|---|---|
| `.strudel` | code the engine runs; k7x borrows its look precisely so these need not change |
| `.dsp` (Faust), `jsdsp.ts`, `.glsl` | code, in the language its compiler reads |
| `.json` | amp-model weights and generated `jsdsp.json` — written by tools, not by hand |
| `.md` | prose |

## Measured scope

- 81 source files import `yaml` outside tests; `parseDocument` is called 236 times and
  `getIn`/`setIn`/`deleteIn`/`hasIn` about 270 — the line-preserving Document API is the contract
  the writers depend on, not `parse`/`stringify`.
- 1,259 YAML files in `demos/` and `st0-library/`, plus every workspace stored on a server or a
  device.
- No C++ or Kotlin reads YAML: the engine receives a compiled `ProjectDoc`. The change is
  TypeScript-only.

## Phases

1. **The core** — `@studio/k7x`: grammar, span-carrying tree, canonical printer, a document whose
   edits keep every other byte, and the YAML converter. Proven on the whole corpus
   (`packages/k7x/src/corpus.test.ts`). Done.
2. **One door for reading and writing a file** — `packages/song/src/yaml/workspaceFile.ts`, at the
   input/output boundary rather than in each writer: code keeps its YAML names and YAML text, and a
   `.k7x` file is read as YAML and written as edits through the bridge
   (`packages/k7x/docs/bridge.md`). Every node-side read, write, existence check, copy, rename and
   removal of a workspace file goes through it, and so does the file service's `/file` route for a
   YAML name (`packages/song/docs/k7xFiles.md`). Done.
3. **Reading `.k7x`** — wherever a kind is looked up by name, `.k7x` is found first and `.yaml`
   second; a writer writes back the file it read; a folder listing, the revision token and the
   browser's path rules accept both. Every demo, converted whole, compiles to the same document and
   takes the same commands as its YAML original (`packages/commands/src/k7xFiles.test.ts`). Done.
4. **live-sync over k7x** — a `.k7x` change is a `k7x` op: the same key paths and natural list keys
   (`packages/live-sync/src/listKeys.ts`), diffed on the k7x tree, replayed byte for byte, checked
   and set aside by the room like a YAML op (`packages/live-sync/docs/ops.md`). Done.
5. **The editor** — a `.k7x` file has its own colours (`packages/ui-editor/src/k7x/language.ts`),
   completion from the same zod-derived vocabulary as YAML (`packages/ui-editor/docs/completion.md`),
   and the same check before autosave, its findings placed on the k7x text's own lines — in the
   browser and in the loader's messages alike. Done.
6. **Conversion** — `demos/` and `st0-library/` are `.k7x`, each converted in a commit of its own by
   `packages/song/scripts/migrateK7x.ts`, every file checked to read back to the same data. Stored
   workspaces convert through the file service's `POST /migrate-k7x`, one account at a time, the
   originals kept in the workspace's hidden `.k7x-backup/` (`packages/song/docs/k7xFiles.md`). That
   route refuses a real run until `STUDIO_K7X=1`: turning it on, once every shipped build
   reads `.k7x`, is the step this phase leaves to the deploy.
7. **YAML retired**, in two steps that do not share a risk.
   - **New files as `.k7x`**: with `STUDIO_K7X=1`, a file created through the workspace door — a
     command, the editor, the module scaffold, a `.dawproject` import — is written as `.k7x`
     (`packages/song/docs/k7xFiles.md`). The same switch as the migration, since both are safe exactly
     when every device reads k7x. Done.
   - **`.yaml` no longer looked up**: only once every workspace has migrated, since it makes any YAML
     left anywhere unreadable — and the repository's own tests write their fixtures as YAML, which
     would first move to k7x or to the YAML copy `testSupport` gives. Readers still receive YAML text
     through the bridge; each moves to reading k7x data directly as it is next touched, and `yaml`
     leaves a package once none of its readers needs the bridge.
8. **Sugar, kind by kind** — `notes("c4 d4 ~ e4")` for a sequence's notes, `runs([[…]])` for a
   graph's segments (a chain cannot repeat `.to(…)`, a key being unique in a map). Expanded before
   any reader sees the file; kept through an edit that leaves its expansion alone, written as the full
   data by one that changes it (`packages/song-schema/docs/sugar.md`). Done.

## The hazards

- **A half-migrated workspace**: a project folder holding both `graph.yaml` and `graph.k7x`. `.k7x`
  wins, and the conversion deletes the `.yaml` only once the `.k7x` reads back equal.
- **A writer that transforms YAML text with a pattern** sees the bridge's layout, not the author's.
  It still writes the right data, since only data is applied, but a pattern that expected one layout
  may find nothing to change. The demo commands are the guard; a new text-pattern writer needs one.
- **A device on an older build**: it cannot read `.k7x`. Phase 6 does not start before every
  shipped desktop and phone build reads it (phase 3 released).
