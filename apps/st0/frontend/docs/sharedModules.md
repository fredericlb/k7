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
| **Libraries** | one row per LEVEL — `@workspace`, `@engine` — with the modules under it, and one per LIBRARY of the account (`@st0`, `@drums`…), each a repository with its `modules`, `chains` and `assemblies` |

**They are two different answers, and the difference is worth writing down.** Looking for
`_modules` *inside the file tree* finds nothing, because `/tree` is deliberately rooted at the
ACTIVE PROJECT: *"the rest of the clone is the REPOSITORY, not the song"*
(`packages/file-service/docs/activeProject.md`, and a test that says so). `_modules` sits BESIDE
the project, and the libraries are not in the workspace at all — the file service clones them
under `<studioHome>/libraries` and answers them at the virtual `_libraries/<name>/…` — so no amount
of searching the song's own tree can find either.

So they have a route of their own, `GET /module-libraries`, whose roots come from
`@studio/song`'s `moduleLibraryDirs`. It therefore lists what the LOADER resolves against and
cannot drift from it, which searching a tree cannot guarantee.

```
@workspace    _modules/                  shared by every project beside it
@st0          _libraries/st0/modules/    one of the account's libraries, cloned by the file service
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

A library is listed when the machine has cloned it, whether or not it has a `modules/` yet — its
chains still have to go somewhere. Which libraries the account has is set on the home page, never
from this tab: a library's own row cannot be renamed, moved or deleted from here.

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
(`packages/song/docs/moduleFork.md`). A plugin has no panel and no presets until it has
somewhere to keep them, and this tab does not pretend otherwise.

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
account's repositories holds three FAMILIES and `modules` is one of them. That difference is why the
rows are found from a list rather than a pattern.

**The Project tab has no `modules/` to drop.** A module lives at `@workspace` or in a library now,
never inside the song, so there is nothing under the Project tab that the Libraries tab also
owns — the two tabs are already disjoint, by where the files sit rather than by anything drawn
here choosing to leave one out.

The Libraries root rows are **namespaces** — the `@` prefix a chain writes in a ref — and under
each, the catalogue exactly as a ref spells it. A library is drawn one level deeper, because it is
a REPOSITORY holding three families side by side, and the row shows it as it is on disk:

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
so creating a module resolves as any `@st0/…` ref does; the repository row and its `chains` and
`assemblies` rows belong to no level and offer no create.

A module is one row, as it is on the Project tab and by the same code (`foldModules`): the
folder holds `module.yaml`, so the tree folds it and clicking it opens the builder rather than
a file.

The listing is fetched the first time somebody looks at the tab, not on mount — it is a walk of
its own over three levels, and most sessions never open it. It is not re-polled: what this tab does
to it — make, rename, delete — refreshes it itself.

## Renaming and deleting

**Rename…** and **Delete** sit on every row INSIDE a library's families — a module, a folder, a
chain, a template — and never on the repository row nor on `modules`, `chains` and `assemblies`
themselves, which are the library's shape rather than its content. `@engine` gets neither, for the
reason it gets no create.

Both are PUBLISHED at once: the library is committed and pushed, as the builder's Save does. A
library is a repository other people read, so a rename left uncommitted would be one only this
machine sees, and the next Save would push it bundled with an unrelated edit under that edit's
message.

A delete does not go to the workspace's recycle bin. The library's HISTORY is its bin — the commit
that removes a module is the one to revert — and the library's clone may sit on another disk than
the workspace, where a move would fail. The confirmation says so rather than promising a bin.

A rename changes a module's REF, and a folder's rename changes the ref of every module inside it.
So it repoints them as a move does, in the library and in this workspace's projects; other
workspaces keep the old ref (`packages/song/docs/moduleMove.md`). An engine's folder cannot be
renamed: nodes pick an engine by that name.

## Moving a module — drag it

A **module** row drags onto another folder of its own library and type: the type folder, or one
category below it. Only module rows drag; a folder, a chain and anything at the `@workspace` or
`@engine` level do not. Unlike a rename, a move **takes its refs with it**: every `extends:` naming
the old ref, in the library and in this workspace's projects, is repointed, then the library is
published. What the move cannot reach is any other workspace. The rules and the reasons are in
`packages/song/docs/moduleMove.md`.

## Editable at once — Save is the decision

Every module opens in the builder **editable**, a library's as readily as `@workspace`'s: no lock,
no Edit button, no dialog. The builder never writes on its own — each pane holds its edits until
**Save** — and on a library module Save IS the publish: the four files committed and pushed onto
that library's repository, which every song in the account reads. So the moment of decision is
the one button already there, pressed on purpose, rather than a gate before the first keystroke
that edits nothing. A module somebody opened to read costs nothing: closing it unsaved leaves the
library untouched.

What saving a library module means is still worth knowing: the library's copy is the only copy,
nothing forks, and every song that names this module will sound different next time it is opened.

A library module still holds no shelf presets — they would be an edit to the one copy every song in
the account reads (`packages/song/docs/userPresets.md`). The `@engine` level stays read-only, since
a scanned plugin has no folder to write into.

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
second one lands in the account's clone of `st0`, since `_libraries/<name>/` is a VIRTUAL folder
the file service maps there and confines there (`packages/file-service/docs/workspace.md`). The
builder gets `moduleStore` either way, and what tells them apart is a folder name rather than
which tab you clicked — `isLibraryPath` reads it off the path, so `ui builder <path>` locks
exactly as a click in the Libraries tab does, and `libraryOfPath` says which library a Save
publishes.

That is what the virtual folder buys: one path space where libraries served from somewhere else
would need two that spell a module *identically*, a second store, and a rule that the choice
between them must never be re-derived from a path.

## The builder has a Save button, and it is the only screen here that does

Every text pane in st0 writes as you type. This one does not, and the reason is what a save
*means* here:

- **A module is four files describing one thing.** `module.yaml`, `ui.yaml`, `presets.yaml` and
  a `jsdsp.ts` are edited together and are only coherent together. Autosave writes each of them
  whenever *its own* typing pauses, which for a shared module means publishing a panel for a
  plugin nobody else has yet.
- **On a shared module a save is a publish.** It commits and pushes a repository other people
  read. A timer that did that on every pause in typing would put a commit on a shared history
  every time a knob moved.

So Save writes all four files and then, if the module is a library one, commits and pushes.
Ctrl+S and vim's `:w` are that button — all four files, not the pane you happen to be looking
at. The machinery underneath is the ordinary one: `useAutosave`'s `manual` mode keeps the
validation and the held-back buffers and only turns the timer off
(`packages/ui-editor/docs/autosave.md`).

**Publishing runs only if every file landed.** `flush()` reports whether a buffer is on disk,
and a file held back because it would not compile reports false — committing a module whose
`module.yaml` is still yesterday's would put a half-edit in front of everybody.

## What a save actually does

1. `PUT /file` on the file service for each dirty file, into the library's clone. The same route a
   project file takes.
2. `POST /libraries/publish`, naming THAT library — `git add -A`, a commit authored by you, a push.

That is all of it. No song repository is touched: none records which version of a library it uses —
a library is at its latest, for every song (`packages/song/docs/sharedFolders.md`). A
refused push reports "committed, not pushed" and keeps the work in the clone; the next Save pushes
it. Nothing to commit is not a failure either — two saves with no edit between them land there.

## What the bench is for

`@banc` opens **one live rig** — `/@banc/live.st0`, a place to HEAR a library module when no song
you have open happens to name it. Nothing in it is kept: what a bench session produces is an edit
to the library module itself, made from this tab, which is why the bench needs no second home for
one. `apps/pl8/docs/banc.md` is its page.

Neither a MODULE nor a CHAIN is edited there: both are authored from a project that is already
open, and every other address under `@banc` answers 404 with a sentence pointing here. The bench
sees the account's libraries like any other workspace, so `@st0/…` resolves there the way it does
in a song.

## What to check in a browser

The suites here mount nothing, so none of this is covered by a green run:

- with **no library** on the account, open any project → st0 refuses with "no libraries" before it
  clones anything, with the libraries card under the refusal — adding one opens the project;
- add an **empty** repository from st0's home page (the card is above everything else), leaving the
  name blank → it is listed as `@st0`, cloned under `<studioHome>/libraries/st0`, and no workspace
  gains a `_libraries/` folder;
- add a SECOND repository named `drums` → switch the tree to **Libraries** → `@workspace`, `@drums`,
  `@st0`, `@engine`, each library with `modules`, `chains` and `assemblies`;
- open a workspace with no `_modules` → `@workspace` is there and empty. Right-click it →
  **New module…** → type `audio/test` → the folder is made, the builder opens on it, writable
  with no lock;
- `@engine` is last, greyed, and grouped by type; clicking a row opens nothing and right-clicking
  offers no menu;
- right-click a type folder inside `@workspace` → **New folder…** and **New module…**, the second
  taking just a name there and `<type>/<name>` on the level's own row;
- click an `@st0` module → the builder opens editable, with no Edit button and no dialog; typing
  writes NOTHING: the Save button lights up instead. Close it unsaved → the library is untouched;
- edit two of the four files, press **Save** once → both land, and one commit appears in THAT
  library's repository, pushed. Not two commits, not one per file, and none in the song's
  repository;
- type something that will not parse and press Save → it is held back with the reason, and
  nothing is committed;
- edit a module the open song NAMES → its parameter list is the plugin's, and turning a knob
  changes the sound;
- publish a change to a library from ANOTHER machine, then open a project here (or press
  **Update** on the home page) → the module is the new one, in every workspace at once;
- open a workspace that still has the old `_libraries` submodule → it is gone after the open, with
  one unpushed commit "libraries: no longer a submodule…" in that workspace;
- open `/@banc/modules.st0` → a refusal that says where a module is edited;
- open `/@banc/live.st0` → the rig, with `@st0/…` resolved out of the account's libraries.
