# The shared module builder, and `ui.yaml` beside the module

A module is **its folder**, what describes it fits in the files inside it, and the two apps draw
the same builder over it. This page holds the rules that make that true; what is left to do is the
last section but one.

## A module, its folder

```
modules/<type>/<name>/module.yaml    what it does
modules/<type>/<name>/ui.yaml        what it looks like
```

Its named settings are NOT here: a preset is a file of the presets tree, keyed by the module's ref
and kept in the workspace or a library (`packages/song/docs/userPresets.md`).

In the media library, clicking any of them opens the same builder as k7.

## The rules

1. The shared builder is a package of its own, **`@studio/ui-module-builder`**, and not a piece of
   `@studio/ui-editor`. The latter is the *language* stack — CodeMirror YAML mode, completions
   derived from the schema, entity links, tracker widget — and it is framework-agnostic; the
   builder is a React *view*. Merging them would bring React into a package that does without it.
   (Which does not stop a piece moving up into `ui-editor` when it really belongs to the language —
   see the vocabulary, below.)
2. **A panel is written into its module's folder, shared library included.** `Workspace.write` lets
   `ui.yaml` through under `_modules/`, the sole exception to the read-only lock. Accepted
   consequence: editing a panel from one project changes what every other one sees — that is the
   meaning of "drawn once for the plugin".
3. The folder is the key, and the file carries no `ref:`: that would be a second source of truth.
   `uiPathFor` writes `<type>/<sub>/ui.yaml`, `loadUiLibrary` walks the **module** libraries and
   derives the ref from the folder, `writeUiFile` resolves the ref to its library
   (`packages/song/src/uiLibrary.ts`, rationale in `packages/song/docs/uiLibrary.md`).

The `io/` case is the remaining exception: a bare io ref (`desk`) has no type segment, so
`uiPathFor` puts the `io/` back or the file lands at the root of the library. The test states it
explicitly.

## The trap: the module's own files are not nodes

It appears at every storey, always the same way: counting as a **node** every `.yaml` in the folder
that is not `module.yaml`. Unguarded, a panel comes back as a `reverb:ui` node.
`nodeFiles` (`packages/song/src/yaml/moduleIO.ts`) and `scanModules` therefore skip the module's own
basenames, named in one place — `MODULE_OWN_BASES`, where `presets` stays reserved so a stale shelf
file is never read as a node. On the media library side, a module's
entry carries `files`: what the folder really contains.

## A module always has a folder

A scanned plugin has a file nowhere: `engineCatalogue` synthesises `@engine/<slug>` from the scan
cache, and a chain can name it with nothing on disk. That is a good arrangement — copying 273
wrapper folders into every workspace serves nobody.

It stops holding as soon as one wants to **own** something of the module: a face is a *file in a
module's folder*. Hence the rule, and the mechanism that makes it true:
`materialiseEngineModule` (moduleFork.ts) builds the folder, writes a `module.yaml` recording
**which** plugin to load — the scan is a discovery aid, not the project's memory — and repoints the
chains, exactly like a fork.

Reached by the **`module own <ref>`** command; in the chains graph, a right click on an `@engine/…`
block offers it in place of `ui file`, which has no file to open. `writeUiFile` refuses an
`@engine/`, and the message says what to do.

## Presets are not the builder's

A preset is chosen, saved and updated on a NODE of the graph, which is where its values are heard;
the builder's Preset menu holds the plugin's factory banks only (`packages/song/docs/userPresets.md`).

## The shared package, and the seam

`@studio/ui-module-builder`: `ModuleBuilder.tsx`, `WidgetGridEditor.tsx`, `moduleUi.ts` and
`paramDrag.ts`, plus `store.ts` — the seam; its YAML pane is `@studio/ui-editor`'s `YamlPane.tsx`.
Both apps draw it.

**The seam is `ModuleStore`** (`read`, `moduleUi`, `hints`, `write` and the optional ones), and
the builder never builds a path — it only hands back the ones it was given. The two path spaces
resemble each other too closely for it to construct one. Full rationale in
`packages/ui-module-builder/docs/store.md`, including the one asymmetry: `write` may answer "it
landed elsewhere", because k7 redirects a save aimed at `_modules` to a local copy. The builder
surfaces that through `onRelocated` and does not follow the path itself.

Two files live further out than the builder:

- `yamlVocabulary.ts` is in **`@studio/ui-editor/yaml/vocabulary`**: three editors want the same
  answers (k7's `EditorPane`, the media library's, the builder's), and "what completes where" is a
  matter of *language*, not of view. `@studio/song/yaml/fields` is pure Zod, so `ui-editor` stays
  navigable.
- `paramDrag.ts` is exported by the builder (`/param-drag`): k7's `fileDrop.ts` reads the MIME to
  ignore the drag, and two copies of a protocol are not a protocol.

**In k7**, a *Builder* button in the editor bar when the open file is a module, and a full-screen
overlay above the shell. A **button** and not a hijacked click: opening `module.yaml` must go on
opening its text, because that is the path by which a shared module is forked. The overlay offers
neither presets nor live plugin parameters — those are the engine's business and this overlay has
no engine link.

**In the media library**, the tree descends to file level: a `modules` entry has its two children,
and clicking either opens the builder on the right tab (`initialPane`). The tree shows **exactly
the files that exist**: a row for an absent file lies about the disk. The panel is
created in the builder, which offers them anyway — it is the entrance, not the tree.

## What is left

- **Nothing is exercised in a browser.** Both apps typecheck, build, and the dev server serves the
  modules through the workspace alias; the frontend shell has no tests (see `apps/k7/AGENTS.md`).
  The k7 overlay and the media library tree want a real click.

## The media library chrome

The media library carries k7's chrome: families as tabs, the shared `FileTree` in the sidebar with
context menus and drag and drop, a cog for the engine and for signing out. The backend has
`POST /move`, `POST /folder` and `DELETE /folder` (`apps/k7/backend/src/media/routes/library/write.ts`, backed
by `@studio/mediatek/write`).

Trap in the shared `FileTree`: the context menu **does not open at all** if no action passes its
`when` (`file-tree.tsx:385`), and `rootLabel` draws no row — it only names the target of the
background menu. A visible root node has to be synthesised.
