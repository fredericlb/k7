# libraries.ts — mounting the account's library repository at `_libraries`

A git SUBMODULE where the workspace is a git repository, a plain clone where it is not. This is
what `@st0/…` resolves against, and it is the ONLY source: nothing syncs modules from the
médiathèque, and nothing seeds a catalogue into it either. The shape on disk is in
`packages/song/docs/sharedFolders.md`; what follows is why the mount is done the way it is.

## Keeping `_libraries` out of the PROJECT repository's `git add -A`

The leak `excludeFromProjectRepo` closes: when the mount is a checkout the superproject has NOT
registered — the seed could not be pushed, or `submodule add` has yet to run — `_libraries` is an
untracked folder inside somebody's song repository, and `project commit` does `git add -A` over
the whole tree. Git would then either commit the entire catalogue INTO the song, or record an
"embedded repository" gitlink with no `.gitmodules` beside it, which is a submodule nobody who
clones can resolve. Both put the library inside a project repository, which is the one place it
must never be.

`.git/info/exclude` and not `.gitignore`, and that is the point: it is per-checkout, never
committed, and never travels — so this touches no tracked file of a repository that is not ours.
Harmless once the submodule IS registered, since an ignore rule has no say over a path git
already tracks. Best effort: an exclude that could not be written costs the guard, not the mount.

The git dir is asked for rather than assumed to be `<root>/.git`: that is a FILE in a worktree or
a submodule, and writing `info/exclude` under it would make a file inside a file.

## `registerSubmodule` stages, and needs `--force`

It stages `.gitmodules` and the gitlink and does not commit — deliberately: committing is
`project commit`, somebody's decision, not something opening a song does to their repository.

**`--force` is not optional.** `excludeFromProjectRepo` has just written `/_libraries/` into this
repository's `.git/info/exclude`, and `git submodule add` refuses an ignored path: *"The
following paths are ignored by one of your .gitignore files … use -f"*. Without it every first
mount leaves the library seeded, pushed and **unregistered** — the exact half-state the exclusion
exists to make survivable, reached by the code meant to end it. A test can hide that: a fixture
built with `-f` already never meets the refusal, which is how a workaround in a fixture hides the
bug in the thing it is fixturing.

The two are not in conflict. The exclusion guards the window where the mount is untracked; this
is the act that closes that window, so overriding it here is the point.

## `LibrariesMovedError` is never fixed automatically

A library repository already mounted here, pointing somewhere else, gets its own error because it
is the one outcome nobody should fix automatically: rewriting the submodule would swap every
`@st0/…` module under a project that is already using them, and doing that silently while opening
a song is how a mix changes for no visible reason. pl8 says the same thing on the card that
changes the setting.

## `initIfEmpty` gives a new repository the one thing a gitlink needs

A gitlink has to point AT a commit, so a repository somebody just created through a web UI —
unborn HEAD — needs one made before it can be adopted as a submodule (`git submodule add` on an
unborn HEAD fails). That is the whole of what it does.

**It fills nothing.** The account's LIBRARY REPOSITORY is the reference: what is in it is what a
project inherits, and a build shipping its own copy of somebody's modules would be a second
source of truth that could only ever disagree with the first.

The consequence is worth knowing rather than discovering: a new library is EMPTY, so every
`@st0/…` ref resolves to nothing until modules are put there — including the four a scaffolded
SET writes for its decks. An unresolved ref is not a compile error
(`packages/song/docs/sharedFolders.md`), so a project naming one reads as a project whose module
is bypassed.

It answers what happened, because the caller's next move depends on it: `"filled"` (there is a
commit — nothing to do), `"initialised"`, or `"unpushed"` (committed here, refused there). The
commit carries an author via `-c`, because a repository with no `user.email` configured refuses
to commit at all and this runs on a machine nobody has set up for git; `--allow-empty` because
there is by definition nothing to write.

Two machines racing to adopt the same new repository is the ordinary way a push is rejected: the
loser's push fails, and the winner's commit is just as good a thing to point at. So the failure
is warned and the checkout left alone — the caller declines to record a gitlink, and nothing
downstream ends up pointing at a commit that never left this machine.

## `ensureLibraries` clones first and adopts second

For a library not declared at all — the first workspace to mount it — the mount is a `git clone`
followed by `git submodule add`, rather than one `submodule add`. The reason is the case this
path exists for: a library repository somebody just created has NO COMMITS, and a gitlink has to
point at one. Cloning it, giving it a commit, and only then adding it hands `submodule add` a
repo with a commit — and `submodule add` on a path that is already a checkout adopts it rather
than cloning a second time. The gitlink is recorded only after that commit was pushed.

