# Hosting the graph — extended notes

## What this package is, and what it is not

`DomChains` is the RENDERER: HTML nodes, one SVG cable layer, the camera, the widgets,
the interaction. It draws what `@studio/ui-chains` laid out and knows nothing about where
a graph came from.

What stays in each app is the **shell**: fetching `/graph`, the reload polling, the chain
list beside the canvas, the parked camera (a graph unmounts with its pane, so the camera
has to live above it), and optimistic state like a pending bypass. l8' `ChainsTab` is
~500 lines of that against 2100 shared here.

There is deliberately no `ChainsShell` yet. Promote one when two apps have written the
same sidebar — guessing it now would be guessing.

## What a host must supply

**`icons` — required, and the compiler enforces it.** The glyphs are the app's vocabulary,
not the graph's: l8 draws the same track icons in its mixer and its timeline, so they
cannot live here without those two importing a chains package. They reach the nested node
components through a context, but the PROVIDER is not a caller's job — the component takes
`icons` as a required prop and provides it itself. There is no arrangement in which a host
forgets and the graph throws at render.

**`runCommand`** (the `command` prop) — a `@studio/commands` SID line. Every app that can
edit a graph has one.

**Live engine state**, through `@studio/engine-browser`: `engineStore` for meters and the
playhead, `params` for the ~20 Hz plugin parameter feed. Both are external stores, so a
frame re-renders the node that reads it and nothing else.

The engine store is **optional, and the component provides one when you don't** — the same
arrangement `icons` has, for the same reason. `InputMeterBar` renders under every track node
unconditionally, so a host that drew a graph without wrapping itself in an
`EngineStoreProvider` threw `useEngineStore used outside <EngineStoreProvider>` at render.
That is not a hypothetical: the médiathèque's module preview hit it, and m9's deck panel
would have. Wrap the graph in your own provider to show live meters; pass nothing and they
read silent, which is the truth for a host with no engine.

### Modules the engine has never heard of — `moduleParams` / `onModuleParam`

Optional, and off unless you pass one of them.

A widget normally resolves to a PLUGIN param, addressed by the step's `pluginId`. An
`offline` module has none: the compiler reads the type and emits no plugin at all, so there
is nothing to watch and no id to watch it by. Its widgets therefore draw nothing and refuse
the hand — correct, and the reason `buildGraphDoc` stopped inventing an id for them.

But the value is not nowhere. It lives on whichever surface REALISES the module — m9's tempo
becomes a clip warp on the desk — and these two props are how that surface lends it:

- `moduleParams: { [module]: { [param]: number } }` — keyed by MODULE name, since there is no
  plugin id to key by. Consulted before the value the file authored.
- `onModuleParam(module, param, value)` — the way back, per frame during a drag.

They are separate because **showing and taking are separate abilities**. m9's graph can show
a deck's tempo while the desk that sets it is unmounted, and cannot take a new one: realising
a tempo needs that desk's songs and its document. Pass only `moduleParams` and the widget is
read-only — drawn from a value it cannot change, rather than a knob that turns against
nothing. That distinction is the whole point of the pair; a single prop would have brought
back the lie the missing `pluginId` removed.

A host that passes neither is unaffected: l8 and st0 draw those widgets inert, exactly as
before.

## What it emits

`onContextMenu(ctx, x, y)` carries a `GraphMenuCtx` — four kinds, the ones a node can be:
`track`, `module`, `chain`, `sink`. That is the graph's own vocabulary. l8' `MenuCtx` is
a superset covering timeline things (markers, clip placements) this cannot produce, and a
host whose type is wider accepts the handler unchanged.

## Styling: one injected sheet, and one gap

The stylesheet is injected by the component and scoped under `.dgx`, which is what lets it
drop into a host with any CSS setup — no import, no Tailwind config, no build step.

It defines its own `--sand`, `--mauve`, `--card`, `--line`, `--dim` and `--faint`.

**It does not define `--accent`, and neither does anything else in this repo.** Five rules
reference it — the accent dot (`.dgx-tri`), the selected node's border tint, and a badge —
so those declarations are invalid and have been inert since they were written. It is a
pre-existing cosmetic gap, not something the extraction introduced, and it was left alone
here on purpose: changing how the graph renders inside a commit that only moves it would
be exactly the kind of thing that makes a 2100-line move with no tests unreviewable.

Whoever fixes it should either define `--accent` in the injected sheet (making the
component fully self-contained) or have every host's theme provide it. The first is
probably right, with a `var(--accent, <default>)` so a host can still override.
