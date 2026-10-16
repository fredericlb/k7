# Picture, surfaces and other files

This page covers the remaining file kinds: surfaces, assemblies, a set's cue sheet,
presets, and the files inside a module folder. How to use them is explained in the Picture, DJ and
Chains sections; this is their field reference.

## Video lanes

A picture lane is `video_tracks/<lane>.yaml`: its rectangle in the viewport (`x`, `y`, `w`, `h`), its
`name`, `color` and `mute` (hidden), and its shots under `events:`. Every time in it is in **decimal
seconds**, not bars, and every lane must be listed in `project.yaml`'s `layers`. The full field
reference — shots, transitions, animation, titles — is in the Picture section.

## Surfaces

`surfaces/<name>.yaml` asks the editor to draw a special view. A project draws only what it declares:
remove `surfaces/timeline.yaml` and the song still plays, with no timeline on screen.

```yaml
type: turntables
layout: split
playlist: friday-set
stems: true
```

| Field | Type | Meaning |
|---|---|---|
| `type` | `timeline`, `viewport`, `turntables`, `mastering` | What to draw. |
| `layout` | `split`, `floating`, `view` | Where. Each type accepts only some layouts: `timeline`, `turntables` and `mastering` draw in `split`, `viewport` in `floating`. |
| `playlist` | text | `turntables` only: the playlist the desk's browser lists, by its name under `_playlists/`. |
| `stems` | true/false | `turntables` only: separate a record into stems when it goes on a deck. |
| `mapping` | map | Which module parameter each of the surface's controls drives. |

`mapping` is keyed by the control's id. Each value is `null` (not wired yet) or
`{ module, param, invert?, also? }`, where `invert: true` mirrors the control's range and `also` is a
second target with the same three fields. The controls a `turntables` desk offers are
`crossfade` and, per deck `A`/`B`, `deckA.tempo`, `.trim`, `.eqLow`, `.eqMid`, `.eqHigh`, `.filter`,
`.level`, `.echo`, `.stemDrums`, `.stemBass`, `.stemOther`, `.stemVocals`. A `mastering` surface
offers `comp.lowCut`, `comp.low`, `comp.mid`, `comp.high`, `comp.lowFreq`, `comp.highFreq`,
`spread.width`, `spread.bassMono`, `limiter.hfLimit`, `limiter.drive`, `limiter.ceiling`,
`limiter.release`, `limiter.output`. k7 writes the skeleton when it creates the surface.

## Assemblies

An assembly draws several nodes of the project as one box on the graph. It changes nothing in the
sound. `assemblies/<name>.yaml`:

```yaml
uses: "@k7-core/turntable"
members:
  platter: deckA
  eq: eqA
```

| Field | Type | Meaning |
|---|---|---|
| `uses` | reference, required | The assembly template in a library. |
| `members` | map, required | Template member name → this project's node name. |

The template is a library folder holding `assembly.yaml` beside an ordinary graph and nodes:

| Field | Type | Meaning |
|---|---|---|
| `label` | text | What the box is called; absent, the instance's name. |
| `inputs`, `outputs` | lists of plugs | Each `{ name, type: audio/midi/video, node, port?, mandatory? }`: a port on the box standing for a member's port. Two plugs on one side cannot share a name. |
| `params` | map of knob → `{ node, param }` | Member parameters promoted onto the box's face. |

## mix.yaml: the cue sheet

A set (`mix` project) keeps its cue points at the root in `mix.yaml`. The desk writes it when you drop
a cue.

```yaml
cues:
  - "@k7-core/songs/Artist/Album/Title"
  - ref: "@k7-core/songs/Other/Record/Track"
    markers: [12.5, null, 64.0]
```

| Field | Type | Meaning |
|---|---|---|
| `cues` | list | Songs this desk has cues for: a song reference, or `{ ref, markers }`. |
| `ref` | `@k7-core/songs/<path>` | A song in the media library. |
| `markers` | up to 8 entries, seconds or `null` | The cue buttons, in source seconds; `null` is an empty button. |

A duplicate song is dropped on read. An older `views/mix.yaml` file, mapping controls in the same
shape as a surface's `mapping`, is still read.

## Preset files

A preset is one file of values for one module, kept in a preset tree — the workspace's `_presets/`
or a library's `presets/` — at `<namespace>/<module path>/<name>.yaml`. The name is limited to
letters, digits, spaces, `_` and `-` (64 characters).

```yaml
# preset for @k7-core/audio/reverb
engine: tracktion
params:
  Room Size: 0.8
  Damping: 0.3
```

| Field | Type | Meaning |
|---|---|---|
| `engine` | text | The engine the values were taken on. |
| `base` | text | The named base they apply over. |
| `params` | map of name → number | The values. |
| `rack` | map of pad → `{ note, sample? }` | A kit; samples must be library samples, not a project's. |

## Module folder files

| File | Meaning |
|---|---|
| `module.yaml` | The module, fields as in [Node and module fields](./35-node-fields.md). |
| `ui.yaml` | Its panel, below. |
| `controller.yaml` | MIDI CC bindings: `<param>: { ch: 1–16, cc: 0–127 }`, one control per param. |
| `widgets.js` | Script drawing the panel's `lcdscreen` widgets. |
| `engines/<name>/` | One engine of the module, with its own `module.yaml` and `ui.yaml`. |
| `base/` | Named whole-state files (`.vstpreset`, `.fxp`) a `base:` picks. |
| `shaders/<name>/vertex.glsl`, `fragment.glsl` | A shader module's programs. |
| `config.yaml` (at the root of a modules folder) | `namespace: <name>` — what the folder's modules are referenced by. |

### ui.yaml

```yaml
cols: 4
rows: 2
widgets:
  cut: { type: knob, col: 0, row: 0, bind: "Filter Freq", min: 20, max: 20000, curve: log }
  lvl: { type: fader, col: 3, row: 0, rowSpan: 2, bind: Level }
tabs:
  - name: Env
    widgets:
      a: { type: knob, col: 0, row: 1, bind: Attack }
```

| Field | Meaning |
|---|---|
| `cols`, `rows` | The grid (the horizontal layout, at most 4 rows). |
| `widgets` | Widgets drawn on every tab, by id. |
| `tabs` | Pages: `{ name (≤ 10 characters, unique), widgets }`. |
| `vertical` | The narrow layout (at most 4 columns): `cols`, `rows`, `widgets`, `tabs` — with the same tab names in the same order. |

Widget fields: `type` (`label`, `knob`, `slider`, `fader`, `number`, `toggle`, `button`, `meter`,
`waveform`, `dropdown`, `filepicker`, `lcdscreen`, `tap`, `group`), `col`, `row`, `colSpan`,
`rowSpan`, `label`, `hidden`, `bind` (the parameter). Some fields belong to one type only, and are
refused on others: `min`/`max`/`step`/`curve` (`lin`/`log`) on knob, slider, fader and number; `text`
on label; `source` (`input`, `output`, `take`) on waveform; `options` (`{ label, value }` list) and
`library` on dropdown; `color` (`#rgb`, `#rrggbb`, `#rrggbbaa`) and `invert` on group; `pair` (the dry
parameter of a crossfade knob) on knob. A `filepicker` needs a `bind`; an `lcdscreen` takes none. A
rack pad binds `@rack:<symbol>`.
