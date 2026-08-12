# uiLibrary — a module's panel, in a file of its own

A module used to carry its own widget grid, as a `ui:` block inside `module.yaml`. That put two unrelated things
in one file: what the module *is* (a plugin, its params, its DSP source) and how it is *drawn*. They have
different authors, different lifetimes and different owners.

- `_modules/` used to be rebuilt wholesale from the engine's plugin scan. A panel drawn by hand sat in the path of
  a generated file, and the only thing keeping it was populate's rule never to overwrite.
- A panel is per-plugin, not per-song. Every project that reaches for the same compressor wants the same panel.

So the panel became its own file. It sits **in the module's folder**, beside the module file:

```
_modules/audio/filter/auto-wah/module.yaml     what it is
_modules/audio/filter/auto-wah/ui.yaml         how it's drawn
```

## Why beside, and not in a parallel tree

It was a parallel tree first — `_ui/` at the workspace root, mirroring `_modules/`, each file naming its module
with a `ref:`. That bought one thing: a panel could be moved or renamed and still find its module. It cost
several, and the balance was the wrong way round.

- **Two sources of truth.** The `ref:` was the key and the path was filing, so the two could disagree. A folder
  copied by hand kept the original's `ref:` and its panel silently landed on the module it was copied from.
- **Two places to look.** "Where is this module's face" had no answer you could reach by looking at the module.
- **Write-one, read-many.** A panel edited for a shared module was copied into the project's own `_ui`, because
  `_modules/` is read-only through the web. So the thing that was supposed to be authored once per plugin was in
  practice authored once per project — the opposite of the point.

Beside the module, the **folder is the key**. Nothing inside `ui.yaml` says which module it draws, because
nothing has to. Moving a module moves its face; copying one copies it; deleting one takes it along.

## The file

Exactly what the `ui:` block was, at the top level. The header comment is a courtesy, not a key:

```yaml
# panel for @engine/audio/filter/auto-wah
cols: 5
rows: 4
widgets:
  low: { type: knob, col: 0, row: 0, rowSpan: 2, label: Low, bind: Low, min: 60, max: 8000 }
```

`ui.yaml` is the one name that is neither the generic nor a node. Every other `<name>.yaml` in a module
folder is one *use* of the module, so `nodeFiles` skips this one by name — without that, a module with a
panel came back with a phantom node called `ui`.

Refs are still the loader's own — `@<namespace>/<type>/<sub>` for a shared module, `<type>/<name>` for a
project's own, a bare name for an io module — because that is what a chain names and what `byRef` is keyed by.
`uiPathFor` still puts the `io/` back for a bare ref: that rescue is about the ref's *shape*, not about the tree
the file used to live in.

## Which libraries are read

`modulePanelRoots` (sharedFolders.ts): the project's own `modules/` first, then every shared root it inherits
— `_modules`, the mediatek. **Nearest wins**, so a project that forked a shared module draws its own face rather
than the one it was copied from. There is no separate list to declare: point a project at a library and the
faces come along with the modules, because they are in the same folders.

## Writing

`writeUiFile` resolves the ref back to a library — the project's own for a bare ref, otherwise the one whose
`config.yaml` declares the namespace — and writes `ui.yaml` into the module's folder. It throws on a namespace
no visible library declares, rather than guessing at a root: a panel filed under a module that isn't there is a
save that reports success and draws nothing.

**This writes into shared libraries, and that is the intent.** A workspace's `_modules/` is otherwise read-only
through the file service ([moduleFork](moduleFork.md)) — a save aimed at one forks the module into the project.
`ui.yaml` is the single exception, carved in `Workspace.write`. Drawing a knob for a plugin every song reaches
for must not fork the module: that copy is exactly what nobody wanted, and it was reason enough to invent the
`_ui/` tree in the first place. What a module *is* stays read-only; only its face is shared and editable.

The consequence is real and worth stating: editing a panel from one project changes what every project sees.
That is the same trade `module populate` already makes, and it is what "authored once for the plugin" means.

## How it reaches the graph

`applyUiLibrary` overlays the panels at the **source** — inside `loadModules` and `loadModuleRefs` — so the
graph, the engine doc, the hints and the web all see `module.ui` exactly as they did before, and none of them
knows where the file was. A panel replaces a module's own inline `ui:` whole, for the same reason an inherited
grid does: half of one author's layout inside another's is a grid nobody drew.

Nodes share their generic's ref, so a panel drawn once shows on every node — which is what the
generic-wins rule already said, back when panels lived in the module file.

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

The old `_ui/` trees are **not** migrated. That was a deliberate clean break: the files that were in them are
orphaned, and the panels they held have to be redrawn.
