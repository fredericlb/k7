# workspaces.ts — the live set of workspaces, and the two listings over it

One `Workspace` instance per (userSlug, workspace), memoized so a workspace's caches (compiled
doc, waveforms) persist across requests, plus the listings st0's home page and `/external` draw.

## Opening does NOT create

`getWorkspace` does not mkdir on first touch: that would make any request which merely NAMED a
workspace conjure one, and a browser tab still retrying with a remembered name would silently
recreate a workspace you had just deleted, empty. Creation happens only in `createWorkspace`
(from `POST /workspaces`), `cloneWorkspace` (from `POST /workspaces/clone`) and the one-off
Examples bootstrap, so what is on disk changes because someone asked for it. Those first two are
the two ways one appears on st0's home page, and they are the same pair of buttons: **Nouveau**
and **Importer**.

The existence check runs before the memo, on every call: a folder deleted from Finder would
otherwise be served from cache and 500 deep in `fs`. `UnknownWorkspaceError` is carried as a type
so the HTTP layer can answer 404 rather than lumping it in with a malformed name, which is a 400
— `workspaceRoot()` throws on a traversing or empty name.

## A workspace does not need a repository

`createWorkspace` **git-initialises** what it makes, with no remote at all **and nothing in it**.
That is the ordinary first workspace: someone opens studio, makes one, and the editor asks what
the first project should be. There is no host to name, no key to
paste, no account to have — `@local/<espace>/<projet>` addresses it and every command that acts
on the working copy works, `project commit` included. What does not work is the one thing that
genuinely needs a repository: pushing.

Three things are written at init, and each answers a failure:

- **`main`, explicitly** (`git init -b main`). git's default branch name depends on the version
  and on a config file this service deliberately ignores, and a workspace whose branch is
  `master` on one machine and `main` on another is a push that is refused for a reason nobody
  will guess.
- **A `.gitignore`** — `_recycle_bin/`, `_history/`, `*.cache`, `.studio-active`. A clone brings
  its author's; this one never had an author. Without it a deleted project comes back through
  the repository, and the undo journal — a ring of up to a thousand entries, blobs included — is
  committed and pushed with the song.
- **A repo-local `user.email` / `user.name`.** Not hygiene: `gitEnvFor` pins
  `GIT_CONFIG_GLOBAL` to `/dev/null` (see below), so a machine WITH a git identity has none
  here, and the very first commit would fail with *"Please tell me who you are"* — on a musician's
  machine, in a screen that has no business explaining git config.

An init that fails is logged and not thrown: the folder exists and is usable, and the first
`project commit` is what will say that it is not a repository. Creating the workspace and being
able to version it are two different promises.

## Its FIRST repository, later

`setWorkspaceRemote` is that day: `git remote add origin` and `git push -u origin HEAD`, both in
one call because they are one act — a remote nobody has pushed to is a workspace that LOOKS
published and is not. It refuses a workspace that already has an origin, because re-pointing one
at another repository is a different act with different consequences, and it is not this one.

**A failed push takes the remote back off.** Otherwise the workspace is left claiming a
repository it never reached: `listMachineWorkspaces` would draw its URI, `workspaceForRepo` would
answer it, and st0 would stop offering the one button that fixes it. Half-published is the state
worth not having.

Both caches are dropped afterwards, and it has to be both: the row's origin comes from
`remotes`, and the row itself from `listings`.

## Cloning

`cloneWorkspace` throws with git's stderr on failure — that text ("Permission denied
(publickey)", "Host key verification failed") is exactly what the user needs to see, and it is
git's own words rather than ours. `onProgress` is what makes the wait visible; see
[cloneJobs.md](cloneJobs.md). `--progress` is passed because git only writes counters when it
thinks it has a terminal, and the stderr split takes `\r` as well as `\n` because git rewrites
the counter line in place rather than emitting new ones.

If the clone fails, `root` is removed: it did not exist beforehand, so whatever is there is our
debris, and a half-clone must not survive in the picker.

The git environment carries `GIT_TERMINAL_PROMPT=0` (fail rather than prompt — there is no
terminal to answer) and the two `GIT_CONFIG_*` lines, which are load-bearing rather than hygiene:
a personal `insteadOf` rewrite turns the SSH URI back to https, privilege and all.

## The remote memo

