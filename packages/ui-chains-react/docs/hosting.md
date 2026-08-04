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
