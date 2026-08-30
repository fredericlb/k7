# Editing a shared module — the Libraries tab

A module is a plugin. What it does is not in its file: it is heard. And the names of its
parameters, their bounds and its factory banks exist only in a **loaded** plugin — which means
in a project.

So a shared module is edited from inside a project, against the engine already playing the song:
**the file tree has a second tab.**

## The two tabs

| tab | what it lists |
|---|---|
| **Project** | the workspace, minus every module folder the other tab owns |
| **Libraries** | one row per LEVEL — `@project`, `@workspace`, `@st0`, `@engine` — and the modules under it |

**They are two different answers, and the difference is worth writing down.** Looking for
`_libraries` and `_modules` *inside the file tree* finds nothing, because `/tree` is deliberately
rooted at the ACTIVE PROJECT and excludes exactly those folders: *"the rest of the clone is the
REPOSITORY, not the song"* (`packages/file-service/docs/activeProject.md`, and a test that says
so). The two shared levels sit BESIDE the project, so no amount of searching the song's own tree
can find them.

So they have a route of their own, `GET /module-libraries`, whose roots come from
`@studio/song` — the project's own `modules/`, then `moduleLibraryDirs`. It therefore lists what
the LOADER resolves against and cannot drift from it, which searching a tree cannot guarantee.

```
@project      01.danse.st0/modules/       the song's own
@workspace    _modules/                  shared by every project beside it
@st0          _libraries/modules/        the account's library repository (a submodule)
@engine       — no folder —              this machine's plugin scan, READ-ONLY
```

**Nearest first, which is precedence.** Reading the tab top to bottom is reading the order the
loader resolves in — which module wins when two levels hold the same name. The service answers
in that order and the tab does not re-sort it: two places deciding precedence is how they come
to disagree.

**A level with no folder yet is still drawn, empty.** It is a place you can put a module — the
row's menu offers exactly that, and creating through it is what brings the folder into being —
so hiding it would leave nowhere to start on a project whose `modules/` does not exist yet,
which is every new project. `exists: false` and "empty" are kept apart in the answer for the
same reason: only one of them is fixed by adding a module.

`@st0` is the one level that disappears when absent. It is a git submodule somebody has to
mount, not a folder to fill in, so an empty row would be an offer nothing here can honour.

## `@engine`, which is not a folder

The fourth level is here too, last, and it is **read-only** — the one level that is not files at
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
everywhere: `audio/reverb` on `@project`, `reverb` inside `audio`. The hint spells the resulting
file out, so what is about to be written is never a guess, and the service refuses anything with
no type folder — `audio/reverb` is the shortest thing the loader will key.

`@engine` gets neither: `rootOf` refuses a read-only level, so the menu does not open there at
all rather than opening with everything greyed out. A scanned plugin has no folder, so there is
nothing to make one in (`packages/song/docs/moduleNamespaces.md`).

Note the two shapes: a workspace library holds its type folders **directly**, where the
account's repository holds two FAMILIES and `modules` is one of them. That difference is why the
rows are found from a list rather than a pattern.

**The Project tab drops the project's own `modules/`**, which is `@project` on this one. Shown
twice it would be two ways into one module, one that opens the builder and one that browses its
files; and which folder a module lives in is the loader's business rather than somewhere to drop
files by hand. The two SHARED levels need no dropping — the file tree is the song's own files and
they are not in it.

The Libraries root rows are **namespaces** — the `@` prefix a chain writes in a ref — and under
each, the catalogue exactly as a ref spells it:

```
@st0
  audio
    delay
      tape-delay        →  @st0/audio/delay/tape-delay
```

A module is one row, as it is on the Project tab and by the same code (`foldModules`): the
folder holds `module.yaml`, so the tree folds it and clicking it opens the builder rather than
a file.

The listing is fetched the first time somebody looks at the tab, not on mount — it is a walk of
its own over four levels, and most sessions never open it. It is not re-polled: nothing st0 does
from here adds or removes a module.

## Read-only, then a decision

A shared module opens in the builder **locked**. Everything works — the four files are shown,
the params list is populated, the live plugin's knobs move — and nothing is written: the code
panes refuse keystrokes, the widget grid takes no drags, no autosave is armed, and the shelf
presets (which are edits) are not offered. The header says `read-only` where the save badge
normally is.

Beside it, an **Edit** button, and behind that a dialog that says what saving here means: the
library's copy is the only copy, nothing forks, and every song that names this module will
sound different next time it is opened. Confirm and the same screen becomes writable — with
st0's ordinary rule, which is that there is no Save button and each file is written as soon as it
reads as a document.

Two things make that gate worth the click rather than ceremony:

* **There is no fork here.** A save aimed at a workspace's `_modules` is redirected onto a
  project-local copy and the chains are repointed (`packages/song/docs/moduleFork.md`). That is
  the safety net everywhere else, and the library has none — its whole point is being the
  one editable catalogue.
* **There is no Save button to hesitate over.** Autosave writes as soon as the buffer parses, so
  "start editing and decide later" is not a state this screen has. The decision has to happen
  before the first keystroke, which is exactly where the dialog is.

## The loaded plugin comes free

Editing a module needs two things at once: an editable catalogue, and a loaded plugin. This tab
has both without inventing anything. You are already in a project, with a real engine and a real
song playing; the shared module you want to change is very likely one that song already names.
So the builder's live-plugin lookup is the ordinary one — read the compiled graph, find a chain
step whose `module` matches — with one spelling difference:

```
a project module   modules/audio/reverb/module.yaml            →  reverb
a shared module    modules/audio/delay/tape-delay/module.yaml  →  @st0/audio/delay/tape-delay
```

