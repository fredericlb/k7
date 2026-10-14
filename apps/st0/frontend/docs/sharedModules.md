# Editing a shared module — the Libraries tab

A module is a plugin. What it does is not in its file: it is heard. And the names of its
parameters, their bounds and its factory banks exist only in a **loaded** plugin — which means
in a project.

So a shared module is edited from inside a project, against the engine already playing the song:
**the file tree has a second tab.**

## The two tabs

| tab | what it lists |
|---|---|
| **Project** | the song's own files — a project has no modules of its own to hold back |
| **Libraries** | one row per LEVEL — `@workspace`, `@engine` — with the modules under it, and one per LIBRARY of the origin (`@st0`, `@drums`…), each a folder with its `modules`, `chains` and `assemblies` |

**They are two different answers, and the difference is worth writing down.** `/tree` walks the
workspace (`packages/file-service/docs/activeProject.md`), and the libraries are not in the
workspace at all — the file hub holds one folder of each for the origin and the file service
answers them at the virtual `_libraries/<name>/…` — so no walk of the workspace can find them, nor
say which level wins when two hold the same name.

So they have a route of their own, `GET /module-libraries`, whose roots come from
`@studio/song`'s `moduleLibraryDirs`. It therefore lists what the LOADER resolves against and
cannot drift from it, which searching a tree cannot guarantee.

```
@workspace    _modules/                  shared by every project beside it
@st0          _libraries/st0/modules/    one of the origin's libraries, held by the file hub
@drums        _libraries/drums/modules/  …another, each under its own name
@engine       — no folder —              this machine's plugin scan, READ-ONLY
```

**Nearest first, which is precedence.** Reading the tab top to bottom is reading the order the
loader resolves in — which module wins when two levels hold the same name. The service answers
in that order and the tab does not re-sort it: two places deciding precedence is how they come
to disagree.

**A level with no folder yet is still drawn, empty.** It is a place you can put a module — the
row's menu offers exactly that, and creating through it is what brings the folder into being —
so hiding it would leave nowhere to start on a workspace whose `_modules` does not exist yet,
which is every fresh one. `exists: false` and "empty" are kept apart in the answer for the
same reason: only one of them is fixed by adding a module.

A library is listed when the server holds its folder, whether or not it has a `modules/` yet — its
chains still have to go somewhere. Which libraries the origin has is set by its admins in the home
page's Libraries page, never from this tab: a library's own row cannot be renamed, moved or
deleted from here.

## An admin edits a library from any project, and nobody else edits it

Everything inside a library — making, renaming, deleting, moving, a builder's Save, a chain's verb,
a preset saved into it — is refused by the file service unless the account is one of the origin's
admins. The refusal says so; the tab still offers the entries, since the service is the gate. What
forced it: a library is ONE folder on the server that every account reads, so a write into it is
everybody's at once. An admin's file service writes into its `draft/`, never a published version
(`packages/file-service/docs/libraries.md`), from whichever project is open.

That is what lets the song that names a module be the place to hear an edit — there is no special
place to go to, and no second copy of a library to keep in step with the one everyone reads.

## `@engine`, which is not a folder

The third level is here too, last, and it is **read-only** — the one level that is not files at
all. `engineCatalogue` synthesises it from this machine's plugin scan (`<state>/exts.json`),
so there is no path, nothing to open and nothing to write. Its rows are a **vocabulary a chain
can name**, and they are greyed for exactly that reason: the same treatment a `.wav` gets, and
for the same reason — something you can read and cannot open.

**This tab is the only place it is offered.** `@engine` refs are deliberately absent from the
module-name completions — the command bar's `<module>` arguments and the YAML editor's chain
wiring — because the size of that namespace is a fact about the MACHINE and not about the song:
a rig with four hundred plugins put four hundred entries in front of the dozen modules the
project has, and the dozen were what you were looking for. So it is browsed here, where it is
grouped by type and where scrolling is the point, rather than completed there, where it is not.

