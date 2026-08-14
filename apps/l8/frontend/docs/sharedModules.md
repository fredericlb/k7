# Editing a shared module — the Libraries tab

A module is a plugin. What it does is not in its file: it is heard. And the names of its
parameters, their bounds and its factory banks exist only in a **loaded** plugin — which means
in a project.

That sentence used to have a whole project built around it. The **bench** (`@banc/modules.l8`)
was a generated `.l8` whose `modules/` folder was the médiathèque's catalogue, mirrored on every
open, and it was the one project allowed to write back to the catalogue. You opened it *in order
to* edit a module, wired the module into its chain to hear it, and edited it there.

It is gone, and what replaced it is smaller: **the file tree has a second tab.**

## The two tabs

| tab | what it lists | where it comes from |
|---|---|---|
| **Project** | the open project's workspace, minus `_libraries` | the workspace tree |
| **Libraries** | the account's library submodule, one row per namespace | the same tree, under `_libraries/modules` |

Both are the same tree and the same path space. The libraries are a **git submodule** mounted
at `<workspace>/_libraries` (`packages/song/docs/sharedFolders.md`), so they arrive with every
other folder the file service serves — there is nothing to fetch, nothing to poll, no second
client and no failure of its own. The Project tab drops the `_libraries` row because it has a
tab; without that you would see the whole catalogue twice, once as folders to browse and once
as rows that open the builder.

This was not always so. The first version of this tab read st0's hosted `/api/mediatek/list`
and wrote back to its volume, because the modules lived there and the machine only had a cache
of them. Two path spaces that spelled a module identically, two stores, and a sync after every
save. Putting the library in the workspace deleted all of it.

The Libraries root rows are **namespaces** — the `@` prefix a chain writes in a ref. Today there
is one, `@st0`, and under it the catalogue exactly as a ref spells it:

```
@st0
  audio
    delay
      tape-delay        →  @st0/audio/delay/tape-delay
```

A module is one row, as it is on the Project tab and by the same code (`foldModules`): the
folder holds `module.yaml`, so the tree folds it and clicking it opens the builder rather than
a file.

The listing is fetched the first time somebody looks at the tab, not on mount — the catalogue is
another service, and most sessions never open it. It is not re-polled: nothing l8 does from here
adds or removes a module.

## Read-only, then a decision

A shared module opens in the builder **locked**. Everything works — the four files are shown,
the params list is populated, the live plugin's knobs move — and nothing is written: the code
panes refuse keystrokes, the widget grid takes no drags, no autosave is armed, and the shelf
presets (which are edits) are not offered. The header says `read-only` where the save badge
normally is.

Beside it, an **Edit** button, and behind that a dialog that says what saving here means: the
médiathèque's copy is the only copy, nothing forks, and every song that names this module will
sound different next time it is opened. Confirm and the same screen becomes writable — with
l8's ordinary rule, which is that there is no Save button and each file is written as soon as it
reads as a document.

Two things make that gate worth the click rather than ceremony:

* **There is no fork here.** A save aimed at a workspace's `_modules` is redirected onto a
  project-local copy and the chains are repointed (`packages/song/docs/moduleFork.md`). That is
  the safety net everywhere else, and the médiathèque has none — its whole point is being the
  one editable catalogue.
* **There is no Save button to hesitate over.** Autosave writes as soon as the buffer parses, so
  "start editing and decide later" is not a state this screen has. The decision has to happen
  before the first keystroke, which is exactly where the dialog is.

## Why this is better than the bench

The bench existed to hold two things at once: an editable catalogue, and a loaded plugin. The
second is what a project is for, so the bench had to *be* a project — an empty one, regenerated
from the catalogue each time, that you had to leave your song to visit.

The Libraries tab has both without inventing anything. You are already in a project, with a
real engine and a real song playing; the shared module you want to change is very likely one
that song already names. So the builder's live-plugin lookup works the same way it always has —
read the compiled graph, find a chain step whose `module` matches — with one spelling
difference:

