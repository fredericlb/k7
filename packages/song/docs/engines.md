# Engines — one module, several DSPs behind it

A module can hold **engines**: the other modules it can run as. The compressor is one module; the
Tracktion compressor, a vari-mu and a bus compressor are its engines, and a node picks one.

```
@st0/audio/dynamics/compressor/
  module.yaml               engine: tracktion
  engines/<name>/           module.yaml, ui.yaml, widgets.js, presets.yaml — a whole module
```

## Why engines exist

The `@st0` library grew one module per plugin, so a picker offered nine compressors and four
choruses, branded by whoever wrote the DSP. That is the wrong question to ask first. You want *a
compressor*, and then which one. An engine puts the function in the picker and the brand inside
the node.

## An engine is a module folder, inside its module

Each engine is an ordinary module folder: its own `module.yaml` (usually an `extends:` of an
`@engine/…` plugin), its own panel and screen, its own presets. Engines have the same shape as
modules for two reasons:

- **every tool already works on it.** The builder edits an engine by opening its `module.yaml`,
  the panel walk finds its `ui.yaml`, and its jsdsp source resolves against its own folder. None of
  them needed a second code path;
- **a module stays a folder you can copy.** Its engines travel with it. Refs to modules elsewhere in
  the library would have made the compressor depend on modules that are no longer offered on their
  own.

An engine is loaded under `<module ref>/engines/<name>` and carries `engineOf`. That marker is the
one thing that keeps it out of the base-module picker, the catalogue and the completions. It is
picked inside its module and never offered beside it.

The engines are **found, not declared**: the module lists none, its `engines/` folder does. A
list in `module.yaml` would be a second answer to the question the folder already answers, free to
disagree with it.

## The module keeps who it is; the engine says what it runs

Running as an engine keeps the module's IDENTITY and its place in the graph — name, colour,
mix and levels, automations, alternatives — and takes everything else from the engine: plugin,
params, panel, preset, ports. The list is `KEPT` in `engines.ts`. A field on that list is a
question of where the node SITS; a field off it is a question of what the DSP IS.

## Knobs are kept per engine

A node's values live under `engines.<name>.params`, never in its top-level `params`. Two things
force it:

- the engines' params are **different knobs**. Tracktion's `Ratio` is a 0..0.95 slope, and the
  vari-mu has no such parameter. A flat `params:` would hand one engine's values to another;
- **switching back should find the knobs as they were.** That is what makes trying an engine
  cheap, and it costs nothing to keep.

So `node param` writes into the engine that is on (`setAlternativeParam`, given the engine), and
the resolve ignores top-level `params` on a module with engines.

## Not an alternative, and composing with one

An alternative is a state you switch between, held by the one node. An engine is a choice the
MODULE offers and every use of it can make. They compose rather than compete: `engine:` is an
ordinary module field, so an alternative can set it, and two sets A/B two engines. The engine is
resolved last, after the alternative has said which is on (`resolveModule`).

## The default

`engine:` on the module is the default, and a node overrides it. With none, `tracktion` wins if
the module has one, else the first by name. That rule is `DEFAULT_ENGINE`. The Tracktion built-ins
ship in the engine itself, so they are always there, and they are the plainest of the set. An
`engine:` naming a folder that is not there falls back to the default rather than silencing the
node.

## Switching is a reload

`node engine` writes `engine:` on the set that is on and reloads, and never takes the values-only
fast path that `node alternative select` can. Another engine is another plugin, so there is no
diff of values to push.

## Turning modules into engines

When modules become engines of another, their uses are repointed by
`scripts/migrateToEngines.ts`, given a map of old ref → module and engine:

```bash
npx tsx packages/song/scripts/migrateToEngines.ts map.json <dirs…>          # dry
npx tsx packages/song/scripts/migrateToEngines.ts map.json <dirs…> --write
```

Every use gets an explicit `engine:`, even when it is the default, so a later change of default
moves no existing node. A use is a file's own `extends:` or an ALTERNATIVE naming its own module
([alternatives.md](alternatives.md)): a set that swaps a Wurlitzer for Plaits is repointed like a
node. Its params, its own and every alternative's, move under that engine,
because a module with engines reads no other. A use that kept the same ref still needs this when it
set params, or when the module's default is not the DSP it was tuned on: the blind test's one-knob
filters are pinned to `one-knob` for that reason.