Absent from the SUGGESTIONS, not forbidden: a chain step may still name `@engine/nam`, and
typing it works — a completion list is an offer, never a validator. And the
one question where the engine's catalogue *is* the right answer keeps it: `extends:`, and the
`module new` / `node replace` / `module own` arguments that ask what to inherit from. `isEngineRef`
in `packages/song-schema/src/moduleTypes.ts` is the predicate, and it is a function rather than a
`startsWith` at each call site so that a library called `@engineering` is not swallowed with it.

Two things about it are synthesised, and it is worth knowing which:

- **The type folders.** A ref is flat (`@engine/nam`), and two hundred and fifty plugins in one
  list is a level you cannot find anything in. So the folder rows carry a made-up path and the
  **leaves carry the real ref**, which is the one string anything downstream should trust.
- **The level's own row.** It has no folder, so its label stands in for a path.

Giving a scanned plugin a folder is a different act, and a deliberate one: `module own <ref>`
(`packages/song/docs/moduleFork.md`). A plugin has no panel until it has somewhere to
keep one, and this tab does not pretend otherwise.

An `@engine` with nothing in it is not drawn: a machine that has never scanned has no
vocabulary to offer, and an empty heading would say something untrue.

## Making things

Two entries, on any folder of a **writable** level — the namespace row included, since that row
IS the level's folder:

| entry | makes |
|---|---|
| **New folder…** | a plain folder, for filing (`audio/delay/`) |
| **New module…** | `<type>/<name>/module.yaml`, and opens the builder on it |

A module is named by its path **under the row you clicked**, so the entry reads the same
everywhere: `audio/reverb` on `@workspace`, `reverb` inside `audio`. The hint spells the resulting
file out, so what is about to be written is never a guess, and the service refuses anything with
no type folder — `audio/reverb` is the shortest thing the loader will key.

`@engine` gets neither: `rootOf` refuses a read-only level, so the menu does not open there at
all rather than opening with everything greyed out. A scanned plugin has no folder, so there is
nothing to make one in (`packages/song/docs/moduleNamespaces.md`).

Note the two shapes: a workspace library holds its type folders **directly**, where each of the
origin's libraries holds three FAMILIES and `modules` is one of them. That difference is why the
rows are found from a list rather than a pattern.

**The Project tab has no `modules/` to drop.** A module lives at `@workspace` or in a library now,
never inside the song, so there is nothing under the Project tab that the Libraries tab also
owns — the two tabs are already disjoint, by where the files sit rather than by anything drawn
here choosing to leave one out.

The Libraries root rows are **namespaces** — the `@` prefix a chain writes in a ref — and under
each, the catalogue exactly as a ref spells it. A library is drawn one level deeper, because it is
a FOLDER holding three families side by side, and the row shows it as it is on disk:

```
@st0                      _libraries/st0/
  modules                   modules/        the @st0 module level
    audio
      delay
        tape-delay        →  @st0/audio/delay/tape-delay
  chains                    chains/         → @st0/<path>, opened in the chains builder
  assemblies                assemblies/     → opened in the assembly builder
```

A chain or a template is filed under ITS library's row, by the `@<name>/` its ref starts with, and
drawn without that prefix — the row it sits under already says it.

Drawing `modules/` AS `@st0`, with the chains in a row labelled `@st0/chains`, would show two
sibling folders as a folder and its child, under a label that is not even a ref prefix (a chain is
`@st0/tools/stems`, never `@st0/chains/tools/stems`). The `modules` row keeps the level's own path,
so creating a module resolves as any `@st0/…` ref does; the library row and its `chains` and
`assemblies` rows belong to no level and offer no create.

A module is one row, as it is on the Project tab and by the same code (`foldModules`): the
folder holds `module.yaml`, so the tree folds it and clicking it opens the builder rather than
a file.

