# Hosting the graph — extended notes

## What this package is, and what it is not

`DomChains` is the RENDERER: HTML nodes, one SVG cable layer, the camera, the widgets,
the interaction. It draws what `@studio/ui-chains` laid out and knows nothing about where
a graph came from.

What stays in each app is the **shell**: fetching `/graph`, the reload polling, the chain
list beside the canvas, the parked camera (a graph unmounts with its pane, so the camera
has to live above it), and optimistic state like a pending bypass. l8' `ChainsTab` is
~560 lines of that against ~2500 shared here.

There is deliberately no `ChainsShell` yet. Promote one when two apps have written the
same sidebar — guessing it now would be guessing.

The camera is the one piece of that shell the package does name: `Cam` and `CamStore` are
exported, because five surfaces had written `useRef<{x,y,k}|null>(null)` with four
near-identical comments over it. A shape is not a sidebar; it was worth naming early.

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

## Styling: one injected sheet

The stylesheet is injected by the component and scoped under `.dgx`, which is what lets it
drop into a host with any CSS setup — no import, no Tailwind config, no build step.

It defines its own `--sand`, `--mauve`, `--card`, `--line`, `--dim` and `--faint`, and
`--accent` **per node kind** — a track, a module and a sink take `--sand`, a curve `--mauve`,
a stub red, an unsupported plugin amber. The accent dot, the selected node's border tint and
the badge read it from whichever node they are inside.

This page used to say the opposite: that nothing defined `--accent`, that five rules were
therefore inert, and that whoever cared should fix it. That was true when it was written and
stopped being true when the per-kind declarations landed. It is recorded here because the
claim outlived the gap by long enough to send a reader looking for a bug that was not there.
