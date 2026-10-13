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
song, song-edit, commands, take-render, audio-passes and st0-plugins, and some 290 `.yaml`
literals that build paths, all keep working by going through this one module. It also means a
writer cannot tell which format it wrote, which is the point: a k7x file stays a k7x file, with its
comments and its layout, through every command.

## The rules

- **`.k7x` wins.** A folder holding both `graph.yaml` and `graph.k7x` reads the k7x one. A folder
  half converted is still one project, never two answers.
- **A new file is YAML.** A write to a name with no file of either format creates the `.yaml`. New
  files start as k7x only when YAML is retired (phase 7 of the plan).
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

## Known limits

- **A validation message's line is the YAML view's.** A module or graph refused by its schema
  names the right file and a line counted in the YAML `toYaml` produced, not in the k7x text.
- **The editor shows a `.k7x` file as plain text**: no highlighting, no completion, no lint yet
  (phase 5).
- **Both spellings in one folder** list twice where code counts files, though only the k7x one is
  read.
