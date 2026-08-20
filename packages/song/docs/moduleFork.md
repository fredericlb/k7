# moduleFork — editing a module you don't own

The workspace's `_modules` folder is a library, shared by every project beside it. It holds what someone WROTE
— jsdsp and racks — and is the vocabulary a project inherits from the roots beside it: a chain step names
one of its modules by ref (`@library/audio/delay/tape-delay`), and the module itself lives once, in the library.

Only the library forks. An `@engine` module has no file — the engine reports it — so there is nothing to copy
and nothing to guard: `sharedModuleRef` matches a real path under a shared root, which an engine ref
never has. It has its own way in, at the bottom of this page.

Which is exactly why nothing may write to it from the web UI. A save into `_modules` while mixing one song
changes every other song in the workspace, silently, with no author, no diff a musician would ever look at and
no way back. So the library is **read-only to every route**, enforced in `Workspace.guardShared` rather than in
the UI, since the routes are reachable without it.

Read-only alone would be a dead end, though: a module has to be changeable somewhere. So a save aimed at a
shared module is not refused — it is redirected.

**One thing opts out: `ui.yaml`.** There used to be a general escape hatch, `editShared`, for the module builder
whose whole subject *was* the library; the builder lives in the médiathèque now (see `moduleCatalogue.md`), so
that one has no caller left and is gone. What replaced it is far narrower and named in `Workspace.write`: a
module's **panel**, and nothing else. (Its `presets.yaml` is the same kind of file but stays inside the rule —
a shelf is per-song taste, where a panel is per-plugin.) A panel is drawn for the plugin, not for the song, so forking a whole
module to move a knob is precisely the copy nobody wanted — it was reason enough to invent a separate UI tree
once, and this exception is what makes that tree unnecessary (see `uiLibrary.md`). Everything a module *is*
stays read-only, and every save aimed into it forks — including one that meant it.

## What a fork does

`forkSharedModule(dir, file, content)`:

1. **Identify the module.** `sharedModuleRef` walks the project's shared roots, finds the one containing
   the file, and rebuilds the ref exactly the way `readModuleTree` keys it — `<type>/<leaf>`, or
   `<type>/<category>/<leaf>` one folder deeper. A path it returns a ref for is a path the loader agrees about.
2. **Name the copy after the track that plays it.** The first chain whose steps name the ref gives the name:
   `<track>_<leaf>_<n>`, with `<n>` stepping past any folder already there. A module the project doesn't play
   yet has no track to be named after and forks as `<leaf>_<n>` — it still forks, or the edit would be lost.
   That rule is `instanceName.ts` and is not this file's alone any more: a NODE is named the same way
   (`docs/nodes.md`), which is the same question asked about a use rather than about a copy. It was two
   implementations that happened to agree, and one of them was a person typing.
3. **Copy the folder**, sidecars included, and write `content` as its module file.
4. **Repoint the chains** — every step naming the ref now names the copy — *after* the files exist. A chain
   naming a module with no file is precisely what the compiler refuses to load.

The result is an ordinary project-local module. The next save goes straight to it; only the first edit forks.

## Why a folder and not a node

The obvious shape is a node file beside the shared module — `<track>_<leaf>_<n>.yaml`, which is what the
loader already offers for "the same module, tweaked here". Two things rule it out:

* **A node's `ui:` has no effect.** `loadModules` takes the widget grid whole from the generic (see
  `nodes.test.ts`), because a grid is laid out as a unit and half-merging two authors' grids produces
  overlapping cells nobody wrote. Editing the UI is most of what the module editor does, so a node would
  drop most of what people fork *for*.
* **A module resolves against its own folder.** `jsdsp:`, `.vstpreset` and rack audio are all read relative to
  the module's directory — deliberately, so a module stays a self-contained folder you can copy or share. A
  lone node file has no folder of its own to resolve against.

Copying the folder gets both, at the cost of duplicating a module the library also holds. That duplication is
the point: the project now owns its copy, and a later edit to the library cannot reach it.

## What the UI does with it

`PUT /file` answers `{ ok: true, forked }` when the save was redirected. The text editor follows the copy and
says so in the status bar, naming the chains that moved. `FileTree` hides its mutating actions inside
`_modules` entirely, so the read-only rule is visible before it is hit rather than after.

The file tree is now the fork's ONLY entry point: it is what happens when a module file is opened as a *file*,
in a song, rather than as a module. Opening it as a module means opening the médiathèque.

## The other way in: a module with no folder at all

`materialiseEngineModule` is the same act aimed at the opposite problem. A **scanned plugin** is a module with
no files anywhere: `engineCatalogue` synthesises `@engine/<slug>` from the machine's scan cache, and a chain
can name one with nothing on disk. That is a good arrangement — a plugin's substance is the plugin, and
copying 273 folders of wrappers into every workspace is what `module populate` used to do and why it went.

It stops working the moment you want to *own* something about the module. A panel and a shelf of presets are
FILES in a module's folder (`uiLibrary.md`, `userPresets.md`), so a module without one has nowhere to put
them. **There is no module without a folder**, put another way: an engine ref is a name for a plugin, and a
module is a folder.

So this is the moment it becomes one:

1. Make `modules/<category>/<slug>/`, stepping past a name the project has taken.
2. Write a `module.yaml` recording **which plugin** to load — the scan is a discovery aid, not the project's
   memory of what it uses, and the project must still open on a machine that has never scanned.
3. Repoint every chain step naming the ref, exactly as a fork does.

Nothing is copied, because there was nothing to copy. It returns the same `ForkedModule`, because it is the
same answer to "this module isn't yours yet".

Reached as `module own <ref>` — the command, so the CLI and the web share it. In the chains graph a right-click
on an `@engine/…` block offers it instead of `ui file`, which has no file to open.
