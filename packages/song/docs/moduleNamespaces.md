# moduleNamespaces — the four levels a module lives at

A module ref carries its level as an `@` prefix:

| ref | where the module is | who edits it |
|---|---|---|
| `@engine/nam` | **nowhere** — a scanned plugin, synthesised from the machine's scan cache | nobody; it has no file |
| `@st0/audio/delay/tape-delay` | the account's library repository, mounted at `<workspace>/_libraries/modules` | l8's Libraries tab |
| `@workspace/audio/reverb` | the workspace's `_modules/`, shared by every project beside it | the médiathèque |
| `@project/audio/reverb` | the project's own `modules/` | l8 |

## `@st0` is a git submodule in the workspace

The level's folder is `<workspace>/_libraries/modules` — the account's library repository,
mounted by the file service into every workspace. It used to be `~/.studio/mediatek/modules`,
one folder per machine synced from the hosted médiathèque, and `moduleNamespaceOf` was an exact
string comparison against that one path. There is one per workspace now, so the test is
structural instead: the root's parent folder is named `_libraries`. See
[sharedFolders.md](sharedFolders.md) for what that bought and what it cost.

## `@st0`, and why the cache folder is still called `mediatek`

The media library's level was named after **the app that served it**. It was `@mediatek` while
that app was `apps/mediatek`; the app became `apps/st0` and the ref did not follow, so for a
while a chain named a library by a word that no longer appeared anywhere else in the repo. That
is what `migrateNamespace.ts` was written for, and the level was moved once, to `@st0`.

**It has not moved since, and will not.** That app is `apps/pl8` today — renamed when l8 took
the origin root and the médiathèque moved to `/pl8` — and the level is still `@st0`. The name
follows the *folder of modules*, which did not move, rather than the *path on the origin*, which
did. The price of moving it is the whole reason: a level is written into user files, so every
chain in every repository on every machine would have to be rewritten at once, and the failure
signature is a `?` on a graph node and nothing else. Once was worth it to stop a word that
appeared nowhere; twice would be to chase a URL.

What did *not* move is `~/.studio/mediatek`. That is a **cache path** on one machine, not a name
anybody writes in a file — nothing resolves a ref through it, and renaming it would be a
migration of a folder on every machine in exchange for nothing. `$STUDIO_MEDIATEK` and the
`@studio/mediatek` package stay for the same reason: the médiathèque is still what the thing is
called, and `pl8` is what serves it.

### Nothing accepts the old spelling

