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

So the builder moved — twice. First to lanes' settings panel, and then out of lanes entirely: it lives in
`apps/mediatek` now, where the modules themselves do. The settings entry that used to open it is a link out.

`moduleCatalogue` stays, and is still useful, because it answers a different question: it lists what **this
workspace** can name in a chain, which is what the module picker and the docs panel read. What it no longer
does is feed a builder.

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

Nothing here saves any more. A workspace's `_modules` is read-only without exception — the escape hatch
(`editShared` on `Workspace.write`) is gone, because the one caller that used it moved out. A save aimed at a
shared module still forks (`moduleFork.md`), for everybody, which is what read-only does here instead of
refusing.

Edits happen in the médiathèque, against its own service. The panel is unaffected by any of this: it always
lived outside the module, keyed by ref (`uiLibrary.md`) — first in the workspace's `_ui`, now in the library's
`ui/` beside the modules it draws.
