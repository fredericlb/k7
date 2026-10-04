# libraries.ts — the origin's libraries, cloned and kept by each account's service

The origin has ONE list of libraries, each a git repository with a NAME: `st0`, `drums`. Only an
admin edits it; every account inherits it. Each account's service clones each one to `<studioHome>/libraries/<name>` and keeps it at its remote's latest commit, and
`@<name>/<type>/<module>` resolves against that clone from every workspace of the account. No
workspace holds a copy, and no workspace repository records one (a workspace still carrying a
`_libraries` folder is cleaned on open — below). The layout and why nothing declares it is in
`packages/song/docs/sharedFolders.md`; what follows is how the clones are kept.

## The setting: `$STUDIO_LIBRARIES_FILE`

The file hub names it, `<dataRoot>/libraries.json`, beside the account folders. Every account's
service reads that one file, and it is written through a sibling and a rename, so no reader sees
half of it. While it does not exist, the account's own `<studioHome>/libraries.json` is read
instead. That keeps a server that has not been through an admin's first save working, with the
list each account had. Without a hub, which only tests run, the account's file is the setting.

**One list, one clone per account.** A library's clone is a working copy: the module builder
writes into it and `commitLibrary` publishes from it with the ACCOUNT's deploy key. A shared
checkout would mix two accounts' unpublished edits and push them under one key. So the list is
shared and the clones are not. The cost is a clone per account (small YAML repositories), plus
the requirement that **every account's key can read every listed repository**. When an account's
key cannot, that clone fails *for that account*. `libraryFailure` keeps git's words until a sync
succeeds, and `GET` answers them as the row's `error`.

`{ "libraries": [{ "name": "st0", "uri": "git@host:me/st0.git" }, …] }`, in the order they were
added. `librarySettings` reads it; `setLibrarySettings` writes it, after `settingsProblem` has
refused anything it could not honour: a name no ref could spell (`LIBRARY_NAME` — lowercase,
digits, dashes — minus `engine`, `workspace` and `meta`, which a ref already means something by),
the same name twice, the same repository twice, a URI that is not SSH.

**The old file held one `{ "uri" }`, and it still reads — as a library called `st0`.** That is
what every `@st0/…` written before libraries had names meant, so no project needs a single line
changed. For the same reason the account's FIRST library is named `st0` when nobody names it
(`defaultLibraryName`), and any other after its repository: the scaffolds write `@st0/…` refs for
a set's decks, and a first library called anything else would leave them unresolved.

## Cloning: into a sibling, then renamed into place

`syncLibrary` clones a library this machine has none of into `<home>/libraries/.cloning-…` and
renames it into place once it is whole. A dot-name is never a library name, so `accountLibraries`
cannot see a clone while it fills, and a clone that dies leaves no half a library for a compile to
resolve against.

A brand-new repository — unborn HEAD, created a minute ago on a git host — gets one empty commit,
pushed (`initIfEmpty`), so it has a branch for the next machine to fetch. **It fills nothing.** The
library is the reference: a build shipping its own copy of somebody's modules would be a second
source of truth. A new library is therefore EMPTY, every `@<name>/…` ref resolves to nothing until
modules are put there, and an unresolved ref is not a compile error
(`packages/song/docs/sharedFolders.md`) — such a project reads as one whose modules are bypassed.

## Always the latest — and never at the cost of work

There is no pin: a library is at its remote's latest commit, and every workspace sees that one.
`syncLibrary` fetches and fast-forwards. What it never does is lose anything, and a checkout here
CAN hold work — the module builder writes into it before its Save publishes. So a clone with edits
not committed, or commits not pushed, is left exactly where it is and the answer says so
(`state: "kept"`), naming what is there. A remote whose history was rewritten cannot fast-forward
and is kept the same way.

