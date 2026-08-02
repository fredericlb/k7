# Instruments

## modules/<type>/<name>/module.yaml

A module — its own folder named for the module (the folder IS the name; there's no `name:`), holding module.yaml: a flat struct with no `package` clause. Its kind + input port come from the type folder (io / instruments / audio / transformers). It carries a plugin (or io, or a rack) inline; the control grid it draws on the graph is a separate file in the workspace's `_ui/` (below). A <name>.vstpreset in the folder overrides state.

```yaml schema=Module
# modules/instruments/synth/module.yaml — a midi→audio instrument
plugin:
  type: internal
  name: 4osc
# ir: "ir/marshall.wav"    # an asset from a libraries_from folder (a cabinet IR)
# nam: "nam/jcm800.nam"    # …or a Neural Amp Modeler profile
# docs: "the lead voice"
# todos: ["try a longer release"]
# params:
#   Filter Freq: 69

# modules/io/OUT/module.yaml — the stereo-output sink
io: out
```

An `io: in` module is a live interface input instead. It carries `channel:` — a channel number, a pair for a stereo input, or one of the labels from your preferences — plus two optional settings for what the input does before anything else sees it. It names no track: an input lands on the track at the head of the run it sits in, so one module can be shared by every project in a workspace. See [Chains](#syntax-chains).

`monitor:` says whether you hear it. Write `true` or `false` for the everyday answer; the three-state spelling (`off` / `auto` / `on`) is there because **auto** — the default — is neither: it means audible only once the track is armed.

`gain:` is an input trim in dB, `0` being unity. A guitar into a line input usually wants some; a hot synth wants less. It is applied at the interface, so it lands ahead of every module in the chain — and, like the monitor mode, it belongs to the physical input: two tracks on one input share it.

```yaml schema=Module
# _modules/io/IN/in-1.yaml — an instance of the IN module: one physical input
channel: [1]
monitor: true    # hear it whether or not the track is armed
gain: 6          # …and trim it 6 dB on the way in
```

## modules/<type>/<name>/module.yaml — a NAM amp and its level

A `.nam` profile is trained at whatever level its author played at, and it records that level in the file. Nothing makes two profiles agree, so a model can play back several dB below what went in — which sounds like the amp doing nothing at all. The Neural Amp Modeler module carries three parameters for this. `Normalize` (off/on, **on** by default) levels the profile to a fixed reference using its declared loudness, so swapping one amp for another stops being a volume change; `Input` and `Output` are ±20 dB trims around it. `Input` is a tone control as much as a level one — how hard you hit a modelled amp is half of what it sounds like. A profile that declares no loudness gives `Normalize` nothing to work from, and the module shows a warning saying so.

```yaml schema=Module
# modules/audio/amp/module.yaml — a Neural Amp Modeler with its levels set
plugin:
  type: internal
  name: Neural Amp Modeler
nam: "nam/Two-Rock/overdrive.nam"
params:
  Normalize: 1     # 0 turns it off and leaves the profile at its trained level
  Input: 3         # hit it 3 dB harder
  Output: -1.5
```

## modules/<type>/<name>/module.yaml — jsdsp: a module whose DSP is written in JS

A module using the `DSP Graph` plugin gets its audio from a **description** rather than from code compiled into the engine, and `jsdsp:` names the JS/TS file that produces it. That file lives **in the module's own folder**, named as a bare filename — a module is a directory you can copy, clone or share, and a path pointing outside it would break the moment you did.

The file default-exports a function taking a graph builder. It imports nothing at runtime — the builder arrives as the argument — so a song folder needs no `node_modules`:

```ts
// modules/audio/wah/wah.ts
import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const rate = g.param("Rate", { min: 0.05, max: 10, default: 2 });
  const depth = g.param("Depth", { min: 0, max: 8, default: 4 });
  const centre = g.param("Centre", { min: 0.5, max: 12, default: 5 });
  const dry = g.input();
  const time = g.aadd(g.amul(g.lfo("sine", rate), depth), centre);
  g.output(g.aadd(dry, g.delay(dry, time, 20)));
};
```

```yaml schema=Module
# modules/audio/wah/module.yaml — beside wah.ts
plugin:
  type: internal
  name: DSP Graph
jsdsp: wah.ts
params:
  Depth: 3
```

The parameters come from the description, so two modules with different sources are two different-looking devices of the same plugin type — knobs, dropdowns and drag-to-bind all work without the engine knowing anything about them.

The source is **run**, in a child process, and the result cached as a sibling `.json` regenerated only when the source is newer. A first compile after an edit costs ~200 ms of Node startup; every one after that is a file read. That `.json` is worth committing: it is what actually ran, it diffs, and a checkout without Node still plays the song. Nothing here is fatal — a source that throws leaves the last good build in place, and failing that the module falls back to the plugin's default graph and the engine says so.

Nodes run in four phases per block: `envelope` follows the input per sample; `todb`/`lerp`/`linmap`/`geolerp`/`clamp`/`select`/arithmetic/`glide` are once-per-block scalar maths; `biquad`/`gain`/`mix` transform the audio a block at a time; and `ain`/`aout`/`adelay`/`alfo`/`amul`/`aadd`/`atanh` run in a per-sample loop, where reading a wire written later in the list yields the previous sample — the unit delay a feedback loop is built on.

## modules/<type>/<name>/module.yaml — extends another module

A module can inherit from another with `extends: "type/name"` (or "@ns/type/name" for one pulled in via project.modules_from). It gets the base's plugin/params/ui/rack, overriding per key. Several modules can extend one base.

```yaml schema=Module
# modules/instruments/synth/module.yaml extends a shared base
extends: instruments/fourosc
params:
  Filter Freq: 69   # override just this one
```

## modules/<type>/<name>/<instance>.yaml — an instance of a module

Beside module.yaml, a module's folder can hold one file per INSTANCE — the same flat shape, inheriting module.yaml automatically (the folder is the parent; there's no `extends` to write). A chain uses one as "<name>:<instance>", and the generic stays usable too. Each instance keeps its own params and its own <instance>.vstpreset, so tweaking one leaves the generic and its siblings alone. Merge order: extended base → module.yaml → instance. To add one: right-click the module's folder in the file tree → "New instance…", or run `module instance new instruments/synth lead`.

```yaml exempt="shows several files at once (the generic, two instances, the chain that uses them) - not one document"
# modules/instruments/synth/lead.yaml — state only what this instance changes
params:
  Filter Freq: 90

# modules/instruments/synth/pad.yaml
params:
  Filter Freq: 40

# chains.yaml — the generic and both instances are separate nodes. Pointing both
# tracks at the bare `synth` would NOT give each its own: a module is named once,
# so one name is one plugin, and the two lanes would sum into it.
tracks:
  melody: [ synth:lead ]
  pad: [ synth:pad ]
modules:
  synth:lead: [ OUT ]
  synth:pad: [ OUT ]
```

## modules/instruments/<name>/module.yaml — rack (drum kit)

A rack instrument (type: "rack") — a note→audio sampler, not a plugin. Two kinds. samples: each symbol names its OWN clip; a base can ship defaults and a module that extends it merges its symbols OVER them per symbol. slice: one shared source cut into [from, to) windows in seconds. Audio sits in the module's folder.

```yaml exempt="shows both rack kinds side by side - not one document"
# samples base — modules/instruments/drumrack/module.yaml
type: rack
rack:
  symbols:
    BD: { note: 36, clip: kick.wav }   # the base's default sound

# a module extends + overrides — modules/instruments/kit/module.yaml (the folder names it)
extends: instruments/drumrack
type: rack
rack:
  symbols:
    SN: { note: 38, clip: snare.wav }
    HH: { note: 42, clip: hat.wav }

# slice rack — one source, each symbol a window (seconds) into it
type: rack
rack:
  rack_type: slice
  source: loop.wav
  symbols:
    LO: { note: 60, from: 0.0, to: 0.5 }
    HI: { note: 62, from: 0.5, to: 1.0 }
```

## _ui/<type>/<sub>.yaml — a module's panel

The control grid a module draws on its graph node, in a file of its own at the **workspace root**, beside `_modules/`. `ref:` names the module it draws — `@<namespace>/<type>/<sub>` for a shared one, `<type>/<name>` for a project's own. That ref is the key: the file's path only mirrors `_modules/` so the tree is recognisable, and a panel can be moved or renamed without losing its module.

cols/rows is the layout; each widget sits on a cell and binds a plugin parameter by name. Drag a parameter from the module editor's Parameters pane onto a widget to bind it — the range and the label come with it. knob/slider/fader/number carry min/max; dropdown carries the named settings of a discrete parameter; waveform draws a live tap; label draws fixed text and binds nothing.

`fader` is the mixer strip's control: vertical, with the value read out above it, and it fills whatever height its `rowSpan` gives it — so its throw is something you author rather than a fixed bar. Give it the rows to be worth using (the editor starts it at 3); one cell tall it is only a worse slider. Its drag sweeps the range over its own height, so the cap stays under the pointer. On a track's chain it also carries that track's VU beside the throw — the same signal, span and colours as the Mix panel's meter, because it is the same strip. A chain that is not a track (a bus, a disabled lane) has no one level to show, and the fader simply has no meter.

```yaml schema=UiFile
ref: "@engine/instruments/mini_v3"
cols: 4
rows: 2
widgets:
  w1: { type: knob, col: 0, row: 0, bind: Cutoff, min: 0, max: 135, label: Cutoff }
  w2: { type: dropdown, col: 1, row: 0, bind: "Filter Type",
        options: [ { label: Low, value: 0 }, { label: High, value: 1 } ] }
  w3: { type: waveform, col: 2, row: 0, colSpan: 2, rowSpan: 2, source: output }
  w4: { type: fader, col: 3, row: 0, rowSpan: 6, bind: Volume, min: -60, max: 6, label: Vol }
```

A panel used to be a `ui:` block inside `module.yaml`. It moved out so a rebuilt `_modules/` never took hand-drawn work with it, and so a plugin every song reaches for is drawn once — which is what lets an `@engine` module, which has no file at all, still have a face. `ui migrate` moves the ones still written inline. An inline `ui:` is still read, and a panel in `_ui` replaces it whole.

## modules/<type>/<name>/module.yaml — automations:

Bind a curve to a parameter. `curve` names a curves/<id>.yaml; `param` is the parameter's display name — the same name a widget binds and `module param` addresses. A curve's polarity decides whether it sweeps the parameter's whole range or rides ± around where the knob sits.

```yaml schema=Module
automations:
  - { param: "Filter Freq", curve: sweep }
  - { param: Level, curve: wobble }
```

## _modules/config.yaml

A SHARED module library — a folder of modules outside any one song, referenced as @<namespace>/<type>/<category>/<name>. This one file declares the namespace; everything under it is addressable by it. `lanes populate` fills such a folder from the engine's plugin scan, filing each plugin under its declared category.

```yaml schema=ModuleConfig
namespace: engine

# then, e.g.:
#   _modules/audio/amp/neural-amp-modeler/module.yaml
# referenced from a song as:
#   extends: "@engine/audio/amp/neural-amp-modeler"
```
