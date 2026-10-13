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
2. **One door for reading and writing a file** — a module in `song-schema` that opens a file by its
   kind and returns a document with the operations the writers use, backed by `yaml` or `k7x` by
   extension. The 81 importers move onto it one package at a time, with `yaml` still underneath, so
   this phase changes no file on disk.
3. **Reading `.k7x`** — wherever a kind is looked up by name (`project.yaml`, `graph.yaml`,
   `module.yaml`…), `.k7x` is found first and `.yaml` second. A writer writes back the file it read.
4. **live-sync over k7x** — the same key paths and the same natural list keys
   (`packages/live-sync/src/listKeys.ts`), diffed on the k7x tree. Until then a `.k7x` change travels
   as whole text, which costs bandwidth and never correctness.
5. **The editor** — highlighting and completions for `.k7x`, derived from the same zod schemas as
   today's (`packages/song-schema/docs/fields.md`).
6. **Conversion** — `demos/` and `st0-library/` in one commit each; stored workspaces by a one-shot
   pass per account through the file service, which converts a file only when it reads back equal
   and keeps the original beside it until that account's next sync confirms the copy.
7. **YAML removed** — new files are written as `.k7x`, `.yaml` is no longer looked up, and `yaml`
   leaves every package but the converter.
8. **Sugar, kind by kind** — forms only one kind of file has, read by that kind's reader into the
   same data: mini-notation for a sequence's notes, `.to(…)` for the graph's segments. Each is
   optional to write, and none changes the data a schema sees.

## The hazards

- **A half-migrated workspace**: a project folder holding both `graph.yaml` and `graph.k7x`. Phase 3
  settles it: `.k7x` wins, and the conversion deletes the `.yaml` only once the `.k7x` reads back
  equal.
- **A device on an older build**: it cannot read `.k7x`. Phase 6 does not start before every
  shipped desktop and phone build reads it (phase 3 released).
