# moduleNamespaces — the four levels a module lives at

A module ref carries its level as an `@` prefix:

| ref | where the module is | who edits it |
|---|---|---|
| `@engine/nam` | **nowhere** — a scanned plugin, synthesised from the machine's scan cache | nobody; it has no file |
| `@mediatek/audio/delay/tape-delay` | the machine's media library (`~/.studio/mediatek/modules`) | the médiathèque |
| `@workspace/audio/reverb` | the workspace's `_modules/`, shared by every project beside it | the médiathèque |
| `@project/audio/reverb` | the project's own `modules/` | l8 |

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
| `@mediatek` | `~/.studio/mediatek/modules` (or `$STUDIO_MEDIATEK`) |
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
named bare before the levels were spelled out, and every `chains.yaml` already written
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
extends: "@mediatek/audio/amp/nam"
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

The answer is a `@mediatek` module that extends it and holds the panel. The médiathèque
is the editable catalogue, so the face is drawn once, there, for every song that reaches
for the plugin — rather than copied into each project that plays it.

Contrast that with [moduleFork.md](moduleFork.md), which copies a whole folder into the
project. Copying was the older answer to the same question, and it is still what a save
into a read-only `_modules` does; inheritance is the one that leaves a single copy of the
module and a single place to fix it.
