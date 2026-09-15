# moduleCatalogue — what a workspace can name in a chain

`moduleCatalogue` lists what **this workspace** can name in a chain, which is what the module picker reads.
It feeds no builder.

A module is a **workspace** thing. It lives once, in `_modules`, and the same file backs every project beside
it (see `sharedFolders.md`). So the builder is not reached from the chains graph — a small "edit module"
button on a step, opening that module's file — for two reasons. Opening it from inside one song would look
like a per-project edit and never be one: the only thing making it behave like one is that saving forks a copy
(`moduleFork.md`), which is a workaround for an entry point rather than a design. And for a module the project
inherits it would not work at all, since resolution through `hints.paths` by construction only holds the
project's **own** modules, so a shared one comes back "couldn't resolve".

st0 is the builder's only host, because a parameter list is a fact about a LOADED plugin and only
a project loads one (`apps/st0/frontend/docs/moduleBuilder.md`). What answers the "a module is a
workspace thing" objection is not where the builder lives but **which tree you opened it from**:
the file tree's Libraries tab lists the shared libraries as themselves, so a shared module is
opened as shared and says so (`apps/st0/frontend/docs/sharedModules.md`).

## What is listed

`moduleCatalogue(dir)` returns the **generic** modules of every shared root the project inherits, in ref order.

Each row carries `panel`, the grid size of the module's panel when it has one, and so does
`listBaseModuleRefs`: the picker draws the card of a node being created before that node exists,
and a card is as big as its grid (`apps/st0/frontend/docs/chainsGraph.md`).

Generics only. A node (`IN:in-2`, a channel; a preset variant) has no face of its own — `loadModules`
takes a widget grid whole from the generic, so a `ui:` written on a node is ignored — and a builder aimed
at one would edit nothing. Nodes are a count on their generic's row instead.

The substance comes from `loadModuleRefs`, so what is listed is exactly what a chain can name. The **path** is
derived from the ref: `@<ns>/<type>/<sub>` is the module's position inside the root that declares `<ns>`, which
is how `readModuleTree` keyed it in the first place. An entry whose file cannot be found is dropped rather than
listed — the builder's one job is to open it, and a row that only ever reports an error is worse than no row.

## Saving

Nothing here saves. A workspace's `_modules` is read-only without exception — `Workspace.write` carries no
escape hatch. A save aimed at a shared module forks (`moduleFork.md`), for everybody, which is what read-only
does here instead of refusing.

Edits to a MÉDIATHÈQUE module happen against pl8's own service, from st0's Libraries tab — a
second store over the same builder, and the confirmation in front of it is there because that
library has no fork to fall back on. A workspace's `_modules` has no such tab and no such route:
it is read-only, and a save aimed at it forks. The panel is the one thing that still saves in place:
it is the `ui.yaml` inside the module's folder (`uiLibrary.md`), and `Workspace.write` lets that one file through
because drawing a knob must not fork the module.

An ENGINE module has no folder, so it has no panel and cannot be given one — `writeUiFile` refuses rather than
filing it somewhere arbitrary. `hasUi` is false for every one of those rows.
