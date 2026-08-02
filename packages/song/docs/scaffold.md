# scaffold.ts — extended notes

The shared core behind the web command bar's `new project <type> <name>` (the file
service scaffolds at the workspace root). Lives in `@studio/song` because the bundled
sample video the `video` variant copies is a `@studio/song` asset.

A scaffolded project is minimal, valid, and immediately playable: one MIDI track (a
rising C-major scale) through a built-in 4OSC synth to OUT, plus a live Strudel pattern.
Every file carries its mandatory params, so the project loads and plays as-is and
doubles as a worked example to edit. `video` adds picture on top of that same audio
example: a viewport, a bundled sample clip, and two video tracks (a full-frame
background and a picture-in-picture) — demonstrating compositing and the seconds-based
video timeline.

Every file here is authored by hand rather than serialised from an object, because the
COMMENTS are the point: a new project is the one worked example a reader gets, and the
explanation has to sit next to the field it explains. (Those `#`-prefixed lines inside
the template strings are the SCAFFOLDED FILES' own comments — they ship to the user's
disk verbatim and are not TypeScript comments; they're deliberately left in full.)
