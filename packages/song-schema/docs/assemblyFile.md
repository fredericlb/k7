# The assembly files

The rationale behind `src/yaml/assemblySchema.ts` and `src/yaml/assemblyFile.ts` — the two
documents an ASSEMBLY is, and the writer over the pair. The concept, and why it is not a group, is
`packages/song/docs/assemblies.md`; this page is about the shapes.

## Two files, because they answer two questions

`assembly.k7x` says what the box **is** — its plugs, and the params promoted onto its face. It sits
in the library beside an ordinary `graph.k7x` and `nodes/`, which say what it is **made of**: a
chain template with one more file, and that file is the whole difference.

`assemblies/<name>.k7x` in a project says which of THIS project's nodes are one of those boxes.
Nothing else: no wiring, no params, no position. Those are already in `graph.k7x`, where every
other per-node fact lives.

## A plug carries its member

```k7x
outputs([name("mix").type("audio").node("fade")])
```

`PortSchema` (`moduleSchema.ts`) says `name`, `type` and `mandatory`; a plug adds `node`, and
optionally `port` when that member declares several ([ports.md](../../song/docs/ports.md)). It has
to: a plug is a name for somewhere the signal already goes, so a box drawn without the member behind
each of its sockets could be wired and never say where the cable landed.

Two plugs of one name on one side are refused, and only on one side — an `in` and an `out` may share
a word. A plug name is what a cable NAMES (`turntableA#mix`), so two of them is a ref with no
reading, which is the same rule `graphSchema` applies to `#b` and `x#`.

## `params:` is keyed by the PROMOTED name

```k7x
params({ Level: { node: "level", param: "Gain" } })
```

The key is the word the box wears, not the plugin's. That is what lets one template promote two
members' `Gain` — a knob called `Level` and a knob called `Trim` — and what makes `setAssemblyParam`
a replace rather than a stack: one name, one knob.

The value names a member and a param, and stops there. No range, no curve, no label: those belong to
the plugin, and a copy of them here would be a second opinion going stale the day it is updated.
This is the same reasoning `viewBindings.md` gives for a surface mapping, which carries a module and
a param and nothing else either.

## `members:` maps the template's name to the project's

That indirection is the reason the whole feature works twice over. Instancing mints
`<box>_<member>`; a MIGRATION folds nodes that already exist — `deckA`, `trimA`, `fadeA` — under the
names they already have, so it renames nothing and touches no line of `graph.k7x`.

A member is a template name and a project node name, so a node rename walks the instances' members
by value: `renameNodeInAssemblies` in `packages/song/src/assemblyEdit.ts`.

## Why every write goes through the Document API

These files are read by people and are in git. `renameAssemblyMember` changes one scalar;
`setAssemblyParam` adds one entry to one map. Reserialising instead would be a canonical document,
which eats every comment in the file — the same reason `moduleFile.ts` and `graphFile.ts` are
written the way they are.

`dropAssemblyParam` takes the empty map with the last entry: `params: {}` says something was
authored and then emptied, which is not what un-promoting a knob means. Same rule as
`setModuleAutomation`'s.

`formatAssembly` is the one place a WHOLE instance file is emitted — `assembly new` and the
migrations — and it takes its header as an argument, since what wrote a file is worth saying and is
not the same sentence in both.

## Browser-safe, like `surfaceFile.ts`

No `node:fs`. The screen that DRAWS a box is the one that has to resolve it, and the builder edits
the template through a store rather than through a path it built. The disk walk is
`packages/song/src/assemblies.ts`, on the other side of that line.

## What the schema does not check

Whether a plug's `node` is a member, whether `uses:` resolves, whether a member exists in the
project: all three need something beyond one file. They live in `assemblies.ts` and in `graph.ts`'s
`validate()`, exactly as `extends` and a rack's `clip` do.
