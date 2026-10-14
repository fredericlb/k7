# Binding a surface to the graph

A "mapped" surface — the DJ desk, the mastering strip — carries a `mapping:` in its `surfaces/`
file, keyed by CONTROL:

```yaml
mapping:
  deckA.eqLow: { module: eqA, param: Low-shelf gain }
```

Turning that into "put this parameter on this plugin" needs three questions answered, and
`bindings.ts` holds **two**. The third belongs to the surface, which is the whole point of this
page.

| question | who answers |
|---|---|
| is this module in this project's chains? | **here** (`stepsByModule`) |
| which widget draws this parameter, and so what is its range? | **here** (`widgetFor`) |
| how do you turn "where the control is" into "what the parameter is worth"? | **the surface** |

## Why in this package

Because it is the **graph** half of the join, and reading a graph is this package's job.
`widgetDenorm` — the other half, which unrolls a 0..1 into a widget's range — is already in
`graph.ts`, next door. Both consumers depend on it already, so nothing new enters a
`package.json`.

The input type is **structural** (`SurfaceMapping`) rather than imported from
`@studio/song-schema`: the file's SHAPE is validated there, what it means against a graph is
decided here, and this package keeps its two dependencies.

## What is NOT here, and must not come here

Scaling. Not an oversight — the two surfaces disagree, deliberately:

- **the desk** normalises the control into its own range and lets the widget unroll it
  (`valueFor` → `widgetDenorm`). A tempo fader has no unit of its own: it is "somewhere between
  the two ends of the module's knob";
- **the mastering strip** refuses to normalise. Its numbers are dB, Hz, milliseconds, and the
  point is precisely to read them against a meter. Its range IS the widget's, with no conversion.

Pushing either one down here would make the other wrong. See
[mastering.md](../../../apps/k7/frontend/docs/mastering.md) and
[controls.md](../../../packages/k7-plugins/docs/turntables/controls.md).

## The "no plugin" policy

The one behavioural parameter, and worth understanding because it fails silently.

`buildGraphDoc` gives a `pluginId` to **every** step of a chain — including steps the compiler
emits no plugin for, an `offline` module being literally
`if (rawType === OFFLINE_TYPE) continue`. A step can therefore carry an address the engine does
not know.

| policy | who | what it does |
|---|---|---|
| `track` | the desk | a step with no plugin binds through the **track** its chain draws material from — that is how a tempo fader stretches a clip |
| `refuse` | mastering | a step with no plugin is **refused**: this surface is the picture of ONE loaded plugin, so a knob with no plugin would do nothing |

Swapping them breaks nothing visible: `set-plugin-param` leaves for an address the engine does not
have, no error, no log, and the knob moves with nothing happening. Which is why it is a type
rather than a boolean, and why the test pins both sides.

> Not to be confused with `hasPlugin()`, which asks a neighbouring question of another document:
> the graph describes what is DRAWN, the compiled document what PLAYS. See
> [controls.md](../../../packages/k7-plugins/docs/turntables/controls.md).

## A line that does not resolve is SAID

Three ways to fail, and all three are **reported** rather than dropped — a `mapping` belongs to
THIS project and names THIS project's nodes, so a line that does not resolve is a typo on its own
file.

A missing WIDGET is the only non-fatal case: without it there is no range, but the target exists,
and declaring it broken would be wrong.

A control **named and not wired** (`null`, which is what a surface skeleton is made of) is skipped
**without a word**. `unmappedControls` reports it once, as a gate over the whole surface. Saying
it twice would give two sentences for one line to fill in.

The two surfaces do not name themselves alike in "X is not a control …" — hence `noun`, the only
thing the caller has to say about itself.
