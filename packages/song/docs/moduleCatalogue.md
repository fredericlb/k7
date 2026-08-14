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

So the builder moved — three times. First to l8' settings panel; then out of l8 entirely, into
`apps/st0` where the modules themselves live; and then back, because a parameter list is a fact
about a LOADED plugin and only a project loads one (`apps/l8/frontend/docs/moduleBuilder.md`).
l8 is its only host now. What answers the "a module is a workspace thing" objection is not where
the builder lives but **which tree you opened it from**: the file tree's Libraries tab lists the
shared libraries as themselves, so a shared module is opened as shared and says so
(`apps/l8/frontend/docs/sharedModules.md`).

`moduleCatalogue` stays, and is still useful, because it answers a different question: it lists what **this
workspace** can name in a chain, which is what the module picker reads. What it no longer
does is feed a builder.

## What is listed

`moduleCatalogue(dir)` returns the **generic** modules of every shared root the project inherits, in ref order.

Generics only. A node (`IN:in-2`, a channel; a preset variant) has no face of its own — `loadModules`
takes a widget grid whole from the generic, so a `ui:` written on a node is ignored — and a builder aimed
at one would edit nothing. Nodes are a count on their generic's row instead.

The substance comes from `loadModuleRefs`, so what is listed is exactly what a chain can name. The **path** is
derived from the ref: `@<ns>/<type>/<sub>` is the module's position inside the root that declares `<ns>`, which
is how `readModuleTree` keyed it in the first place. An entry whose file cannot be found is dropped rather than
listed — the builder's one job is to open it, and a row that only ever reports an error is worse than no row.

## Saving

Nothing here saves any more. A workspace's `_modules` is read-only without exception — the escape hatch
(`editShared` on `Workspace.write`) is gone, because the one caller that used it moved out. A save aimed at a
shared module still forks (`moduleFork.md`), for everybody, which is what read-only does here instead of
refusing.

Edits to a MÉDIATHÈQUE module happen against st0's own service, from l8's Libraries tab — a
second store over the same builder, and the confirmation in front of it is there because that
library has no fork to fall back on. A workspace's `_modules` has no such tab and no such route:
it is read-only, and a save aimed at it forks. The panel is the one thing that still saves in place:
it is the `ui.yaml` inside the module's folder (`uiLibrary.md`), and `Workspace.write` lets that one file through
because drawing a knob must not fork the module.

An ENGINE module has no folder, so it has no panel and cannot be given one — `writeUiFile` refuses rather than
filing it somewhere arbitrary. `hasUi` is false for every one of those rows.
