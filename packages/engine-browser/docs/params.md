# The plugin-param store's two channels (`params.ts`)

The engine reports a watched plugin's **full** parameter set ~20×/s, and it reports it **one
plugin per message**. `PluginParamsStore.set` therefore fires once per plugin per cycle, which
is the fact everything below follows from: with N plugins on screen the store is poked 20·N
times a second.

## Why there are two ways to subscribe

`subscribe` wakes on **any** plugin. `subscribeTo(id, …)` wakes only on one.

The whole-map channel is the honest one for a reader that genuinely needs the whole map —
st0's `MidiFeedback`, which pushes every value back out to a control surface, and m9's
`useDeckSet`. Those draw nothing, so a re-render costs a function call.

It is the wrong channel for anything that *draws*. A single whole-map subscription at the root
of a tree of N nodes turns 20·N notifications into 20·N full-tree renders, each rendering N
nodes — **quadratic in the number of plugins on screen**. That is what made st0's mixer heavy
on a song with many tracks: the strips are the graph's own cards, one plugin each, and every
strip re-rendered every other strip's frame.

## Why per-plugin and not a selector over the map

A selector still has to *run* on every notification. With one subscription per widget over the
whole map, every widget's `getSnapshot` executes on every message — 30 strips × 8 widgets ×
600 msg/s ≈ 144 000 reads a second, before any equality check saves a render. Keying the
subscription by plugin id means only the widgets on the plugin that actually moved are asked:
≈ 4 800 for the same graph.

## Why the value hook returns a number

`usePluginParamValue` returns a **primitive**, so React's own `Object.is` on the
`useSyncExternalStore` result is the equality cache and a frame that did not move *this* number
re-renders nothing. That is why it needs none of the `useRef` comparison wrapper
`engineStore.ts`'s `useStoreState` carries — that one returns objects, which are never `Object.is`
equal, so it has to cache by hand.

It accepts a null id or name so a caller can hold the hook unconditionally. A widget only knows
whether it is bound to a plugin, a track or an offline module *after* it has looked at its
bind, and a hook cannot live behind that branch.

## Where to put the subscription

At the leaf that displays the number, not at the root that owns the tree — the same rule the
chains renderer's `InputMeterBar` and `FaderMeter` already follow for meter levels. See
`packages/ui-chains-react/docs/hosting.md`.