The listing is fetched the first time somebody looks at the tab, not on mount — it is a walk of
its own over three levels, and most sessions never open it. It is not re-polled: what this tab does
to it — make, rename, delete — refreshes it itself.

## Renaming and deleting

**Rename…** and **Delete** sit on every row INSIDE a library's families — a module, a folder, a
chain, a template — and never on the library row nor on `modules`, `chains` and `assemblies`
themselves, which are the library's shape rather than its content. `@engine` gets neither, for the
reason it gets no create.

Both are live at once, like every edit to a library: the folder they change is the one every
account reads.

A delete goes to the LIBRARY's own `_recycle_bin/`, never the workspace's: the library is not in
the workspace and may sit on another disk, where a move would fail, and what an admin deletes from
a library belongs with that library rather than with whichever project was open.

A rename changes a module's REF, and a folder's rename changes the ref of every module inside it.
So it repoints them as a move does, in the library and in this workspace's projects; other
workspaces keep the old ref (`packages/song/docs/moduleMove.md`). An engine's folder cannot be
renamed: nodes pick an engine by that name.

## Moving a module — drag it

A **module** row drags onto another folder of its own library and type: the type folder, or one
category below it. Only module rows drag; a folder, a chain and anything at the `@workspace` or
`@engine` level do not. Unlike a rename, a move **takes its refs with it**: every `extends:` naming
the old ref, in the library and in this workspace's projects, is repointed; the library's part is
live at once. What the move cannot reach is any other workspace. The rules and the reasons are in
`packages/song/docs/moduleMove.md`.

## Editable at once — Save writes, and the write is the publication

Every module opens in the builder **editable**, a library's as readily as `@workspace`'s: no lock,
no Edit button, no dialog. The builder never writes on its own — each pane holds its edits until
**Save** — and on a library module, for an admin, Save writes the four files straight into the
server's folder of that library. There is no second step: no publish, no discard, nothing pending.
A module somebody opened to read costs nothing: closing it unsaved leaves the library untouched.

So Save on a library module is worth knowing for what it is: the library's copy is the only copy,
nothing forks, and every song of every account that names this module sounds different the next
time it is opened. Its history is the library's st0fs log, which the file hub keeps
(`packages/file-hub/docs/fileHub.md`).

A module's presets are not in its folder at all: they are files of a presets tree, saved from a
graph node into the workspace or into a library, so keeping one never edits the module every song
reads (`packages/song/docs/userPresets.md`). The `@engine` level stays read-only, since a scanned
plugin has no folder to write into.

## The loaded plugin comes free

Editing a module needs two things at once: an editable catalogue, and a loaded plugin. This tab
has both without inventing anything. You are already in a project, with a real engine and a real
song playing; the shared module you want to change is very likely one that song already names.
So the builder's live-plugin lookup is the ordinary one — read the compiled graph, find a chain
step whose `module` matches the ref the module's own folder spells out:

```
_modules/audio/delay/tape-delay/module.yaml                →  @workspace/audio/delay/tape-delay
_libraries/st0/modules/audio/delay/tape-delay/module.yaml  →  @st0/audio/delay/tape-delay
_libraries/drums/modules/audio/kick/module.yaml            →  @drums/audio/kick
```

`libraryModuleRef` is that spelling (`src/libraryTree.ts`), and getting it wrong is what would
quietly turn this tab into a text editor: no ref, no plugin, no real parameters. A module the
open song does *not* name gets no plugin, which is an ordinary state and not an error — the
same one the builder has for any module a project does not instantiate.

To hear a module no project uses, wire it into the song you have open.

## One path space, one store

```
the workspace's own   _modules/audio/reverb/module.yaml
a library's            _libraries/st0/modules/audio/reverb/module.yaml
```

