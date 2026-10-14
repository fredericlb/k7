# moduleFork — giving an engine module a folder

A `@workspace` or `@k7-core` module already has a folder: `module.yaml`, and whichever of `ui.yaml`
and a `jsdsp.ts` it carries. Editing one is writing that folder directly — no
special handling here, no redirect. `@workspace` takes the write immediately, like any other file
k7 saves; `@k7-core` goes through the Edit-then-publish gate instead, since a save there commits and
pushes a repository other songs read (`apps/k7/frontend/docs/sharedModules.md`). Neither needs
this file: it is about the module that has no folder at all.

## The other way in: a module with no folder at all

`@engine` is that module. `engineCatalogue` synthesises `@engine/<slug>` from the machine's plugin
scan, and a chain can name one with nothing on disk. That is a good arrangement — a plugin's
substance is the plugin, and copying 273 folders of wrappers into every workspace buys nothing but
the multiplication.

It stops working the moment you want to *own* something about the module. A panel is a FILE in a
module's folder (`uiLibrary.md`), so a module without one has nowhere to put it. Presets are not:
they live in a presets tree keyed by the ref, so an `@engine` module has them without a folder
(`userPresets.md`). **There is no module without a folder**, put
another way: an engine ref is a name for a plugin, and a module is a folder.

So `materialiseEngineModule` is the act that makes it one:

1. Make `_modules/<category>/<slug>/`, stepping past a name the workspace has taken. Not
   `instanceName`: this one is named after a PLUGIN's own slug and wants it bare, so the folder
   reads as the plugin it is, and the counter only appears when the name is already taken — two
   engine modules can slug the same.
2. Write a `module.yaml` recording **which plugin** to load — the scan is a discovery aid, not the
   project's memory of what it uses, and the project must still open on a machine that has never
   scanned.
3. Carry the panel across, if the engine ref had one drawn under it somewhere readable — its
   header then names the new module instead of the ref it was drawn for, so a `ui.yaml` whose
   comment still points at `@engine/…` does not read as borrowed rather than given.
4. Repoint every chain step naming the ref — *after* the file exists. A chain naming a module with
   no file is precisely what the compiler refuses to load.

Nothing is copied, because there was nothing to copy — an engine ref has no folder to copy FROM.
The result is an ordinary `@workspace` module from that point on: the next edit goes straight to
its own folder, nothing left to materialise.

Two details behind those four steps:

- **`sharedRoots` reads through `moduleLibraryDirs`**, so the médiathèque is among the roots
  `sharedModuleRef` can match a file against. It is the same lookup the file service's panel
  route uses to turn a CLICKED file back into its ref, not only the one this function
  walks on its way to naming a fresh folder's own.
- **`chainsUsing` counts `out` as well as `use`.** A module several things feed is a chain of its
  own, and a chain that only ever names itself tells nobody anything — which is why its own chain
  is left out. Called once BEFORE the repoint, to find what still names the bare ref, and once
  AFTER, so the report names what the new module actually plays in rather than which nodes moved.

## Why a folder and not a node

The obvious shape is a node file naming the plugin directly — `<slug>.yaml` in `nodes/`, which is
exactly what `createNode` already writes for an engine pick nobody has materialised. Two things
rule it out as the general answer:

* **A node's `ui:` has no effect.** `loadModules` takes the widget grid whole from what a node
  extends, because a grid is laid out as a unit and half-merging two authors' grids produces
  overlapping cells nobody wrote. A node has nowhere of its own to keep a panel, so materialising
  one would drop most of what people reach for `module own` *for*.
* **A module resolves against its own folder.** `jsdsp:`, `.vstpreset` and rack audio are all read
  relative to the module's directory — deliberately, so a module stays a self-contained folder you
  can copy or share. A lone node file has no folder of its own to resolve against.

A folder gets both, and it is the same reason a shared module is a folder in the first place
rather than a flat file: a panel is per-PLUGIN, not per-use, and every node that later extends this
one shares it.

## Reached as `module own <ref>`

The command, so the CLI and the web share it. In the chains graph a right-click on an
`@engine/…` block offers it instead of `ui file`, which has no file to open.
