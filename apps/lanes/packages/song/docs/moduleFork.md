# moduleFork — editing a module you don't own

The workspace's `_modules` folder is a library, shared by every project beside it. It holds what someone WROTE
— jsdsp and racks — and is the vocabulary a project inherits through `project.modules_from`: a chain step names
one of its modules by ref (`@library/audio/delay/tape-delay`), and the module itself lives once, in the library.

Only the library forks. An `@engine` module has no file — the engine reports it — so there is nothing to copy
and nothing to guard: `sharedModuleRef` matches a real path under a `modules_from` root, which an engine ref
never has.

Which is exactly why nothing may write to it from the web UI. A save into `_modules` while mixing one song
changes every other song in the workspace, silently, with no author, no diff a musician would ever look at and
no way back. So the library is **read-only to every route**, enforced in `Workspace.guardShared` rather than in
the UI, since the routes are reachable without it.

Read-only alone would be a dead end, though: a module has to be changeable somewhere. So a save aimed at a
shared module is not refused — it is redirected.

**One caller opts out.** The module builder's whole subject *is* the library (see `moduleCatalogue.md`): it
lists `_modules` and edits what it lists, so redirecting its save would put the edit in a project it was never
aimed at. It passes `editShared` to `Workspace.write`, and nothing else does. The rule above still holds for
every other way in — a module file opened from the file tree still forks, because from there the edit really
was aimed at one song.

## What a fork does

`forkSharedModule(dir, file, content)`:

1. **Identify the module.** `sharedModuleRef` walks the project's `modules_from` roots, finds the one containing
   the file, and rebuilds the ref exactly the way `readModuleTree` keys it — `<type>/<leaf>`, or
   `<type>/<category>/<leaf>` one folder deeper. A path it returns a ref for is a path the loader agrees about.
2. **Name the copy after the track that plays it.** The first chain whose steps name the ref gives the name:
   `<track>_<leaf>_<n>`, with `<n>` stepping past any folder already there. A module the project doesn't play
   yet has no track to be named after and forks as `<leaf>_<n>` — it still forks, or the edit would be lost.
3. **Copy the folder**, sidecars included, and write `content` as its module file.
4. **Repoint the chains** — every step naming the ref now names the copy — *after* the files exist. A chain
   naming a module with no file is precisely what the compiler refuses to load.

The result is an ordinary project-local module. The next save goes straight to it; only the first edit forks.

## Why a folder and not an instance

The obvious shape is an instance file beside the shared module — `<track>_<leaf>_<n>.yaml`, which is what the
loader already offers for "the same module, tweaked here". Two things rule it out:

* **An instance's `ui:` has no effect.** `loadModules` takes the widget grid whole from the generic (see
  `instances.test.ts`), because a grid is laid out as a unit and half-merging two authors' grids produces
  overlapping cells nobody wrote. Editing the UI is most of what the module editor does, so an instance would
  drop most of what people fork *for*.
* **A module resolves against its own folder.** `jsdsp:`, `.vstpreset` and rack audio are all read relative to
  the module's directory — deliberately, so a module stays a self-contained folder you can copy or share. A
  lone instance file has no folder of its own to resolve against.

Copying the folder gets both, at the cost of duplicating a module the library also holds. That duplication is
the point: the project now owns its copy, and a later edit to the library cannot reach it.

## What the UI does with it

`PUT /file` answers `{ ok: true, forked }` when the save was redirected. Both editors follow the copy — the
module editor re-aims at it (so the params and presets shown belong to the copy), the text editor opens it —
and say so in the status bar, naming the chains that moved. `FileTree` hides its mutating actions inside
`_modules` entirely, so the read-only rule is visible before it is hit rather than after.

Since the builder moved to the catalogue, the fork's live entry point is the file tree: it is what happens when
a module file is opened as a *file*, in a song, rather than as a module.
