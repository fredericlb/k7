# workspaces.ts — the live set of workspaces, and the two listings over it

One `Workspace` instance per (userSlug, workspace), memoized so a workspace's caches (compiled
doc, waveforms) persist across requests, plus the listings st0's home page and `/external` draw.

## Opening does NOT create

`getWorkspace` does not mkdir on first touch: that would make any request which merely NAMED a
workspace conjure one, and a browser tab still retrying with a remembered name would silently
recreate a workspace you had just deleted, empty. Creation happens only in `createWorkspace`
(from `POST /workspaces`), `cloneWorkspace` (from `POST /workspaces/clone`) and the one-off
Examples bootstrap, so what is on disk changes because someone asked for it.

The existence check runs before the memo, on every call: a folder deleted from Finder would
otherwise be served from cache and 500 deep in `fs`. `UnknownWorkspaceError` is carried as a type
so the HTTP layer can answer 404 rather than lumping it in with a malformed name, which is a 400
— `workspaceRoot()` throws on a traversing or empty name.

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