```
a project module   modules/audio/reverb/module.yaml            →  reverb
a shared module    modules/audio/delay/tape-delay/module.yaml  →  @st0/audio/delay/tape-delay
```

`libraryModuleRef` is that spelling (`src/libraryTree.ts`), and getting it wrong is what would
quietly turn this tab into a text editor: no ref, no plugin, no real parameters. A module the
open song does *not* name gets no plugin, which is an ordinary state and not an error — the
same one the builder has always had for a module a project does not instantiate.

What is lost with the bench is the ability to audition a module **no** project uses. Wire it
into the song you have open, which is the same act the bench asked for and one step shorter.

## One path space, one store

```
the project's own    modules/audio/reverb/module.yaml
the library's        _libraries/modules/audio/reverb/module.yaml
```

Both are workspace paths, both served by the file service, both written by the same route. The
builder gets `moduleStore` either way, and what tells them apart is a folder name rather than
which tab you clicked — `isLibraryPath` reads it off the path, so `ui builder <path>` locks
exactly as a click in the Libraries tab does.

That is a simplification bought by the submodule, and it is worth naming what it replaced: two
path spaces that spelled a module *identically* (`modules/audio/reverb/module.yaml` meant two
different files), a second store, and a rule that the choice between them must never be
re-derived from a path. All of it existed because the library was somebody else's service.

## What a save actually does

One write: `PUT /file` on the file service, into the submodule's working copy. The same route,
the same autosave and the same badge a project file gets.

**Committing is separate, and deliberately.** `project commit` is what publishes it — a commit
inside the submodule, then the gitlink in the workspace repo, the same two-step `commons/` takes
in this repo. Autosave fires on every pause in typing; a save that also pushed would put a
commit on a shared repository every time a knob moved.

So an edit is versioned but not published until you say so, and until then it is yours and
your machine's. That is the opposite of what the hosted volume did, where a save was immediately
everyone's and there was no draft state at all.

## What stayed on the bench

`@banc` is still there, and still opens **one library chain** — `/l8/@banc/chains/<path>.l8`,
from the chain's screen in st0. A chain is a routing you hear, and editing one against nothing
is half the job; it has no second home the way a module now does. The `@in`/`@out` edge
translation is unchanged (`packages/song/src/benchChain.ts`).

What went with the submodule is its **module mirror**: the bench used to copy the whole
catalogue into `<project>/modules` on every open, because the catalogue was a machine-wide cache
no project could see. The bench's workspace mounts the library like any other, so `@st0/…`
resolves there the way it does in a song, and two hundred folders per open went with the mirror.
`@banc/modules.l8` answers 404 with a sentence pointing here.

## What to check in a browser

The suites here mount nothing, so none of this is covered by a green run:

- with **no libraries repository** on the account, open any project → l8 refuses with "no
  libraries repository" and a button back to st0, before it clones anything;
- add one in st0's Projets section (the card is above everything else), then open a project →
  it clones, and `_libraries/` is there beside it with `.gitmodules` staged in the workspace;
- switch the tree to **Libraries** → `@st0`, and the catalogue under it; the Project tab does
  NOT show `_libraries`;
- click a module → the builder opens read-only, with `read-only` in the header and an Edit
  button beside it; typing in the code pane does nothing;
- click **Edit**, confirm → the same screen takes edits, and the badge behaves as it does for a
  project file;
- edit a module the open song NAMES → its parameter list is the plugin's, and turning a knob
  changes the sound;
- `project commit` → a commit in the submodule and a gitlink bump in the workspace; another
  machine that clones the workspace gets the same modules at the same commit;
- open a second project in the same workspace → the same `_libraries`, not a second copy;
- change the libraries repository in st0, then reopen a workspace that already has the old one →
  it is left alone, and the refusal names both URIs rather than rewriting the submodule;
- open `/l8/@banc/modules.l8` → a refusal that says where a module is edited now.
