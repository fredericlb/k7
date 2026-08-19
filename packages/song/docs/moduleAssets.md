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

That is the only place they are looked for. There is no shared asset library any more (see
"What replaced the library" below).

`assets/` is one of three reserved subfolders a module may have — the other two are `nodes/`
(one file per placement) and `base/` (named `.vstpreset` blobs, `docs/userPresets.md`). Nothing
else in a module folder is a folder with a meaning: a name not on that list is just a name.

A module INHERITS its ancestors' assets: pointing a song at a shared amp means a thin local
module that `extends` it, and the files are in the shared folder. `moduleAssetChoices` is the one
answer to "what may this param be set to" — the panel's picker, the graph and the CLI completion
all ask it. See [filePicker.md](filePicker.md), which is also where the widget that offers them
is described.

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
next to Input and Output, and swapping it is the same gesture as turning a knob. Giving it a
top-level field of its own (`nam:` beside `params:`) made it a second kind of thing: a second
place to look, a second command to learn, a second merge rule.

`params` merges **per key**, which is the real gain: a node that overrides only the model
keeps everything else the generic set, and that is now the same edit as overriding a gain.

The list of file-valued params is `moduleTypes.FILE_PARAMS` — one entry, `nam`. Every other param
is a number, and that stays overwhelmingly the common case.

### The wire did not change

`params` on the protocol is `Record<string, number>`, mirrored in C++ as a float map, and a
string there is not a value the engine could set. So `nodeProject.numericParams` drops the
file-valued ones before the doc goes out, and the model leaves as its own `namFile` field —
which is exactly what the engine already expected. The authored shape changed; the protocol
did not, and the C++ side needed no edit for it.

## Confined to the folder

`resolveModuleAsset` refuses a ref that climbs out of `assets/` rather than resolving it. Without
it an asset ref would be a way to read any file the file service can see, on a module that
arrives from a shared catalogue and was written by somebody else.

Nesting inside `assets/` is kept, not flattened: a NAM pack arrives as a folder per amp, and
`Two-Rock/Clean.nam` is a legitimate ref. Flattening a hundred models into one list is what made
the old library picker unusable.

## …except for a file too big to travel

"A module carries its material so it survives a fork" is an argument about **cost**, and it
inverts somewhere north of a few hundred megabytes. `forkSharedModule` copies a module's folder
recursively; a 166 MB neural model would be duplicated per fork, per médiathèque upload, and
per machine synced to — the exact multiplication `module populate` was removed for.

So a model is named exactly like an amp profile (`onnx:` in `params:`, one of `FILE_PARAMS`)
and `resolveModuleAsset` looks in two places: the module's own `assets/` first, then the
machine's `~/.studio/models`. The module stays self-describing — it still says which model it
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

A rack's audio is resolved against the module folder already, so `assets/bd.wav` worked as a
spelling before this existed. A **bare** name is looked for in `assets/` first and falls back to
the folder itself — so a shelf laid out the old way, with its `.wav` beside `module.yaml`, keeps
loading, and a sample dropped onto a module in the médiathèque is found without rewriting the
yaml.

## What replaced the library

There used to be a shared asset library: a `_library/` beside the projects with one folder per
kind (`ir/`, `nam/`), plus the médiathèque's, and a module named a file by its path *inside* it.
Two fields fed it, `ir:` and `nam:`.

Both are gone, and the reasoning is the one that already governs `.vstpreset` and jsdsp source:
**the folder is the module**. A module that carries its material is self-contained, so it
survives a fork (`docs/moduleFork.md` copies the whole folder), an upload to the médiathèque, and
a sync onto a machine that has none of the original song's files — it sounds the same in all four
places, because the bytes went with it. A module whose sound depended on a folder two levels up
did not.

`ir` went entirely rather than moving into `params:` with `nam`. Nothing used it — no `ir:` in
any song, no file in any `_library/ir/` — so it was a whole mechanism (a plugin branch in
`EditBuilder`, a field, a command, a completion source) kept alive for a case that never arrived.

`libraries_from` is still ACCEPTED by the project schema, because every song already written
carries it and refusing the key would turn a working project into one that will not open.
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

### The listing has to nest too, and did not

That drop worked long before this listing did, which is the worst shape a bug takes: the bytes
landed, and the screen said nothing was there. Measured on the real library —
`modules/audio/amps/guitar/assets` holds one folder per amp, twenty-two files across four of
them, and the entry reported `assets: []`, because the scan filtered to `isFile()` at one level.

So `scan.ts`'s `assetsOf` walks, and `MediatekEntry.assets` carries `assets/`-relative POSIX
paths — the **same shape** `listModuleAssets` returns, so a path the tree shows is a path a
`params:` may name. Two things differ, both deliberate:

- **No extension filter.** `listModuleAssets` keeps what a file-valued param accepts; a tree that
  hid the `.wav` cabinet IR beside the `.nam` would be lying about the folder.
- **A folder holding nothing is reported with a trailing `/`.** Nothing else would ever mention
  it — a folder with children is implied by their paths — and the médiathèque already had to
  learn this lesson one level up (`scanUnlisted`): a "Nouveau dossier…" that answers 200 and
  appears nowhere reads as the call having done nothing at all.

`apps/pl8/frontend/src/assetTree.ts` turns those paths back into rows. The `assets` segment
itself is never drawn — a module's children ARE its assets, and a fixed row between them and it
would be a level with nothing to choose in — but it stays in every row's `path`, so a drop, a
move, a rename and a delete all address the file that is actually there.

The size of that listing is not capped. A module carrying a five-thousand-sample pack would make
the modules listing heavy, and the listing is polled; nothing observed has come close, and a cap
would have to choose which files to hide, which is the failure this section is about.
