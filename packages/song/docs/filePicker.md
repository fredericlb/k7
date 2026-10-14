# The `filepicker` widget

A panel control that picks a **file the module carries** for one of its file-valued params.

```yaml
# modules/audio/amps/guitar/ui.yaml
cols: 4
rows: 2
widgets:
  w1: { type: filepicker, col: 0, row: 0, colSpan: 4, bind: model }
```

`bind` is the whole configuration, and it names three things at once: the param the choice is
written to, the command that writes it (`node param <node> nam <file>`), and the extension offered
(`.nam`). One choice to make, and nothing that can disagree with itself.

The button shows the current file's stem; clicking opens a **searchable tree** of the module's
assets — one level per folder, because that is how these arrive (a NAM pack is a folder per amp)
and a flat alphabetical list of three hundred profiles is not a thing anyone can use. `— none —`
is always first: a module with no profile loaded is a legitimate state, not something to hunt for.

## Why the extension is derived, not declared

A widget could carry `ext: .nam`. It does not, because the param already says what it loads: by its
name (`onnx`), or by its entry in a small table when one param takes several formats (`model`: a
`.nam` or an RTNeural `.json`). A field repeating it would be a second place to get it wrong on a
panel whose author already wrote `bind: model`. `assetExtsFor` is that rule, in `moduleTypes.ts`
beside `FILE_PARAMS`.

## Where the choices come from

The module's own `assets/`, **and its ancestors'** — `moduleAssetChoices`.

The ancestry half is not a refinement; without it the widget lists nothing in the normal case.
A song points at a shared amp by making a thin local module that `extends` it:

```
project/modules/audio/guitar/module.yaml     extends: "@k7-core/audio/amps/guitar"
mediatek/modules/audio/amps/guitar/assets/   ← the fourteen profiles are HERE
```

Looking at `<project>/modules/<category>/<file>/assets` and nowhere else is right only for a
module this project both owns and stores the files in. For the guitar above it lists the local
folder — empty — so the one module in the médiathèque built to be picked from would open with
nothing in it. The graph (`assetChoicesFor`) and the CLI completion (`assetFiles`) go through
`moduleAssetChoices` for that reason, rather than each carrying the walk.

A nearer module's assets come first and a duplicate path is dropped, so a local file shadows an
inherited one of the same name.

### It costs no directory walk

"Where does this ref live" is answered from `folderAbs`, which the loader stamps on every module
it reads — so the ref map a caller has loaded anyway already knows. Asking the libraries instead
(`moduleFolderForRef`) is a full walk of every module library **per ancestor, per module**, which
turned one graph build into a walk per node.

The same trap in a second shape: `buildGraphDoc` must not load the ref map itself, because
`loadGraph` — which it calls one line earlier — has already read it, and loading it twice doubles
the cost of a graph build that is polled. Both are the same rule: this data is loaded once per
request already, and the walk is expensive enough that a second one shows up as a timeout.

**Three** places want that folder, not two. The third is the WRITE: `node param` checks the file
against the module's assets before writing it. Miss it there and the picker offers a profile the
command then refuses, so the click does nothing at all.

## Choosing one has to RESOLVE, too

Picking a profile for a shared amp writes the ref into the local module, and each module resolves
its own file params against its own folder — which for that one holds nothing. Resolved there
alone the ref comes back undefined and `mergeAuthored` keeps the PARENT's path: the panel shows
the name you chose while the engine loads the inherited file. Silently the wrong sound, which is
worse than none.

So the fold re-resolves a file param against the folders of the whole chain
(`withInheritedAssets`), nearest first — the same order the choices are offered in, because the
list you pick from and the path you get must agree. Two rules keep it honest:

- Only what **this** module named. A ref it inherited was already resolved by the module that
  declared it, against the folder that holds the file; re-doing it here would blank it.
- An escaping ref is still refused outright. Escaping is a property of the ref, not of the folder
  it was tried against, so one refusal ends the walk — otherwise `../` would become a way through
  a shared module's containment. `resolveModuleAssetIn` holds that check, once, for both the
  single-folder and the ancestry case.

## `dropdown` + `library` is the other spelling

A `dropdown` carrying `library: nam` is **accepted and read as a filepicker**, so every panel
written that way keeps working; the builder still edits it, labelled *legacy*. New panels get the
widget that says what it is. Nothing needs migrating, and `library` says nothing `bind` does not.

What it does NOT do is filter on a `nam/` prefix. There is no shared `_library/` behind the choices
([moduleAssets.md](moduleAssets.md)) — a module carries its own assets, whose paths are relative to
its `assets/` — so a prefix filter would match nothing at all.

## What it is NOT

- Not a browser of the machine. `resolveModuleAsset` refuses a ref that climbs out of `assets/`,
  and the picker only ever offers what the module carries — a module that arrives from a shared
  catalogue was written by somebody else.
- Not a `dropdown`. A dropdown's choices are values its author wrote down; this one's are a
  folder tree discovered on disk, which is why it needs a search field and its own type.
