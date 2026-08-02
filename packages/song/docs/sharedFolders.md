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

## Where a panel lives — `_ui/`, and why it isn't a fourth list

A module's UI panel lives OUTSIDE the module (see uiLibrary.ts). It used to be found at
one hard-coded place, `../_ui`, which was the one shared folder the list mechanism didn't
cover — fine while there was exactly one library, wrong the moment a project can also draw
modules from a mediatek outside the workspace.

`uiLibraryDirs()` derives it instead: the project's own `../_ui` first, then the `ui`
folder BESIDE each library in `modules_from`. A workspace has `_modules/` + `_ui/`; the
mediatek has `modules/` + `ui/` — the same relationship, so both spellings are probed
rather than ruled on.

Deriving beats declaring here. A panel is not an independent asset like an impulse
response; it is the face of a module, and it should travel with the library that owns
that module. Point a project at a library and the faces come along, with nothing else to
write down — and there is no way to end up with modules from one place and panels from
another because somebody updated one list and not the other.

**Order is precedence, and reading is not writing.** `loadUiLibrary` reads every library,
nearest first, so a project that forked a shared module draws its own face rather than the
one it was copied from. `writeUiFile` only ever writes into the project's own `_ui`: a
panel found in a shared library is read-only, exactly like the module it draws.

One consequence worth stating: the same ref appearing in two libraries is **precedence
working**, not a collision, and is silent. Two panels for one ref inside a SINGLE library
is still the mistake it always was, and is still reported.
