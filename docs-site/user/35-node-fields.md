# Node and module fields

A **module** is a reusable definition — a plugin with its settings and its panel — kept in a library
or in the workspace's `_modules/`. A **node** is one use of a module in a project: it `extends` the
module and states only what it changes. Lanes are nodes too (see [Lanes and events](./34-lanes-events.md)).
Modules, libraries and the panel editor are covered in the Chains and modules section; this page is
the field reference both kinds of file share.

Where a node is written depends on the project layout:

- **Chain layout**: a node is an item in a chain's `steps`, written inline with an `id`
  (see [Chains and the graph](./36-chains-graph.md)).
- **Graph layout**: a node is a file `nodes/<name>.yaml`; the file name is the node's name.
- A **module** is a folder holding `module.yaml` (and usually `ui.yaml`), under a type folder:
  `_modules/audio/reverb/module.yaml` is `@workspace/audio/reverb`.

```yaml
# nodes/lead.yaml — one use of the workspace synth, brighter than the default
extends: "@workspace/instruments/synth"
params:
  "Filter Freq": 90
```

```yaml
# _modules/instruments/synth/module.yaml
plugin:
  type: internal
  name: 4osc
```

Every key is checked: an unknown key (a typo such as `paramz:`) is refused rather than ignored.

## Inheritance

`extends` names the module this one is built on. Chains of `extends` are followed to the end, and the
merge goes from the deepest ancestor to the node, the nearer file winning **per key**:

- `params` merge key by key: a node setting one knob keeps all the others.
- `rack.symbols` and `ui.widgets` merge entry by entry.
- `engines` merge per engine, then per param inside each.
- Everything else — including every **list**, such as `automations` or `events` — is replaced
  whole. An empty list (`automations: []`) is how a node drops what it inherited.

A node's `extends` must resolve, or the project refuses to load with
`module 'x': extends unknown module '…'`.

## Field reference

### What it is

