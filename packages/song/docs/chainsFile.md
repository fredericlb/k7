# chainsFile.ts — extended notes

chains.yaml declares SEGMENTS — one `modules:` map, each node listing where its signal goes (a LANE is a module
too, see trackModules.md, which is why there is no second half) — and the
chains are derived from them (chainsGraph.ts). Everything here follows from that: an edit is an edge rewire, and
a module is named exactly once.

The four edits the app actually makes (the honest test set):

- **bypass a module** — the graph's bypass button, many times a session
- **insert a module** — `module insert`, and the graph's drop-on-an-arrow
- **take a module out of the signal path** — `node unlink` (`module delete`, which removed the
  files as well, is gone: deleting them is the file tree's)
- **rename a module** — forking a shared module into the project (`module replace` used to do
  this too; it repoints a node's `extends:` now and never touches a chain)

## What the shape bought

- **Bypass no longer needs a chain named.** The list format let one module sit in two chains, so bypassing it in
  one had to leave the other running — `module bypass` had to find the chains, refuse when there were two, and
  the frontend had to carry a chain name alongside the module. A module is named once here, so there is one
  thing to toggle. That is why `bypassed` is a flat list at the root and not a field on the node: there is no
  second copy for it to get out of step with.
- **Insert is two node names, not a chain and an index.** The old `insertStepAt` took a position in a list and
  clamped it so the module stayed ahead of the sink; `insertBetween` takes the two ends of one arrow, which is
  what the caller had in the first place.
- **Remove has to SPLICE.** This is the one thing the list format got for free: deleting a list item closed the
  gap. Here the gap has to be closed on purpose — whatever fed the module now feeds what it fed — or the file
  still parses and the track goes quiet with nothing to point at.

## Formatting

- A node's destinations are a FLOW sequence on one line. In block style each destination is its own line, so a
  ten-module song becomes forty lines and an insert is a four-line diff; in flow it is one line per node.
- The file has to already be in the library's own flow spacing (`[ a, b ]`). Edit a file written any other way
  and every flow line in it is re-spaced — a diff on nodes nobody touched. `formatChains` emits the canonical
  form, and the migration writes it.
- `OPTS` pins YAML 1.2 (keeps `5:1:1`-shaped scalars as strings — see moduleFile.ts) and `lineWidth: 0` (keeps
  destinations on ONE line; at the default of 80 a node that grows past it is re-emitted across several lines).

## The colon

Module names carry `:` — `eq_dj:vox` is a node, `@engine/io/IN:in-1` an inherited one. They were values
before and are map KEYS now, which is where `:` is most dangerous: it is YAML's own key/value indicator. It
survives, because 1.2 allows `:` inside a plain scalar when no space follows. Nothing about that is obvious, and
it is the first thing that would break silently, so chainsYaml.test.ts pins it.

A ref starting with `@` is a different matter: `@` really is reserved, so those keys must be quoted. The library
quotes them on its own — but `renameNode` clears the scalar's `type` when it swaps a name, or every module
renamed over a ref would keep wearing the ref's quotes.
