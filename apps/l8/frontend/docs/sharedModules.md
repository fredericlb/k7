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

| tab | what it lists | paths are | who serves it |
|---|---|---|---|
| **Project** | the open project's workspace | workspace-relative | `@studio/file-service`, on the engine's machine |
| **Libraries** | the shared module libraries, one row per namespace | library-relative | **st0**, same-origin, on the session cookie |

The Libraries root rows are **namespaces** — the `@` prefix a chain writes in a ref. Today there
is one, `@mediatek`, and under it the catalogue exactly as a ref spells it:

```
@mediatek
  audio
    delay
      tape-delay        →  @mediatek/audio/delay/tape-delay
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
a shared module    modules/audio/delay/tape-delay/module.yaml  →  @mediatek/audio/delay/tape-delay
```

`libraryModuleRef` is that spelling (`src/libraryTree.ts`), and getting it wrong is what would
quietly turn this tab into a text editor: no ref, no plugin, no real parameters. A module the
open song does *not* name gets no plugin, which is an ordinary state and not an error — the
same one the builder has always had for a module a project does not instantiate.

What is lost with the bench is the ability to audition a module **no** project uses. Wire it
into the song you have open, which is the same act the bench asked for and one step shorter.

## Two path spaces that spell a module identically

```
workspace   modules/audio/reverb/module.yaml
library     modules/audio/reverb/module.yaml
```

Those are two different files, and no rule can tell them apart from the string. So the builder
gets a **different store** rather than a path-aware one, and which store is decided by *where
the click came from* — the Project tab or the Libraries tab — and never re-derived afterwards.
`src/library.ts` holds l8's, over st0's `/api/mediatek/file`; `moduleStore` in `src/api.ts` is
the workspace one, unchanged.

The library store itself is shared with st0's own module screen
(`@studio/ui-module-builder/library-store`): both read the same volume through the same routes,
and what differs is the origin, the credentials and what happens after a write. Two copies of
"where does a panel go" is the drift that rule exists to stop.

## What a save actually does

Two writes, in this order:

1. **st0's `PUT /api/mediatek/file`** — the hosted library, which is what everyone else reads.
   Same-origin, on the session cookie: st0 answers the origin root, so this needs no engine and
   no cross-origin grant.
2. **the file service's `POST /mediatek/sync {family: "modules"}`** — this machine's cache under
   `~/.studio/mediatek`, which is what the engine beside you loads a plugin from.

The second is best-effort and cannot fail the save: the bytes are in the library, so an engine
that is unreachable costs the audition and not the work. Without it the module you just edited
would keep sounding like the one you opened until something else happened to sync.

## What stayed on the bench

`@banc` is still there, and still opens **one médiathèque chain** —
`/l8/@banc/chains/<path>.l8`, from the chain's screen in st0. A chain is a routing you hear, and
editing one against nothing is half the job; it has no second home the way a module now does.
Its machinery is unchanged, including the `@in`/`@out` edge translation
(`packages/song/src/benchChain.ts`) and the module mirror that makes the chain resolve. What is
gone is `@banc/modules.l8`: that address now answers 404 with a sentence pointing here.

## What to check in a browser

The suites here mount nothing, so none of this is covered by a green run:

- open a project, switch the tree to **Libraries** → `@mediatek`, and the catalogue under it;
- click a module → the builder opens read-only, with `read-only` in the header and an Edit
  button beside it; typing in the code pane does nothing;
- click **Edit**, confirm → the same screen takes edits, and the badge behaves as it does for a
  project file;
- edit a module the open song NAMES → its parameter list is the plugin's, and turning a knob
  changes the sound;
- save, then open the module in st0's Modules section from another browser → the change is
  there;
- reload the song → the engine plays the new version (the cache was synced);
- open `/l8/@banc/modules.l8` → a refusal that says where a module is edited now.
