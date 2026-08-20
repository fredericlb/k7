# workspace.ts — extended notes

The filesystem layer over ONE workspace root.

This was the st0 backend's former `store.ts`, turned from a single module-level `ROOT` into
a per-workspace object: the file service serves many users' workspaces from one process,
so `root`, the active project, and the compiled/waveform caches all live on a `Workspace`
instance. The path-traversal guards (`safePath`/`toRel`) were preserved verbatim — they
just read `this.root`.

The active project is remembered per-workspace in a `.studio-active` marker file inside
the root (a dotfile, so it's hidden from the tree), replacing the old global
`~/.studio/session.json`. Global machine preferences stay global (`preferences.yaml`).

It is also what `tree()` walks, and what `setActiveProject` has to be strict about now that
pl8 names a project out of a mirror this machine's clone may be ahead of — both in
[activeProject.md](activeProject.md).

## `revision()` — the change token

A cheap token that CHANGES whenever the active project's sources do, so a client can poll
it instead of the expensive things that derive from them.

The one that pays for itself is the compile behind `/project-errors`, which the shell
asked for every 2 seconds whether or not anything had moved. Folding a file walk (~2ms)
in front of it turns a constant cost into one paid per edit.

**Three ingredients, because none is sufficient alone:**

- `mutations` — our own writes, so an edit through the API is reflected instantly, even
  inside a single filesystem-timestamp tick.
- the files — count + newest mtime over the project's files, so an edit made OUT of
  process (a `git pull`, another tab, an external editor) moves it too. There is no
  watcher here; this walk is what stands in for one.
- **two files outside the project**, folded into the same "newest mtime": the engine's scan
  cache (`~/.studio/exts.json`) and the machine's preferences (`~/.studio/preferences.yaml`).
  Every view keyed on this token reads one of them — `@engine/…` modules come out of the scan,
  a channel's label out of the preferences — and neither is in the project, so a plugin rescan
  or a `system channel set` left the memoised answers stale until an unrelated edit moved the
  token. `hints()` had that hole quietly from the day it was keyed here; two stats on a walk of
  hundreds close it for every view at once, which is why they belong in the TOKEN rather than
  in each cache.

Deliberately NOT a content hash: reading every file would cost more than some of the
things this is meant to guard. Count+mtime misses a change that preserves both — in
practice an edit inside the same millisecond as another — and the mutation counter covers
the case we cause ourselves.

## What the token keys: both derived caches

`graphDoc()` and `cachedProjectDoc()` are memoised on it, and that is the whole
invalidation story — there is nothing else to remember to call.

The compiled doc was the exception until recently: it was invalidated by our OWN writes
only, through `invalidateProjectDoc()`. Which is correct for every edit that arrives
through the API, and silently wrong for every edit that doesn't. A `git pull`, an editor on
the same disk, a tool writing the folder directly — none of them touch the mutation
counter, so the service kept serving a compile of a project that no longer existed, for the
lifetime of the process. The symptom is the worst kind available: the graph, the document
sent to the engine and the error list all agree with each other and all contradict the
files on screen, and the only thing that ever fixed it was reopening the project. It cost a
debugging session in m9, where a module added to a set never appeared in the graph.

The cost is one directory walk per read where there used to be none: 4.8 ms against the
~280 ms a graph build takes and the compile behind it, and the frontend pays that same walk
on every poll anyway. `invalidateProjectDoc()` stays — it bumps `mutations`, which is what
makes our own write visible inside a single timestamp tick.

The token describes the ACTIVE project. Both caches take a `dir` because building takes
one, not because a second project can sit in them.

`hints()` is the third, added later and for the same reason: it is a pure read of the folder,
and st0 asks for it after EVERY command — the editor pane is mounted in every layout and
refreshes its tree and its completion vocabulary together, so a command that never touched a
file the editor is showing still rebuilt the tracks, the clips, the per-plugin params and the
path map. 150 ms on a real song, on the one process that is also compiling the answer to that
command.

`projectErrors()`, `moduleCatalogue()`, `ioPorts()` and `baseModules()` are the rest, and they
go through one helper (`onRevision`) rather than four hand-written cache fields: the same token,
the same rule, and one place to read it. Each was a full read of the module vocabulary on EVERY
request — 21 to 43 ms, on routes a mounted panel asks for on each reload. `build` may only READ;
a builder that wrote would be memoising its own side effect away.

## `recordChange` re-reads only what moved

The undo journal diffs the project's text files before and after a mutation, which is two
whole-folder walks per command — 180 small YAML files read 360 times to journal the one line a
command rewrote. The "before" image is also almost always the "after" image of the command
before it.

So `textOf` keeps the last walk's content, keyed by path, beside each file's size+mtime, and
re-reads only the files whose stamp moved. The gate is the one `binOf` has always trusted for
binaries; the walk itself still happens, so a file created or deleted out of band is still seen.

The walk is now ONE walk. `textOf` and `binOf` split the same tree between them and used to cross
it separately to do it, and `revision()` crossed it a third time for the token — six passes per
writing command, since the journal takes an image either side of the mutation and the route took
a token either side of the command. `walkProject` does it once and reports every file's
`size`/`mtime`/`binary`/`source`; `withWalk` holds that list for one phase, exactly as
`withRevision` holds the token and for the same reason; and `recordChange` hands its caller the
token of both instants, so the route walks not at all. 31–34 ms → 16 ms on a real song, with the
token identical to the character. Two things that had to stay true, and are tested
(`revisionWalk.test.ts`): the narrow walk `/revision` takes and the wide one a mutation takes
must produce the SAME token, and the two-second poll must not start paying for a folder of wavs —
which is what `sourcesOnly` is, and why no workspace-relative path is computed on that path.

`diffBin` had a sharper version of the same problem, and it was a plain mistake rather than a
trade: it read every binary's bytes BEFORE deciding whether the diff could use them. A song with
650 MB of takes in `clips/` read all of it to journal one line of YAML, on every command. The
bytes are now read only for a file the mutation created, or one it snapshotted — which is
exactly the set the journal can act on.

## Windows handle discipline

Deleting a project moves its whole folder to the recycle bin, and on Windows a directory
can't be renamed while any handle inside it is open: a file watcher's
`ReadDirectoryChangesW` (closed async, just before), or the engine still holding a clip's
`.wav` after an async flush. Both release within a few ms, so `renameWithRetry`'s bounded
retry turns the EPERM/EBUSY into success rather than a failed delete.

Every mutating path therefore releases what IT holds first (`cancelPrewarm()`, and via
`beforeMove` the engine and the watcher), then leans on the retry for anything that
lingers. A non-transient error, or exhausting the retries, still throws. POSIX renames
succeed on the first try, so all of this is a no-op there.
