# sharedFolders.ts — extended notes

A workspace holds folders every project in it draws from, and a project finds them **by
where they are**:

```
ws/_modules/              the workspace's own    → @workspace/<type>/<name>
ws/_libraries/modules/    the account's library  → @st0/<type>/<name>
ws/_libraries/chains/     …and its chains
ws/song/                  a project
```

`moduleLibraryDirs()` answers that: what sits beside the project, then the library.
Order is PRECEDENCE — nearest first.

## `_libraries` is a git submodule

The account registers ONE library repository with pl8, from st0's home page
(`apps/st0/frontend/docs/projects.md`), and the
file service mounts it into every workspace it makes — `git submodule add` where the workspace
is a repository, a plain clone where it is not. `packages/file-service/src/libraries.ts` is the
whole of it, and `POST /open` is where it runs, on every launch rather than only on clone: the
setting can be added after a workspace already exists, which is true of every workspace that
predates the feature.

### A new repository is SEEDED with the catalogue

ONE thing has to happen to a library repository somebody just created, and it is not about
modules at all.

**It needs a commit.** A gitlink has to point at one, and `git submodule add` on an unborn HEAD
fails. So the first machine to mount one commits and pushes, which is all `registerSubmodule`
needs. That is the whole of `initIfEmpty`.

**Nothing is put IN it.** The repository is the reference: what is in it is what its projects
inherit, and nothing anywhere else has an opinion about what a library ought to contain.

> It was seeded, twice over. A catalogue came from the hosted médiathèque over HTTP; when that
> volume stopped holding modules the copy was dropped and only the empty commit kept, so a new
> account got a library of nothing — silently. The answer then was to EMBED the catalogue in the
> build (`@studio/dsp/catalogue`) and write it into every fresh repository. That is gone too: a
> build shipping its own copy of somebody's modules is a second source of truth, and the modules
> in `packages/dsp/modules/` are a place to copy FROM now, not a seed
> ([packages/dsp/docs/catalogue.md](../../dsp/docs/catalogue.md)).

**What that costs, and it is deliberate:** a new library is empty, so every `@st0/…` ref resolves
to nothing until modules are put there — including the four a scaffolded set writes for its decks
(`@st0/audio/utility/crossfade`, `…/tempo`, `@st0/audio/filter/eq3`, `…/sweep`). An unresolved ref
is **not** a compile error (below), so such a project reads as one whose modules are bypassed. The
day that needs to be visible, the place to say it is the compile — not a seed putting files in
somebody's repository so the question never comes up.

Two details are load-bearing:

- **The gitlink is recorded only after the push succeeds.** A gitlink promises that a commit is
  fetchable; pointing one at a commit that never left the machine breaks the workspace for
  everybody who clones it. Two machines racing to adopt the same new repository is the ordinary
  way this happens — the loser is told, keeps its checkout, and records nothing.
- **The FILE SERVICE does it, not pl8.** pl8 holds the repository's ADDRESS but is deliberately
  not a git writer (`apps/pl8/docs/projects.md`: the service that mints everyone's session and
  holds the one deploy key must not also be able to push to every repository). This machine
  already writes to git, already has a working copy, and already has a copy of the key.

### The library is written to. A project repository is not

The mount commits and pushes to the LIBRARY repository, and to nothing else. The only mark it
leaves on a project repository is `submodule add`'s: a `.gitmodules` entry and a gitlink,
**staged and not committed** — publishing them is `project commit`, which is somebody's
decision. A song repository is somebody's work and nothing here has business committing to it.

One leak had to be closed for that to hold. Until `submodule add` has run — the first commit
could not be pushed, or the mount only just happened — `_libraries` is an *untracked folder
inside a song repository*, and `project commit` does `git add -A` over the whole tree. Git would
then either commit the whole library into the song, or record an "embedded repository" gitlink
with no `.gitmodules` beside it, which is a submodule nobody who clones can resolve.

So the file service writes `/_libraries/` into the project repository's **`.git/info/exclude`**
before it puts anything there. Per-checkout, never committed, never travelling — so it touches
no tracked file of a repository that is not ours — and inert once the submodule is registered,
since an ignore rule has no say over a path git already tracks.

**This replaced `~/.studio/mediatek/modules`.** That folder was one per MACHINE, synced from
the hosted médiathèque by `mediatekPull`, and it is no longer a module root at all. Three things
follow, and each is worth stating because each was a rule before:

