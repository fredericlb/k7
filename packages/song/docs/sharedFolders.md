# sharedFolders.ts — extended notes

A project finds the modules it can extend **by where they are**:

```
ws/_modules/                  the workspace's own  → @workspace/<type>/<name>
<libraries>/st0/modules/      a library, `st0`     → @st0/<type>/<name>
<libraries>/st0/chains/       …its chains          → @st0/<path>
<libraries>/st0/presets/      …its presets         → <ns>/<module path>/<name>.yaml
ws/_presets/                  the workspace's presets, the same shape
<libraries>/drums/…           another, `drums`     → @drums/…
ws/song/                      a project
```

`<libraries>` is `librariesHome()`: `$STUDIO_LIBRARIES_HOME` where the file hub runs the service
— its ONE folder of each library, shared by every account — else `<studioHome>/libraries`.

A preset tree is keyed by the MODULE a preset is for, namespace included, and kept wherever the
person chose: a workspace may hold presets for an `@st0` module, and a library for an `@engine` one.
So `presets/` is a library family like `chains/`, and `_presets/` sits beside `_modules/` for the
`@workspace` level (`userPresets.md`).

`moduleLibraryDirs()` answers where the modules are: what sits beside the project, then every library, in name
order. Order is PRECEDENCE — nearest first — and two libraries never compete, since each keys its
modules under its own name.

## Libraries are the ORIGIN's, and the file hub keeps them

The origin has one list of named libraries, edited by its admins from st0's Libraries panel. The
file hub keeps ONE folder of each (`packages/file-hub/docs/fileHub.md`). **Every workspace of every
account sees every library; none holds a copy.** A copy mounted INTO each workspace would make the
workspace the wrong owner: each copy drifting from the others with nothing to reconcile them, a song
carrying somebody else's catalogue, and one library per account, since a fixed folder name is what
makes `@st0` mean it.

**A library is a series of frozen VERSIONS, and the workspace pins one.** `<name>/1/`, `<name>/2/`…
are published and never written again; `<name>/draft/` is the one its admins edit. A workspace
names the version of each library it uses in `_library-pins.yaml` at its root, and every function
here that turns a name into a folder takes the path it resolves FROM (`libraryRoot(name, from)`),
walks up to that file, and answers the pinned version's folder. Unpinned is version 1. What forced
it: a desktop whose st0 is too old for the newest version keeps playing an older one, and the
server must open that song as the desktop hears it. A path already inside a version of a library
resolves that library at that version, so a module reads its own library's files where it was
loaded. A library still in one folder, with no version folder in it, is every version of itself.
The plan and what remains of it: `docs/library-versions-plan.md`.

**Still found by location, never declared.** `accountLibraries()` is the folders under
`librariesHome()` whose name a library could have (`isLibraryName`); the SETTING that lists
them is the hub's, and resolution never reads it. A folder there is a root,
a folder not there is not one, and nothing can fail — the same bargain `_modules` has always had.
A library still being copied from the seed is `.seeding-…`, a dot-name no library can take, so it is
never read half-way.

**The name IS the namespace.** `moduleNamespaceOf(root)` is the library a root sits in, by path, or
`workspace`. A library cannot be called `engine`, `workspace` or `meta` (`RESERVED_LIBRARY_NAMES`),
so no library collides with the synthesised catalogue or the fixed levels; the name is lowercase
letters, digits and dashes, because it is a ref segment and a folder name at once.

**The origin's first library is named `st0`.** That is what every `@st0/…` written before
libraries had names meant — songs, chains, the four refs a scaffolded set writes for its decks — so
none of them needs a line changed. `DEFAULT_LIBRARY` is that name, and a BARE chain ref (`bass/di`,
as a bench address or a machine setting written earlier may hold one) is read as `@st0/bass/di`.

**Nothing is put IN a library, and this repo ships no modules to put.** The library is the
reference: what is in it is what its projects inherit. Modules written with `@studio/dsp` are
authored straight into a library; what the library gains is argued in
[packages/dsp/docs/catalogue.md](../../dsp/docs/catalogue.md). A new library is empty, every ref
into it resolves to nothing until modules are put there, and an unresolved ref is **not** a compile
error, so such a project reads as one whose modules are bypassed.

**A module root is a library folder, never the médiathèque cache.** `<state>/mediatek/modules` is
not one: a mirror of the médiathèque deletes whatever the owner's manifest does not list, and over a
library that would delete files somebody wrote. So `mediatekPrefetch` carries `songs` and
nothing else.

