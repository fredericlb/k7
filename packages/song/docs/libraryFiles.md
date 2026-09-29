# A library's sound files — `samples/` and `irs/`

An account library holds more than modules: beside `modules/`, `chains/` and `assemblies/` it may
carry **`samples/`** and **`irs/`**, folders of sound files any song on the account can use.
`libraryFiles.ts` lists and resolves them; `LibraryFamily` names all five families.

## Shared files, where a module's `assets/` are its own

A module carries the files it loads, in its own `assets/` (`moduleAssets.md`) — a `.nam` model
belongs to the amp module that plays it. A cabinet IR does not belong to any one amp: the same
Deluxe Reverb cabinet goes after a Two-Rock and after a Super Reverb, and an IR copied into each amp
module that might use it is the same file in five places, drifting. So IRs, and samples for the same
reason, live once per library and are reached from anywhere.

This is what retired `@st0/audio/amps/guitar`: a module that existed only to carry files — the models
now sit in the NAM module's own `assets/`, the IRs in the library's `irs/`, and the pickers on the
NAM module's panel reach both.

## …and a PROJECT's own `samples/`, as `@project/<path>`

A song may keep a sound only it plays in its own `samples/`, named `@project/<path>` — the demos do,
since they are copied into every account's Examples and cannot rely on any library being there. The
resolution needs the project, so the loader hands its folder down (`resolveRackAudio`'s `projectDir`,
from `loadNodes` and from the shared-module read, both of which read FOR a project) and a ref read
with none resolves to nothing rather than guessing. The picker lists them first, before the
libraries'. Only samples, today: an IR is the libraries'.

## Named `@<library>/<path>`

A file is named the way a module is: `@st0/fender deluxe verb/DELUXE REVERB OXFORD - BIG.wav`, the
path under that library's `irs/`. The library's name is in it because two libraries may each have a
`fender deluxe verb/`, and because a song moves between machines: the name says where to look on
the next one, where an absolute path would say nothing. `libraryFile` refuses a path that climbs out
of the folder, since a ref is text a hand-edited file holds.

## Which params take one

`LIBRARY_FILE_PARAMS` (in `@studio/song-schema/moduleTypes`, so the browser's picker can filter by
it) maps a param to its family: today `ir` → `irs`. Such a param is set like any file-valued one —
`node param <node> ir "@st0/…"`, what the panel's picker runs — and is checked against
`libraryFiles`, the list the picker was shown. The loader resolves it to an absolute path on the
module (`ir`) while keeping the name it was written with (`assets.ir`), exactly as it does a `nam`.

The graph document carries these choices only to a node whose panel binds such a param
(`withLibraryChoices` in the file service): every step carrying every IR of every library would
make each graph the size of the library.

`samples/` is what a rack's taps play (`racks.md`): a tap's `sample` names one the same way, and a
rack's step carries the libraries' samples as its picker's choices, whatever its panel binds.

## Adding a sound is a drop

A file dropped on a library's `samples/` or `irs/` in the editor's Libraries tab is uploaded there —
the service's ordinary upload, whose path maps `_libraries/<name>/…` into the library's clone. The
tab takes a drop nowhere else, and only sound files: a library is a repository other songs read, and
a stray file in `modules/` is a module nobody meant to publish. `GET /module-libraries` lists each
library's two sound folders beside its modules so the tab can draw them.

Uploaded or moved, the files are not committed: a library is PUBLISHED, as a module save is.

The preview route plays files in those two folders too — it otherwise refuses anything outside the
workspace — so a tap auditions its sample like any clip.
