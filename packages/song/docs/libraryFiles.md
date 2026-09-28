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

`samples/` has no param yet. The folder exists so a library can hold them, and the listing and the
resolution already take the family; a sampler's pick is the next consumer.
