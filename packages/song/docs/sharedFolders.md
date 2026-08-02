# sharedFolders.ts — extended notes

A workspace holds two folders every project in it wants, and neither is visible until
the project SAYS so in its `project.yaml`:

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
