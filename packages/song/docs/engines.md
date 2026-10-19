# Engines — one module, several DSPs behind it

A module can hold **engines**: the other modules it can run as. The compressor is one module; the
Tracktion compressor, a vari-mu and a bus compressor are its engines, and a node picks one.

```
@k7-core/audio/dynamics/compressor/
  module.k7x                engine: tracktion
  engines/<name>/           module.k7x, ui.k7x, widgets.js — a whole module
```

## Why engines exist

The `@k7-core` library grew one module per plugin, so a picker offered nine compressors and four
choruses, branded by whoever wrote the DSP. That is the wrong question to ask first. You want *a
compressor*, and then which one. An engine puts the function in the picker and the brand inside
the node.

## An engine is a module folder, inside its module

Each engine is an ordinary module folder: its own `module.k7x` (usually an `extends:` of an
`@engine/…` plugin), its own panel and screen. Engines have the same shape as modules for two
reasons:

- **every tool already works on it.** The builder edits an engine by opening its `module.k7x`,
  the panel walk finds its `ui.k7x`, and its jsdsp source resolves against its own folder. None of
  them needed a second code path;
- **a module stays a folder you can copy.** Its engines travel with it. Refs to modules elsewhere in
  the library would have made the compressor depend on modules that are no longer offered on their
  own.

An engine is loaded under `<module ref>/engines/<name>` and carries `engineOf`. That marker is the
one thing that keeps it out of the base-module picker, the catalogue and the completions. It is
picked inside its module and never offered beside it.

The engines are **found, not declared**: the module lists none, its `engines/` folder does. A
list in `module.k7x` would be a second answer to the question the folder already answers, free to
disagree with it.

## The module keeps who it is; the engine says what it runs

Running as an engine keeps the module's IDENTITY and its place in the graph — name, colour,
mix and levels, automations, alternatives — and takes everything else from the engine: plugin,
params, panel, ports. The list is `KEPT` in `engines.ts`. A field on that list is a
question of where the node SITS; a field off it is a question of what the DSP IS.

`extends` is on it: a node running the `echo` engine of `@k7-core/audio/delay` is still a use of
`@k7-core/audio/delay`. Off the list, the engine's own `extends` (often none) would take its place, and
every card running an engine would lose its module's name — falling back to its place, `chain · step
n` — and its presets, which are its module's.

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
