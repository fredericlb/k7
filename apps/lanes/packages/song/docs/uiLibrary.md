# uiLibrary — a module's panel, kept outside the module

A module used to carry its own widget grid, as a `ui:` block inside `module.yaml`. That put two unrelated things
in one file: what the module *is* (a plugin, its params, its DSP source) and how it is *drawn*. They have
different authors, different lifetimes and different owners.

- `_modules/` used to be rebuilt wholesale from the engine's plugin scan. A panel drawn by hand sat in the path of
  a generated file, and the only thing keeping it was populate's rule never to overwrite.
- `_modules/` is read-only through the web UI (see [moduleFork](moduleFork.md)), so drawing a panel for a shared
  plugin meant forking the whole module into the project — a copy of a module nobody wanted to change.
- A panel is per-plugin, not per-song. Every project that reaches for the same compressor wants the same panel.

So the panel moved out. `_ui/` sits beside `_modules/` at the workspace root:

```
_modules/audio/filter/auto-wah/module.yaml     what it is
_ui/audio/filter/auto-wah.yaml                 how it's drawn
```

## The file

Exactly what the `ui:` block was, at the top level, plus a `ref:` naming the module:

```yaml
# panel for @engine/audio/filter/auto-wah
ref: "@engine/audio/filter/auto-wah"
cols: 5
rows: 4
widgets:
  low: { type: knob, col: 0, row: 0, rowSpan: 2, label: Low, bind: Low, min: 60, max: 8000 }
```

**The `ref` is the key; the path is filing.** Two consequences worth stating, because they are what makes the
split survive contact with a real workspace:

- A panel can be moved or renamed inside `_ui/` and still finds its module.
- Two refs can want the same path — a project's `audio/reverb` and a shared `@engine/audio/reverb` — so writers
  step past an occupied file (`reverb-2.yaml`) instead of clobbering it. Readers never look at the path.

Refs are the loader's own: `@<namespace>/<type>/<sub>` for a shared module, `<type>/<name>` for a project's own,
and a bare name for an io module (which is why `uiPathFor` puts the `io/` back).

## How it reaches the graph

`applyUiLibrary` overlays the library at the **source** — inside `loadModules` and `loadModuleRefs` — so the
graph, the engine doc, the hints and the web all see `module.ui` exactly as they did before, and none of them
knows the library exists. A panel replaces a module's own inline `ui:` whole, for the same reason an inherited
grid does: half of one author's layout inside another's is a grid nobody drew.

Instances share their generic's ref, so a panel drawn once shows on every instance — which is what the
generic-wins rule already said, back when panels lived in the module file.

A [module fork](moduleFork.md) copies the panel too, under the copy's own ref. Its ref is a new one, and without
that copy the fork would come up blank — which reads as the edit having wiped the module's face.

## Editing

The module editor's code pane switches between the two files (`module.yaml` / `panel`); the widget grid always
edits the panel. `GET /module-ui?path=` answers the panel for a module file — the existing one, or the path it
*would* take plus a blank grid, so the first save creates it through the ordinary write route rather than
needing one of its own. `_ui/` is writable where `_modules/` is not, which is the whole point.

## Migrating

`ui migrate` (uiMigrate.ts) moves the blocks still written inline, in the project's `modules/` and in the shared
`_modules/` beside it, and deletes them from the module files with `setModuleValue` — a one-key diff, so every
comment and layout choice around the block survives. It is re-runnable: a module with no `ui:` left is skipped.

A panel the schema refuses is **reported, not moved** — leaving it in the file it is in beats writing half of it
somewhere new.
