# moduleNamespaces — the levels a module lives at

A module ref carries its level as an `@` prefix:

| ref | where the module is | who edits it |
|---|---|---|
| `@engine/nam` | **nowhere** — a scanned plugin, synthesised from the machine's scan cache | nobody; it has no file |
| `@k7-core/audio/delay/tape-delay` | the origin's library called `k7-core`, at `k7-core/modules` under `librariesHome()` — every library is a level of its own name (`@drums/…`) | k7's Libraries tab, by an admin, from any project |
| `@workspace/audio/reverb` | the workspace's `_modules/`, shared by every project beside it | the médiathèque |

## A library is a level, named by the origin's list

Each of the origin's libraries is read at `libraryRoot(<name>)` — the file hub's one clone of it,
or, for an admin's account, its own clone of that library — and its `modules/` is the level `@<name>`.
`moduleNamespaceOf`'s test is structural: the library a root sits in, by path, else `workspace`.
`engine`, `workspace` and `meta` cannot name a library, so no library collides with a fixed level,
and the origin's first library is `k7-core` — the level every
ref written before libraries had names uses. See [sharedFolders.md](sharedFolders.md).

## `@k7-core` names a LIBRARY of modules, and the cache folder is called `mediatek`

The level's name follows the folder of modules rather than the path on the origin: the
médiathèque is served by k7's backend under `/media`, and the level is `@k7-core` all the same.
A level is written into user files, so renaming one means rewriting every chain in every
repository on every machine at once, and the failure signature is a `?` on a graph node and
nothing else. That is worth paying to stop a word that appears nowhere; it is not worth paying
to chase a URL.

> **`@k7-core` is not the app `apps/k7`.** Nothing resolves through an app either way. The level
> names a folder of modules, and that folder is what the name follows.

`<state>/mediatek` is a **cache path** on one machine, not a name anybody writes in a file —
nothing resolves a ref through it, and renaming it would be a migration of a folder on every
machine in exchange for nothing. `$STUDIO_MEDIATEK` and the `@studio/mediatek` package keep the
name for the same reason: the médiathèque is what the thing is called, whatever serves
it.

### `@mediatek/…` and `@st0/…` resolve to nothing

Both old spellings of the default library resolve to nothing, deliberately: a chain step naming an unknown module draws
its name with a `?` on the graph, and an `extends:` that resolves to nothing is reported by
`libraryModuleIssues`. Neither is silent — which is the bar a rename in this repo has to clear
(`docs/rename-test-plan.md`).

```bash
# a project, a workspace, or the médiathèque itself — dry by default
npx tsx packages/song/scripts/migrateNamespace.ts <state>/workspace/<you>/<workspace> --write
npx tsx packages/song/scripts/migrateNamespace.ts <state>/mediatek --write
```

That script is a **text replace** on `@mediatek/` and `@st0/` (and the `st0:` key of a `_library-pins.yaml`),
not a pass through the k7x document: a namespace appears in mapping KEYS (a chain step is one), in scalar values, inside flow sequences, and in
the comment at the top of a panel. Reserialising to catch all four is exactly what `formatChains`
does, and it emits a canonical document, which would eat every comment in the file. Replacing one
unambiguous token touches nothing else: there is no other thing in this repo spelled `@mediatek` or `@st0`.

## The level comes from the LOCATION

`moduleNamespaceOf(root)` answers from the path, and no root declares one. A `namespace:`
field in a root's `config.k7x` would make the level a free string an author picked, with
two consequences worth naming. A workspace library could call itself `engine` and collide
head-on with the synthesised catalogue, so the same ref `@engine/io/IN` would mean a folder
in one place and a scanned plugin in the next. And nothing would tie the name to how deep
the folder actually sits, so the ref would tell you what someone had typed rather than where
the file is.

There are only two shared roots — the media library, or the workspace's own — so the
question has exactly two answers.

## No level is declared. They are all found

Every root is at a fixed place, so nothing in `project.k7x` names one:

| level | where |
|---|---|
| `@engine` | nowhere — synthesised from the machine's plugin scan |
| `@<library>` | `libraryRoot(<library>)/modules`, one level per library the server cloned |
| `@workspace` | `../_modules`, beside the project |

`moduleLibraryDirs()` states that once (sharedFolders.ts) and everything reads it: the modules,
their panels (`modulePanelRoots`), the fork path (`sharedRoots`) and the builder's catalogue —
which is what keeps the three from disagreeing about what a project can reach. Which libraries the
account HAS is the file service's setting; resolution only ever looks at which are cloned.

Nothing in `project.k7x` declares one. A `modules_from` naming the middle one, or a
`libraries_from` doing the same for assets, could only ever name a fixed place: it would
decide nothing while leaving three ways to be wrong about it — docs/sharedFolders.md lists
the three, each of which costs a real afternoon.

What this does NOT do is put the bytes there. The library lives on the server, and a module
reaches the engine's machine through the tunnel when the engine opens it
(`packages/engine-tunnel/docs/tunnel.md`).

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

```k7x
// _modules/audio/my-nam/module.k7x   (@workspace)
extends("@k7-core/audio/amp/nam")
params({ Gain: 0.7 })
```

`resolveModule` folds the whole ancestry in, deepest first, with no depth limit and a
cycle guard — and `mergeAuthored` merges `ui` widget by widget, so a panel drawn once
upstream reaches every module below it. That is one merge, defined once; see
[moduleResolve.md](moduleResolve.md) for why it is a phantom-branded type rather than a
convention.

This is also how a **scanned plugin gets a face**. `@engine/nam` has no folder, so it can
carry no `ui.k7x` — `writeUiFile` refuses it, in as many words:

```
@engine/nam: no module library this project can see declares '@engine',
so there is no folder to draw it in
```

The answer is a `@k7-core` module that extends it and holds the panel. The médiathèque
is the editable catalogue, so the face is drawn once, there, for every song that reaches
for the plugin — rather than copied into each project that plays it.

Contrast that with [moduleFork.md](moduleFork.md)'s `module own <ref>`, which gives an `@engine`
ref a folder of its OWN rather than a `@k7-core` module that extends it — the right answer when what
you want is a panel and presets FOR YOU, not a face the whole account reads.
