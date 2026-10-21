# The layers of a node project

A node project routes sources through a graph. `graph.ts` loads one, and
`scripts/graph.ts` prints it (`k7 graph <project>`).

| layer | what it holds |
|---|---|
| `clips/` + `sequences/` | raw audio and MIDI material |
| `timelines/` | other arrangements, each placed WHOLE as one event on a lane and played through it — see [timelines.md](timelines.md) |
| `nodes/<name>.k7x` | one USE of a module, flat, named by its file — its `extends:` names what it inherits from, an `@workspace/…` or `@k7-core/…` module, `@engine/…` for a scanned plugin, or nothing for a self-contained one (a plugin, an io role, a rack). **The arrangements too**: a lane is a node of a `@meta/…-track` module ([trackModules.md](trackModules.md)), and there is no `tracks/` folder. The module a node extends is never a project's own file — a project has no `modules/` — see [sharedFolders.md](sharedFolders.md) |
| `graph.k7x` | the routing SEGMENTS, in one `modules:` map: which module(s) each node feeds |
| `mix.k7x` | a SET's cue points, written by the desk (see [mixFile.md](mixFile.md)) |
| `views/<view>.k7x` | what a VIEW's own controls drive — see [viewBindings.md](viewBindings.md) |

A **set** is this same layout with `clips/` and `sequences/` missing and a `turntables`
surface present: it holds no material of its own, and its lanes are DECKS — declared, with no
arrangement, filled at play time from the playlist that surface names ([playlists.md](playlists.md)).
Not a dialect of its own: an `.k7` read by the same loader. See [setProject.md](setProject.md).

The chains themselves are DERIVED from those segments (chainsGraph.ts), not written: a run
is a maximal linear path, breaking where the signal splits and where two signals meet. The
model every consumer downstream reads is unchanged — `from` a track, `use` modules, `out`
to other chains and/or the OUT sink. Only where the runs and their names COME FROM moved.

Which nodes are LANES is not in the file — one `modules:` map, and only what a name extends tells
a lane from a reverb — so `deriveChains` is told, by whoever holds the module map. See
[trackModules.md](trackModules.md).
