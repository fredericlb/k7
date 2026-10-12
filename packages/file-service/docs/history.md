# The undo/redo journal

`history.ts` is a per-project journal that makes Ctrl+Z / Ctrl+Y in st0 undo
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

The TEXT side has the same hazard and answers it differently, because there is no callback to be
the authority: the two images come from `textOf`, which keeps each file's content against its
`(size, mtime)`. A same-size rewrite inside one file-time tick — `v1` → `v2`, a knob from `0.5` to
`0.7` — reproduces that key, and the "after" image would then be the "before" one: the two diff to
nothing and the edit is journalled nowhere. So a file whose mtime has not SETTLED is re-read and
never kept, the rule `@studio/song`'s caches follow and the window they share
(`packages/song/docs/moduleCache.md`).

It answers a `Recorded<T>` rather than the mutation's own value: whatever `mutate` returned, plus
the **revision token either side**. That is not the journal's business and it is nonetheless the
right place for it — `recordChange` is the one thing that brackets a write, and it has to cross
the tree twice to diff it, so naming both instants costs it a filter over a list it already
holds. Its caller would otherwise walk twice more to learn the same two facts. See
`docs/audit-perf-web.md`, lot E.

## The entry model

A ring of up to **1000** entries with a cursor (`entries[0..cursor-1]` are applied;
the rest are redoable). A fresh push truncates any redo tail. Text changes store the
before/after content inline; binary changes reference backup blobs. `kind` is `"process"`
iff the entry carries blobs — the client confirms before undoing one, because it restores
an audio file.

`GET /history/entries` lists the journal for st0's History panel — every entry's label, time and
PATHS, never its contents, with `undone` past the cursor — and `GET /history/commits` the commits
that touched the project folder (`src/projectCommits.ts`), both with paths relative to the project
so the panel reads one kind of path. The commit list stops at 200: it is a list, not a git client.

**An applied undo or redo pushes the project to the engine**, as `PUT /file` does after a write
(`src/routes/files.ts`). A step rewrites the open project's files outside any verb, and a verb's
reload is the only other thing that tells the engine: without the push, an event restored by
Ctrl+Z is back on disk and on screen and stays silent until the next unrelated edit.

## Not in the project: the account's cache

The journal is the session's, not the song's. Kept in the project, it is a ring of up to a thousand
entries, audio included, that a clone without the right `.gitignore` commits and pushes with the
song. So it lives in the account's state, never in a workspace:

- **The journal** — `journal.json`, with every text change inline — is in
  `<studioHome>/.history/<project>-<hash>/` (`historyStoreFor`; `HISTORY_HOME_DIR`). On the server
  that is `$STUDIO_FILES_ROOT/<account>/.history`, on st0's `/workspaces` volume beside `workspace/`. The name
  is the project folder's, for a reader; the hash is of its path, so two projects of one name do
  not share one. A project moved or renamed starts an empty journal.
- **Forgotten after a month unused.** The hub sweeps every account's `.history` hourly
  (`packages/file-hub/staleCaches.ts`) and deletes a journal no edit, undo or redo has rewritten in
  30 days — and, in a live one, any blob older than that. An undo past a purged blob fails like
  one whose engine is gone (below).

Recorded paths stay workspace-root-relative (what the editor and the file API speak), and resolve
against the root. A `_history/` folder inside a project is still hidden by `Workspace.skip()`;
nothing writes one.

## The audio is kept by the ENGINE

A blob is the audio a process step overwrote or created — the big part of the journal, and the
part only the engine's machine produced. It is **kept by the engine that was bound** when the step
was recorded, not by the server:

- **Kept.** `push` writes the blob in the journal's `blobs/`, records the engine
  (`keptOn: { id, name }`, from the binding — `boundEngine()`), and asks that machine to take it:
  a `prefetch` job naming the file, which the tunnel downloads before the machine answers
  (`historyKeeper.ts`). Once the machine holds every blob of the step, the copy here is deleted.
  Until then — or if it never takes them — the copy here is what an undo uses.
- **Fetched back.** An undo or redo that needs a blob no longer here asks the SAME engine for it:
  a `send-up` job naming it, which the machine answers by naming its copy, so the tunnel uploads
  it. The copy fetched is deleted again once written over the project; the engine keeps its own.
- **Another engine: an error, and nothing written.** When the engine bound now is not the one that
  keeps the step's audio, the undo FAILS with a message naming that engine, before any file is
  written — text and audio of a step go back together or not at all. Text steps above it still
  undo; it is the step needing the audio where Ctrl+Z stops, until that engine is bound again.
  The same holds when the engine no longer has the file.
- **A month on the machine too.** The supervisor deletes a kept file a month after it was last
  kept or sent back (`purgeKeptHistory`, `engine/st0-supervisor/src/MachineJobs.cpp`): sending it
  back stamps it, so a step still undone and redone stays.
- **No engine bound** — an import with no machine, a test — keeps the blob here, under the same
  month.

Undo and redo run one at a time per project, since each may wait on the machine and both move the
cursor.

## The wire

`GET /history` peeks (enables the shortcuts and labels the toast). `POST /undo` and
`POST /redo` take `{ confirm? }`: a process step without `confirm` replies
`{ needsConfirm, files, label }` and does nothing; the client confirms and re-posts. The
reply names the files it reverted, which the client toasts and navigates the editor to.
Types are `@studio/web-protocol`'s `HistoryPeek` / `HistoryState` / `UndoResult`; the
client half is `@studio/project-shell/undo`.
