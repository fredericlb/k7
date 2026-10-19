# Project and workspace layout

A k7 song is a folder of small text files. Every setting, lane, clip and chain is a file you can open
in the editor, read, and change by hand. This section is the reference for those files: where they
live, what each field means, and what k7 does when one is wrong.

The pages of this section:

| Page | What it covers |
|---|---|
| [Project and workspace layout](./30-project-folder.md) | The folders, the file kinds, how things are named |
| [Timecodes](./31-timecodes.md) | How positions and lengths are written |
| [Project and settings files](./32-project-settings.md) | `project`, `settings`, markers, archetypes |
| [Clips, sequences and curves](./33-material.md) | The material a lane plays, and automation curves |
| [Lanes and events](./34-lanes-events.md) | Lane files and every field of a placed event |
| [Node and module fields](./35-node-fields.md) | Everything a node or module file may say |
| [Chains and the graph](./36-chains-graph.md) | How signal is routed: chain files, `graph`, `layout` |
| [Picture, surfaces and other files](./37-picture-surfaces.md) | Video lanes, surfaces, assemblies, presets, panels |
| [Strudel pattern files](./38-strudel.md) | `algo/*.strudel` and generated lanes |
| [The k7x syntax and validation errors](./39-k7x-validation.md) | The `.k7x` text format, and what an error means |

## Every file is a `.k7x` file

Every file of a project is written in k7x, a Strudel-looking syntax: `tempo(120)`,
`events([ref("kick").start("1:1:1")])`. It is read, never run. When k7 writes a value into a file, it
changes that value only and keeps your comments and layout. A `.yaml` file in a project folder is not
read. See [The k7x syntax](./39-k7x-validation.md).

## The workspace

A **workspace** is one folder holding several projects plus the things they share. Its root looks
like this:

```text
my-workspace/
  first-song.k7/            a project (the folder name ends in .k7)
  second-song.k7/           another project
  _modules/                 the workspace's own modules — the @workspace level
  _presets/                 presets saved at workspace level
  _playlists/               set lists (one file each) a turntables desk can name
  _references/              finished mixes to listen against (audio files)
  _library-pins.k7x         which version of each library this workspace uses
  TODOS.md                  the workspace's task list
  _recycle_bin/             deleted entries, hidden from the tree
```

