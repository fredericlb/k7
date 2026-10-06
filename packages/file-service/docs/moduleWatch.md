# moduleWatch.ts — letting the module-stamp walk become rare

`@studio/song` memoises the module vocabulary against a STAMP of the folders it is read from,
and that stamp is a directory walk: 329 `readdir` and 419 `stat`, about 19 ms
(`packages/song/docs/moduleCache.md`). It buys a 295 ms read, so it is a good trade — but it is
paid per derivation, and a reload asks six routes. This file makes it paid per ten seconds
instead.

## Letting go before a folder moves

`fs.watch` holds the directory it watches. On Windows that is not advisory: renaming a watched
folder answers **EPERM**, half-way through whatever was moving it. So every path that MOVES a
project or a workspace closes the watches under it first — `closeModuleWatchesUnder`, called by
`Workspace.deleteProject` and by `removeWorkspace`.

`closeModuleWatch(project)` alone was not enough, and the reason is the shape of the two: the
watch is keyed by PROJECT, and the caller holds a folder — a workspace root, or a project it knows
by a workspace-relative path. Closing "everything under this folder" is the question those callers
can actually ask.

The watch was dropped when a session SWITCHED project (`forgetModuleWatch`), and on nothing else —
so a project deleted while it was the one being served kept four directory handles, and the
delete failed on the rename with the project still on disk.

## What it answers

One bit: **have this project's module folders moved since the last walk?** Nothing else. The
oracle is installed into `@studio/song` through `setFoldersStill`, and `false` always means
"walk", which is what everything that installs nothing gets.

One watch per PROJECT, not one at a time: `startEngineForActive` runs per workspace, and every
session's own `/workspace` poll starts its own. Two people on two projects each get the fast path,
and a change to one does not cost the other its answer.

Three things make it say no, and all three are one-directional — saying no costs a walk, saying
yes wrongly costs a module served under a name nobody wrote:

- nobody is watching this project;
- an event arrived since the last walk;
- the ceiling ran out (`WALK_ANYWAY_MS`, ten seconds).

The first ask after starting a watch is also a no. The watcher has seen no events, but neither
has it seen the folders, and the walk it forces is what gives every later answer something to be
measured against.

## What it watches

The roots the stamp walks: the module panel roots, `nodes/`, and a chain project's `chains/`,
`tracks/` and `vstpresets/` (`packages/song/docs/chainFiles.md`). A root that does not exist is
simply not watched, so an older project costs nothing for the newer format's folders.
`layout.yaml` is not watched: where a card sits feeds the segments, which are read fresh on every
load, and none of the cached reads — the module map and the ref map — looks at it.

## Why a watcher is not enough on its own

`fs.watch` delivers on a later tick. A command that WRITES a module file and then rebuilds the
graph — one HTTP request, synchronously — asks before its own event has arrived. Told nothing had
moved, it would build from a vocabulary missing the node it had just created, and the ceiling
would be no help: the ten seconds it is wrong for are the ten that matter.

So the process that writes says so, through `moduleFoldersMoved()`, wired to
`Workspace.invalidateProjectDoc` — this service's single "something changed" choke point.
Deliberately blunt: every write, not only a module's. Knowing which is knowing the answer, and one
extra walk after a write is exactly what a write costs without any of this; the five reads that
follow it are free, which is the point.

`invalidateProjectDoc` is not the only way a write happens, though. A verb writes through
`@studio/song-edit` on its own, and it reaches that choke point only if it then asks for a reload.
One that pushes a patched document to the engine instead — `node bypass`, and `node alternative
select` between two sets of numbers — never does. So `runWebCommand` says so too, after any
command that moved the revision: otherwise the graph that same request returns is built on the
module file as it was, and the switch the person just made shows as undone.

The rule this is an instance of, for the next cache backed by a watcher: **a watcher reports the
FILESYSTEM's events, and the process doing the writing is ahead of them.** Both sources have to be
wired, not one or the other.

## Why the ceiling exists

`fs.watch` drops events. Under load, across network shares, on some Linux filesystems, and on
Windows when a rename storm outruns the buffer. Without a ceiling a single dropped event would
leave the vocabulary stale **for good** — the exact "confidently wrong" failure
`Workspace.cachedProjectDoc` documents and refuses. With one, a dropped event is a delay of at
most ten seconds: far longer than a burst of saves, far shorter than anyone's patience with a
module that will not appear.

That is the whole safety argument, and it is why this is a *shortcut over* the walk rather than a
*replacement for* it. The walk is still the source of truth; the watcher only says when it can be
skipped.

## Why `fs.watch` and not chokidar

The service uses chokidar for the strudel watcher, so it is the default choice here too. Two
reasons not to.

**Handles.** `fs.watch(root, { recursive: true })` is ONE handle per root — four for a project.
Chokidar takes one per directory, which is ~150 for a médiathèque of modules. And on Windows a
handle held on a directory is what makes *that* directory's parent refuse to be renamed: with the
handle on `modules/`, renaming a module folder inside it is untouched. Renaming a MODULE is an
ordinary operation; renaming `modules/` is not.

**Shape.** Chokidar's job is telling you which file changed, with add/change/unlink and a
debounce. This needs a counter. Everything else it offers would be work spent producing
information that is then thrown away.

The one thing chokidar gives that raw `fs.watch` does not is a portable guarantee about recursive
watching. Hence the try/catch around each root and the ceiling above: a platform that refuses
recursive watching simply never gets a fast path, and nothing else changes.

## Closing it before a rename

The roots sit inside the project folder, and recycling a project renames that folder. On Windows
an open handle inside a directory is what makes the directory refuse. So `unloadEngine` closes
this watch beside `closeStrudelWatcher()`, and the project being left is read from `served`
**before** that map is cleared — it is the only record of which folder was being served.

`startEngineForActive` closes it too, on a project SWITCH. Without that, every project ever
opened would keep its four handles for the life of the process, and each of those folders would
refuse to be renamed by a person who had merely moved on.

Both go through `forgetModuleWatch`, which first checks whether anybody else is still served that
project: two people can have one shared project open, and "this session left it" is not "nobody
is on it". Closing it under them would cost them the fast path and nothing else — the oracle
answers false for a project it does not watch — but leaving it open in front of a rename is the
failure that matters, so the check is made rather than skipped.

`renameWithRetry` (25 attempts, 100 ms apart) is the net under all of it, and its comment already
says so: it exists for a watcher's handle that lingers past the close.

## What it measures

The six routes of one reload, alternating arms in a single invocation so the machine's drift
falls out — the median of five each:

| | ms |
|---|---|
| without the watcher | 230 |
| with it | **108** |

The walks a reload pays go from six to none, bar one every ten seconds.
