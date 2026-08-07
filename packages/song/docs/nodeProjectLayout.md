# The layers of a node project

A node project routes sources through a graph. `graph.ts` loads and inspects one
(`l8 graph <project>`).

| layer | what it holds |
|---|---|
| `clips/` + `sequences/` | raw audio and MIDI material |
| `tracks/<id>.yaml` | arrangements — positioned clips and sequences, plus track settings |
| `modules/<type>/<name>/module.yaml` | a module: a plugin, io or rack, its params, and an optional `extends` naming another module to inherit from (`modules/io/OUT/module.yaml` is the sink) |
| `modules/<type>/<name>/<inst>.yaml` | an instance of that module, inheriting its `module.yaml` and used as `"<name>:<inst>"` |
| `chains.yaml` | the routing SEGMENTS: which module(s) each track and each module feeds |
| `songs.yaml` | m9 only — the médiathèque songs a SET draws on (see [songsFile.md](songsFile.md)) |
| `views/<view>.yaml` | what a VIEW's own controls drive — see [viewBindings.md](viewBindings.md) |

An **m9 set** is this same layout with `clips/` and `sequences/` missing and `songs.yaml`
present: it holds no material of its own, and its tracks are DECKS — declared, with no
arrangement, filled at play time from the set list. See [m9Project.md](m9Project.md).

The chains themselves are DERIVED from those segments (chainsGraph.ts), not written: a run
is a maximal linear path, breaking where the signal splits and where two signals meet. The
model every consumer downstream reads is unchanged — `from` a track, `use` modules, `out`
to other chains and/or the OUT sink. Only where the runs and their names COME FROM moved.