A workspace's `remote.origin.url` is filled lazily and dropped whole when a clone adds one, since
a `git config` per workspace on every lookup would be a subprocess per poll. `workspaceForRepo`
is what stops st0 re-cloning something already on disk, and it compares NORMALIZED uris because
the two sides learn the address by different routes: pl8 has what was pasted, this has whatever
git wrote into `remote.origin.url`.

## `listMachineWorkspaces` — what st0's home page draws

Every workspace on this machine, with the projects it holds and the repository it came from. The
machine is the only thing that can answer it: the projects are folders on this disk. A hosted
answer, out of a mirror of each repository, would be a second copy, a fetch behind, and unable to
see a project that is committed here but not yet pushed.

The counted cost is `remoteOf` per workspace, which is a `git config` subprocess. It is memoized
for the process' life and dropped only when a clone adds one, so the poll behind this pays it
once. The walk beside it is the same one `workspaceInfo` runs, without its cache — measured at
5.3 ms on a real workspace, and this asks it of a handful.

The origins are resolved first and on their own, because addressability is a fact about the SET:
a short name only identifies a workspace when no other workspace answers to it. A short name
shared by two clones is reported as NOT unique rather than resolved — pl8 answers 409 for such a
name, and picking a winner here would send somebody to the other one. Whether pl8 knows the
repository at all is the OTHER half of that question and is not asked here; see
`MachineWorkspace`.

`repoNameOfKey` and not `repoName`: these origins are already normalized keys, and the validating
door refuses its own output. See `packages/git-repos/src/uri.ts`.

Inside a row, `.` names the workspace folder itself and every other path ends in the folder that
claims the app. Either way the NAME decides, which is the one rule both ends use.

## The 5-second listing window

The same window `Workspace.workspaceInfo` puts under its own project scan, for the same reason. A
page polls this every few seconds and the answer changes when somebody creates a project. Without
a floor, every tab on the home page walks every workspace's directory tree on every tick — a
`readdir` per folder, and a real workspace has hundreds. A list five seconds behind is a row that
has not appeared yet, which is a wait; the compiled-document cache refuses this trade and has to,
because a stale COMPILE is confidently wrong about a song.

It is dropped whole when a clone or a new workspace lands, which is the one change this service
makes that the window would otherwise hide for the length of it. Both listings are dropped
together, since the second is built on the first: a clone that adds a workspace adds any surfaces
it holds, and one window dropped without the other would show the projects and not their screens.

## `listSurfacedProjects` — what `/external` draws

Every project on this machine that DECLARES a surface, flat, with those surfaces: the list of
screens this account could put on a second device. Built ON the listing above rather than beside
it, so "which projects are there" is asked once and answered the same way for both pages, and
only the surface scan is new.

That scan is a `readdir` of `surfaces/` plus a small YAML parse per file, and it is asked of every
project rather than of one — hence a window of its own, the same length and for the same reason.
It is deliberately NOT folded into `listMachineWorkspaces`: the home page is the front door and
does not draw surfaces, and making it pay for them would be a cost with no reader.

Its diagnostics are dropped on purpose: a surface file that will not parse is not a row this page
can offer, and the place that says WHY is the editor, which shows them beside the project's other
faults.

No policy here about which surfaces are worth a second device. The service reports what the
project declares; whether a `timeline` can be driven from a phone is the APP's question, and st0
answers it in one place — see `apps/st0/frontend/docs/external.md`.

`activeOf` reads the marker file straight off disk rather than opening a `Workspace`, which would
build its caches to read one line.

## Which project a bare workspace address opens

`Workspace.defaultProject()` answers it, and `POST /open` calls it whenever the address said `.`
without the workspace's own folder being a project. Three tiers, most deliberate first:

1. the `.studio-active` marker — the project last open here, which is what someone coming back
   expects;
2. the first `projectDirsUnder(root)`, which is alphabetical because the walk is;
3. `null` — and that is the ORDINARY state of a workspace just made, since `createWorkspace`
   writes no project. The gate turns it into st0's first-project wizard rather than mounting an
   editor over nothing (`packages/project-shell/docs/launch.md`).

`setActiveProject` is untouched by all of this and keeps its exact rule: it checks existence
before the name rule and refuses anything that is not a project folder. A fallback belongs where
the ambiguity is, which is the address, not the check.
