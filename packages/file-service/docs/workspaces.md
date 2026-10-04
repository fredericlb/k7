# workspaces.ts — the live set of workspaces, and the two listings over it

One `Workspace` instance per workspace, memoized so its caches (compiled doc, waveforms) persist
across requests, plus the listings st0's home page and `/external` draw.

## Opening does NOT create

`getWorkspace` does not mkdir on first touch: that would make any request which merely NAMED a
workspace conjure one, and a browser tab still retrying with a remembered name would silently
recreate a workspace you had just deleted, empty. Creation happens only in `createWorkspace`
(from `POST /workspaces`), `cloneWorkspace` (from `POST /workspaces/clone`) and `Examples`,
so what is on disk changes because someone asked for it. Those first two are
the two ways one appears on st0's home page, and they are the same pair of buttons: **Nouveau**
and **Importer**.

`Examples` is stocked when the service STARTS (`syncExamples` in `demos.ts`), not by a listing.
The hub starts an account's service on that account's first request, so startup is the first use,
and the demos are on the home page the first time it draws. The root's absence cannot be the cue:
the service creates the root as it boots, so a check made later never sees a new account.

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

Four things are written at init, and each answers a failure:

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
  machine, in a screen that has no business explaining git config. A CLONED workspace has no
  such config, and the hosted container has no global identity either, so EVERY git call this
  service makes carries the editing account as `GIT_AUTHOR_*` / `GIT_COMMITTER_*` — the
  commits the web makes (`webGitEnv` in `src/engineLink.ts` — a project delete,
  `project commit`) and the workspace-level ones (`gitEnvFor` in `src/workspaces.ts` — a
  compaction's root commit): the author is the person editing, whatever the repository or the
  machine says.
- **A `.gitattributes` routing media through LFS**, and the repo-local filter behind it — see
  [Media through LFS](#media-through-lfs).

An init that fails is logged and not thrown: the folder exists and is usable, and the first
`project commit` is what will say that it is not a repository. Creating the workspace and being
able to version it are two different promises.

## Media through LFS

A song IS its audio, and git stores a whole new copy of a file on every commit that changes it.
A trimmed wav re-committed a dozen times is a dozen wavs in the history, forever, and the cost is
paid again by every clone and every push. So a workspace made here tracks every audio and video
extension the médiathèque knows — `gitLfs.ts`, over `AUDIO_EXT` and `VIDEO_EXT` from
`packages/mediatek/src/media.ts`, so the list that decides what the library will PLAY is the list
that decides what the repository stores by reference.

The patterns are spelled `*.[Ww][Aa][Vv]`. git matches an attribute pattern case-sensitively, and
a real library hands over `.FLAC` and `.WAV`; a rule that only said `*.wav` would silently commit
those whole. Every rule carries `-text` as well, since git otherwise reserves the right to rewrite
line endings inside a binary on checkout.

**`git lfs install --local`, never `--global`.** This is not tidiness: `gitEnvFor` pins
`GIT_CONFIG_GLOBAL` to `/dev/null` and sets `GIT_CONFIG_NOSYSTEM`, so a machine where the musician
already ran `git lfs install` has NO lfs filter as far as this service is concerned. The repository's
own config is the only place the filter can be seen from here.

## A machine without git-lfs

Creating a workspace still works, and writes the same `.gitattributes`. An attribute naming a
filter git has no driver for is a no-op — the wav is committed as an ordinary blob — so the rules
cost nothing while they cannot be honoured, and start being honoured the day git-lfs is installed.
It is logged once, and the failure is not thrown: as with the git identity above, being able to
version the workspace and being able to version it WELL are two different promises.

**Cloning is the other way round, and refuses.** A clone whose media is in LFS lands as pointer
files — a few hundred bytes of text where a wav should be — and nothing downstream says so: the
decoder fails, the waveform is empty, the project looks corrupt. `NoLfsError` names the fix
instead, and the clone's debris is removed by the same path that handles a refused push.

That fetch is ours to run even when git-lfs IS there: `git clone` smudges nothing, because the
filter lives in a config the clone does not have yet. `pullLfs` installs it into the fresh
checkout and pulls, reporting an `LFS` phase so the wait in `cloneJobs.md`'s progress bar has a
name.

The pull is bounded by SILENCE, two minutes without a line, never by its length. What it is
spawned with serves that rule and the error it leaves:

- **no stdin**, so a credential or host-key question fails at once with git-lfs's words, instead
  of waiting for an answer nobody can give until the timer kills it with nothing to say;
- **stdout drained**, since a full pipe blocks git-lfs and looks exactly like a stall;
- **`GIT_TRACE` on**, kept out of the progress and out of the timer: when it IS stopped for
  silence, its last lines — the `ssh … git-lfs-authenticate`, the batch request — are the only
  account of where it stopped, and the error carries them.

## The fetch is not believed, it is CHECKED

git-lfs having exited 0 is not proof the media arrived, and neither is anything git will tell you
afterwards: a pointer left in the working tree matches HEAD exactly, so `git status` is clean,
`git lfs status` says nothing and `git lfs fsck` says OK. The repository is in perfect health and
every wav in it is 130 bytes of text. That is the state this section exists to refuse — a workspace
that opens, draws its tracks, and plays silence.

So `pullLfs` finishes by reading the files. `git lfs ls-files` gives the paths, and each one's
first bytes are compared against the pointer spec line, which is the only tell there is. Anything
still a pointer means the fetch did not finish, and `IncompleteLfsError` says so rather than
letting the import claim a success it did not verify. **The check is on the bytes, not on the
exit code**, because every layer that reports on the fetch reports it went fine.

**A marker carries that across a death.** `.git/studio-lfs-pending` is written BEFORE the fetch
and removed only after the files verify, so the one failure no `catch` can see — the process
killed mid-pull, which strands partial objects in `.git/lfs/incomplete` and leaves the tree full
of pointers — is still known about the next time someone asks. `lfsPending` is that question. It
costs one `existsSync` when nothing is owed, and when the marker stands it re-reads the files and
clears it if the media has since arrived: fetching by hand is a supported way out, and a marker
that lied about a workspace someone already repaired would be worse than none.

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

## Copying a project from one workspace to another

`copyProject.ts` is its own module because it is the one act naming TWO workspaces: neither
`Workspace` instance owns it, and each end still answers for its own guards — the source resolves
and validates what is read (`projectFolder`), the destination resolves and validates where it
lands (`copyProject`, over `copyProjectInto` in `projectLifecycle.ts`).

**The copy keeps the source's suffix.** The suffix is what decides which application opens a
folder, so a `.st0` copied as `.z0` would be a song z0 is asked to read: refused by name here
rather than discovered by whoever opens it.

**A workspace that IS a single project is refused as a destination.** Such a workspace lists `.`
and nothing under it, so the copy would be on disk and in no listing — an act that appears to have
done nothing.

**What is not content is left out**, through the same `skip` the tree, the watcher and the diff
use: caches (`*.cache`), `node_modules`, the undo journal, the recycle bin. A dotfile inside a
project is invisible to every one of those already, so the copy loses nothing anything can see,
and gains none of the machine-local weight.

**The playlists the copy NAMES come with it.** A `turntables` surface names a set list by name and
the file lives at the WORKSPACE root, one level above everything the copy carries — so the project
alone lands beside no `_playlists/` and opens on "the playlist this surface names cannot be found".
`carryPlaylists` copies each one the surfaces name, and skips any the destination already has: a
workspace's own set list is the one its other projects are already reading, and a copy is no reason
to overwrite it. Nothing else is chased across — a module named from `_modules` resolves against the
destination's library by design, which is what a shared library IS.

The COMMIT is not here. A copy changes the workspace that receives it, and committing that is
st0's call in one place — see `apps/st0/frontend/docs/projects.md`.

## Renaming one in place

`renameProject` guards what every writer here guards — the root, the shared library, the recycle
bin, the no-clobber, the Windows handle retry — plus the one thing a PROJECT folder has that an
ordinary one has not: **a suffix that names the application**. It is checked with `projectApp` on
both names rather than by string surgery, so `winter.st0` → `spring.z0` and `winter.st0` →
`spring` are both refused by name, and the caller cannot hand a project to another editor by
typing.

**It is deliberately not `renameEntry`**, whose `guardMutable` refuses the ACTIVE project outright.
A rename takes `beforeMove` instead, exactly as `deleteProject` does, and the route hands it
`unloadEngineIfServing`: the engine is asked to let the folder go, and the rename proceeds. The
alternative — "stop it first" — is a refusal that asks somebody to go and find the transport in
another tab before they may rename a folder, and the handles are released the same way either way.

**The marker FOLLOWS it**, which is where the two acts part. A delete clears `.studio-active`,
having ended the project; a rename re-points it at the new folder, the project being the same one.
The compiled-doc cache is invalidated with it, and the project CACHE dropped
(`forgetProjects`) as a delete and an import do — the listing is memoised, and a renamed project
would otherwise be listed under a folder that is gone.

The COMMIT is not here either, for the reason the copy's is not.

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
`AccountWorkspace`.

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

## A clone is bounded by SILENCE, not by duration

`gitClone` runs with `--progress`, so git writes a counter line continuously while it works. The
kill timer is reset by every one of those lines: a clone may take as long as it takes, and is only
killed after **two minutes with nothing said at all**.

It was a total cap of two minutes, and the failure it produced was hard to read from the outside.
A repository with a lot of audio in it goes past two minutes easily; git was killed mid-checkout,
`close` fired non-zero, and the `catch` removed the half-clone — so the workspace **appeared while
cloning and vanished when it "finished"**, with git's last words being whatever it had been saying
when it died. Nothing in that reads as a timeout.

The client gives up drawing progress after ten minutes (`CLONE_CAP_MS`), and that is only the PAGE
giving up: the machine goes on cloning and the workspace appears by itself. The message says so,
because "le clonage n'en finit pas" would read as a failure of something that is working.

**`git lfs pull` now follows the same rule**, and needed it more: `FETCH_MS` was a total cap of
five minutes on `execFile`, and a song repository's media is routinely larger than five minutes of
link. It is `lfsPull` in `gitLfs.ts` — a spawn rather than `execFile`, with the clock reset by
every line, so the fetch may take an hour and is killed only after two minutes of silence.

Two things that fetch needs and `execFile` could not give:

- **`GIT_LFS_FORCE_PROGRESS`.** git-lfs draws its meter only for a terminal; piped, it says
  nothing at all — and a timer that watches for silence would then kill every fetch it ever ran.
- **The meter reaching the screen.** Those lines go through `parse` like git's own, so the
  percentage shows. A fetch now allowed to take an hour cannot be a motionless "clonage…".

## Removing one is FINAL, and that is why the button asks

`removeWorkspace` deletes the folder and everything under it. There is no recycle bin for this:
the bin is `_recycle_bin` **inside** a workspace, so a project falls into it and a workspace has
nowhere of its own to fall.

Two things make that acceptable, and the confirmation says which one it is looking at, because
only the first is reversible:

| the workspace | what removing it costs |
|---|---|
| has an `origin` | what was pushed is at the git host, and importing it again brings it back; what was not pushed goes |
| has none | it only ever existed here, and nothing brings it back |

**The engine is unloaded first, and that is not politeness.** A project of this workspace still
loaded holds files open, and Windows answers EPERM half-way through a delete — the same wall a
person hits removing the folder by hand, where Explorer reports it as a request for admin rights
and elevating does not help. `deleteProject` has carried that rule since it was written
(*"Release every handle inside the folder before renaming"*); this route follows it.

## Compacting

`compactWorkspace.ts` (`POST /workspaces/compact`) brings a repository back to what its working
tree uses today. A song repository grows with every take and stem ever committed, and git keeps
each one forever, including after it is deleted, so after a while the history weighs far more
than the song. Compacting:

- **empties `_recycle_bin`**, for good;
- **replaces the history with ONE commit**: the working tree as `.gitignore` sees it today,
  uncommitted edits included. A file that was tracked before a rule ignored it drops out of the
  repository and stays on disk. The commit is built on an orphan branch, which then takes the
  current branch's name;
- **deletes every other ref**: branches (alternatives included), tags, the stash and the
  remote-tracking refs. While any one of them is left, the old objects are still reachable and
  nothing is freed;
- **expires the reflog, runs `gc --prune=now` and `git lfs prune`**, which is where the bytes
  actually come back;
- **force-pushes** when there is an `origin`.

**It refuses before deleting anything** when the current branch is ambiguous: a detached HEAD, a
merge or rebase in progress, or an alternative checked out. Rebuilding an alternative as the
branch would silently replace its parent.

**It never touches the working tree**, the bin aside. That is why it does not unload the engine,
unlike a removal. If building the commit fails, HEAD is pointed back at the old branch and the
index is reset to it.

**A refused force-push does not undo anything.** The local repository is compacted either way. The
reply carries git's words in `pushError`, and the page says the repository is compacted here but
was not pushed. The usual cause is a protected branch, and pushing again once the host allows it
finishes the job. What compacting does NOT do is purge the host: the remote's other branches stay,
and so do the LFS objects already uploaded, which only the host's own tools can delete. Every other
clone of the repository diverges and has to be cloned again. The confirmation names both costs.

## Sync state

`workspaceSync.ts` (`GET /workspaces/sync`) tells the home page, for each workspace, how many paths
`git status` lists, how many commits the upstream lacks, and how many it has that this copy lacks.

**It is a route of its own and not a field of the listing.** "Not pulled" is only true after a
`git fetch`, and a fetch is a network call that can take seconds or hang on a host that is down.
The listing is polled every three seconds and must answer at once. So the page polls sync on a
slower timer of its own, and the service fetches each workspace **at most once a minute**,
bounded at 20 s. A poll that finds a fetch running joins it instead of starting another. Each call
recounts the local figures, so a commit made in the editor shows on the next poll.

**`ahead` and `behind` are null with no upstream.** A workspace with no repository has no "not
pushed": its commits have nowhere to go, and its row says only what is uncommitted.

**The paths behind that count are a route of their own**, `GET /git/changes`, with one path's
diff at `GET /git/diff` (`src/workspaceChanges.ts`). They are asked per workspace, by the home
page's tree when it is unfolded, and not by every row on every poll. Untracked files are listed
one by one (`--untracked-files=all`) so the tree can colour each file rather than only its folder.
A diff is taken with `--literal-pathspecs`, and a path that leaves the workspace is refused before
git sees it.

**A failed fetch is reported in `fetchError` and not as a failure.** `behind` is then as old as the
last fetch that worked: still the best answer there is, and a wrong zero would not be.

## An import brings the LIBRARIES up to date too

The libraries are the account's, not the workspace's: no workspace holds a copy
(`libraries.md`). An import still ends with them — after the clone lands and before the media,
`cloneWorkspace` refreshes the account's clones (waiting only for one not cloned yet), so the first
open of what was just imported finds every `@<library>/…` it names.

A workspace committed back when libraries were a submodule arrives with a `.gitmodules` for
`_libraries`; the import takes it out (`retireWorkspaceLibraries`) in one path-limited commit, not
pushed, and says so on the progress line. Non-fatal, for the same reason the LFS fetch is: the
workspace IS cloned, and a library that would not sync is reported rather than a reason to undo the
rest. `POST /open` does the same two things, which is what catches a workspace cloned before.
