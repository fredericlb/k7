# `@meta` modules — the ones st0 ships itself

Most modules come from a **library**: a repository the account clones, which anyone with access can
change, and which a project only finds once it is cloned ([sharedFolders.md](sharedFolders.md)).
A few modules cannot work that way, because the way lanes and sets behave depends on them. Those
ship WITH st0, in `packages/song/meta/`, and answer under `@meta`:

| ref | what depends on it |
|---|---|
| `@meta/audio/mixer` | every lane's STRIP, its level and pan ([trackMixer.md](trackMixer.md)); `SHARED_STRIP` names it |
| `@meta/audio/turntable` | a DJ set's PLATTER, the source of every deck ([setProject.md](setProject.md)) |
| `@meta/audio/recorder` | a live rig's RECORDER on the master run, what makes a rig something you keep ([recorderNode.md](recorderNode.md)) |

## Why not a library

A lane without its strip has nowhere to put a level, and a deck without its platter plays nothing.
Left in a library, both could be deleted, renamed or edited out of shape by anyone with access to
it, or simply be missing on a machine that has not cloned it yet. The scaffolds, the importer and
the migrations all write these refs, so a missing one breaks every new project at once. Shipped
with the code, they are there wherever st0 runs, and they change only with st0.

## How they are read

`packages/song/meta/` has a library's shape (`<type>/<name>/module.yaml`, `ui.yaml`, `widgets.js`)
and is read by the same loader. `META_MODULES_ROOT` names the folder and `moduleNamespaceOf`
answers `meta` for it. It is added **only where modules are read**: the loader, and the panel and
controller lookups (`modulePanelRoots`). It is deliberately absent from `moduleLibraryDirs`, which
is what the Libraries tab lists, what a save forks into, and where a panel is written. So nothing in
the app edits these modules; a change to one is a change to st0's source. No library can shadow
one, because `meta` cannot be a library's name.

The modules name their engine plugin directly (`plugin: { type: internal, name: Mixer }`) rather
than extending an `@engine/` ref: an `@engine/` ref resolves through the machine's plugin scan,
and st0's own modules must not depend on a scan having been made.

They are not owed by a library either: `neededRefs` and the médiathèque fetch never list them.
