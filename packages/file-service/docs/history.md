# The undo/redo journal

`history.ts` is a per-project journal that makes Ctrl+Z / Ctrl+Y in st0 and m9 undo
**persisted** changes to the project — an editor save, or any command that rewrote a
file — across the whole project, not just the file on screen. It lives in the file
service because that is the one place every mutation already funnels through, and because
the history must reach a file the UI doesn't currently have open.

## What it records

Every mutation crosses one of two choke points, and both wrap it in
`Workspace.recordChange(label, mutate)`:

- **`PUT /file`** — an editor save (`routes/files.ts`).
- **`POST /command` → `runWebCommand`** — every UI action that dispatches a command,
  including `track process` / `clip process` (`engineLink.ts`).

`recordChange` snapshots the project's text files (small YAML) before and after the
mutation and diffs them, so it catches an edit however it was written. Binary files (a
process *bounce*, which overwrites a rendered `.wav`) are handled by the `snapshot(abs)`
callback the mutation calls **before** it overwrites one: that stashes the pre-image
bytes, and the after-image is read from disk once the mutation returns. A process step
therefore ends up as one entry holding both the repointed clip YAML (text diff) and the
render backup (blob), undone atomically.

The `snapshot` callback — not size/mtime — is the authority for overwrites, so a
same-size re-bounce still registers even on a coarse-mtime filesystem.

It answers a `Recorded<T>` rather than the mutation's own value: whatever `mutate` returned, plus
the **revision token either side**. That is not the journal's business and it is nonetheless the
right place for it — `recordChange` is the one thing that brackets a write, and it has to cross
the tree twice to diff it, so naming both instants costs it a filter over a list it already
holds. Its caller would otherwise walk twice more to learn the same two facts, which is precisely
what `POST /command` used to do. See `docs/audit-perf-web.md`, lot E.

## The entry model

A ring of up to **1000** entries with a cursor (`entries[0..cursor-1]` are applied;
the rest are redoable). A fresh push truncates any redo tail. Text changes store the
before/after content inline; binary changes reference backup blobs. `kind` is `"process"`
iff the entry carries blobs — the client confirms before undoing one, because it restores
an audio file.

## On disk

Everything lives under `<project>/_history/` — `journal.json` plus `blobs/` — hidden by
`Workspace.skip()` exactly like `_recycle_bin`, so it never shows in the tree, moves the
revision token, or is itself diffed. Recorded paths are workspace-root-relative (what the
editor and the file API speak), so `ProjectHistory` stores under the project but resolves
paths against the root.

## The wire

`GET /history` peeks (enables the shortcuts and labels the toast). `POST /undo` and
`POST /redo` take `{ confirm? }`: a process step without `confirm` replies
`{ needsConfirm, files, label }` and does nothing; the client confirms and re-posts. The
reply names the files it reverted, which the client toasts and navigates the editor to.
Types are `@studio/web-protocol`'s `HistoryPeek` / `HistoryState` / `UndoResult`; the
client half is `@studio/project-shell/undo`.