| Entry | What it is |
|---|---|
| `<name>.k7/` | A k7 project. The `.k7` suffix is what makes the folder a project k7 opens. A folder is a project when it holds a `project` file. |
| `_modules/` | Modules shared by every project of the workspace, organised by type folder (`instruments/synth/module.k7x`, `audio/...`). A node names them `@workspace/<type>/<name>`. A new project creates `_modules/instruments/synth/` the first time, and never overwrites it afterwards. |
| `_presets/` | Presets kept at workspace level, one file per preset: `_presets/<namespace>/<module path>/<name>.k7x`. See [Picture, surfaces and other files](./37-picture-surfaces.md#preset-files). |
| `_playlists/` | One playlist per file. A `turntables` surface names one by its name. Covered in the DJ & sets section. |
| `_references/` | Reference tracks: `.wav .flac .mp3 .m4a .aac .ogg .opus .aif .aiff .webm`. The extension is the whole rule; there is no sidecar. Covered in the DJ & sets section. |
| `_library-pins.k7x` | A map `library name: version` (a positive number, or `draft`). A library the file does not name is used at version 1. |
| `TODOS.md` | A Markdown checklist: `- [ ] text`, done when `- [x] text`, optionally ending with `` `<project> @ <timecode>` `` to point at a place in a song. |
| `_recycle_bin/` | Deleting a file or folder in k7 moves it here, so a delete can be undone. Hidden from the tree. |
| `_libraries/<name>/` | Shown in the file tree but not on disk in your workspace: the account's libraries (`@k7-core` and any other), read-only unless you are an admin editing a library draft. |

Names starting with a dot, `node_modules`, `_recycle_bin`, `_history` and files ending in `.cache`
(waveform sidecars the engine writes next to audio files) are never shown in the tree.

## The project folder

A new project is created from an archetype (see [Project and settings files](./32-project-settings.md#archetypes)).
An `arrangement` project looks like this once created:

```text
first-song.k7/
  project.k7x               tempo, metre, name, markers…
  settings.k7x              metronome and count-in
  chains/                   one file per chain: the signal routing
    <chain>.k7x
    …
  tracks/                   one file per audio lane: its events
    melody.k7x
    pad.k7x
    kit.k7x
    live.k7x
  sequences/                MIDI material, one file each
    melody.k7x
  clips/                    audio and video material: one .k7x per clip, beside its media file
  curves/                   automation curves
  algo/                     Strudel pattern files
    pattern.strudel
  surfaces/                 the special views this project asks for
    timeline.k7x
  vstpresets/               plugin state saved by k7 (binary, one per node)   — once needed
  assets/                   files a node's params name (models, IRs…)        — once needed
  layout.k7x                where the cards sit on the graph (cosmetic)      — once a card is moved
```

### Every folder and root file

| Path | Kind | Reference |
|---|---|---|
| `project.k7x` | The song's settings, track order, markers | [Project and settings files](./32-project-settings.md) |
| `settings.k7x` | Metronome, its level, count-in | [Project and settings files](./32-project-settings.md#settingsk7x) |
| `chains/<name>.k7x` | One chain: its steps and where its signal goes | [Chains and the graph](./36-chains-graph.md) |
| `tracks/<lane>.k7x` | An audio/MIDI lane: what it extends, its events | [Lanes and events](./34-lanes-events.md) |
| `video_tracks/<lane>.k7x` | A picture lane: its rectangle and shots | [Picture, surfaces and other files](./37-picture-surfaces.md#video-lanes) |
| `clips/<id>.k7x` | An audio or video clip: which file, which window | [Clips, sequences and curves](./33-material.md#clips) |
| `sequences/<id>.k7x` | A MIDI sequence: its notes | [Clips, sequences and curves](./33-material.md#sequences) |
| `curves/<id>.k7x` | An automation curve | [Clips, sequences and curves](./33-material.md#curves) |
| `algo/<name>.strudel` | A Strudel pattern played by generated lanes | [Strudel pattern files](./38-strudel.md) |
| `surfaces/<name>.k7x` | A view the project asks the editor to draw | [Picture, surfaces and other files](./37-picture-surfaces.md#surfaces) |
| `assemblies/<name>.k7x` | Which nodes are drawn as one box | [Picture, surfaces and other files](./37-picture-surfaces.md#assemblies) |
| `layout.k7x` | Card positions on the graph | [Chains and the graph](./36-chains-graph.md#layoutk7x) |
| `vstpresets/<id>.vstpreset` | A plugin's opaque state, saved by k7 | written by k7, not by hand |
| `assets/` | Files that a node's file-valued params name | [Node and module fields](./35-node-fields.md#file-valued-params) |
| `samples/` | Sound files a Strudel pattern or a rack can name (`@project/kick.wav`) | [Strudel pattern files](./38-strudel.md) |
| `mix.k7x` | A set's cue sheet (mix projects) | [Picture, surfaces and other files](./37-picture-surfaces.md#mixk7x-the-cue-sheet) |
| `graph.k7x`, `nodes/` | The other project layout, described below | [Chains and the graph](./36-chains-graph.md#the-graph-layout-graphk7x-and-nodes) |
| `stems/` | Separated stems written beside a source file | written by k7 |
| `_history/` | The project's undo journal | hidden, written by k7 |

### Two project layouts

A project's routing is written in one of two layouts. k7 reads both.

- **Chain layout** — a `chains/` folder. Each chain is a file listing its steps in order; a lane's
  events live in `tracks/`. This is what new `arrangement`, `video` and `live` projects use.
- **Graph layout** — a `graph.k7x` file listing, for each node, where its signal goes next, and a
  flat `nodes/` folder with one file per node (lanes included). New `mix` (set) projects use this
  layout, and so do the bundled demo projects.

The presence of a `chains/` folder decides: a project with one is read from it, and its
`graph.k7x` (if any) is ignored.

## Names and references

**A file's name is its id.** `clips/kick.k7x` is the clip `kick`; `sequences/melody.k7x` is the
sequence `melody`; `tracks/pad.k7x` is the lane `pad`. A file never states its own id, which is why
one file can never declare two things. Rename the file and you rename the thing.

Other files point at things by name or by **reference**. A reference starts with a namespace:

| Reference | Resolves to |
|---|---|
| `@meta/<name>` | A module built into k7: `@meta/track`, `@meta/strudel-track`, `@meta/group-track`, `@meta/doc`, `@meta/IN`, `@meta/audio/mixer`, `@meta/audio/recorder`… |
| `@workspace/<type>/<name>` | A module in the workspace's `_modules/` folder |
| `@k7-core/<type>/<name>` | A module in the shared `k7-core` library (other libraries answer to their own name, `@<library>/…`) |
| `@account/<type>/<name>` | Your account's own library: copies of library modules you have forked |
| `@engine/<slug>` | A plugin the engine has scanned on the machine, by its slug (`@engine/neural-amp-modeler`) |
| `@project/<file>` | A file in this project's own `samples/` folder (rack taps) |
| `@meta/curves/<id>` | A curve of this project (the bare id `<id>` works too) |

Built-in signal ends are written in capitals and are not files: `MIX`, `OUT`, `RENDER`,
`VIDEO_OUT`, `CUE`. See [Chains and the graph](./36-chains-graph.md#built-in-ends).

## Comments

Every file can carry comments: `// …` and `/* … */`. k7 keeps them when it
edits a value, so a file is also the place to write down why a setting is what it is.
