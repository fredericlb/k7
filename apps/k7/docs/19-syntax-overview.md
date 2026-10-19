# How a song is written

A song is a folder of k7x files. One entity per file, and **the filename is the id** — `clips/kick.k7x` declares the clip `kick`; there is no `name:` inside repeating it. That is what makes a rename nothing more than moving a file.

Files are **flat**: no wrapper key, no package clause. A node file starts at `extends(…)`, a clip file at `source(…)`.

**Timecodes are strings, and k7 always writes them quoted** — `"1:1:1:1"`, **bar:beat:eighth:sixteenth**, one-based, with anything finer than a sixteenth written after a dot as a count of ticks (960 to the beat): `"3:2:1:2.120"`. Trailing levels at their origin are left off, so `"2:1"` is the top of bar 2. A timecode is a string like any other, so it is quoted: an unquoted `25:1` does not parse, and `start(25)` is a number the schema refuses. Beats inside a sequence are plain numbers, and a clip's `from`/`to` may be either: material that answers to the tempo is in beats, material that answers to the clock is in seconds. Picture is entirely the second kind — a shot is placed in seconds and no tempo can move it — which is why its lanes live in `video_tracks/` and read nothing from the lines above. See the Video page.

A string is always quoted, so nothing is read as something else: a track called `no` is a track called `no`, and `monitor("on")` is the word `on`.

**Every file is validated on load** against a schema (`packages/song-schema/src/yaml`), and the editor's completions come from those same schemas — what it offers you is what the loader will accept.

Unknown fields are an **error**, not a shrug: a typo in a key would otherwise be a setting that silently never applies. `settings.k7x` is the one deliberate exception.

References between files are by **id**, never by path — a track's `ref: kick` finds `clips/kick.k7x`, a module's `extends` names a module, an automation's `curve` names a curve.
