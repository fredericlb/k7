# libraries.ts — the origin's libraries, as one account's service sees them

The origin has ONE list of libraries, each a git repository with a NAME: `st0`, `drums`. The file
hub holds it, clones each library ONCE with the server's own key and fetches it, moving it only
when an admin pulls or a bench pushes — the list, the key and the clones are the hub's, and their choices are in
`packages/file-hub/docs/fileHub.md`. This service READS those clones (`$STUDIO_LIBRARIES_HOME`),
and `@<name>/<type>/<module>` resolves against them from every workspace of the account. No
workspace holds a copy, and no workspace repository records one (a workspace still carrying a
`_libraries` folder is cleaned on open — below). The layout and why nothing declares it is in
`packages/song/docs/sharedFolders.md`.

What this service keeps is what cannot be shared: the clone an admin's bench EDITS, the guard that
refuses every other write into a library, and the call that asks the hub to sync.

## Asking the hub: `askHubSync`

The clones are the hub's, so this service never runs git in them. It calls
`POST $STUDIO_HUB_URL/libraries/sync` with its own hub secret — the same one the hub stamps on what
it forwards, which is how the hub knows the caller is one of its instances:

- **`POST /open`** (`refreshLibraries`): the hub fetches at most once a minute however many projects
  open, and the call is WAITED FOR only when a clone is missing. A fetch of a clone already there
  runs behind the open, because an unreachable git host must not hold a song back for two minutes.
  An open never PULLS: what a song resolves `@<name>/…` against changes when an admin says so.
- **The verb `project libraries update`** forces the fetch and says what is to pull. The verb
  reaches this service through `CommandHost.updateLibraries`: its subject is the account, and the
  dependency runs file-service → commands, never back ([commands/docs/git.md](../../commands/docs/git.md)).
- **A bench push** PULLS that one library (`pull: true`), so every account reads what was just
  pushed. It drops no bench: the pushing bench's clone is the remote, and the others are an admin's
  Pull away from going — that one destroys every bench of the library, through
  `POST /account/bench-library/drop`, which only the hub calls.

With no `$STUDIO_HUB_URL` — which only tests run — the libraries are whatever the folder holds.

`/account/libraries*` never reaches this service: the hub answers it.

**Nothing is created or imported before the origin has a library.** `POST /workspaces`,
`POST /workspaces/clone` and the bench refuse with the same sentence: a workspace made without a
library is a folder whose chains and modules point at nothing, and the refusal has to come before
the folder exists rather than at the first open. `Examples` is not a user gesture and is not gated.

## Nobody writes a library outside its bench

The hub's clones are made EXACTLY their remote at every sync, so anything written into one is lost
at the next — and a write from one account would be read by all of them before it was ever pushed.
So every write that lands in a library is refused (`Workspace.assertLibraryWritable` in
`../src/workspace.ts`; `writeNodePreset` in `packages/song-edit/src/presets.ts` for
`node preset save … <library>`; the `/command` route for a verb whose `at` is in a library) —
unless it targets the ONE library overlaid by this account's bench clone. That covers every
gesture of the file tree, the builder's Save and a chain edited from the Libraries tab alike: a
library is edited on its bench, or not at all.

## The bench's clone: `libraryBench.ts`

`/@banc/@<library>/live.st0` opens an admin's bench ON a library. It reads and writes
`<studioHome>/bench-libraries/<name>`, a clone of the library's remote made with the ADMIN's own
deploy key, because the push is theirs: the server's key is read-only, and an edit pushed under a
key nobody owns would be nobody's. Opening it overlays that library (`setLibraryOverlay`), so the
compile, the file tree and the engine's paths read the bench's clone instead of the hub's.

- **It is kept until a push leaves it clean.** Unpushed work is the one thing on a server that
  nobody else has a copy of, so reopening the bench resumes it; a clean clone is brought forward to
  what was pushed since. Opening another library's bench deletes the CLEAN clones of the others and
  leaves the rest.
- **The open one is remembered** in `bench-libraries/.active`: the overlay lives in this process,
  and a service restarted by the idle stop must read the same library from the same place.
- **The overlay is per account process**, not per project: an admin's account reads its bench
  clone in ordinary projects too, which is what lets a song using the module hear the edit before
  it is pushed. **Only while there IS such an edit**: opening any project outside the bench lifts
  an overlay whose clone has nothing uncommitted or unpushed (`releaseCleanLibraryBench`). A clean
  clone is the remote at best and behind it at worst — a library pushed from elsewhere would
  otherwise stay invisible to that admin's every project until the bench was reopened.
- A brand-new repository — unborn HEAD — gets one empty commit, pushed (`initIfEmpty`), so it has a
  branch for the hub to fetch. **It fills nothing.** The library is the reference: a build shipping
  its own copy of somebody's modules would be a second source of truth. A new library is therefore
  EMPTY, and an unresolved `@<name>/…` ref is not a compile error
  (`packages/song/docs/sharedFolders.md`).

A chain's bench (`/@banc/<chain>/live.st0`) edits no library: it closes any overlay.

### Publishing: commit & push, or discard

A Save writes; nothing it does publishes. Publishing is one explicit gesture on the bench, because
a library is every account's and a push is not undone by the next keystroke:

- `GET /account/bench-library` answers `{library, changed, ahead}`, or null with no bench open —
  what the editor's bottom row shows.
- `POST /account/bench-library/commit` (admins) commits everything changed with the message the
  admin typed, pushes it with their key, then asks the hub to sync THAT library. The author is the
  admin, via `-c` rather than a written config: a machine must not leave its own identity in a
  checkout. A commit whose push failed is pushed by the next one, even with nothing new staged,
  and a refused push is REPORTED rather than called saved: everyone else still has the old module.
- `POST /account/bench-library/discard` (admins) resets the clone to what is pushed.

`unpublishedCounts` decides what "clean" means, and it refuses to guess: a folder that is not the
top of a git checkout of its own throws rather than answering. `git -C` climbs to whatever
repository CONTAINS a folder that is not one itself, so without that check a plain folder would be
judged by its parent's status.

## A workspace carrying `_libraries`: `retireWorkspaceLibraries`

A workspace may hold libraries mounted INTO it at `_libraries` — a git submodule where the workspace
is a repository, a plain clone where it is not — with the version pinned by the gitlink. Nothing
reads that folder, so `POST /open`, a workspace clone and the bench take it out:

- **A submodule** is removed with `git rm` (checkout and `.gitmodules` section together), its
  `.git/modules/_libraries` deleted, and ONE commit made, path-limited to `_libraries` and
  `.gitmodules` so nothing else in flight goes with it. Not pushed: pushing a song is `project
  commit`, a decision about somebody's work. A `.gitmodules` naming other submodules keeps them.
- **A plain clone** is deleted.
- **Anything holding unpublished work** — or that git cannot account for — is left exactly where it
  is, and the log says what is there. It resolves nothing either way; the person publishes from it
  by hand and the next open removes it.

## The environment every git call here carries

`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` are load-bearing rather than hygiene: a
personal `insteadOf` rewrite turns the SSH URI back to https, privilege and all. `GIT_SSH_COMMAND`
pins the account's deploy key. Calls are bounded (120 s), because a hung fetch must not hold a
workspace open. The tests lean on the one door that leaves: command-level config
(`GIT_CONFIG_COUNT`), through which they point an SSH URI at a bare repository on disk.
