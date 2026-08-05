# song — the folder becomes a document

`packages/song` is the layer that turns a directory of YAML into two flat documents:

- **ProjectDoc** — what the engine plays: tracks, clips resolved to absolute paths, plugins with their parameters. The engine's whole input.
- **GraphDoc** — what the Chains view draws: the routing graph, modules, signals.

Everything else reads these rather than the files. That is the boundary that keeps the engine free of parsing and the UI free of folder layout.

Inside, `yaml/` holds one Zod schema per entity kind, and those schemas are the contract: they validate on load, and the editor's completions are derived from the same definitions, so what the editor offers and what the loader accepts cannot drift.

It also resolves **module inheritance** (`extends`), **instances** (a file in the project's flat `instances/`, named by its filename and reaching its module through `extends` like anything else), and Strudel patterns.
