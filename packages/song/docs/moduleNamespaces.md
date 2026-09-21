# moduleNamespaces — the three levels a module lives at

A module ref carries its level as an `@` prefix:

| ref | where the module is | who edits it |
|---|---|---|
| `@engine/nam` | **nowhere** — a scanned plugin, synthesised from the machine's scan cache | nobody; it has no file |
| `@st0/audio/delay/tape-delay` | the account's library repository, mounted at `<workspace>/_libraries/modules` | st0's Libraries tab |
| `@workspace/audio/reverb` | the workspace's `_modules/`, shared by every project beside it | the médiathèque |

## `@st0` is a git submodule in the workspace

The level's folder is `<workspace>/_libraries/modules` — the account's library repository,
mounted by the file service into every workspace. There is one per workspace, so
`moduleNamespaceOf`'s test is structural rather than a string comparison against a single path:
the root's parent folder is named `_libraries`. See [sharedFolders.md](sharedFolders.md).

## `@st0` names a FOLDER of modules, and the cache folder is called `mediatek`

The level's name follows the folder of modules rather than the path on the origin: the
médiathèque answers under `/pl8` and is `apps/pl8`, and the level is `@st0` all the same.
A level is written into user files, so renaming one means rewriting every chain in every
repository on every machine at once, and the failure signature is a `?` on a graph node and
nothing else. That is worth paying to stop a word that appears nowhere; it is not worth paying
to chase a URL.

> **`@st0` is not the app `apps/st0`.** Nothing resolves through an app either way. The level
> names a folder of modules, and that folder is what the name follows.

`<state>/mediatek` is a **cache path** on one machine, not a name anybody writes in a file —
nothing resolves a ref through it, and renaming it would be a migration of a folder on every
machine in exchange for nothing. `$STUDIO_MEDIATEK` and the `@studio/mediatek` package keep the
name for the same reason: the médiathèque is what the thing is called, and `pl8` is what serves
it.

### `@mediatek/…` resolves to nothing

`@mediatek/…` resolves to nothing, deliberately: a chain step naming an unknown module draws
its name with a `?` on the graph, and an `extends:` that resolves to nothing is reported by
`libraryModuleIssues`. Neither is silent — which is the bar a rename in this repo has to clear
(`docs/rename-test-plan.md`).

```bash
# a project, a workspace, or the médiathèque itself — dry by default
npx tsx packages/song/scripts/migrateNamespace.ts <state>/workspace/<you>/<workspace> --write
npx tsx packages/song/scripts/migrateNamespace.ts <state>/mediatek --write
```

That script is a **text replace** on `@mediatek/`, where `migrateDocFields.ts` beside it goes
through the yaml Document API. The difference is what is being changed: a doc field is a
*structure*, and rewriting the document is what preserves everything around it — but a namespace
appears in mapping KEYS (a chain step is one), in scalar values, inside flow sequences, and in
the comment at the top of a panel. Reserialising to catch all four is exactly what `formatChains`
does, and it emits a canonical document, which would eat every comment in the file. Replacing one
unambiguous token touches nothing else: there is no other thing in this repo spelled `@mediatek`.

## The level comes from the LOCATION

`moduleNamespaceOf(root)` answers from the path, and no root declares one. A `namespace:`
field in a root's `config.yaml` would make the level a free string an author picked, with
two consequences worth naming. A workspace library could call itself `engine` and collide
head-on with the synthesised catalogue, so the same ref `@engine/io/IN` would mean a folder
in one place and a scanned plugin in the next. And nothing would tie the name to how deep
the folder actually sits, so the ref would tell you what someone had typed rather than where
the file is.

There are only two shared roots — the media library, or the workspace's own — so the
question has exactly two answers.

## No level is declared. They are all found

Every root is at a fixed place, so nothing in `project.yaml` names one:

| level | where |
|---|---|
| `@engine` | nowhere — synthesised from the machine's plugin scan |
| `@st0` | `../_libraries/modules`, the account's library submodule |
| `@workspace` | `../_modules`, beside the project |

`moduleLibraryDirs()` states that once (sharedFolders.ts) and everything reads it: the modules,
their panels (`modulePanelRoots`), the fork path (`sharedRoots`) and the builder's catalogue —
which is what keeps the three from disagreeing about what a project can reach.

Nothing in `project.yaml` declares one. A `modules_from` naming the middle one, or a
`libraries_from` doing the same for assets, could only ever name a fixed place: it would
decide nothing while leaving three ways to be wrong about it — docs/sharedFolders.md lists
the three, each of which costs a real afternoon.

What this does NOT do is put the bytes there. The library is hosted; the local folder is a
cache of it, filled by `packages/file-service/docs/mediatekPull.md` for the modules the open
songs name.

`@engine` is the odd one and always will be: it names **no folder at all**. A scanned
plugin is a module the engine merely reports (`engineCatalogue.ts`), which is fine until
you want to draw it a panel or give it presets, because both are FILES in a module's
folder.

## Every ref is namespaced. There is no bare form