`unpublished` is what decides, and it refuses to guess: a folder that is not the top of a git
checkout of its own is "cannot tell", which counts as "something to lose" everywhere it is asked.
`git -C` climbs to whatever repository CONTAINS a folder that is not one itself, so without that
check a plain folder inside a workspace would be judged by the workspace's status.

When the setting now names ANOTHER repository for a name, the clone is replaced — unless it holds
unpublished work, in which case it is kept and the note says what to do. The clone's own remote is
read as WRITTEN (`git config remote.origin.url`), not through `remote get-url`, which applies
`insteadOf` and would compare the wrong thing.

### When it runs

- **`POST /open`** calls `refreshLibraries`: every library brought to its latest, at most once a
  minute (`SYNC_EVERY_MS`) however many projects open. It is AWAITED only when a library is not
  cloned yet; an update of a clone already here runs behind the open, because an unreachable git
  host must not hold a song back for two minutes, and the module caches notice the files when they
  land (`moduleWatch.md`).
- **The bench** waits for it, so a chain just published is the one the rig gets.
- **`POST /account/libraries/update`** and the verb `project libraries update` force it now,
  whatever the last sync was. The verb reaches this service through
  `CommandHost.updateLibraries`: its subject is the account, and the dependency runs
  file-service → commands, never back ([commands/docs/git.md](../../commands/docs/git.md)).

One git operation per library at a time (`serial`): two opens racing must not run two fetches into
one checkout, and a Save must not commit while a fetch is fast-forwarding under it.

## The routes

`GET /account/libraries` answers the list, each with `cloned` and, after a failed sync, `error`.
It also starts a sync behind the answer, at most once a minute, so a library an admin just added
gets cloned for this account without waiting for a project to open. `PUT` sets the WHOLE list —
`{ uri }` alone ADDS one — and **answers 403 unless the hub stamped `x-studio-admin: 1`**. The
list is every account's, and the hub is the only party that knows the caller's groups
(`packages/file-hub/docs/fileHub.md`). Answered before `resolveWorkspace`: the gate asks with no
workspace chosen yet.

Other accounts follow an edit lazily: their next open (`refreshLibraries`) clones what is new and
prunes what was dropped, by the same rules as the admin's own `PUT`.

**A library is validated by CLONING it.** `isSshGitUri` says the paste LOOKS like an SSH URI; only a
clone says it is a repository this machine's deploy key can read, which is the question. So `PUT`
clones every library new to the list, or pointing somewhere new, BEFORE writing the list down, and a
failure answers with git's own words and stores nothing — a setting kept after a refused clone
reads as done and breaks at the next thing that needs it. The request is held for the clone, unlike
a workspace's (`cloneJobs.md`): it is a one-time gesture on a card that says *Cloning…*, and the
answer it needs is a sentence rather than a progress bar.

A library the list DROPPED has its clone removed (`pruneLibraries`) — unless it holds unpublished
work, which keeps it, with a note.

**Nothing is created or imported before the account has one.** `POST /workspaces`,
`POST /workspaces/clone` and the bench refuse with the same sentence: a workspace made without a
library is a folder whose chains and modules point at nothing, and the refusal has to come before
the folder exists rather than at the first open. `Examples` is not a user gesture and is not gated.

## Publishing — the builder's Save

`POST /libraries/publish` commits what changed and pushes it (`commitLibrary`), in the libraries it
names or in every one with something to publish. The builder names ONE — the library the module's
`_libraries/<name>/…` path is in. That is the whole act: no workspace repository is touched, since
none records a version.

- The author is the person editing, via `-c` rather than a written config: the checkout is the
  account's library, not this machine's, and a machine must not leave its own identity in it.
- Nothing to publish is not a failure. Two saves in a row with no edit between them land there.
- A commit left by an earlier Save whose push failed is pushed by the next one, even with nothing
  new staged.
- A push refused after a successful commit is REPORTED: the work is safe here, but "saved" and
  nothing else would be the lie, since everyone else still has the old module.

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