Both are workspace paths, both served by the file service, both written by the same route — the
second one lands in the server's folder of `st0`, since `_libraries/<name>/` is a VIRTUAL folder
the file service maps to that library's root and confines there
(`packages/file-service/docs/workspace.md`). The builder gets `moduleStore` either way, and what
tells them apart is a folder name rather than which tab you clicked — `isLibraryPath` reads it off
the path, so `ui builder <path>` behaves exactly as a click in the Libraries tab does.

That is what the virtual folder buys: one path space where libraries served from somewhere else
would need two that spell a module *identically*, a second store, and a rule that the choice
between them must never be re-derived from a path.

## The builder has a Save button, and it is the only screen here that does

Every text pane in st0 writes as you type. This one does not, and the reason is what a save
*means* here:

- **A module is four files describing one thing.** `module.yaml`, `ui.yaml`, its DSP source and
  its `widgets.js` are edited together and are only coherent together. Autosave writes each of them
  whenever *its own* typing pauses, which leaves a module half-written between two pauses — a
  panel for a plugin the DSP does not have yet.

So Save writes all four files. Ctrl+S and vim's `:w` are that button — all four files, not the
pane you happen to be looking at. The machinery underneath is the ordinary one: `useAutosave`'s
`manual` mode keeps the validation and the held-back buffers and only turns the timer off
(`packages/ui-editor/docs/autosave.md`). A Save writes with `PUT /file`, the route a project file
takes, and nothing else: nothing in the song changes, since the version a song hears is its
workspace's pin, not a field of the song (`packages/song/docs/sharedFolders.md`).

## The bench is not where a library is edited

`/@banc/<chain>/live.st0` opens a live rig seeded with a COPY of a library chain, which anyone may
open and which edits no library (`apps/st0/backend/docs/media/banc.md`). To hear a library module no song you
have open names, wire it into the song you have open. The bare `/@banc/live.st0`, a bare library
such as `/@banc/@st0/live.st0`, and every other address under `@banc` is refused with a sentence
saying where a library is edited.

## What to check in a browser

The suites here mount nothing, so none of this is covered by a green run:

- with **no library** on the origin, open any project → st0 refuses with "no libraries" — adding
  one opens the project;
- as an admin, add a library named `st0` from the home page's Libraries page → it is listed as
  `@st0`, its folder is `<dataRoot>/libraries/st0`, and no workspace gains a `_libraries/` folder;
- add a SECOND one named `drums` → switch the tree to **Libraries** → `@workspace`, `@drums`,
  `@st0`, `@engine`, each library with `modules`, `chains` and `assemblies`;
- open a workspace with no `_modules` → `@workspace` is there and empty. Right-click it →
  **New module…** → type `audio/test` → the folder is made, the builder opens on it, writable
  with no lock;
- `@engine` is last, greyed, and grouped by type; clicking a row opens nothing and right-clicking
  offers no menu;
- right-click a type folder inside `@workspace` → **New folder…** and **New module…**, the second
  taking just a name there and `<type>/<name>` on the level's own row;
- as a NON-admin, edit an `@st0` module and press Save → refused, with a sentence saying only the
  origin's admins edit a library;
- as an admin, in any project, click an `@st0` module → the builder opens editable, with no Edit
  button and no dialog; typing writes NOTHING: the Save button lights up instead. Close it unsaved
  → the library is untouched;
- edit two of the four files, press **Save** once → both land in `<dataRoot>/libraries/st0` at
  once, and nothing in the song's own files changes;
- delete a module from `@st0` in the Libraries tab → it is in `<dataRoot>/libraries/st0/_recycle_bin/`,
  not in the workspace's bin;
- type something that will not parse and press Save → it is held back with the reason;
- edit a module the open song NAMES → its parameter list is the plugin's, and turning a knob
  changes the sound;
- save a library module from ANOTHER admin's account, then open a project here as a non-admin → the
  module is the new one, in every workspace at once;
- open `/@banc/modules.st0`, `/@banc/live.st0` or `/@banc/@st0/live.st0` → a refusal that says
  where a library is edited.