`extends: "@workspace/audio/reverb"` is the only way to name it — there is no shorter spelling,
and nothing keys a module a second time under a bare `audio/reverb`. A project has no modules of
its own to make a bare name unambiguous about, so a ref that carried no `@` prefix would have
nothing to mean.

## Going deeper means inheriting, not copying

To change a module you do not own, you make one at YOUR level that `extends` it:

```yaml
# _modules/audio/my-nam/module.yaml   (@workspace)
extends: "@st0/audio/amp/nam"
params:
  Gain: 0.7
```

`resolveModule` folds the whole ancestry in, deepest first, with no depth limit and a
cycle guard — and `mergeAuthored` merges `ui` widget by widget, so a panel drawn once
upstream reaches every module below it. That is one merge, defined once; see
[moduleResolve.md](moduleResolve.md) for why it is a phantom-branded type rather than a
convention.

This is also how a **scanned plugin gets a face**. `@engine/nam` has no folder, so it can
carry no `ui.yaml` — `writeUiFile` refuses it, in as many words:

```
@engine/nam: no module library this project can see declares '@engine',
so there is no folder to draw it in
```

The answer is a `@st0` module that extends it and holds the panel. The médiathèque
is the editable catalogue, so the face is drawn once, there, for every song that reaches
for the plugin — rather than copied into each project that plays it.

Contrast that with [moduleFork.md](moduleFork.md)'s `module own <ref>`, which gives an `@engine`
ref a folder of its OWN rather than a `@st0` module that extends it — the right answer when what
you want is a panel and presets FOR YOU, not a face the whole account reads.

## Giving the WHOLE scan a face

`engineFaces()` does for a library what `engineFaceModule()` does for one plugin, and pl8
offers it on the modules section itself. On the machine this is measured against: 252 plugins
scanned, 242 modules written, 10 skipped.

### A face COPIES nothing

Worth stating, because the pass looks like the opposite thing. A `module.yaml` per scanned
plugin holding **two copied facts** — `plugin.type` and `plugin.name` — would be strictly
less informed than the scan it came from, would have to be regenerated by hand, and would go
stale in silence (see `engineCatalogue.ts`).

A face copies **nothing**. It is one `extends:` line, and every fact about the plugin still
comes from the scan through the ref. Update the plugin and the face is still right; there is no
second copy to go stale, because there is no copy. What it adds is the two things a ref with no
folder behind it cannot have: a name a chain can say, and somewhere a `ui.yaml` can sit.

### Idempotent, by REF and not by path

Running it twice must write nothing the second time, and "already faced" cannot be a question
about paths. On the measured library, `audio/distortion/bitcrush` extends `@engine/de-rez` and
`audio/utility/pitch-shift` extends `@engine/pitch-shifter` — faces somebody filed under names
of their own. A path check would write a second face for each, and one plugin reachable under
two names is a chain that reads as two different things depending on which you typed.

So `@studio/mediatek`'s `extendedRefs()` walks the library and collects what every module
extends. It is a walk on demand and not a field on `MediatekEntry`, because the scan does not
open a `module.yaml` today — it only checks one is there — and making every rescan parse every
module would put a cost on the listing that draws the tree to answer a question asked when
somebody clicks one menu item.

A file already sitting at a face's default path is left alone too. It cannot be a face — that
is the check above — so it is somebody's own module, and this pass must not destroy work to
make room for a two-line stub.

### Where each one lands

`<type>/<category>/<slug>`, the type from `categoryForRole` (which decides the module's PORTS)
and the category from what the scan reports about the plugin itself — its **last** segment, so
`Fx|Delay` files under `delay` and `instrument|synth` under `synth`. The first segment only
repeats the type: every effect says `Fx`.

That is the axis the médiathèque files by. `audio/distortion`, `audio/filter` and
`audio/utility` are folders somebody made by hand, and the scan's categories land straight on
them. Filing by MANUFACTURER is the other candidate: it would be a second axis crossing that
one, and one folder would hold most of the library the moment you install a big free pack —
186 of the 252 measured here come from one.

Flat under the type folder is not an option: two hundred effects in one folder is a level
you cannot find anything in. That is also why `engineFaceModule` takes a sub-folder at all — the
médiathèque's own modules sit at that depth.

`faceFolder` answers `""` for a category word that says nothing the TYPE folder does not already
say — `fx`, `effect`, `audio`, `instrument`, `midi`. `Fx` under `audio/` would be a level holding
everything, which is the same as no level at all.

Two plugins whose names slug the same **collapse to one, first wins** — the identical rule
`engineModules` applies to the scan it derives its refs from. It has to be identical, or the face
would name a ref the catalogue does not synthesise. A name with no slug in it is skipped exactly as
the catalogue skips it.

The face's header names the plugin as the SCAN spells it: the slug is lossy, and someone reading
the file a year later needs to know which of two similarly-slugged plugins it stands for.

### What it does not do

No `ui.yaml`. A panel is drawn by hand afterwards, in the builder, and two hundred and
forty-two blank ones would be that many files saying nothing.

Nothing is pushed to any machine either. `mediatekPull` fetches the modules the **open songs
name**, so a library of faces costs a machine nothing until a song reaches for one.
