# moduleCatalogue — the module builder's list

The module builder used to be reached from the chains graph: a step showed a small "edit module" button, and
clicking it opened that module's file. That reading was wrong in a way that only showed up once shared modules
became nameable directly.

A module is a **workspace** thing. It lives once, in `_modules`, and the same file backs every project beside
it (see `sharedFolders.md`). Opening it from inside one song looked like a per-project edit and never was —
the only reason it behaved like one is that saving forked a copy (`moduleFork.md`), which is a workaround for
the entry point, not a design. And for a module the project inherited, it did not work at all: the resolution
went through `hints.paths`, which by construction only holds the project's **own** modules, so a shared one
came back "couldn't resolve".

So the builder moved. It is an entry in the settings panel, beside I/O — `ModulesPage` lists the catalogue,
picking one opens its builder, and there is no path from the graph.

## What is listed

`moduleCatalogue(dir)` returns the **generic** modules of every shared root the project inherits, in ref order.

Generics only. An instance (`IN:in-2`, a channel; a preset variant) has no face of its own — `loadModules`
takes a widget grid whole from the generic, so a `ui:` written on an instance is ignored — and a builder aimed
at one would edit nothing. Instances are a count on their generic's row instead.

The substance comes from `loadModuleRefs`, so what is listed is exactly what a chain can name. The **path** is
derived from the ref: `@<ns>/<type>/<sub>` is the module's position inside the root that declares `<ns>`, which
is how `readModuleTree` keyed it in the first place. An entry whose file cannot be found is dropped rather than
listed — the builder's one job is to open it, and a row that only ever reports an error is worse than no row.

## Saving

The builder writes the shared file in place. That is what "per-project module UI editing is removed" means
concretely: there is no project copy any more, and an edit here changes every project in the workspace. The
mechanism is the `editShared` flag on `Workspace.write` — see `moduleFork.md` for why the fork still exists for
every other caller.

The panel itself is unaffected by any of this: it already lived outside the module, in the workspace's `_ui`,
keyed by ref (`uiLibrary.md`). It was the module file, not the grid, that needed a way in.