**A shared module is edited by an admin, from any project, and by nobody else.** In a workspace's
file API a library answers at the VIRTUAL folder `_libraries/<name>/…` — confined to that library's
root, never on the workspace's disk (`packages/file-service/docs/workspace.md`). The hub's folder is
every account's, so only an admin may write it. A library is OVERLAID to say so
(`setLibraryOverlays`): an admin's account overlays each onto its own folder, and everything that
asks `libraryRoot(name)` — the compile, the file tree, the engine's paths — reads the overlay's
root. `isLibraryEditable(name)` is true for an overlaid library and only for one; writes are refused
anywhere else, and the write is what publishes (`packages/file-service/docs/libraries.md`,
`apps/st0/frontend/docs/sharedModules.md`). For a versioned library the overlay is its `draft/`:
`isLibraryRootEditable(lib)` asks whether the folder a path lies in IS the overlay, so a published
version refuses every write, an admin's included. A pin outranks the overlay, so an admin hears the
draft only in a workspace that pins `draft` or pins nothing.

`_modules` is untouched by all of that. It is the WORKSPACE's own library, one copy backing every
project beside it, and it forks on write (`docs/moduleFork.md`).

There is no row for assets either: a module carries the files it loads in its own `assets/`, so
the module travels whole. See `docs/moduleAssets.md`.

### …or you are standing INSIDE one

A chain template lives in a library, and its nodes name `@<name>/…` modules of the same library or
another. `moduleLibraryDirs(dir)` needs no second arm for that: the libraries are the
origin's, so a folder inside one sees them exactly as a project does. `libraryOf(dir)` says which
library a path is in — through its overlay's root when it has one — which is what the write guard asks and what the file API maps back to
`_libraries/<name>/…`.

## A chain template is ONE file

`<library>/chains/<path>.yaml` is the chain `@<library>/<path>`, written as a project's chain file is
([chainFiles.md](chainFiles.md)): its steps in order, each node an item with its `id`, and last the
one link it makes.

```yaml
# <library>/chains/process/normalize.yaml
steps:
  - { id: 0706883d-…, extends: "@st0/cold/normalize", params: { Target: -1 } }
  - to: [ { chain: "@out" } ]
```

- **No `start`, no `ports`.** A template is fed by whatever it is put after — a clip's audio in a
  bounce, the rig's input on the bench — so its one input is implicit: its first node's main input.
  A declared port would name another input of that node, which nothing that runs a template feeds.
- **One run.** Every reader flattens a template — a bounce into a plugin list, the bench into its
  own segments — so a side-by-side step, or a link anywhere but `@out`, is refused by name rather
  than half-run.
- **`@out` is written, not implied**, because a chain's last step is where it says its signal goes,
  and a template's goes to wherever it is put. It is one of `CHAIN_SINKS` for that.
- **A node's plugin state** is `<library>/vstpresets/<file>`, named by its `vstpreset:` (default
  `<id>.vstpreset`): the library stands where a project stands, its `vstpresets/` beside its
  `chains/`. Ids are uuids, so every template shares the one folder without colliding.

`libraryChains.ts` also reads the FOLDER a library may still hold — `chains/<path>/graph.yaml`, ends
`@in`/`@out`, a `nodes/` beside it — and answers the file when a ref is held both ways, so a live
library keeps working until it is migrated. `scripts/migrateLibraryChains.ts` converts a library: it
takes the run a graph declares from `@in` to `@out`, refuses anything else and any file a chain
file has no place for, and reads every conversion back through the same reader, step by step,
before writing it. The run is what it trusts, not the folder reader: a graph that still keys its
source under `tracks:` reads as no step at all.

## Why nothing declares them

A declared list could only ever name those same two places, so it decides nothing — while giving
every project three ways to be **wrong** about facts the loader already knows:

- a list that predates a root names none of it, so every ref into that root reads as "extends
  unknown module" — about modules sitting right there on disk;
- a folder deleted from the workspace leaves its declaration behind, and a resolver that cannot
  resolve a declared root has to throw: one stale line, and the whole song goes dark;
- the same roots written twice — once in the header, once derived — drift apart between the
  compiler and the builder's catalogue, which is how a module plays and is not listed.

Location cannot drift. A folder that is not there is simply not a root, which is why none of
these functions can fail: there is no header to read first, and nothing to throw.