It is idempotent and cheap in the common case: a populated mount is left alone without a single
subprocess beyond the check. Called on every open rather than only on clone, because the setting
can be added after a workspace already exists.

Where the workspace is NOT a git repository — someone made it rather than cloned it — there is no
superproject to hold a gitlink, so the same folder is a plain clone instead. The shape on disk is
identical, which is all `@studio/song` looks at; what is lost is the pinned commit, and a
workspace that is not versioned had nowhere to pin it anyway.

## The URI is validated by CLONING it, and nothing is made before there is one

`PUT /account/libraries` does not merely check the spelling. `isSshGitUri` says the paste LOOKS
like an SSH URI; only a clone says it is a repository this machine's deploy key can read, and
that is the question being asked. So the route clones before it writes the pointer down, and a
failure answers with git's own words and stores nothing — a URI kept after a refused clone is a
setting that reads as done and breaks at the next thing that needs it.

The clone lands in the BENCH's workspace (`bench.ts`, `ensureBenchLibraries`), which is not an
extra place to keep one: the bench is a workspace like any other and mounts the library like any
other, so validating the URI is the same work as preparing the bench, done once instead of twice.
A clone of a DIFFERENT repository there is deleted rather than left: that folder is what the
answer rests on, and `clonedFrom` is what asks it.

The request is held for the length of the clone, unlike a workspace's (`cloneJobs.md`). It is a
one-time setup gesture on a card that draws a spinner and says *Cloning…*, git's own 120 s timeout
bounds it, and the answer a caller needs is a sentence rather than progress — a job registry would
buy a progress bar for a repository of text.

**Nothing is created or imported before the account has one.** `POST /workspaces` and
`POST /workspaces/clone` refuse with the same sentence the bench route uses, because everything in
a workspace resolves `@st0/…` through the library: a workspace made without one is a folder whose
chains and modules point at nothing, and the refusal has to come before the folder exists rather
than at the first open. `Examples` and the bench's own workspace are not user gestures and are not
gated — the second one IS the library's clone.

## `bumpGitlink` — writing down which library version a song uses

Without it the working copy is already on the new module (the submodule is checked out at it)
while the song still SAYS the old one, so a clone somewhere else gets yesterday's module and
nothing explains why.

Two things keep it from being a liberty taken with somebody's repository:

- **Path-limited, always.** `git commit -- .gitmodules _libraries` commits those paths and
  nothing else, whatever is dirty or staged around them. A `git add -A` here would sweep half a
  song into a commit about a module.
- **Only after the library push succeeded.** A gitlink promises the commit is fetchable; pointing
  one at a commit that never left this machine breaks the song for everyone who clones it. The
  caller enforces the order — it is only reached on a push that landed.

NOT pushed. Pushing a song is `project commit`, a decision about somebody's work and not a side
effect of saving a module. Best effort besides: a workspace that is not a git repository has no
gitlink to move, and a bump that fails costs the record, never the save.

## `commitLibraries` — two repositories, two rules

What a Save in the module builder does, once the files are on disk. The LIBRARY gets the content
— a commit and a push, because that is what makes the module everyone else's. The PROJECT gets
one line: its gitlink, committed path-limited so nothing else in flight goes with it, and never
pushed.

Nothing to commit is not a failure. Two saves in a row with no edit between them, or a save of
files another workspace on this machine already committed, both land there.

The author is the person editing, so the history says who — and via `-c` rather than a written
config, because this checkout is the account's library, not this machine's, and a machine must
not leave its own identity in it.

A push refused after a successful commit is reported rather than swallowed: the work is safe and
the next Save pushes both commits, but saying "saved" and nothing else would be the lie, since
everyone else still has the old module.

## Coming back the other way — `project libraries update`

Everything above is the mount and the PUBLISH. Moving a workspace onto what somebody else
published is the verb `project libraries update`, and it lives in `@studio/commands`'s `git.ts`
beside `pull` and `commit` rather than here: a command's subject is the workspace, and the
dependency runs file-service → commands, never back.

That is why the path-limited gitlink commit is written twice — `bumpGitlink` here, `recordLibraries`
there. They are not quite the same act: this one is a side effect of a Save and carries the editing
person's identity by `-c`, since a machine must not leave its own in the account's library; that one
is what the person just asked for, and commits as whoever git says they are.
[commands/docs/git.md](../../commands/docs/git.md) is that half.

## The environment every git call here carries

`GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` are load-bearing rather than hygiene: a
personal `insteadOf` rewrite turns the SSH URI back to https, privilege and all. Every git
subprocess in this repo carries the same two lines. Calls are bounded, because a hung fetch must
not hold a workspace open.