| Field | Type | Meaning |
|---|---|---|
| `extends` | reference | The module this one builds on. See [references](./30-project-folder.md#names-and-references). |
| `plugin` | map: `type`, `name`, any other key | The plugin. `type` is the format — `internal` for a Tracktion built-in (`name: 4osc`), `vst3`, and the other formats the engine scans — and `name` its name. Further keys are passed to the engine as-is. `type: offline` and `type: not_supported` are special markers. |
| `type` | `plugin`, `rack`, `video_effect`, `video_transition`, `shader`, `shape` | What kind of module. Defaults to `plugin` when the file says neither `type`, `io` nor `extends`. |
| `io` | `in`, `out`, `file`, `camera`, `midi`, `video_out` | An input/output module instead of a plugin. `in`, `file`, `camera` and `midi` are sources. |
| `inputs`, `outputs` | lists of `{ name, type, mandatory? }` | The module's own ports, overriding its type folder's defaults. `type` is `audio`, `midi` or `video`; `mandatory` applies to inputs. |
| `status` | `listed`, `favorite`, `hidden` | How completions treat the module. Default `listed`. |
| `content` | text | A note shown on the graph (for nodes of `@meta/doc`). |

### Values

| Field | Type | Meaning |
|---|---|---|
| `params` | map of name → number (or text for a file-valued param) | Plugin parameter values. Names are the plugin's own (`"Filter Freq"`); quote names with spaces. |
| `base` | text | A named starting state from the module's `base/` folder (a `.vstpreset` or `.fxp`, optionally in a subfolder: `Pads/Bell Pad`). `params` apply on top of it. |
| `engine` | text | Which of the module's `engines/` sub-folders this runs as. Default: `tracktion` if the module has it, else the first. |
| `engines` | map of engine → `{ params }` | Values set per engine, so switching back finds the knobs as they were. |
| `alternatives` | list | Other complete sets of fields for this node; each takes the same fields as a module plus `name` and `extends`. |
| `alternative` | name or number ≥ 1 | Which set is on. `1` is the node's own fields; a name wins over a number; an unknown value falls back to `1`. An alternative with its own `extends` replaces the module, except on a lane or a mixer strip. |

### Levels and mix

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mix` | number 0–1 | `1` (all wet) | The engine's dry/wet around this effect. |
| `input_volume` | number, −60 to 12 dB | `0` | Level into the module. |
| `output_volume` | number, −60 to 12 dB | `0` | Level out of the module. |

### Inputs and sources (io modules)

| Field | Type | Applies to | Meaning |
|---|---|---|---|
| `channel` | a label, `[n]` or `[left, right]` | `io: in` | Which interface input: a label from the machine's preferences, or one or two channel numbers. |
| `gain` | number (dB) | `io: in` | Input trim at the interface. |
| `monitor` | true/false, or `off`, `auto`, `on` | `io: in` | Whether you hear the input while it plays. |
| `source` | text | `io: file` | The audio file, project-relative. |
| `camera` | text | `io: camera` | Which camera, by the label you see in the browser. |
| `frame` | `[x, y, w, h]` in px | `io: camera` | Where in the viewport it draws. Absent: the whole frame. |
| `device` | text | `io: midi` | Which MIDI device to record from, by label. Empty or absent: any device. |

### Racks and kits

| Field | Type | Meaning |
|---|---|---|
| `rack` | map | A sampler kit. `rack_type: samples` (default) with `symbols`, or `rack_type: slice` with a `source` and `symbols` each carrying `from`/`to`. |
| `rack.symbols.<name>` | `{ note, sample?, clip?, from?, to?, mute? }` | One pad: the MIDI `note` (0–127) it answers to, and a `sample` (`@<library>/…` or `@project/<file>`), or a clip and window. `mute` keeps the pad but silences it. A pad with no sample plays nothing. |
| `kit` | map of pad name → note | The pads of an SFZ drum kit, drawn as taps. |
| `tap_outs` | map of pad name → subchain id | Pads that leave by an output of their own, each feeding a subchain of the node's chain. |

```yaml
type: rack
extends: "@workspace/instruments/drumrack"
rack:
  symbols:
    BD: { note: 36, sample: "@project/kick.wav" }
    SN: { note: 38, sample: "@project/snare.wav" }
```

### Picture modules

| Field | Type | Meaning |
|---|---|---|
| `shader` | folder name | Which shader in the module's `shaders/` folder this node runs. |
| `shape` | `square`, `circle`, `text` | What a shape module draws; its geometry is in `params`. |
| `font` | text | A `text` shape's CSS font family. Its string is `content`. |

### Automation

```yaml
automations:
  - { param: "Filter Freq", curve: sweep }
  - { param: Level, curve: "@meta/curves/env", trigger: lead }
```

| Field | Type | Meaning |
|---|---|---|
| `automations[].param` | text | The parameter driven. |
| `automations[].curve` | text | A curve id of the project (`sweep` or `@meta/curves/sweep`). |
| `automations[].trigger` | node name | The node whose note-ons restart the curve (for `adsr` curves and `event` conditions). |

### Processing and state

| Field | Type | Meaning |
|---|---|---|
| `cold` | true/false | The module needs its whole input before producing any output; it runs as an offline pass. |
| `frozen` | text | Frozen at this module: a render stands in for everything upstream. Written by k7. |
| `model_url` | `http(s)://…` | Where to download the model a file-valued param names when this machine lacks it. |
| `disabled` | true/false | Left out of the render. |
| `ui` | panel | An inline panel; normally the panel is the module's `ui.yaml` (see [Picture, surfaces and other files](./37-picture-surfaces.md#module-folder-files)). |

### Lane fields

`events`, `color`, `tracks`, `strudel`, `video_source` are accepted on any module and are what make
a lane; see [Lanes and events](./34-lanes-events.md).

## File-valued params

A few parameters take a file rather than a number: `model` and `onnx` (neural models; `model` takes
`.nam` or `.json`), and `ir` (an impulse response from a library's `irs/` folder, written
`@<library>/<path>`). `model` may also name a file in a library's `models/` folder. A node's own files
live in the project's `assets/` folder.

## Chain-only node keys

In a chain file a node item also carries:

| Key | Meaning |
|---|---|
| `id` | The node's identifier, required. k7 generates one. |
| `bypass` | `true` to pass the signal through untouched (on a lane: mute). |
| `vstpreset` | The file in `vstpresets/` holding this node's plugin state. Default `<id>.vstpreset`. |
| `mapping` | Accepted on a node item. |
