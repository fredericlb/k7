# Intrinsics — a module's own controls

A module has two kinds of control, and one verb sets both:

```
node param synth "Filter Freq" 69      a PLUGIN's parameter
node param ge_rythm-in @channel 1,2    an INTRINSIC — the module's own field
```

The `@` is the whole of the difference, and it is the same `@` a widget binds.

## Why one verb

A verb per field — `module channel`, `module monitor` — leaves every field nobody wrote one for
unreachable. `@gain` is bindable in the builder and therefore reachable from a widget: a knob
bound to it would send `module gain …` and be answered *unknown command*. A vocabulary that grows
a verb every time a field becomes settable is a vocabulary that will be one field behind.

From the outside the two are one act: *set this control on this module*. So they share a verb,
and the table of intrinsics (`INTRINSICS` in `@studio/commands`) is one line per field.

## What the `@` actually decides

| | a plugin param | an intrinsic |
|---|---|---|
| where it lives | `params:` in the module file | a field of the module file (`channel:`, `monitor:`, `gain:`) |
| how the engine learns it | sent to the running plugin, one `PluginParamChanged` | the module is **rebuilt** — the field is read at build time |
| after the write | the document is patched and pushed | the project is reloaded |
| on a module with no plugin | impossible — there is nothing to send to | the only kind it can have |

That last row is why intrinsics exist at all. An `io: in` module runs no plugin: the input **is**
the module, so every control it has is a field of its file, and without a way to write one from a
widget its panel would be inert.

## The five there are

- **`@channel`** — which interface input a live input listens on: one channel, or two for a
  stereo pair. A pair is even/odd and nothing else, because `findWaveInput` matches a device on
  its exact channel list; a set the rig does not group resolves to nothing and plays as silence.
  Nothing in the command can check that — the rig is the engine's to know — so it refuses only
  the shapes that could never be one, and the surfaces that offer the choice offer only sets the
  machine declares.
- **`@camera`** — WHICH lens an io `camera` node opens, by the **label** a person reads rather than
  by a deviceId, which is salted per browser and rotates. `default` clears it. Nothing is checked
  against the machine here: which cameras exist is the browser's to say, and the surface offering
  the choice offers only what it enumerated ([camera.md](camera.md)).
- **`@monitor`** — `off` / `auto` (audible once armed) / `on`. Written quoted: `on` and `off` are
  YAML 1.1 booleans, and `monitor: on` read by anything that does not parse 1.2 stops being a
  word.
- **`@gain`** — the input trim in dB, unclamped. Tracktion does not clamp it either; what is
  *useful* (±24 dB) is a judgement for the surface offering the control, not for the writer
  taking a number someone typed.
- **`@input-volume`, `@output-volume`** — the level into an audio module and out of any module with
  audio out, in dB (−60..+12), made by the ENGINE's stage around the plugin like `@mix`, and LIVE like
  it (`engine/st0-engine/docs/mix.md`). Written as `input_volume:` / `output_volume:`, and 0 dB
  writes no line. On a LANE, `@output-volume` is the mixer fader instead, the lane's level having
  always been that fader's; the name says which side of the module it acts on, which `@volume` did
  not once a module had two levels.
- **`@mix`** — an EFFECT's dry/wet, 0 all dry to 1 all wet, which the ENGINE makes around the
  plugin (`engine/st0-engine/docs/mix.md`). The one intrinsic that is also LIVE: the field is what
  the file keeps, and a knob sends the same name to the running engine as a plugin param, so a
  drag is heard before it is written. 1 writes no line at all, since no `mix:` already means all
  wet, and a module never saved with a blend should not grow one by being turned back up.

- **`@base`** — which named `.vstpreset` this module starts from, out of its own `base/` folder or
  an ancestor's, with `none` to clear it. The one intrinsic that is not an input's: it belongs to
  any module whose plugin has bases, and it exists because a big commercial synth's sound is not
  in its automatable parameters at all (`docs/userPresets.md`). It is a field for the usual
  reason — a preset is loaded when the plugin is BUILT — and what it may not disturb is the point:
  the engine applies `params:` over the base, so every value the module authored still wins.
  The surfaces that offer the choice offer only the bases the loader listed, exactly as `@channel`
  offers only sets the machine declares.

## The write may reach past the project

`module populate` files one `io/IN` node per interface channel in the **workspace's** shared
`_modules/`, beside the `channel:` that says which channel it is. Setting an intrinsic on one of
those writes there — which socket a guitar is in describes the desk, not the song — so the
command says so out loud. It is the only thing here that writes outside the project on a click.

## What is still a verb of its own, and why

- **`node bypass`** — it writes `graph.yaml`, not the module's file. Where a module sits in
  the signal path is not one of its own fields.
- **`track mute` / `track solo` / `track gain` / `track pan`** — a track's intrinsics are drawn
  from `@mute`, `@solo`, `@arm`, `@output-volume`, `@pan`, but they are not written into the lane's
  file: mute is the module's bypass in `graph.yaml`, solo is `soloed:` in `project.yaml`, and
  level and pan are params of the mixer module at the end of the chain. Different files, so
  different verbs.

## …and one thing that is NOT a verb of its own: a FILE-valued param

`model` and `onnx` land in `params:` like the numbers do, so they are `node param <node> model
<file>`. Two differences the handler carries: the value is checked against the assets the module
actually holds, and it is **not** patched into the running engine, because a plugin reads its
file when it is BUILT.

A verb per file param — `module model`, named after the param so there is one word to learn — is
the same shape as `module gain`: a family the UI treats generically, held together by verbs
written one at a time. The asset picker builds its line from the param's own name, so an `.onnx`
picked under such a scheme reaches a command nobody wrote.

What it costs: the value has no `assetFiles` completion. A provider is handed the host and not
the half-typed line — the same limit that makes that list every module's assets rather than this
one's — so `node param`'s value cannot know that the param before it was `model`. The picker is
unaffected; typing the line by hand does not offer the filenames.

## Where each piece lives

| what | where |
|---|---|
| the table and its validation | `INTRINSICS` / `setIntrinsic` in `packages/commands/src/commands.ts` |
| the writers | `setModuleChannel`, `setModuleMonitor`, `setModuleInputGain` in `projectEdit.ts` |
| what a widget binds | `widgetTarget` in `@studio/ui-chains-react` — an `@` bind on a module node |
| the line a pick sends | `setModuleField`, same file |
| the built-in input panel | `inputUI` in `@studio/ui-chains` (`docs/graphBuild.md`) |
