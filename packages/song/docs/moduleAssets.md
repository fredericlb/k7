# The assets a module carries

A module holds the material it plays — an amp profile, the samples on a shelf — in an
**`assets/` folder inside the module itself**:

```
modules/audio/amp/
  module.yaml        ← what the module IS
  ui.yaml
  assets/            ← what it LOADS
    jcm800.nam
    Two-Rock/Clean.nam
```

That is the only place they are looked for: there is no shared asset library (see "No shared
asset library" below).

`assets/` is one of four reserved subfolders a module may have — the others are `nodes/`
(one file per placement), `base/` (named `.vstpreset` blobs, `docs/userPresets.md`) and `sources/`
(a rack's audio, below). Nothing else in a module folder is a folder with a meaning: a name not on
that list is just a name.

A module INHERITS its ancestors' assets: pointing a song at a shared amp means a thin local
module that `extends` it, and the files are in the shared folder. `moduleAssetChoices` is the one
answer to "what may this param be set to" — the panel's picker, the graph and the CLI completion
all ask it. See [filePicker.md](filePicker.md), which is also where the widget that offers them
is described.

### Why the walk is up the ANCESTRY

`moduleAssetChoices` returns every asset a module can name, nearest owner first, walking what it
`extends`. Looking at `<project>/modules/<category>/<file>/assets` and nowhere else is right only
for a module this project both owns and stores the files in, and wrong for the two shapes that
actually carry material:

- a module living in a shared library — the médiathèque's `audio/amps/guitar` has the fourteen NAM
  profiles, and the project's `modules/audio/guitar` has none;
- a thin local module that exists only to override a param of one, which is what `extends` produces
  and is the normal way to point a song at a shared amp.

Both would list nothing, and the panel's picker would open empty on the one module in the
médiathèque built to be picked from. A nearer module's assets come first and a duplicate path is
dropped, so a local file shadows an inherited one of the same name — the same precedence
`resolveModuleAsset` gives the folders.

The FOLDERS are not looked up during that walk: the loader stamps `folderAbs` on every module it
reads, so the ref map a caller has loaded anyway answers "where does this one live" for free.
Asking the libraries instead costs a full directory walk per ancestor per module — one graph build
becomes a walk per node, which on a médiathèque mounted over `/mnt/c` is seconds. What is left is
memoised per request because ancestors repeat: every module inheriting one shared amp would
otherwise re-read that amp's `assets/` once each.

## A file is a param

The file a plugin loads is named in `params:`, beside the numbers:

```yaml
plugin: { type: internal, name: Neural Amp Modeler }
params:
  nam: jcm800.nam
  Input: -5.06
  Output: 8.26
```

Because that is what it is. A .nam model is one of the plugin's controls — it sits in the panel
next to Input and Output, and swapping it is the same gesture as turning a knob. A top-level field
of its own (`nam:` beside `params:`) would make it a second kind of thing: a second place to look,
a second command to learn, a second merge rule.

`params` merges **per key**, which is the real gain: a node that overrides only the model
keeps everything else the generic set, and that is the same edit as overriding a gain.

The list of file-valued params is `moduleTypes.FILE_PARAMS` — one entry, `nam`. Every other param
is a number, and that stays overwhelmingly the common case.

### The wire carries numbers only

`params` on the protocol is `Record<string, number>`, mirrored in C++ as a float map, and a
string there is not a value the engine could set. So `nodeProject.numericParams` drops the
file-valued ones before the doc goes out, and the model leaves as its own `namFile` field —
which is what the engine expects. The authored shape and the protocol are free to differ, and
here they do.

## Confined to the folder

`resolveModuleAsset` refuses a ref that climbs out of `assets/` rather than resolving it. Without
it an asset ref would be a way to read any file the file service can see, on a module that
arrives from a shared catalogue and was written by somebody else.

Nesting inside `assets/` is kept, not flattened: a NAM pack arrives as a folder per amp, and
`Two-Rock/Clean.nam` is a legitimate ref. Flattening a hundred models into one list is what makes
a picker unusable.

## …except for a file too big to travel

"A module carries its material so it survives a fork" is an argument about **cost**, and it
inverts somewhere north of a few hundred megabytes. `forkSharedModule` copies a module's folder
recursively; a 166 MB neural model would be duplicated per fork, per médiathèque upload, and
per machine synced to.

So a model is named exactly like an amp profile (`onnx:` in `params:`, one of `FILE_PARAMS`)
and `resolveModuleAsset` looks in two places: the module's own `assets/` first, then the
machine's `<state>/models`. The module stays self-describing — it still says which model it
wants — while the bytes live where a 166 MB file belongs, which is once per machine, beside the
engine binary and the plugin scan.

**The containment check keeps its priority.** A ref that climbs out of `assets/` is refused,
not redirected to the cache: the fallback must not become a way to launder an escaping ref. The
cache is consulted only for a name that already passed. Pinned in `moduleAssets.test.ts`.

## A dangling ref is reported, not silent

The loader resolves each file-valued param to an absolute path and leaves it `undefined` when it
cannot, keeping the authored name in `assets`. The two disagreeing IS the report — `validate()`
warns rather than letting the module load nothing. An amp whose model did not load passes no
sound at all, and silence with no explanation is the failure mode worth spending a warning on.

## A rack's samples

A rack keeps its audio in **`sources/`**, its own reserved subfolder (`MODULE_SOURCES_DIR`, in
song-schema so a browser knows the word too). It is not `assets/` because the two are chosen by
different hands: an asset is a file a PARAM names and the asset picker offers, a source is a file a
SYMBOL names and the rack builder writes. Keeping them apart also keeps the picker's list free of
sixteen drum hits nobody will ever pick from it.

`sources/` is the one part of a module the editor's file tree still shows: the fold that turns a
module folder into a single row keeps this child, so the samples can be seen, renamed and dropped
onto. The row stays openable on its name (`opensOnName`), so the chevron folds while the name still
opens the builder.

A **bare** clip name is looked for in `sources/`, then `assets/`, then the module folder itself — so
a shelf with its `.wav` beside `module.yaml` keeps loading, and a sample dropped onto a module in
the médiathèque is found without rewriting the yaml. `assets/bd.wav` is still a spelling that
stands on its own, resolved against the module folder like any other ref.

## No shared asset library

There is no `_library/` beside the projects with one folder per kind, and no module field naming
a file by its path *inside* one. The reasoning is the one that governs `.vstpreset` and jsdsp
source: **the folder is the module**. A module that carries its material is self-contained, so it
survives a fork (`docs/moduleFork.md` copies the whole folder), an upload to the médiathèque, and
a sync onto a machine that has none of the original song's files — it sounds the same in all four
places, because the bytes go with it. A module whose sound depended on a folder two levels up
would not.

There is no `ir:` either, in `params:` or anywhere else. It would be a whole mechanism — a plugin
branch in `EditBuilder`, a field, a command, a completion source — for a case that never arrives:
no song names one, and nothing holds impulse responses to name.

`libraries_from` is still ACCEPTED by the project schema, because songs already written carry it
and refusing the key would turn a working project into one that will not open.
`deadProjectFields` is what stops "accepted" from meaning "silently ignored".

## Where they come from

The médiathèque is where a module is authored, so it is where assets are dropped: a module row in
its tree draws its `assets/` as children, and dropping a file on that row uploads into the folder
(`apps/pl8/frontend/src/Library.tsx`, `assetsTarget`). The scan reports them as the entry's
`assets` — its own field, separate from `files`, because `files` is the module's definition and
these are its material.

Nothing offers to *create* an asset. They arrive as bytes — a **folder** of them as readily as
one, since the tree reads a drop through `webkitGetAsEntry` rather than `dataTransfer.files`
(commons's `lib/droppedEntries.ts`) and `uploadTree` PUTs each file at its own nested path.

### The listing nests too

A drop that lands the bytes while the screen says nothing is there is the worst shape a bug
takes, and it is what a scan filtering to `isFile()` at one level produces:
`modules/audio/amps/guitar/assets` holds one folder per amp, twenty-two files across four of
them, and such a scan reports `assets: []`.

So `scan.ts`'s `assetsOf` walks, and `MediatekEntry.assets` carries `assets/`-relative POSIX
paths — the **same shape** `listModuleAssets` returns, so a path the tree shows is a path a
`params:` may name. Two things differ, both deliberate:

- **No extension filter.** `listModuleAssets` keeps what a file-valued param accepts; a tree that
  hid the `.wav` cabinet IR beside the `.nam` would be lying about the folder.
- **A folder holding nothing is reported with a trailing `/`.** Nothing else would ever mention
  it — a folder with children is implied by their paths — and the médiathèque states the same
  rule one level up (`scanUnlisted`): a "Nouveau dossier…" that answers 200 and appears nowhere
  reads as the call having done nothing at all.

`apps/pl8/frontend/src/assetTree.ts` turns those paths back into rows. The `assets` segment
itself is never drawn — a module's children ARE its assets, and a fixed row between them and it
would be a level with nothing to choose in — but it stays in every row's `path`, so a drop, a
move, a rename and a delete all address the file that is actually there.

The size of that listing is not capped. A module carrying a five-thousand-sample pack would make
the modules listing heavy, and the listing is polled; nothing observed has come close, and a cap
would have to choose which files to hide, which is the failure this section is about.
