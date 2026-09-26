# Instruments

## _modules/<type>/<name>/module.yaml

A module — its own folder named for the module (the folder IS the name; there's no `name:`), holding module.yaml: a flat struct with no `package` clause. Its kind + input port come from the type folder (instruments / audio / transformers). It carries a plugin (or a rack) inline; the control grid it draws on the graph is a separate file in the same folder, ui.yaml (below). A <name>.vstpreset in the folder overrides state.

```yaml schema=Module
# _modules/instruments/synth/module.yaml — a midi→audio instrument
plugin:
  type: internal
  name: 4osc
# params:
#   Filter Freq: 69
#   nam: "jcm800.nam"      # a file the module carries, in its own assets/ folder
```

`OUT` is the interface — a built-in name, not a module: list it as a destination and it is
there, no file anywhere. `MIX`, `CUE`, and on a project with a viewport `RENDER` and
`VIDEO_OUT`, are the same.

### A note on the graph

A **doc module** is a note: one input, no output, and one field — `content`, free multiline text
drawn on the node exactly as you write it. Wire it from whatever it is about, and it says so
where you are already looking.

Every note is a **node of `@meta/doc`**, which is built in: there is no module file to
create, so a note costs one file — its node.

```yaml schema=Module
# nodes/notes-amp.yaml — one note
extends: "@meta/doc"
content: |
  The NAM pulls hard: -6 dB before it,
  or it clips on the attacks.
```

…then wire it in `graph.yaml`, like anything else:

```
modules:
  ampli: [ reverb, notes-amp ]
```

Notes are **hidden by default** and shown by the note button in the footer, beside the mixer —
they sit in the signal path, so drawing them always would put prose in the middle of the thing
you are trying to read.

> There is no `docs:` and no `todos:` field on a module or a track, and no Docs panel to read
> one: a file carrying either does not open. Move the prose into a `#` comment, or into a note
> if it is about the signal.

A live interface input is a NODE, not a module — this song's own wiring, never shared with
another project (`node new io/IN <name>` makes one). It carries `io: in` and `channel:` — a
channel number, a pair for a stereo input, or one of the labels from your preferences — plus two
optional settings for what the input does before anything else sees it. It names no track: an
input lands on the track at the head of the run it sits in. See [Chains](#syntax-chains).

`monitor:` says whether you hear it. Write `true` or `false` for the everyday answer; the three-state spelling (`off` / `auto` / `on`) is there because **auto** — the default — is neither: it means audible only once the track is armed.

`gain:` is an input trim in dB, `0` being unity. A guitar into a line input usually wants some; a hot synth wants less. It is applied at the interface, so it lands ahead of every module in the chain — and, like the monitor mode, it belongs to the physical input: two tracks on one input share it.

```yaml schema=Module
# nodes/in-1.yaml — one physical input, this song's own
io: in
channel: [1]
monitor: true    # hear it whether or not the track is armed
gain: 6          # …and trim it 6 dB on the way in
```

An `io: camera` module is a live **picture** source — a webcam. It carries `camera:`, the name of the camera as your machine reports it, and nothing else. Wire it to a picture lane and that lane draws the lens instead of its shots; the lane keeps its rectangle in the viewport, its `mute`, and any effects over it.

Written by NAME and not by a device id on purpose: an id is different in every browser and changes on its own, so a project carrying one would show a black rectangle on the next machine. A camera this machine has not got falls back to the default one and says which ones it does have. Leave `camera:` out and you get whichever camera your machine calls default, which is what a new node does.

The card on the chains graph lists the cameras your browser can see, so the ordinary way to set this is to pick one there rather than to type it.

A camera needs **no picture lane at all**. On its own it draws a layer of its own, filling the frame, and nothing has to be listed in `layers:` — the document authors no lane, which is the point. Give it a `frame:` to place it instead: `[x, y, w, h]` in viewport pixels, so two cameras can sit side by side. Wire it to a picture lane instead and that lane draws the lens, keeping its own rectangle and its effects.

```yaml schema=Module
# nodes/cam.yaml — a webcam. Put it in graph.yaml and it draws itself.
extends: "@meta/CAM"
camera: "Logitech BRIO"   # leave it out for whichever is default
frame: [40, 40, 320, 180] # …and leave THIS out to fill the frame
```

> An export leaves a camera out. A render walks the timeline frame by frame, and a live picture has no frame at a given moment — what it would record is whatever the lens happened to be showing while the encoder ran.

## _modules/<type>/<name>/module.yaml — a NAM amp and its level

A `.nam` profile is trained at whatever level its author played at, and it records that level in the file. Nothing makes two profiles agree, so a model can play back several dB below what went in — which sounds like the amp doing nothing at all. The Neural Amp Modeler module carries three parameters for this. `Normalize` (off/on, **on** by default) levels the profile to a fixed reference using its declared loudness, so swapping one amp for another stops being a volume change; `Input` and `Output` are ±20 dB trims around it. `Input` is a tone control as much as a level one — how hard you hit a modelled amp is half of what it sounds like. A profile that declares no loudness gives `Normalize` nothing to work from, and the module shows a warning saying so.

```yaml schema=Module
# _modules/audio/amp/module.yaml — a Neural Amp Modeler with its levels set
plugin:
  type: internal
  name: Neural Amp Modeler
params:
  nam: "Two-Rock/overdrive.nam"   # a file in this module's own assets/ folder
  Normalize: 1     # 0 turns it off and leaves the profile at its trained level
  Input: 3         # hit it 3 dB harder
  Output: -1.5
```

## _modules/<type>/<name>/module.yaml — the eurorack modules

Eight modules come with the engine, built from the open-source firmware of Mutable Instruments' eurorack modules, by Émilie Gillet (MIT licence). There is nothing to install, and they play the same everywhere the engine runs, the phone included. Each carries a descriptive name rather than the original's, as its author asks of derivatives:

| name | what it is | plays |
|---|---|---|
| `Macro Oscillator 2` | 24 synthesis models: analog, FM, wavetable, chords, speech, strings, drums… | notes, 8 voices |
| `Macro Oscillator` | its predecessor: 47 shapes, with bit and sample-rate reduction | notes, 8 voices, an envelope each |
| `Resonator` | modal and string resonators, and a hidden string synth | notes strum it; the track's audio excites it |
| `Modal Synthesizer` | a bow, a breath and a mallet on a resonator, with its reverb | notes, one at a time; the track's audio excites it too |
| `Tidal Modulator` | a sculpted slope at audio rate, spread over four outputs | notes, 8 voices, an envelope each |
| `Drum Voices` | kick, snare, hi-hat and an FM drum | the General MIDI drum notes; the FM drum on every other note |
| `Texture Synthesizer` | grains, stretches, loops and spectral freezes of the track's audio | an effect; a note fires a grain |
| `Meta Modulator` | cross-modulation and a vocoder between two signals | an effect: the track modulates; the carrier is its own oscillator, played by notes, or the track wired to its second input |

A menu parameter (`Model`, `Shape`, `Mode`…) takes the position of its entry, from 0, as its value.

```yaml schema=Module
# _modules/instruments/bells/module.yaml — the modal resonator model, struck
plugin:
  type: internal
  name: Macro Oscillator 2
params:
  Model: 20          # Modal resonator
  Harmonics: 0.3
  Timbre: 0.7
  Decay: 0.8
  Envelope: 1        # ping: struck, and left to ring
```

## _modules/<type>/<name>/module.yaml — jsdsp: a module whose DSP is written in JS

A module of type `jsdsp` gets its audio from a **description** rather than from code compiled into the engine. There is nothing to name: the type says the DSP is in **`jsdsp.ts`, in the module's own folder**, and that is the whole rule. A module is a directory you can copy, clone or share, and the source travels with it.

The file default-exports a function taking a graph builder. It imports nothing at runtime — the builder arrives as the argument — so a song folder needs no `node_modules`:

```ts
// _modules/audio/wah/jsdsp.ts
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
# _modules/audio/wah/module.yaml — beside jsdsp.ts
plugin:
  type: jsdsp
params:
  Depth: 3
```

The parameters come from the description, so two modules with different sources are two different-looking devices of the same plugin type — knobs, dropdowns and drag-to-bind all work without the engine knowing anything about them.

The source is **run**, in a child process, and the result cached as a sibling `.json` regenerated only when the source is newer. A first compile after an edit costs ~200 ms of Node startup; every one after that is a file read. That `.json` is worth committing: it is what actually ran, it diffs, and a checkout without Node still plays the song. Nothing here is fatal — a source that throws leaves the last good build in place, and failing that the module falls back to the plugin's default graph and the engine says so.

Nodes run in four phases per block: `envelope` follows the input per sample; `todb`/`lerp`/`linmap`/`geolerp`/`clamp`/`select`/arithmetic/`glide` are once-per-block scalar maths; `biquad`/`gain`/`mix` transform the audio a block at a time; and `ain`/`aout`/`adelay`/`alfo`/`amul`/`aadd`/`atanh` run in a per-sample loop, where reading a wire written later in the list yields the previous sample — the unit delay a feedback loop is built on.

## _modules/<type>/<name>/module.yaml — more than one input

The type folder gives a module its ports: one audio in for `audio/`, one midi in for `instruments/`. That makes the folder decide how many cables a module takes, which is not what a folder is for — a crossfade is an audio effect like any other and needs **two** audio inputs. A module can name its own instead, with `inputs:` and `outputs:`. Declare neither and the folder's defaults apply, which is every module written so far; the two lists are independent, so you can name your inputs and inherit your outputs.

`mandatory` is an input's business — an output is offered, never required — and defaults to true, so a port you bothered to name has to be fed unless you say otherwise. A crossfade's second input is exactly the case for `mandatory: false`: wiring one side and leaving the other silent is a legitimate state, not a half-built chain.

```yaml schema=Module
# _modules/audio/crossfade/module.yaml — two audio inputs, one output
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

## _modules/shaders/<name>/module.yaml — GLSL over the picture

A module in `shaders/` takes an **image**, gives back an image, and accepts an **optional audio input** whose live level reaches the shader as `uAudio`. It is the only module whose ports carry two different signals, and that is what it is for: a picture that moves with the sound.

What it *does* is GLSL, in a `shaders/` folder beside the module file — one folder per shader, each holding a `vertex.glsl` and a `fragment.glsl`. `shader:` picks which one runs. A shader is a folder rather than a file because it is a **pair**: swap the fragment and keep the vertex and you have a different effect on the same geometry. A folder missing one of the two is not offered at all.

```
_modules/shaders/glow/
  module.yaml
  ui.yaml
  shaders/pulse/{vertex,fragment}.glsl
  shaders/ripple/{vertex,fragment}.glsl
```

Every shader gets the same uniforms: `uTex` (the picture coming in), `uAudio` (0..1, the wired lane's level over −60..0 dB, and 0 with nothing wired), `uTime` (the transport's position in seconds), `uResolution`, and `uP1`..`uP4` — the four knobs, each 0..1. They are numbered rather than named because the module cannot know what a shader will call its controls; what each one means is written in that shader's `fragment.glsl`.

```yaml schema=Module
# _modules/shaders/glow/module.yaml
type: shader
shader: pulse        # a folder under this module's shaders/ — the dropdown writes it
params:
  P1: 0.6            # reaches the fragment as uP1
  P2: 0.35
```

Its panel's dropdown binds `@shader` and lists **nothing**: which shaders exist is a fact about the folder, so the graph fills the entries from what it finds. Drop a folder in and it is offered, with no file to edit.

```yaml schema=UiFile
# _modules/shaders/glow/ui.yaml
cols: 4
rows: 2
widgets:
  pick: { type: dropdown, col: 0, row: 0, colSpan: 4, bind: "@shader" }
  p1: { type: knob, col: 0, row: 1, bind: P1, min: 0, max: 1, step: 0.01 }
```

Wire it like anything else. A video lane through it shades **that layer** before it is composited; the same module on the `RENDER → VIDEO_OUT` run shades the **whole frame**. The audio input is a side input, so it names the port:

```
modules:
  drums:  [ MIX, glow#audio ]   # the kit feeds the mix AND the shader
  MIX:    [ OUT ]
  main:   [ glow ]
  glow:   [ RENDER ]
  RENDER: [ VIDEO_OUT ]
```

A node with no shader picked, one naming a folder that is not there, and one whose GLSL will not compile all do the same thing: the picture passes through untouched and the node keeps its card, its knobs and its dropdown. A shader you are halfway through writing does not take the viewport down.

## _modules/<type>/<name>/module.yaml — a COLD module

`cold: true` says the module only works on audio **already on disk**. Not "expensive": a cold module run live would not be slow, it would be *wrong*, because the answer does not exist yet. Normalisation is the plain case — the gain depends on the loudest sample, and the loudest sample may be the last one, so nothing can be produced until the whole input has been read.

Adding one to a chain whose signal does not come from a file input (`io: file`) is refused, with a message saying so, before anything is written. That is why they belong in the médiathèque's chain templates, which run over a song's master file, rather than in a live project chain.

```yaml schema=Module
# _modules/audio/normalize/module.yaml — bring the peak to Target
cold: true
plugin: { type: jsdsp, name: Normalize }
params:
  Target: -1   # dBFS, 1 dB of headroom
  Peak: 0      # measured by the cold pass; 0 until it has run, so the module only attenuates
```

## _modules/<type>/<name>/module.yaml — a module that needs a MODEL

A separating module names its neural model like any file-valued param (`onnx:`), but 166 MB does
not travel through a library repository: the machine keeps it in `~/.st0/models`. `model_url:` says
where that file can be **downloaded** from, so a machine that has not got it can fetch it rather
than be told to go and find it.

Then, on a machine without the model, the module's node offers **Download model** as the first
entry of its right-click in the graph, and a cold chain using it offers the same as a link in st0's
settings (*Separation chains*) once that chain is chosen. Either one fetches the file into
`~/.st0/models` under the name `onnx:` gives it, and the node or chain works from there on. The URL
is only ever read off the module: nothing a page sends can make the machine download anything else.

```yaml schema=Module
# _modules/audio/separation/stemsplit/module.yaml — one mix in, four stems out
cold: true
plugin: { type: offline, name: Stem Split }
params:
  onnx: htdemucs_fp16weights.onnx
model_url: https://models.example.org/htdemucs_fp16weights.onnx
```

## _modules/<type>/<name>/module.yaml — keeping the palette readable

`status:` says how the **completions** should treat this module, and nothing else. It changes no
sound and no wiring: a `hidden` module still loads, still plays, and can still be named by hand —
a completion list is an offer, never a validator.

| value | what the palette does |
|---|---|
| `listed` | offers it in the order it already had — the default, and never written |
| `favorite` | offers it **first** |
| `hidden` | does not offer it |

A library grows past the point where every module in it deserves equal billing: half are the ones
you name every day, the other half a compressor written once and a test rig kept for reference.
This is what separates them. Set it from the module builder's header, where `favorite` is drawn
"first" — what the setting does is put the module at the top of the list.

```yaml schema=Module
# _modules/audio/scratch-comp/module.yaml — kept, but out of the way
status: hidden
plugin: { type: jsdsp, name: Compressor }
```

Returning a module to `listed` removes the line rather than writing it, so a file that has
nothing to say about this stays a file that says nothing.

## _modules/<type>/<name>/module.yaml — extends another module

A module can inherit from another with `extends: "@ns/type/name"` — `@workspace` for one beside
it in `_modules`, `@st0` for one in the médiathèque, `@engine` for a scanned plugin with no file
of its own. It gets the base's plugin/params/ui/rack, overriding per key. Several modules can
extend one base.

```yaml schema=Module
# _modules/instruments/synth/module.yaml extends a shared base
extends: "@st0/instruments/fourosc"
params:
  Filter Freq: 69   # override just this one
```

## nodes/<name>.yaml — one use of a module

A project's USES of its modules live in a flat `nodes/` folder at its root, and the FILENAME names the node: a chain says `lead`, not the module it came from. The file is the same flat shape as module.yaml, says which module it uses with `extends:`, and states only what it changes. Each node keeps its own params and its own `nodes/<name>.vstpreset`, so tweaking one leaves the module and every other use alone. Merge order: extended base → the module → the node. To add one: right-click a module in the file tree → "New node…", or run `node new instruments/synth lead` — which also puts it in the graph, wired to nothing, since a node with no entry there would be drawn nowhere.

The folder is flat on purpose — a node does not mirror the folders of the thing it uses, so a use of a médiathèque module needs no local folder for it.

```yaml exempt="shows several files at once (two nodes and the chain that uses them) - not one document"
# nodes/lead.yaml — state only what this use changes
extends: "@workspace/instruments/synth"
params:
  Filter Freq: 90

# nodes/pad.yaml
extends: "@workspace/instruments/synth"
params:
  Filter Freq: 40

# graph.yaml — the module and both uses are separate nodes. Pointing both
# lanes at the module's own ref directly would NOT give each its own: a module
# is named once, so one name is one plugin, and the two lanes would sum into it.
modules:
  melody: [ lead ]
  pad: [ synth-pad ]
  lead: [ OUT ]
  synth-pad: [ OUT ]
```

## ALTERNATIVES — a module's other sets of settings

A module can hold several sets of attributes and run one of them. A clean amp and a crunchy one,
the mix you had yesterday and the one you are trying, two arrangements of a lane's clips — they
live side by side in the same file, and switching between them is one line.

**The module's own fields are the first set.** The others go under `alternatives:`, and
`alternative:` says which is on — by name, or by position when it has none. Leave `alternative:`
out and the module runs its own fields, which is why a file that never uses this carries nothing
about it.

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
bar: `node alternative select|create|copy <node> [name]`, and a bare `select` lists them.

For a **lane**, the timeline offers the same thing where you are already looking: a small badge
beside the track icon carries the name of the set that is playing, amber while it is not the lane's
own. Click it and you get that lane's menu — switch to another set, or start one. It appears only on
a lane that has a choice, so a lane with a single set carries no badge at all.

A new set starts **empty** (`events: []`), not holding the previous set's placements. Editing
clips while a set is on changes **that set** — the first edit copies in whatever it was playing, so
the set you came from keeps what it had. A lane's colour and its `disabled` flag stay the lane's,
shared by every set.

This is not a **preset**. A preset (`presets.yaml`) is a starting point you stamp into the
module's params — numeric, shared by every use, and gone as a thing once applied. An alternative
is a state you switch between: both survive, one is on, and it belongs to the one module that
holds it.

```yaml schema=Module
extends: "@workspace/audio/amp"
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
`node freeze <node>`, the same line both ways. What it writes is `frozen:`, naming the render
it made, and the badge on the node is a snowflake: cold blue on the point, and on every node the
render already contains.

It is **refused** when something upstream also feeds a node outside the set — that signal would be
in the render *and* still playing, heard twice at a level nothing on screen explains. The message
says where to freeze instead: the point the two paths meet.

The render is a generated file (`renders/<module>.wav`). Delete it and the song simply plays live
again, which is what makes a project safe to clone without it.

```yaml schema=Module
extends: "@workspace/audio/amp"
params: { Gain: 3 }
frozen: renders/amp.wav      # written by `node freeze amp`; delete it and it plays live
```

## _modules/instruments/<name>/module.yaml — rack (drum kit)

A rack instrument (type: "rack") — a note→audio sampler, not a plugin. Two kinds. samples: each symbol names its OWN clip; a base can ship defaults and a module that extends it merges its symbols OVER them per symbol. slice: one shared source cut into [from, to) windows in seconds. Audio sits in the module's folder.

```yaml exempt="shows both rack kinds side by side - not one document"
# samples base — _modules/instruments/drumrack/module.yaml
type: rack
rack:
  symbols:
    BD: { note: 36, clip: kick.wav }   # the base's default sound

# a module extends + overrides — _modules/instruments/kit/module.yaml (the folder names it)
extends: "@workspace/instruments/drumrack"
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

## _modules/<type>/<name>/ui.yaml — a module's panel

The control grid a module draws on its graph node, in a file of its own **beside module.yaml**, in the module's own folder. It says nothing about which module it draws, because the folder already does: move the module and its face moves, copy it and the face is copied. A module folder's other .yaml files are its nodes — ui.yaml is the one name that is neither the generic nor a node.

cols/rows is the layout; each widget sits on a cell and binds a plugin parameter by name. Drag a parameter from the module editor's Parameters pane onto a widget to bind it — the range and the label come with it. knob/slider/fader/number carry min/max; dropdown carries the named settings of a discrete parameter; waveform draws a live tap; label draws fixed text and binds nothing.

`filepicker` is the odd one: it picks a FILE the module carries rather than a number. `bind` names a file-valued parameter (`nam`), and that one word decides everything — the key written, and which files are offered, since a parameter is named after the format it loads. Clicking it opens a searchable tree of the module's `assets/`, its own and those of every module it extends, so a thin module that inherits a shared amp offers that amp's profiles.

`lcdscreen` is a screen the module draws itself. It binds nothing: a `widgets.js` beside `ui.yaml` returns an object keyed by widget id, and the function under a screen's id paints it on every change, given a 2D canvas, the module's live parameters, and the peak level of the signal going IN and coming OUT of the module over the last few seconds. The module editor shows a `widgets.js` tab as soon as the panel has a screen.

```js
// _modules/audio/compressor/widgets.js
export default {
  screen(lcd) {
    const { ctx, width, height, params, input, output, color } = lcd;
    ctx.fillStyle = color.ink;
    ctx.fillText(`ratio ${params.Ratio}`, 4, 12);
  },
};
```

`fader` is the mixer strip's control: vertical, with the value read out above it, and it fills whatever height its `rowSpan` gives it — so its throw is something you author rather than a fixed bar. Give it the rows to be worth using (the editor starts it at 3); one cell tall it is only a worse slider. Its drag sweeps the range over its own height, so the cap stays under the pointer. On a track's chain it also carries that track's VU beside the throw — the same signal, span and colours as the Mix panel's meter, because it is the same strip. A chain that is not a track (a bus, a disabled lane) has no one level to show, and the fader simply has no meter.

```yaml schema=UiFile
# _modules/instruments/mini/ui.yaml
cols: 4
rows: 2
widgets:
  w1: { type: knob, col: 0, row: 0, bind: Cutoff, min: 0, max: 135, label: Cutoff }
  w2: { type: dropdown, col: 1, row: 0, bind: "Filter Type",
        options: [ { label: Low, value: 0 }, { label: High, value: 1 } ] }
  w3: { type: waveform, col: 2, row: 0, colSpan: 2, rowSpan: 2, source: output }
  w4: { type: fader, col: 3, row: 0, rowSpan: 6, bind: Volume, min: -60, max: 6, label: Vol }
  w5: { type: lcdscreen, col: 0, row: 1, colSpan: 2 }
```

A panel is a file of its own rather than a `ui:` block inside `module.yaml`, so that a rebuilt `_modules/` never takes hand-drawn work with it and a plugin every song reaches for is drawn once: a panel is saved where its module is, shared library included, and that is the one edit a shared module accepts without being forked. A plugin the engine merely reports has no folder anywhere, so it has no panel until somebody makes it a module. An inline `ui:` block is still read, and a ui.yaml replaces it whole; `ui migrate` moves the inline ones out into their file.

## _modules/<type>/<name>/module.yaml — automations:

Bind a curve to a parameter. `curve` is a `@meta/curves/<id>` ref naming a curves/<id>.yaml beside the project; `param` is the parameter's display name — the same name a widget binds and `node param` addresses. A curve's polarity decides whether it sweeps the parameter's whole range or rides ± around where the knob sits.

```yaml schema=Module
automations:
  - { param: "Filter Freq", curve: "@meta/curves/sweep" }
  - { param: Level, curve: "@meta/curves/wobble" }
```

## _modules/config.yaml

A SHARED module library — a folder of modules outside any one song, referenced as @<namespace>/<type>/<category>/<name>. This one file declares the namespace; everything under it is addressable by it. `st0 populate` fills such a folder from the engine's plugin scan, filing each plugin under its declared category.

```yaml schema=ModuleConfig
namespace: engine

# then, e.g.:
#   _modules/audio/amp/neural-amp-modeler/module.yaml
# referenced from a song as:
#   extends: "@engine/audio/amp/neural-amp-modeler"
```