**`modules_from` and `libraries_from` are still ACCEPTED by the schema.** Songs on disk carry
them, and refusing the key would turn a working project into one that will not open.
`deadProjectFields` reports them as a warning naming the lines to delete — because "accepted and
silently ignored" is the failure mode this codebase keeps paying for.

## Which library modules a project actually names — mediatekRefs.ts

The machine caches what its songs reach for rather than mirroring a whole catalogue, so something
has to answer "which ones are those" — and it has to answer from the FILES, before the loader can
resolve them, since **a ref that resolves to nothing is exactly the one worth fetching**.

Two ways a project reaches a library module, and both count: a module of its own that `extends` it,
and a chain step naming it outright. `graph.yaml` declares SEGMENTS, so a library module may be a
`modules:` KEY (a node that exists before anything is wired to it), a destination, or a name in
`bypassed:` — read as the file is shaped rather than through the derived chains, which would need
the whole graph model to answer a question about names. A chain may name a NODE of a library module
(`@st0/audio/x:warm`); the folder to fetch is the module's, and the node travels inside it.

Then what those modules extend in turn, since inheritance is how the library builds on itself —
only as far as what is already on disk can say. A module fetched this round reveals its own parent
to the next one, which is one round late and never wrong.

`mediatekSongRefs` is the other half, and lives here because this is where "what does this project
reach for" is answered: a cache sync has exactly one question to ask. **This is what the file is
FOR** — a set names forty songs, the machine that plays them opens file paths, so all forty must be
on its disk before the gig and the venue has no wifi.

The two halves stay SEPARATE functions returning separate vocabularies (`modules/…` against
`songs/…`): a module ref omits its family and a song ref carries one, so a single merged list would
have to be taken apart again by whoever fetches it.

It takes **two arguments, because the answer is in two places**. The list is the PLAYLIST the
desk's surface names, and a playlist lives at the WORKSPACE root beside `_modules` rather than
inside the project. That is the cost of a set list being a document other projects can open, and
it is paid once, here.

Read off the YAML before anything resolves it, for the same reason the modules are. A line naming a
song by its bare TITLE is therefore skipped — resolving that needs the catalogue, which is the thing
being synced — so it arrives on the desk as a song the cache has not got, which it is. The
unambiguous path form is what a click writes and what the desk's own listing offers.

`mediatekPathPrefix` answers a folder PREFIX rather than a file list, because a module IS its
folder: the jsdsp source and the panel are as much part of it as `module.yaml`, and a
sync that fetched only the file named would land a module that loads nothing.

## Where a panel lives — and why there is no list for it

A module's UI panel is the `ui.yaml` in the module's own folder (see uiLibrary.ts). Not a
parallel tree at a place of its own: a project draws modules from several libraries, so one
hard-coded place cannot serve them all — and a panel filed apart from its module is free to
disagree with it about which module it draws.

`modulePanelRoots()` is the project's own `modules/` first, then the shared roots. There is
nothing panel-specific about it — it is the list of module libraries, and the panels are in them.

Deriving beats declaring here, and putting the file in the folder beats deriving. A panel is
not an independent asset like an impulse response; it is the face of a module, so it travels
with the module itself — and a library brings its faces along with nothing to write down.

**Order is precedence.** `loadUiLibrary` reads every library, nearest first, so a project
that forked a shared module draws its own face rather than the one it was copied from.
`writeUiFile` writes the panel where its module is, shared library included — see
`docs/uiLibrary.md` for why that exception exists and what it costs.

`moduleNamespaceOf()` lives here too, because it is the one fact that separates the kinds of
root: a library's modules key as `@<its name>/…`, the workspace's as `@workspace/…`, and a project's
own `modules/` keys bare. Everything that turns a folder into a ref, or a ref back into a folder,
turns on that — and it asks the PATH, never a declaration. See docs/moduleNamespaces.md.

The level is STRUCTURAL and never declared by the root. A per-root declaration would make it a free
string an author chose inside the library: a workspace library could call itself `engine` and
collide head-on with the synthesised catalogue, and nothing would tie the name to where the folder
sits. A library's name is the one the ORIGIN's list gave it, which is its folder's, which is its refs'.

**Why the default library is spelled `@st0`.** It names a library, not the app `apps/st0` its
spelling suggests. It stays on purpose — a level is
written into user files, and moving it would cost every repository a rewrite for a name nobody
types. `packages/song/scripts/migrateNamespace.ts` is what such a rewrite takes.
