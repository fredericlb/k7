# How a song is written

A song is a folder of YAML. One entity per file, and **the filename is the id** — `clips/kick.yaml` declares the clip `kick`; there is no `name:` inside repeating it. That is what makes a rename a `git mv`.

Files are **flat**: no wrapper key, no package clause. A track file starts at `type:`, a clip file at `source:`.

**Timecodes are strings, and pistes always writes them quoted** — `"1:1:1"`, bars:beats:ticks, one-based. Files are read as **YAML 1.2**, where `25:1` is already a string, so unquoted parses correctly here. The quoting is for everyone else: under YAML **1.1** the same bytes are a sexagesimal number, and `start: 25:1` silently becomes beat 1501. Quoted, every version agrees — so nothing this app writes is left bare. Beats inside a sequence are plain numbers, and video is in seconds: material that answers to the tempo is in beats, material that answers to the clock is in seconds.

The same choice covers the other 1.1 traps: `on`, `no` and `y` stay strings rather than becoming booleans, and a leading zero is not octal — so a track called `no` is a track called `no`.

**Every file is validated on load** against a schema (`song/src/yaml`), and the editor's completions come from those same schemas — what it offers you is what the loader will accept.

Unknown fields are an **error**, not a shrug: a typo in a key would otherwise be a setting that silently never applies. `settings.yaml` is the one deliberate exception.

References between files are by **id**, never by path — a track's `ref: kick` finds `clips/kick.yaml`, a module's `extends` names a module, an automation's `curve` names a curve.
