# `views/mix.yaml` — what a desk's controls drive

A project folder gets a `views/` directory: one file per VIEW that has controls of its own,
saying what each of them is wired to. The first is m9's Mix desk.

```yaml
# views/mix.yaml
crossfade:   { module: crossfade, param: Mix }
deckA.tempo: { module: tempoA, param: Target BPM }
deckB.tempo: { module: tempoB, param: Target BPM }
```

## Why not the module's `controller.yaml`

That file exists and does the same job for MIDI — `<param>: { ch, cc }` — and it was the
obvious place to put this. It cannot hold it, for a reason its own doc states:

> **Every instance shares one map.** Two instances of the same module in one song both answer
> to CC 74, because an instance is one *setting* of a device and there is only one device.

A set puts a tempo module on **each deck**. One map for both, so a binding in it could not say
"deck A's fader drives deck A's stretch" — the same line would drive both, or drive the wrong
one. The distinction is not a limitation to work around; it is the difference between two
kinds of fact:

| | belongs to | travels with |
|---|---|---|
| `controller.yaml` — a MIDI CC | the **device** | the module, into every project that names it |
| `views/mix.yaml` — a desk control | **this set** | the project |

A CC is a property of the thing you plugged in. Which fader of *your* desk moves *this* set's
crossfade is a property of the set. They are different files because they are different
questions, and putting the second in the first is what made it unsayable.

## Keyed by the control

A control drives at most one param: two targets on one fader is a thing you cannot see going
wrong. The reverse is fine — two controls may name the same module and param, and both move
it, which is a macro and a thing people want.

`module` is the name the **chains file** uses (`crossfade`, `tempoA`), not a médiathèque ref:
a set has two uses of the tempo module and a ref could not tell them apart. `param` is spelled
exactly as the module's `ui.yaml` binds it, so this file, the panel and a MIDI map line up key
for key and can be read side by side.

## The control ids are the app's, not the format's

`@studio/song` does not know what a `crossfade` is. The schema therefore accepts any key and
**does not validate the ids**: whoever draws the panel checks them, against the list it
actually has (m9's is `apps/m9/frontend/src/controls.ts`, listed in `apps/m9/docs/controls.md`).
A schema that guessed the vocabulary would go stale the day a control is added, and would have
to be edited in a package that has no business knowing.

What the format DOES check is the shape, so a malformed file is a reported error rather than a
binding that silently does nothing.

## Resolving one

Three joins, and each failure is REPORTED rather than dropped:

1. the control id, against the app's list;
2. `module`, against the compiled chains — which is where a name becomes the engine's
   `chain:module` plugin id;
3. `param`, against the widget that draws it — which is where the range comes from.

Only the third is allowed to come up empty. Without a widget there is no min/max, so the value
cannot be scaled — but the target exists, and calling that broken would be wrong; the control's
own units go through untouched.

This is deliberately stricter than l8's MIDI join, which skips what it cannot apply in silence.
It can afford to: a module's map travels into projects that draw it differently, so a binding
that does not apply is normal there. Here the file names **this** set's own instances, so a
line that does not resolve is a typo somebody made about their own project.

## Scaling

The control is normalised to 0..1 by its OWN range and expanded by the widget's `min`/`max` —
the journey a MIDI CC's 0..127 already makes in l8's `useMidiControl`. That is why a control
declares a range at all: without one, every consumer would have to invent a scale, and a fader
would sweep one nobody chose.

## Wired

m9 plays the COMPILED project now (`apps/m9/docs/mix.md`), so the plugins a binding names are
the ones the engine has loaded. Moving the crossfader is one call —
`setPluginParam(pluginId, param, valueFor(binding, position))` — and the module the médiathèque
ships does the fade. The hardcoded path is gone from normal operation; it survives only as the
stand-in for the seconds before the compile arrives.

One kind of binding still resolves and then has nowhere to go: a module that compiles to **no
plugin**. An `offline` module is the case — m9's tempo is one — and it is reported per control
rather than left as a dead fader. That is not a gap in this file; it is what `offline` means.
