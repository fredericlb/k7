# A workspace file is a .k7x file

Every file of a workspace is k7x (`packages/k7x/docs/language.md`): no `.yaml` file of a workspace is
read, listed or written. The plan this belongs to is [k7x-plan.md](../../../docs/k7x-plan.md).

## Two modules, two jobs

- **`src/yaml/workspaceFile.ts` is plain I/O.** `wsRead` and `wsWrite` take and give a file's text as
  it is on disk, atomically for a write, and convert nothing. They stay for the code that holds a
  file's text rather than its data — the file service's `/file` route, a copy, a rename.
- **`src/yaml/workspaceDoc.ts` is the k7x door.** It takes a `.k7x` path named outright and refuses
  any other. A file is read as its text (`wsText`) or its data (`wsData`), edited as a k7x document by
  key path (`wsEdit`), or written whole, canonically from data (`wsWriteData`) or as text that must
  read (`wsWriteText`). Every write is atomic and skipped when the text would not change.

## The rules

- **An edit of a file with short forms sees their expanded data.** The edit runs on a scratch
  document of that data, and the result goes back over the real one by `applySugared`
  (`packages/k7x/src/sugared.ts`, `packages/song-schema/docs/sugar.md`), so a writer never has to know
  that `notes("c4 d4")` is a string. A writer that keeps a short form itself — the graph's `runs(...)`
  — edits the raw document instead.
- **An absent file is an error unless the caller says `create`**: then it is an empty document, and
  is only written once the edit put something in it.
- **A finding carries the line of the k7x text.** Each parser validates the file's data and places
  zod's findings back on the text by key path (`packages/song-schema/src/yaml/k7xPosition.ts`); a
  syntax error is one finding with its own line and column (`packages/song-schema/src/yaml/k7xIssues.ts`).
- **A library's pins and manifest are workspace files too**: `_library-pins.k7x` and `library.k7x`.
  A legacy `.yaml` one still on disk is upgraded once by whoever owns that file's I/O — read, written
  as k7x, the `.yaml` removed (`src/sharedFolders.ts`, `src/namespaceMigrate.ts`).
- **What is not a workspace file stays YAML.** The media library's own store on its volume, a
  machine's `preferences.yaml` under the studio home, the repository's `commands.yaml` and `env.yaml`
  are read and written by name with plain file calls, never through either module.

## What stays on the real files

The undo journal, the live-sync capture and its relay read and write the files that changed on
disk, by their real names: they must restore exactly the bytes that were there. A change travels as
k7x path ops, diffed on the k7x text itself (`packages/live-sync/docs/ops.md`).

## Known limits

- **A finding with no path has no line**, since the line is computed from the key path.
- **Entity links and the preview gutter** give a `.k7x` file colours, completion and lint, not the
  click-through to a referenced file or the play button beside a sample.
