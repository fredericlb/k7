# A workspace file in either format

Any YAML file of a workspace may be written as a `.k7x` file of the same name instead
(`packages/k7x/docs/language.md`). `src/yaml/workspaceFile.ts` is what makes that true for every
reader and writer at once: the code goes on naming `project.yaml`, `nodes/lead.yaml`, and the file
on disk may be either. The plan this belongs to is [k7x-plan.md](../../../docs/k7x-plan.md).

## Code keeps the YAML name, the disk decides the format

`workspaceFile.ts` resolves a YAML-named path to its `.k7x` sibling when one exists, reads a
`.k7x` file as YAML text, and takes a YAML write as edits to it (`packages/k7x/docs/bridge.md`).
Every other path goes straight through, unchanged.

That is what spared rewriting the readers: some 350 reads, writes and existence checks across
song, song-edit, commands, take-render, audio-passes and k7-plugins, and some 290 `.yaml`
literals that build paths, all keep working by going through this one module. It also means a
writer cannot tell which format it wrote, which is the point: a k7x file stays a k7x file, with its
comments and its layout, through every command.

## The k7x door

`src/yaml/workspaceDoc.ts` is the other way in, for code that speaks k7x rather than YAML: it
takes a `.k7x` path named outright, never a YAML name to resolve, and refuses any other. A file is
read as its text (`wsText`) or its data (`wsData`), edited as a k7x document by key path
(`wsEdit`), or written whole, canonically from data (`wsWriteData`) or as text that must read
(`wsWriteText`). Every write is atomic and skipped when the text would not change.

- **An edit of a file with short forms sees their expanded data.** The edit runs on a scratch
  document of that data, and the result goes back over the real one by the same rule as the YAML
  bridge, `applySugared` (`packages/k7x/src/sugared.ts`, `packages/song-schema/docs/sugar.md`), so a
  writer never has to know that `notes("c4 d4")` is a string.
- **An absent file is an error unless the caller says `create`**: then it is an empty document, and
  is only written once the edit put something in it.

## The rules

- **`.k7x` wins.** A folder holding both `graph.yaml` and `graph.k7x` reads the k7x one. A folder
  half converted is still one project, never two answers.
- **A new file follows the deploy switch.** A write to a name with no file of either format creates
  the `.yaml` — or, once `STUDIO_K7X=1` says every device reads k7x, the `.k7x`, provided its text
  converts to the same data (a list at the root does not, and stays YAML). An existing YAML file
  is never converted by being written: that is the migration's job, with its backup.
- **Once YAML is retired, it is found by nothing.** `STUDIO_K7X=only` keeps everything `=1` does,
  and a lookup by name probes `.k7x` alone, a listing skips YAML files, and a new file is k7x or a
  refusal — written as YAML it would be a file no lookup finds. A folder whose project file is still
  YAML is then no project. Only the migration reads YAML, being what converts it.
- **A path named outright still reads, whatever the switch.** Retiring YAML stops its DISCOVERY, not
  the reading of a file the code names itself: the repository's `commands.yaml` and a machine's
  settings are YAML files read by name, and must go on reading. In a migrated workspace the only
  YAML left is what the migration refused, which no lookup finds.
- **Configuration read and written by name stays YAML.** A workspace's `_library-pins.yaml` and a
  library's `library.yaml` manifest are read by name and written atomically (a temporary file, then
  a rename) by code that owns them, so the migration leaves them as they are (`src/k7xMigrate.ts`).
- **A machine's own files are no workspace's.** `preferences.yaml` under the studio home is read and
  written with plain file calls, never through this module, so no switch ever turns it into k7x
  for the other processes that read it.
- **A copy or a rename keeps the format**: a `.k7x` node duplicated is a `.k7x` node.
- **A lookup returns the real path.** `moduleFileFor`, `entityFiles` and `nodeFiles` answer
  `nodes/lead.k7x` when that is the file, so a message names the file the person will open.
- **A folder listing filters on both extensions.** Where code lists a folder and keeps its YAML
  files, the test accepts `.k7x` as well.

## What stays on the real files

The undo journal, the live-sync capture and its relay read and write the files that changed on
disk, by their real names, and never through this module: they must restore exactly the bytes
that were there. A `.k7x` change travels as k7x path ops, diffed on the k7x text itself
(`packages/live-sync/docs/ops.md`).

## The /file route

The file service serves a `.k7x` path as written and writes it as given, which is what the editor
opens from the tree. A YAML name is served through this module: a screen that reads
`sequences/melody.yaml` gets YAML whichever format is on disk, and its write lands in the k7x file
as edits.

## Converting a folder

`src/k7xMigrate.ts` converts a folder's YAML files, and its rules are the safety of the whole move:

- **A file converts only when its k7x reads back to the same data.** Anything else — an anchor, a
  root that is not a map, a YAML error — stays YAML and is reported, never guessed at.
- **A YAML file beside a `.k7x` one is left alone**: the `.k7x` already wins, so touching the YAML
  could only lose something.
- **An original is moved, never deleted**: to the backup a caller names, under its own relative
  path. Only a folder in git (`demos/`, `k7-core/`) passes no backup, its history being one.

Two callers: `scripts/migrateK7x.ts` for the repository's folders, dry by default; and the file
service's `POST /migrate-k7x` for an account's workspace, which keeps the originals in the
workspace's hidden `.k7x-backup/<time>/` — never shown, never synced, never converted again.

**The route refuses a real run unless `STUDIO_K7X=1`.** A converted file reaches every
replica through the relay, and a desktop or phone on a build older than k7x cannot read it. Only
whoever deploys knows when every shipped build reads `.k7x`, so the switch is theirs; a dry run is
always allowed, to see what would happen.

## Known limits

- **A finding's line is computed from its key path.** A parser runs on the YAML view, so the
  module, graph, cue-sheet and chain loaders place each finding back on the k7x text by its path
  (`wsIssues`, `packages/song-schema/src/yaml/k7xIssues.ts`). A finding with no path has no line.
  The placing itself is `packages/song-schema/src/yaml/k7xPosition.ts`, which also takes zod's
  findings on a file's data directly, for a parser that reads k7x without the YAML view.
- **Entity links and the preview gutter read YAML only**: a `.k7x` file gets colours, completion
  and lint, not the click-through to a referenced file or the ▶ beside a sample.
- **Both spellings in one folder** list twice where code counts files, though only the k7x one is
  read.
