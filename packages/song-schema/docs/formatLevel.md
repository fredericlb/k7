# The project format level

`src/formatLevel.ts` holds `FORMAT_LEVEL`, the project format this build reads and writes. A
project root file declares the level it was written at — `format: 2` in YAML, `format(2)` in k7x —
and a build meeting a level above its own refuses the project with one message: *this project was
written by a newer k7 (format N); this k7 reads format M — update k7 to open it*.

## The rule

Any change an older build would reject or misread bumps `FORMAT_LEVEL`, in the same commit: a new
key, a new enum value, a narrowed meaning of an existing value, a k7x syntax the older parser does
not know. From that commit on, the writers stamp the new level into the root file they write.

Absent means level 1. Every project that exists is level 1, and a new project is written without
the key, so an old file and a new one read the same until the first bump.

## Where the level lives: the project root file

The level is per project, in `project.yaml` / `project.k7x`, rather than in a marker at the
workspace root:

- the root file is what the compile reads first, and what refuses to compile is what must say why;
- live-sync replicates edits as operations on files, so the key reaches every replica the same way
  as the edit that needed it;
- a share carries a project, not a workspace;
- a workspace mixes projects of different ages, and one newer project must not lock out the rest;
- a workspace marker would be a second file that can disagree with the projects, and one the
  compile does not read.

## Read on the raw text, before any parse

`formatLevelOfText` finds the level with a line match on the text as it is on disk, before YAML or
k7x parses it. A newer build may introduce syntax this one cannot parse; a parse error there would
show a syntax error where the answer is "update k7". After the parse, the parsed `format` is checked
once more, for a level written in a form the line match does not see.

## `.strict()` stays

The schemas keep refusing unknown keys. A typo at the current level is still caught, and a file of a
higher level never reaches the schema, so nothing needs relaxing for forward compatibility.

## Every read refuses, not only the validating one

`loadProjectRoot` refuses a newer project whether or not it was asked to validate. A non-validating
read answers `{}` for a root that fails its schema, and a writer acting on that empty root would
rewrite a newer file with what this build understood of it. The command layer refuses every verb on
such a project for the same reason, since several verbs write the root without reading it first.

The editor's check (`validateFile`) answers the same message as the one issue of a project root
file, so the autosave holds the buffer back with the reason rather than a schema error.

## On the wire

The file service answers a document route's failure with `code: "format-too-new"`, `fileLevel`
and `buildLevel` beside `error`, and `/project-errors` carries `formatTooNew`. The frontend renders
its own translated message from those levels (`project.formatTooNew`), not the server's English.

## The media library has its own marker

The media library is one volume shared by every account, so its version lives in its root marker,
`mediatek.yaml` — `packages/mediatek/docs/index.md`.