`libraryModuleRef` is that spelling (`src/libraryTree.ts`), and getting it wrong is what would
quietly turn this tab into a text editor: no ref, no plugin, no real parameters. A module the
open song does *not* name gets no plugin, which is an ordinary state and not an error — the
same one the builder has for any module a project does not instantiate.

To hear a module no project uses, wire it into the song you have open.

## One path space, one store

```
the project's own    modules/audio/reverb/module.yaml
the library's        _libraries/modules/audio/reverb/module.yaml
```

Both are workspace paths, both served by the file service, both written by the same route. The
builder gets `moduleStore` either way, and what tells them apart is a folder name rather than
which tab you clicked — `isLibraryPath` reads it off the path, so `ui builder <path>` locks
exactly as a click in the Libraries tab does.

That is what the submodule buys: one path space where a library served from somewhere else would
need two that spell a module *identically*, a second store, and a rule that the choice between
them must never be re-derived from a path.

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

1. `PUT /file` on the file service for each dirty file, into the submodule's working copy. The
   same route a project file takes.
2. `POST /libraries/publish` — in the LIBRARY: `git add -A`, a commit authored by you, a push.
3. …and then, in the SONG: one commit moving the gitlink, so the project records which version
   of the library it now uses.

**Two repositories, two different rules**, and the difference is the whole design:

| | the library | the song |
|---|---|---|
| what is committed | everything that changed | the gitlink, and `.gitmodules` if it is new |
| how | `git add -A` | **path-limited** — `git commit -- .gitmodules _libraries` |
| pushed | yes | **no** |

The song's commit is path-limited and that is load-bearing, not tidiness: a commit *about a
module* must not carry half a song with it. Whatever you had dirty or staged when you pressed
Save is exactly as dirty or staged afterwards.

And it is **not pushed**. Pushing a song is `project commit` — a decision about your work, not a
side effect of saving a module. So the version is recorded locally the moment you save it, and
travels when you decide the song does.

**Nothing is recorded unless the library push succeeded.** A gitlink promises the commit is
fetchable; pointing one at a commit that never left this machine breaks the song for everybody
who clones it — including you on the next machine. So a refused push reports "committed, not
pushed", keeps the work locally, and leaves the song saying what it said before. The next Save
pushes both commits.

Nothing to commit is not a failure either — two saves with no edit between them land there.

## What the bench is for

`@banc` opens **one library chain** — `/@banc/chains/<path>.st0`, from the chain's screen in
pl8. A chain is a routing you hear, and editing one against nothing is half the job; it has no
second home the way a module has this tab. The `@in`/`@out` edge translation is
`packages/song/src/benchChain.ts`, and `apps/pl8/docs/banc.md` is its page.

There is no bench for a MODULE: `@banc/modules.st0` answers 404 with a sentence pointing here.
The bench's workspace mounts the library like any other, so `@st0/…` resolves there the way it
does in a song.

## What to check in a browser

The suites here mount nothing, so none of this is covered by a green run:

- with **no libraries repository** on the account, open any project → st0 refuses with "no
  libraries repository" and a button back to pl8, before it clones anything;
- add an **empty** repository from st0's home page (the card is above everything else), then
  open a project → `_libraries/` is there beside it, filled with the catalogue pl8 already held,
  committed and pushed, with `.gitmodules` staged in the workspace. Look at the repository on
  your git host: `modules/` and `chains/` are in it;
- open a project in a SECOND workspace → the library clones with its content and is not seeded
  again;
- switch the tree to **Libraries** → four rows, `@project` / `@workspace` / `@st0` / `@engine`,
  in that order, each holding its own modules. The Project tab does not show the song's
  `modules/`;
- open a project whose `modules/` does not exist → `@project` is still there, empty. Right-click
  it → **New module…** → type `audio/test` → the folder is made, the builder opens on it;
- open a workspace with no `_modules` → `@workspace` is there and empty, and creating through it
  makes the folder;
- unmount the library submodule → `@st0` disappears rather than offering an empty row;
- `@engine` is last, greyed, and grouped by type; clicking a row opens nothing and right-clicking
  offers no menu. On this machine it holds 254 scanned plugins;
- right-click a type folder inside `@project` → **New folder…** and **New module…**, the second
  taking just a name there and `<type>/<name>` on the level's own row;
- click a module → the builder opens read-only, with `read-only` in the header and an Edit
  button beside it; typing in the code pane does nothing;
- click **Edit**, confirm → the same screen takes edits, and typing writes NOTHING: the Save
  button lights up instead;
- edit two of the four files, press **Save** once → both land, and one commit appears in the
  library repository, pushed. Not two commits, and not one per file;
- look at the SONG's repository → one commit on top, touching `_libraries` and nothing else.
  Leave something half-edited before you save and check it is still half-edited after;
- `git log` in the song → the message names the library's short sha, so which version this song
  uses is readable without opening the submodule;
- type something that will not parse and press Save → it is held back with the reason, and
  nothing is committed;
- edit a module the open song NAMES → its parameter list is the plugin's, and turning a knob
  changes the sound;
- `project commit` → a commit in the submodule and a gitlink bump in the workspace; another
  machine that clones the workspace gets the same modules at the same commit;
- open a second project in the same workspace → the same `_libraries`, not a second copy;
- change the libraries repository in pl8, then reopen a workspace that already has the old one →
  it is left alone, and the refusal names both URIs rather than rewriting the submodule;
- open `/@banc/modules.st0` → a refusal that says where a module is edited.