- **Two writers on one tree is the problem it solves.** `syncFamily` deletes whatever the
  owner's manifest does not list, which is why writing into the cache by hand was already a
  documented mistake. Over a git checkout it would delete files somebody committed. So
  `mediatekPull` stopped fetching `modules` and `chains` entirely — it carries `songs` and
  nothing else now.
- **What a project inherits travels with the repository it is cloned from.** A workspace on a
  second machine gets the same modules at the same commit, because the gitlink pins one. The
  cache could only ever be "whatever this machine last synced".
- **A shared module is editable in place.** There is no fork and no push-through: `_libraries/…`
  is an ordinary workspace path, written by the ordinary write route. st0 opens it read-only
  behind a confirmation, and its builder has a **Save button** that commits and pushes the
  library repository once the files land (`apps/st0/frontend/docs/sharedModules.md`) — a decision
  somebody takes rather than a mechanism that absorbs it. The song's repository then gets ONE
  more commit, moving the gitlink so it records which version it uses: path-limited to
  `.gitmodules` and `_libraries` so nothing else in flight goes with it, and never pushed.

`_modules` is untouched by all of that. It is the WORKSPACE's own library, one copy backing
every project beside it, and it still forks on write (`docs/moduleFork.md`) — nothing has given
it a way back.

The médiathèque itself has not gone anywhere: it still holds songs and samples, still serves
them over HTTP, and `~/.studio/mediatek` is still the cache a machine plays them from. What it
stopped being is the place modules live.

There was a second row, `ws/_library/`, holding the assets a module could name. It is gone —
a module carries the files it loads, in its own `assets/`, so the module travels whole. See
`docs/moduleAssets.md`.

## Why nothing declares them any more

`project.yaml` used to carry `modules_from` and `libraries_from`, and `scaffold` wrote them.
The lists could only ever name those same two places, so they decided nothing — while giving
every project a way to be **wrong** about facts the loader already knew. Three ways, all seen
in one afternoon:

- a project older than the line that added `@st0` saw no médiathèque at all, and every
  `@st0/…` ref in it read as "extends unknown module" — about modules sitting right
  there on disk;
- a `_modules` folder deleted from the workspace left its declaration behind, and
  `loadModuleRefs` **threw** on a root it could not resolve: one stale line, and the whole
  song went dark;
- the same roots written twice — once in the header, once derived — drifted apart between the
  compiler and the builder's catalogue, which is how a module could play and not be listed.

Location cannot drift. A folder that is not there is simply not a root, which is why none of
these functions can fail any more: there is no header to read first, and nothing to throw.

**The fields are still ACCEPTED by the schema.** Every song already written carries them, and
refusing the key would turn a working project into one that will not open. `deadProjectFields`
reports them as a warning naming the lines to delete — because "accepted and silently ignored"
is the failure mode this codebase keeps paying for.

## Where a panel lives — and why there is no list for it

A module's UI panel is the `ui.yaml` in the module's own folder (see uiLibrary.ts). It used
to be a parallel tree, found at one hard-coded place, `../_ui` — fine while there was
exactly one library, wrong the moment a project can also draw modules from a médiathèque
outside the workspace, and wrong again once you notice the panel and the module could
disagree about which module the panel drew.

`modulePanelRoots()` is what is left of that machinery: the project's own `modules/` first,
then the shared roots. There is nothing panel-specific about it any more — it is the list of
module libraries, and the panels are in them.

Deriving beats declaring here, and putting the file in the folder beats deriving. A panel is
not an independent asset like an impulse response; it is the face of a module, so it travels
with the module itself — and a library brings its faces along with nothing to write down.

**Order is precedence.** `loadUiLibrary` reads every library, nearest first, so a project
that forked a shared module draws its own face rather than the one it was copied from. What
is gone is the write-one half of the old rule: `writeUiFile` writes the panel where its
module is, shared library included. See `docs/uiLibrary.md` for why that exception exists
and what it costs.

`moduleNamespaceOf()` lives here too, because it is the one fact that separates the two kinds
of root: the médiathèque's modules key as `@st0/…`, anything else as `@workspace/…`, and
a project's own `modules/` keys bare. Everything that turns a folder into a ref, or a ref back
into a folder, turns on that — and it asks the PATH, never a declaration. See
docs/moduleNamespaces.md.
