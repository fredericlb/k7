# uiLibrary — a module's panel, in a file of its own

A module's widget grid is a file of its own rather than a `ui:` block inside `module.yaml`. Those are two
unrelated things: what the module *is* (a plugin, its params, its DSP source) and how it is *drawn*. They have
different authors, different lifetimes and different owners.

- `_modules/` is written from the engine's plugin scan. A panel drawn by hand inside a generated file sits in
  the path of that scan, kept only by populate's rule never to overwrite.
- A panel is per-plugin, not per-song. Every project that reaches for the same compressor wants the same panel.

The panel sits **in the module's folder**, beside the module file:

```
_modules/audio/filter/auto-wah/module.yaml     what it is
_modules/audio/filter/auto-wah/ui.yaml         how it's drawn
```

## Why beside, and not in a parallel tree

A parallel tree — `_ui/` at the workspace root, mirroring `_modules/`, each file naming its module with a
`ref:` — buys one thing: a panel can be moved or renamed and still find its module. It costs three, and the
balance is the wrong way round.

- **Two sources of truth.** The `ref:` is the key and the path is filing, so the two can disagree. A folder
  copied by hand keeps the original's `ref:` and its panel silently lands on the module it was copied from.
- **Two places to look.** "Where is this module's face" has no answer you can reach by looking at the module.
- **Two writers for one save.** A module's four files are edited together and saved together
  (`apps/st0/frontend/docs/sharedModules.md`); a parallel tree would split that write across two
  roots, and a crash between them leaves a panel that answers to nothing, or a module with none.

Beside the module, the **folder is the key**. Nothing inside `ui.yaml` says which module it draws, because
nothing has to. Moving a module moves its face; copying one copies it; deleting one takes it along.

## The file

The widget grid, at the top level. The header comment is a courtesy, not a key:

```yaml
# panel for @engine/audio/filter/auto-wah
cols: 5
rows: 4
widgets:
  low: { type: knob, col: 0, row: 0, rowSpan: 2, label: Low, bind: Low, min: 60, max: 8000 }
```

`ui.yaml` is the one name that is neither the generic nor a node. Every other `<name>.yaml` in a module
folder is one *use* of the module, so `nodeFiles` skips this one by name — without that, a module with a
panel comes back with a phantom node called `ui`.

Refs are the loader's own — `@<namespace>/<type>/<sub>` for a shared module, `<type>/<name>` for a
project's own, a bare name for an io module — because that is what a chain names and what `byRef` is keyed by.
`uiPathFor` puts the `io/` back for a bare ref: that rescue is about the ref's *shape*, not about where the
file sits.

## Which libraries are read

`modulePanelRoots` (sharedFolders.ts): every shared root the project inherits, nearest first — the workspace's
`_modules`, then the library repository. There is no separate list to declare: point a project at a library and
the faces come along with the modules, because they are in the same folders.

## Writing

`writeUiFile` resolves the ref back to a library — the root whose `moduleNamespaceOf` matches — and writes
`ui.yaml` into the module's folder. It throws on a namespace no visible library answers to, rather than
guessing at a root: a panel filed under a module that isn't there is a save that reports success and draws
nothing.

**This writes into shared libraries, and that is the intent.** A `@workspace` module takes the write directly,
the same as any other file st0 saves; drawing a knob for a plugin every song in the workspace reaches for
changes the panel every one of them sees, which is exactly "authored once for the plugin" rather than a
mistake to guard against. `@st0` is the one level still gated — behind the Edit-then-publish confirmation in
the builder (`apps/st0/frontend/docs/sharedModules.md`), not by anything in this file.

The consequence is real and worth stating: editing a panel from one project changes what every project sees.
That is the same trade `module populate` makes, and it is what "authored once for the plugin" means.

### The path, and the two refs that are special

`uiPathFor` drops the namespace, because it names the LIBRARY the caller has already picked:
`@engine/audio/delay/tape-delay` and `@workspace/audio/reverb` each land beside their module file. An io
module's ref carries no type folder (`desk`), so it gets one back — without that rescue the panel would land at
the library root instead of in `io/desk/`. The rescue is about the REF's shape rather than about where the file
lives.

`moduleRootFor` throws rather than guessing, since a panel written under the wrong root draws a module that
isn't there. Two refs need saying:

- A BARE ref (`audio/reverb`, no `@`) names no library at all — a module lives at `@workspace` or `@st0` now,
  always spelt with the level, so a bare ref would match no root and is refused before it is even split.
- `@engine/<slug>` deliberately has NO answer: an engine module is a scanned plugin with no folder in any
  library, and a panel needs a folder to sit in. Better a refusal that says so than a file written under `io/`,
  which is where the io rescue would put it.

### The emitted YAML is hand-written

Each widget goes on ONE flow line. `yaml`'s stringify would produce the block form, and a widget is read as a
row — eight scalars describing one knob — so a 20-line panel becomes 200 lines nobody scans. This is the shape
the module files use. The panel is validated on the way OUT as well as in: one this cannot read back is a file
the editor would refuse.

`widgets: {}` and not a bare `widgets:`, which YAML reads back as NULL — and a null fails the schema, so a
panel with no widgets yet would read as MALFORMED and the editor would grey its own grid out. That is the
scaffold every module without a panel gets, which is precisely when the grid is needed.

The file's header is the only place the module is NAMED, and it is a comment: the folder is what actually says
it, and two sources of truth is one too many.

## How it reaches the graph

`applyUiLibrary` overlays the panels at the **source** — inside `loadModules` and `loadModuleRefs` — so the
graph, the engine doc, the hints and the web all see `module.ui`, and none of them knows where the file is. A
panel replaces a module's own inline `ui:` whole, for the same reason an inherited grid does: half of one
author's layout inside another's is a grid nobody drew.

Nodes share their generic's ref, so a panel drawn once shows on every node — the generic-wins rule.

A `widgets.js` in the same folder rides on the panel as `ui.script`, as text: it draws the panel's lcdscreen
widgets in the browser, and it is read with the panel rather than on its own so the two can never come from
different folders (`packages/ui-chains-react/docs/lcdScreen.md`).

A [module fork](moduleFork.md) copies the whole folder, so the panel comes along by itself. It is rewritten
anyway, with a header naming the copy: a `ui.yaml` whose comment still points at `@engine/…` reads as the fork
having borrowed a face rather than been given one.

## Editing

The module editor's code pane switches between the two files (`module.yaml` / `ui.yaml`); the widget grid always
edits the panel. `GET /module-ui?path=` answers the panel for a module file — the existing one, or the path it
*would* take plus a blank grid, so the first save creates it through the ordinary write route rather than
needing one of its own. `path` may name either file of the pair, which is what lets a click on `ui.yaml` open
the same builder as a click on `module.yaml`.

## Migrating

`ui migrate` (uiMigrate.ts) moves the blocks still written inline, in the project's `modules/` and in the shared
`_modules/` beside it, and deletes them from the module files with `setModuleValue` — a one-key diff, so every
comment and layout choice around the block survives. It is re-runnable: a module with no `ui:` left is skipped.

A panel the schema refuses is **reported, not moved** — leaving it in the file it is in beats writing half of it
somewhere new.

A `_ui/` tree is **not** migrated, deliberately: a panel filed in one is orphaned and has to be redrawn.
