# The layers of a node project

A node project routes sources through a graph. `graph.ts` loads and inspects one
(`l8 graph <project>`).

| layer | what it holds |
|---|---|
| `clips/` + `sequences/` | raw audio and MIDI material |
| `modules/<type>/<name>/module.yaml` | a module: a plugin, io or rack, its params, and an optional `extends` naming another module to inherit from (`modules/io/OUT/module.yaml` is the sink) |
| `nodes/<name>.yaml` | one USE of a module, flat, named by its file — **the arrangements too**: a lane is a node of a `@studio/…-track` module ([trackModules.md](trackModules.md)), and there is no `tracks/` folder |
| `graph.yaml` | the routing SEGMENTS, in one `modules:` map: which module(s) each node feeds |
| `songs.yaml` | m9 only — the médiathèque songs a SET draws on (see [songsFile.md](songsFile.md)) |
| `views/<view>.yaml` | what a VIEW's own controls drive — see [viewBindings.md](viewBindings.md) |

A **set** is this same layout with `clips/` and `sequences/` missing and `songs.yaml`
present: it holds no material of its own, and its lanes are DECKS — declared, with no
arrangement, filled at play time from the set list. Not a dialect of its own: an `.l8`
read by the same loader. See [setProject.md](setProject.md).

The chains themselves are DERIVED from those segments (chainsGraph.ts), not written: a run
is a maximal linear path, breaking where the signal splits and where two signals meet. The
model every consumer downstream reads is unchanged — `from` a track, `use` modules, `out`
to other chains and/or the OUT sink. Only where the runs and their names COME FROM moved.

Which nodes are LANES is not in the file — one `modules:` map, and only what a name extends tells
a lane from a reverb — so `deriveChains` is told, by whoever holds the module map. See
[trackModules.md](trackModules.md).
