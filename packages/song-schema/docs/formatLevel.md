# The project format level

`src/formatLevel.ts` holds `FORMAT_LEVEL`, the project format this build reads and writes. A
project root file declares the level it was written at — `format(2)` —
and a build meeting a level above its own refuses the project with one message: *this project was
written by a newer k7 (format N); this k7 reads format M — update k7 to open it*.

## The rule

Any change an older build would reject or misread bumps `FORMAT_LEVEL`, in the same commit: a new
key, a new enum value, a narrowed meaning of an existing value, a k7x syntax the older parser does
not know.

**A project is stamped with a level when it starts USING what needs it, never before.** A project
that holds nothing a level-1 build refuses stays at level 1 and opens everywhere, so an installed
tray or phone app keeps opening every song that does not need the update. Stamping every project a
new build writes would lock those builds out of songs they read perfectly.

Absent means level 1, and a new project is written without the key.

## The levels

| level | what needs it | stamped by |
|---|---|---|
| 1 | — | — |
| 2 | an event `start` written in SECONDS, a number where level 1 takes only a timecode ([timecode.md](timecode.md)) | `@studio/song`'s `formatStamp.ts`: a lane or timeline written through the file service, `events add`, and every project open |

The stamp is best-effort, like the video run a viewport gains at open: a root that will not read
is left alone, and the next write or open tries again. The open is what catches a file that arrived
another way — by the sync relay, or edited outside k7. A level is never lowered: removing the last
seconds start leaves `format(2)`, since a level says what the file MAY hold, and lowering it would
need every lane read on every write.

## Where the level lives: the project root file

The level is per project, in `project.k7x`, rather than in a marker at the
workspace root:

- the root file is what the compile reads first, and what refuses to compile is what must say why;
- live-sync replicates edits as operations on files, so the key reaches every replica the same way
  as the edit that needed it;
- a share carries a project, not a workspace;
- a workspace mixes projects of different ages, and one newer project must not lock out the rest;
- a workspace marker would be a second file that can disagree with the projects, and one the
  compile does not read.

## Read on the raw text, before any parse

`formatLevelOfText` finds the level with a line match on the text as it is on disk, before k7x
parses it. A newer build may introduce syntax this one cannot parse; a parse error there would
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
