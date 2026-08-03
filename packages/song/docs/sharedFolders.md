# sharedFolders.ts — extended notes

A workspace holds three folders every project in it wants. Two are invisible until the
project SAYS so in its `project.yaml`; the third is derived from the first (see "Where a
panel lives" below):

- **`_modules/`** — the module LIBRARY: what someone wrote, jsdsp and racks, with a
  `config.yaml` naming its namespace. Declared in `modules_from` (a LIST — a project may
  point at several), after which its modules are referenceable as
  `@library/<type>/<category>/<name>` (see `loader.ts` `loadModuleRefs`). It is no longer
  a plugin catalogue: the engine answers for the plugins it can load, as `@engine/<slug>`,
  with no files anywhere.
- **`_library/`** — the shared assets (`ir/` impulse responses, `nam/` amp models).
  Declared in `libraries_from` (a LIST, migrated from the old singular `library_from`),
  after which a module can name a file inside it and the module editor's library
  dropdowns have something to offer. Without it `libraryDirs()` returns `[]` and every
  one of those dropdowns is empty.

Every project wants both, so nothing here asks: `scaffold` writes them into a new
project.

**THE FOLDER MUST EXIST FIRST.** `loadModuleRefs` THROWS on a `modules_from` path it
can't resolve ("folder not found"), so writing the field speculatively would turn a
working project into one that won't load. (`libraries_from` is gentler — a missing entry
just resolves to nothing — but pointing at nothing is still a lie in the file.) Every
function here checks, and does nothing when the folder isn't there; running
creating the library folder first is the order that works.

`declared()` reads the raw YAML document rather than compiling the project, because this
runs during `scaffold`, before there is a project to compile, and must not care whether
the rest of the file is valid yet.

`ensureSharedLibrary` also migrates the old singular `library_from` field into the new
`libraries_from` list, so a project written before the multi-library change doesn't
silently lose its assets.

## Where a panel lives — and why there is no list for it

A module's UI panel is the `ui.yaml` in the module's own folder (see uiLibrary.ts). It used
to be a parallel tree, found at one hard-coded place, `../_ui` — fine while there was
exactly one library, wrong the moment a project can also draw modules from a mediatek
outside the workspace, and wrong again once you notice the panel and the module could
disagree about which module the panel drew.

`modulePanelRoots()` is what is left of that machinery: the project's own `modules/` first,
then every root `modules_from` names. There is nothing panel-specific about it any more —
it is the list of module libraries, and the panels are in them.

Deriving beats declaring here, and putting the file in the folder beats deriving. A panel is
not an independent asset like an impulse response; it is the face of a module, so it travels
with the module itself. Point a project at a library and the faces come along, with no way
to end up with modules from one place and panels from another.

**Order is precedence.** `loadUiLibrary` reads every library, nearest first, so a project
that forked a shared module draws its own face rather than the one it was copied from. What
is gone is the write-one half of the old rule: `writeUiFile` writes the panel where its
module is, shared library included. See `docs/uiLibrary.md` for why that exception exists
and what it costs.

`moduleNamespaceOf()` lives here too, because it is the one fact that separates the two
kinds of root: a library declaring a namespace in its `config.yaml` keys its modules
`@<ns>/<type>/<sub>`, and a project's own `modules/` keys them bare. Everything that turns a
folder into a ref, or a ref back into a folder, turns on that.