`@mediatek/…` resolves to nothing. That is deliberate, and it is the opposite of the choice
made for [the bare ref](#the-bare-ref) below — worth putting side by side, because the two look
alike and are not:

| | `audio/reverb` vs `@project/audio/reverb` | `@mediatek/…` vs `@st0/…` |
|---|---|---|
| what they are | two spellings of **one** level, both current | the **old** name of a level and its current one |
| resolution | keyed twice, both work, forever | one key; the old name names nothing |
| why | every `graph.yaml` ever written says the bare form | keeping it would mean two words for one library, permanently |

So this one is migrated rather than aliased, and the failure is meant to be seen: a chain step
naming an unknown module draws its name with a `?` on the graph, and an `extends:` that resolves
to nothing is reported by `libraryModuleIssues`. Neither is silent — which is the bar a rename
in this repo has to clear (`docs/rename-test-plan.md`).

```bash
# a project, a workspace, or the médiathèque itself — dry by default
npx tsx packages/song/scripts/migrateNamespace.ts ~/.studio/root/<you>/<workspace> --write
npx tsx packages/song/scripts/migrateNamespace.ts ~/.studio/mediatek --write
```

That script is a **text replace** on `@mediatek/`, where `migrateDocFields.ts` beside it goes
through the yaml Document API. The difference is what is being changed: a doc field is a
*structure*, and rewriting the document is what preserves everything around it — but a namespace
appears in mapping KEYS (a chain step is one), in scalar values, inside flow sequences, and in
the comment at the top of a panel. Reserialising to catch all four is exactly what `formatChains`
does, and it emits a canonical document, which would eat every comment in the file. Replacing one
unambiguous token touches nothing else: there is no other thing in this repo spelled `@mediatek`.

## The level comes from the LOCATION

It used to be declared, per root, in that root's `config.yaml`:

```yaml
namespace: engine     # ← in _modules/config.yaml
```

That made the level a free string an author picked, with two consequences worth naming.
A workspace library could call itself `engine` and collide head-on with the synthesised
catalogue — **a dozen fixtures in this repo did exactly that**, which is why the same ref
`@engine/io/IN` meant a folder in one test and a scanned plugin in the next. And nothing
tied the name to how deep the folder actually sat, so the ref told you what someone had
typed rather than where the file was.

`moduleNamespaceOf(root)` answers from the path now, and the field is gone. There are only
two shared roots — the media library, or the workspace's own — so the question has exactly
two answers.

## No level is declared. They are all found

Every root is at a fixed place, so nothing in `project.yaml` names one:

| level | where |
|---|---|
| `@engine` | nowhere — synthesised from the machine's plugin scan |
| `@st0` | `../_libraries/modules`, the account's library submodule |
| `@workspace` | `../_modules`, beside the project |
| `@project` | the project's own `modules/` |

`moduleLibraryDirs()` states that once (sharedFolders.ts) and everything reads it: the modules,
their panels (`modulePanelRoots`), the fork path (`sharedRoots`) and the builder's catalogue —
which is what keeps the four from disagreeing about what a project can reach.

`modules_from` used to declare the middle two and is gone; `libraries_from` did the same for
assets. They could only ever name those places, so they decided nothing while leaving three
ways to be wrong about them — see docs/sharedFolders.md, which lists the three because each
one cost a real afternoon.

What this does NOT do is put the bytes there. The library is hosted; the local folder is a
cache of it, filled by `packages/file-service/docs/mediatekPull.md` for the modules the open
songs name.

`@engine` is the odd one and always will be: it names **no folder at all**. A scanned
plugin is a module the engine merely reports (`engineCatalogue.ts`), which is fine until
you want to draw it a panel or give it presets, because both are FILES in a module's
folder.

## The bare ref

`audio/reverb` and `@project/audio/reverb` are the same module. Project modules were
named bare before the levels were spelled out, and every `graph.yaml` already written
says them that way, so `loadModuleRefs` keys each one **twice** and both resolve. Nothing
had to be migrated; `@project/` is simply the explicit spelling.

Two places have to know that the bare form is the project level, and both used to get it
free from `moduleNamespaceOf` returning `null` for a root with no config:

- `loadUiLibrary` passes `null` for the project's own `modules/`, which is what makes
  `panelsIn` key its panels bare and skip the category-folder depth a shared library has.
- `moduleRootFor` maps `@project/…` back to `<project>/modules`, or a panel written for
  the explicit spelling would be refused for naming no library.

## Going deeper means inheriting, not copying

To change a module you do not own, you make one at YOUR level that `extends` it:

```yaml
# modules/audio/my-nam/module.yaml   (@project)
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

Contrast that with [moduleFork.md](moduleFork.md), which copies a whole folder into the
project. Copying was the older answer to the same question, and it is still what a save
into a read-only `_modules` does; inheritance is the one that leaves a single copy of the
module and a single place to fix it.

## Giving the WHOLE scan a face

`engineFaces()` does for a library what `engineFaceModule()` does for one plugin, and pl8
offers it on the modules section itself. On the machine this was measured against: 252 plugins
scanned, 242 modules written, 10 skipped.

### This is not `module populate` coming back

It looks like it and it is the opposite, so the difference is worth stating. `module populate`
wrote one `module.yaml` per scanned plugin holding **two copied facts** — `plugin.type` and
`plugin.name` — and those copies were strictly less informed than the scan they came from, had
to be regenerated by hand, and went stale in silence. That is why it was deleted (see
`engineCatalogue.ts`).

A face copies **nothing**. It is one `extends:` line, and every fact about the plugin still
comes from the scan through the ref. Update the plugin and the face is still right; there is no
second copy to go stale, because there is no copy. What it adds is the two things a ref with no
folder behind it cannot have: a name a chain can say, and somewhere a `ui.yaml` can sit.

### Idempotent, by REF and not by path

Running it twice must write nothing the second time, and "already faced" cannot be a question
about paths. On the measured library, `audio/distortion/bitcrush` extends `@engine/de-rez` and
`audio/utility/pitch-shift` extends `@engine/pitch-shifter` — faces somebody filed under names
of their own. A path check would have written a second face for each, and one plugin reachable
under two names is a chain that reads as two different things depending on which you typed.

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

That is the axis the médiathèque already files by. `audio/distortion`, `audio/filter` and
`audio/utility` are folders somebody made by hand before any of this existed, and the scan's
categories land straight on them. Filing by MANUFACTURER was the other candidate; it would have
been a second axis crossing that one, and one folder would hold most of the library the moment
you install a big free pack — 186 of the 252 measured here come from one.

Flat under the type folder was never on the table: two hundred effects in one folder is a level
you cannot find anything in.

### What it does not do

No `ui.yaml`. A panel is drawn by hand afterwards, in the builder, and two hundred and
forty-two blank ones would be that many files saying nothing.

Nothing is pushed to any machine either. `mediatekPull` fetches the modules the **open songs
name**, so a library of faces costs a machine nothing until a song reaches for one.
