# Modules and instruments

A **module** is a reusable sound processor: an effect, an instrument, a MIDI transformer, a
picture effect. A **node** in your graph is one use of a module, with its own settings. Ten
reverbs in a song are ten nodes of one reverb module.

Modules live in folders. Most come from a library, `@k7-core` first among them (see
[Libraries](./44-libraries.md)); you can also make your own.

## Module types

The folder a module sits in decides what kind of module it is, and so which ports it has.

| Type folder | What it is | Input | Output |
|---|---|---|---|
| `audio` | An audio effect | audio | audio |
| `instruments` | Plays notes as sound | MIDI | audio |
| `transformers` | Changes notes (arpeggiator, transpose, note repeat) | MIDI | MIDI |
| `io` | An interface input, an output, a file, a camera, a MIDI device | depends on its role | depends on its role |
| `cold` | A pass over a whole audio file before playback (normalize, stem split, tempo) | audio | audio |
| `console` | One half of a summing console, placed by the project's console setting | audio | audio |
| `video_effects` | A picture effect | picture | picture |
| `video_transitions` | A transition between shots, named by a placement rather than wired | picture | picture |
| `shaders` | A GLSL pass, with an optional audio side input | picture (+ audio) | picture |
| `shapes` | A drawn square, circle or text | none | picture |

A module can declare its own ports instead (for example a crossfade with inputs `a` and `b`).

**Cold** modules only work on audio already on disk: dropping one into a chain fed by a live
input is refused. They are not offered by the module picker; use them in a processing chain
(`track process`, `event process`).

## What is in a module folder

| File | What it holds |
|---|---|
| `module.k7x` | What the module is: its plugin or the module it extends, its default parameter values, its engines. |
| `ui.k7x` | Its panel: the controls drawn on its card. See [Panels](./46-panels.md). |
| `widgets.js` | Drawing code for the panel's LCD screens. |
| `jsdsp.ts` | Its DSP, written in TypeScript, for a `jsdsp` module. See [DSP in JavaScript and Faust](./49-dsp.md). |
| `dsp.dsp` | Its DSP in Faust, for a `faust` module. |
| `engines/<name>/` | One sub-module per engine, each with its own `module` and `ui` files. |
| `base/` | Named starting states of the plugin (a synth's patches). |
| `assets/` | Files the module loads, such as models or impulse responses. |
| `controller.k7x` | MIDI CC bindings for its parameters. |

## The module file

```js
// k7-core/modules/cold/normalize/module.k7x
cold(true)
plugin({ type: "jsdsp", name: "Normalize" })
params({
  Target: -1,
  Peak: 0,
})
```

```js
// a module that only puts a face on a plugin the engine already has
extends("@engine/compressor")
```

```js
// a module with several engines, the default one named
engine("tracktion")
```

The main fields:

| Field | Meaning |
|---|---|
| `plugin` | What runs: `{ type, name }`. Types are `builtin` and `internal` (processors inside the engine), `jsdsp` and `faust` (DSP described in the folder), `offline` (a cold pass run outside the audio thread), or an external plugin format such as `vst3`. |
| `extends` | Another module this one inherits from. Values, panels and engines merge, the child winning. |
| `params` | Default values, by the plugin's exact parameter name. |
| `engine` / `engines` | The default engine, and per-engine parameter values. |
| `base` | Which named base (patch) of the plugin to start from. |
| `mix`, `input_volume`, `output_volume` | Defaults for the stage controls. |
| `cold` | Marks a cold module. |
| `inputs`, `outputs` | Ports, when the type's defaults do not fit. |
| `status` | How the command-bar completions treat the module: `listed` (default), `favorite` (offered first), `hidden` (not offered). |

The full field list is in the song file reference.

## How modules are named

A module is addressed by a **ref**, starting with the place it lives:

| Ref | Where the module lives |
|---|---|
| `@k7-core/audio/reverb` | A library (here, the shared `k7-core` library). |
| `@account/audio/reverb` | Your own account library: always yours to write. |
| `@workspace/audio/crossfade` | The workspace's `_modules/` folder, shared by every project in it. |
| `@engine/compressor` | A plugin the engine provides, straight from its plugin scan. Read-only, no folder. |
| `@meta/track` | k7's own built-ins: lanes, notes, inputs and outputs. |

When two places hold a module with the same path, the nearest wins: the workspace, then your
account library, then the libraries by name.

## Making a module yours

| Command | What it does |
|---|---|
| `module new <category/name> [extends-ref]` | Create a module, and only that. Example: `module new audio/echo @engine/delay`. Follow it with `node new` to use it. |
| `module fork <ref>` | Copy a library module into your account library: `module fork @k7-core/audio/reverb` creates `@account/audio/reverb`, which extends the original, and this project plays the fork. |
| `module own <ref>` | Give an engine module a folder in this project, so it can carry a panel and presets. Example: `module own @engine/nam`. |
| `module clone <category/name> <newName>` | Copy a module folder under a new name. |
| `module create rack` | Build a samples rack on a pad grid, in a popin. |
| `module cc <module> <param> <channel> <cc>` | Bind a MIDI CC to a module's parameter. |

To edit a module's panel or parameters visually, open it in the
[module builder](./45-module-builder.md).
