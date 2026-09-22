# `@meta/not-supported` — the node an unloadable plugin leaves behind

A DAWproject carries plugin names this machine may have nothing to load: a VST3 nobody installed,
an Ableton device, a plugin that exists only on the other musician's laptop. The import has to put
*something* where each one was, because a chain with a hole in it is a chain that routes wrong.

What it puts there is a **node** on `@meta/not-supported`, and no module of its own.

## Why not a module per plugin

The obvious shape is a module of its own carrying `plugin: { name: "Kontakt 7" }` and no `type` —
a stub, routing only. **A module that adds nothing to what it stands for should not exist.**
Sixteen unloadable plugins would mean sixteen folders under `_modules/`, each holding one line,
each in the picker, each a thing to delete by hand when the plugin is finally installed — and
shared workspace-wide, so every song's unrelated import clutters the same list.

The node carries what is actually specific: the plugin's real name as `label:`, and the parameter
values the export carried. Nothing is lost, and the project has one file per USE rather than one
folder per plugin plus one file per use.

## Why `@meta` and not `@st0`

`@st0` is the **médiathèque** — the account's library, which lives on a volume this machine may
not have mounted and which a fresh clone certainly does not. A ref there is one an import can
write and then fail to resolve, and an unresolvable `extends` is a project that will not open at
all: a worse failure than the one this is fixing.

`@meta` is the built-in namespace with no folder — `@meta/doc`, `@meta/track` — seeded into
the ref map by `loader.ts` on every load. It resolves everywhere, always, with nothing installed.
That is the whole reason.

## What the module is

`notSupportedModule.ts`, and every field is a decision:

- **`plugin: { type: not_supported }`** — the marker the graph already reads to draw a node amber
  (`packages/file-service/docs/graphFlags.md`). Reusing it rather than inventing a flag means the
  UI needed no change at all.
- **`inputs: []`** — *unconstrained*, and this is the field that matters. An empty input list opts
  the step out of `checkChainInputs` entirely, which is right: the placeholder stands where a
  plugin was and nothing knows what that plugin took. Declaring `audio` in would refuse an
  unloadable INSTRUMENT fed MIDI, on a project that is already only trying to open.
- **`category: "misc"`** — deliberately NOT a type folder. `MODULE_TYPES` has no `misc`, so nobody
  can author `modules/misc/…`, and the placeholder stays the one thing that answers to it.

It compiles to nothing: `nodeProject.ts` gates on the plugin format, `not_supported` is not one,
and the step contributes no plugin. The signal routes through, which is what a bypass is.

## The diagnostic

`notSupportedModules(dir)` reports one warning per use, and it reads the **resolved** module rather
than the authored file — the marker is inherited now, so the node's own YAML says nothing about it.
It reports at the node's own flat path (`nodes/<name>.yaml`) and names the plugin by its `label:`,
which is the only place the real name survives once the node is called `kontakt_7`.
