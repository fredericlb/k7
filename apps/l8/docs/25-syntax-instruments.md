# Instruments

## modules/<type>/<name>/module.yaml

A module — its own folder named for the module (the folder IS the name; there's no `name:`), holding module.yaml: a flat struct with no `package` clause. Its kind + input port come from the type folder (io / instruments / audio / transformers). It carries a plugin (or io, or a rack) inline; the control grid it draws on the graph is a separate file in the same folder, ui.yaml (below). A <name>.vstpreset in the folder overrides state.

```yaml schema=Module
# modules/instruments/synth/module.yaml — a midi→audio instrument
plugin:
  type: internal
  name: 4osc
# params:
#   Filter Freq: 69
#   nam: "jcm800.nam"      # a file the module carries, in its own assets/ folder

# modules/io/OUT/module.yaml — the stereo-output sink
io: out
```

### A note on the graph

A **doc module** is a note: one input, no output, and one field — `content`, free multiline text
drawn on the node exactly as you write it. Wire it from whatever it is about, and it says so
where you are already looking.

Every note is a **node of `@studio/doc`**, which is built in: there is no module file to
create, so a note costs one file — its node.

```yaml schema=Module
# nodes/notes-amp.yaml — one note
extends: "@studio/doc"
content: |
  Le NAM tire fort : -6 dB avant,
  sinon ça écrête sur les attaques.
```

…then wire it in `chains.yaml`, like anything else:

```
modules:
  ampli: [ reverb, notes-amp ]
```

Notes are **hidden by default** and shown by the note button in the footer, beside the mixer —
they sit in the signal path, so drawing them always would put prose in the middle of the thing
you are trying to read.

> This replaced the `docs:` and `todos:` fields modules and tracks used to carry, and the Docs
> panel that was their only reader. A file carrying one of them will no longer open: move the
> prose into a `#` comment, or into a note if it is about the signal.

An `io: in` module is a live interface input instead. It carries `channel:` — a channel number, a pair for a stereo input, or one of the labels from your preferences — plus two optional settings for what the input does before anything else sees it. It names no track: an input lands on the track at the head of the run it sits in, so one module can be shared by every project in a workspace. See [Chains](#syntax-chains).

`monitor:` says whether you hear it. Write `true` or `false` for the everyday answer; the three-state spelling (`off` / `auto` / `on`) is there because **auto** — the default — is neither: it means audible only once the track is armed.

`gain:` is an input trim in dB, `0` being unity. A guitar into a line input usually wants some; a hot synth wants less. It is applied at the interface, so it lands ahead of every module in the chain — and, like the monitor mode, it belongs to the physical input: two tracks on one input share it.

```yaml schema=Module
# _modules/io/IN/in-1.yaml — a node of the IN module: one physical input
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
params:
  nam: "Two-Rock/overdrive.nam"   # a file in this module's own assets/ folder
  Normalize: 1     # 0 turns it off and leaves the profile at its trained level
  Input: 3         # hit it 3 dB harder
  Output: -1.5
```

## modules/<type>/<name>/module.yaml — jsdsp: a module whose DSP is written in JS

A module of type `jsdsp` gets its audio from a **description** rather than from code compiled into the engine. There is nothing to name: the type says the DSP is in **`jsdsp.ts`, in the module's own folder**, and that is the whole rule. A module is a directory you can copy, clone or share, and the source travels with it.

(It used to be a `jsdsp:` field naming the file, beside a `plugin: {type: internal, name: DSP Graph}` that said nothing about it — two things that had to agree, and the interesting one was the one nobody read.)

The file default-exports a function taking a graph builder. It imports nothing at runtime — the builder arrives as the argument — so a song folder needs no `node_modules`:

```ts
// modules/audio/wah/jsdsp.ts
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
# modules/audio/wah/module.yaml — beside jsdsp.ts
plugin:
  type: jsdsp
params:
  Depth: 3
```

The parameters come from the description, so two modules with different sources are two different-looking devices of the same plugin type — knobs, dropdowns and drag-to-bind all work without the engine knowing anything about them.

The source is **run**, in a child process, and the result cached as a sibling `.json` regenerated only when the source is newer. A first compile after an edit costs ~200 ms of Node startup; every one after that is a file read. That `.json` is worth committing: it is what actually ran, it diffs, and a checkout without Node still plays the song. Nothing here is fatal — a source that throws leaves the last good build in place, and failing that the module falls back to the plugin's default graph and the engine says so.

Nodes run in four phases per block: `envelope` follows the input per sample; `todb`/`lerp`/`linmap`/`geolerp`/`clamp`/`select`/arithmetic/`glide` are once-per-block scalar maths; `biquad`/`gain`/`mix` transform the audio a block at a time; and `ain`/`aout`/`adelay`/`alfo`/`amul`/`aadd`/`atanh` run in a per-sample loop, where reading a wire written later in the list yields the previous sample — the unit delay a feedback loop is built on.

## modules/<type>/<name>/module.yaml — more than one input

The type folder gives a module its ports: one audio in for `audio/`, one midi in for `instruments/`. That makes the folder decide how many cables a module takes, which is not what a folder is for — a crossfade is an audio effect like any other and needs **two** audio inputs. A module can name its own instead, with `inputs:` and `outputs:`. Declare neither and the folder's defaults apply, which is every module written so far; the two lists are independent, so you can name your inputs and inherit your outputs.

`mandatory` is an input's business — an output is offered, never required — and defaults to true, so a port you bothered to name has to be fed unless you say otherwise. A crossfade's second input is exactly the case for `mandatory: false`: wiring one side and leaving the other silent is a legitimate state, not a half-built chain.

```yaml schema=Module
# modules/audio/crossfade/module.yaml — two audio inputs, one output
plugin: { type: jsdsp }
inputs:
  - { name: a, type: audio }
  - { name: b, type: audio, mandatory: false }
outputs:
  - { name: out, type: audio }
params:
  Mix: 0.5
```

A chain carries one signal, so the second input has to arrive from somewhere else: a destination names the port it lands on, `crossfade#b`. See [Chains](#syntax-chains). In the DSP source the ports are read by index, in the order declared — `g.input(0)` is `a`, `g.input(1)` is `b`.

On the graph each port is a socket on the node's edge. Mandatory ones are drawn from the start; past those, one free socket appears beyond the last one you have wired, so a module offers its next input without presenting a row of empty holes.

## modules/<type>/<name>/module.yaml — a COLD module

`cold: true` says the module only works on audio **already on disk**. Not "expensive": a cold module run live would not be slow, it would be *wrong*, because the answer does not exist yet. Normalisation is the plain case — the gain depends on the loudest sample, and the loudest sample may be the last one, so nothing can be produced until the whole input has been read.

Adding one to a chain whose signal does not come from a file input (`io: file`) is refused, with a message saying so, before anything is written. That is why they belong in the médiathèque's chain templates, which run over a song's master file, rather than in a live project chain.

```yaml schema=Module
# modules/audio/normalize/module.yaml — bring the peak to Target
cold: true
plugin: { type: jsdsp, name: Normalize }
params:
  Target: -1   # dBFS, 1 dB of headroom
  Peak: 0      # measured by the cold pass; 0 until it has run, so the module only attenuates
```

## modules/<type>/<name>/module.yaml — extends another module

A module can inherit from another with `extends: "type/name"` (or "@ns/type/name" for one it inherits — from the médiathèque, or the workspace's `_modules`). It gets the base's plugin/params/ui/rack, overriding per key. Several modules can extend one base.

```yaml schema=Module
# modules/instruments/synth/module.yaml extends a shared base
extends: instruments/fourosc
params:
  Filter Freq: 69   # override just this one
```

## nodes/<name>.yaml — one use of a module

A project's USES of its modules live in a flat `nodes/` folder at its root, and the FILENAME names the node: a chain says `lead`, not the module it came from. The file is the same flat shape as module.yaml, says which module it uses with `extends:`, and states only what it changes. Each node keeps its own params and its own `nodes/<name>.vstpreset`, so tweaking one leaves the module and every other use alone. Merge order: extended base → the module → the node. To add one: right-click a module in the file tree → "New node…", or run `node new instruments/synth lead`.

The folder is flat on purpose — a node does not mirror the folders of the thing it uses, so a use of a médiathèque module needs no local folder for it.

```yaml exempt="shows several files at once (two nodes and the chain that uses them) - not one document"
# nodes/lead.yaml — state only what this use changes
extends: "@project/instruments/synth"
params:
  Filter Freq: 90

# nodes/pad.yaml
extends: "@project/instruments/synth"
params:
  Filter Freq: 40

# chains.yaml — the module and both uses are separate nodes. Pointing both
# lanes at the bare `synth` would NOT give each its own: a module is named once,
# so one name is one plugin, and the two lanes would sum into it.
modules:
  melody: [ lead ]
  pad: [ synth-pad ]
  lead: [ OUT ]
  synth-pad: [ OUT ]
```

## ALTERNATIVES — a module's other sets of settings

A module can hold several sets of attributes and run one of them. A clean amp and a crunchy one,
the mix you had yesterday and the one you are trying, two takes of a lane's arrangement — they
live side by side in the same file, and switching between them is one line.

**The module's own fields are the first set.** The others go under `alternatives:`, and
`alternative:` says which is on — by name, or by position when it has none. Leave `alternative:`
out and the module runs its own fields, which is why a file that never uses this keeps exactly
the shape it always had.

An alternative may set **any field a module has** — `params`, `plugin`, `ui`, a lane's `clips` —
and it states only what it CHANGES. The merge is the one a node already gets over the module
it extends: `params` merge key by key, so a set that touches `Gain` leaves `Tone` alone, while a
list replaces outright. `extends` is folded first, so the chosen set always wins.

Names are optional. An unnamed one answers to its number, counting the module's own fields as 1 —
so the first entry under `alternatives:` is "2". A name wins over a number. A name that matches
nothing falls back to the first rather than silencing the module.

The **⋮ button** on a node's top-right corner lists them, switches, and starts another — empty or
as a copy of the one that is on. It lights up while a set other than the module's own is running,
because a node on a variant otherwise looks exactly like one on its own settings. From the command
bar: `module alternative select|create|copy <module> [name]`, and a bare `select` lists them.

This is not a **preset**. A preset (`presets.yaml`) is a starting point you stamp into the
module's params — numeric, shared by every use, and gone as a thing once applied. An alternative
is a state you switch between: both survive, one is on, and it belongs to the one module that
holds it.

```yaml schema=Module
extends: "@project/audio/amp"
params: { Gain: 3, Tone: 5 }
alternative: crunch          # absent = the fields above
alternatives:
  - name: crunch
    params: { Gain: 9 }      # Tone stays at 5 — a set says only what it changes
  - name: clean
    params: { Gain: 1 }
    plugin: { type: vst3, name: Twin }   # any field, not just params
```

## FREEZING — one render standing in for everything upstream

Freeze a module and everything the signal passed through to get there is bounced to one wav and
plays as that wav: those lanes stop playing their clips, those modules stop being built, and the
render becomes the material. **The module itself is included** — freezing an amp gives you the
amped sound, not the sound going into it — and everything **downstream stays live**, which is the
whole difference between freezing and bouncing.

The **⋮ button** on a node's corner freezes and unfreezes; from the command bar it is
`module freeze <module>`, the same line both ways. What it writes is `frozen:`, naming the render
it made, and the badge on the node is a snowflake: cold blue on the point, and on every node the
render already contains.

It is **refused** when something upstream also feeds a node outside the set — that signal would be
in the render *and* still playing, heard twice at a level nothing on screen explains. The message
says where to freeze instead: the point the two paths meet.

The render is a generated file (`renders/<module>.wav`). Delete it and the song simply plays live
again, which is what makes a project safe to clone without it.

```yaml schema=Module
extends: "@project/audio/amp"
params: { Gain: 3 }
frozen: renders/amp.wav      # written by `module freeze amp`; delete it and it plays live
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

## modules/<type>/<name>/ui.yaml — a module's panel

The control grid a module draws on its graph node, in a file of its own **beside module.yaml**, in the module's own folder. It says nothing about which module it draws, because the folder already does: move the module and its face moves, copy it and the face is copied. A module folder's other .yaml files are its nodes — ui.yaml is the one name that is neither the generic nor a node.

cols/rows is the layout; each widget sits on a cell and binds a plugin parameter by name. Drag a parameter from the module editor's Parameters pane onto a widget to bind it — the range and the label come with it. knob/slider/fader/number carry min/max; dropdown carries the named settings of a discrete parameter; waveform draws a live tap; label draws fixed text and binds nothing.

`filepicker` is the odd one: it picks a FILE the module carries rather than a number. `bind` names a file-valued parameter (`nam`), and that one word decides everything — the key written, and which files are offered, since a parameter is named after the format it loads. Clicking it opens a searchable tree of the module's `assets/`, its own and those of every module it extends, so a thin module that inherits a shared amp offers that amp's profiles.

`fader` is the mixer strip's control: vertical, with the value read out above it, and it fills whatever height its `rowSpan` gives it — so its throw is something you author rather than a fixed bar. Give it the rows to be worth using (the editor starts it at 3); one cell tall it is only a worse slider. Its drag sweeps the range over its own height, so the cap stays under the pointer. On a track's chain it also carries that track's VU beside the throw — the same signal, span and colours as the Mix panel's meter, because it is the same strip. A chain that is not a track (a bus, a disabled lane) has no one level to show, and the fader simply has no meter.

```yaml schema=UiFile
# modules/instruments/mini/ui.yaml
cols: 4
rows: 2
widgets:
  w1: { type: knob, col: 0, row: 0, bind: Cutoff, min: 0, max: 135, label: Cutoff }
  w2: { type: dropdown, col: 1, row: 0, bind: "Filter Type",
        options: [ { label: Low, value: 0 }, { label: High, value: 1 } ] }
  w3: { type: waveform, col: 2, row: 0, colSpan: 2, rowSpan: 2, source: output }
  w4: { type: fader, col: 3, row: 0, rowSpan: 6, bind: Volume, min: -60, max: 6, label: Vol }
```

A panel used to be a `ui:` block inside `module.yaml`. It moved into its own file so a rebuilt `_modules/` never takes hand-drawn work with it, and so a plugin every song reaches for is drawn once: a panel is saved where its module is, shared library included, and that is the one edit a shared module accepts without being forked. A plugin the engine merely reports has no folder anywhere, so it has no panel until somebody makes it a module. `ui migrate` moves the blocks still written inline. An inline `ui:` is still read, and a ui.yaml replaces it whole.

## modules/<type>/<name>/module.yaml — automations:

Bind a curve to a parameter. `curve` names a curves/<id>.yaml; `param` is the parameter's display name — the same name a widget binds and `module param` addresses. A curve's polarity decides whether it sweeps the parameter's whole range or rides ± around where the knob sits.

```yaml schema=Module
automations:
  - { param: "Filter Freq", curve: sweep }
  - { param: Level, curve: wobble }
```

## _modules/config.yaml

A SHARED module library — a folder of modules outside any one song, referenced as @<namespace>/<type>/<category>/<name>. This one file declares the namespace; everything under it is addressable by it. `l8 populate` fills such a folder from the engine's plugin scan, filing each plugin under its declared category.

```yaml schema=ModuleConfig
namespace: engine

# then, e.g.:
#   _modules/audio/amp/neural-amp-modeler/module.yaml
# referenced from a song as:
#   extends: "@engine/audio/amp/neural-amp-modeler"
```
