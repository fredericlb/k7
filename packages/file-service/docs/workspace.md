# workspace.ts — extended notes

The filesystem layer over ONE workspace root.

This was the l8 backend's former `store.ts`, turned from a single module-level `ROOT` into
a per-workspace object: the file service serves many users' workspaces from one process,
so `root`, the active project, and the compiled/waveform caches all live on a `Workspace`
instance. The path-traversal guards (`safePath`/`toRel`) were preserved verbatim — they
just read `this.root`.

The active project is remembered per-workspace in a `.studio-active` marker file inside
the root (a dotfile, so it's hidden from the tree), replacing the old global
`~/.studio/session.json`. Global machine preferences stay global (`preferences.yaml`).

It is also what `tree()` walks, and what `setActiveProject` has to be strict about now that
st0 names a project out of a mirror this machine's clone may be ahead of — both in
[activeProject.md](activeProject.md).

## `revision()` — the change token

A cheap token that CHANGES whenever the active project's sources do, so a client can poll
it instead of the expensive things that derive from them.

The one that pays for itself is the compile behind `/project-errors`, which the shell
asked for every 2 seconds whether or not anything had moved. Folding a file walk (~2ms)
in front of it turns a constant cost into one paid per edit.

**Two ingredients, because neither is sufficient alone:**

- `mutations` — our own writes, so an edit through the API is reflected instantly, even
  inside a single filesystem-timestamp tick.
- the files — count + newest mtime over the project's files, so an edit made OUT of
  process (a `git pull`, another tab, an external editor) moves it too. There is no
  watcher here; this walk is what stands in for one.

Deliberately NOT a content hash: reading every file would cost more than some of the
things this is meant to guard. Count+mtime misses a change that preserves both — in
practice an edit inside the same millisecond as another — and the mutation counter covers
the case we cause ourselves.

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
