# Faust modules' sound files

A Faust program declares a SLOT — `soundfile("Table", 1)` — and the node fills it. The library's
`instruments/synth/wavetable` is the reason this exists: a table of single-cycle frames, read at the
note and morphed by a knob.

## The slot is filled by a STRING param of the same name

```k7x
extends("@k7-core/instruments/synth/wavetable")
params({ Table: "@k7-core/basic.wav", Position: 0.4 })
```

A Faust knob is always a number, so a string param on a Faust module can only be a file, and that
is the whole rule — no list of file-valued names to keep in step with the programs, which name their
slots freely. `faustFilesOf` (`faustFiles.ts`) turns every string param into an absolute path and the
compile sends the map as `faustFiles`; `numericParams` already keeps strings off the knobs.

A ref resolves the way a library file does (`docs/libraryFiles.md`): `@<library>/…` in that library's
`wavetables/`, then its `samples/`; `@project/…` in the project's own `wavetables/` or `samples/`;
anything else is a path under the project. One that resolves nowhere is passed through unchanged, so
the engine's warning names exactly what the node said. One that leaves the project's roots — an
absolute path elsewhere, a `..` out — fills no slot at all (`confine.md`).

## `wavetables/`, a library family of its own

Next to `samples/`, `irs/` and `models/`: single-cycle frames of 2048 samples end to end, any number
of them, the format most free wavetable packs ship. A family of its own rather than a folder inside
`samples/`, because a picker bound to a table should offer tables — a drum hit is a sample and plays
as noise there. A panel picks one with a `dropdown` carrying `library: wavetables` — drawn as a file
button, and the one widget the panel schema lets name a family; the bind is the program's slot name,
not a known param, so the family has to be said. The picker filters its list by that family too
(`assetsForParam`'s `family`): left to the param's name, `Table` would ask for `.table` files.

## Setting one by hand

`node param <node> Table "@k7-core/basic.wav"` — on a Faust node a non-numeric value IS a sound file, and
a library ref is checked against what the picker would offer (`packages/commands/docs/verbs.md`).
