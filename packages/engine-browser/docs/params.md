# The plugin-param store's two channels (`params.ts`)

The engine reports a watched plugin's **full** parameter set ~20×/s, and it reports it **one
plugin per message**. `PluginParamsStore.set` therefore fires once per plugin per cycle, which
is the fact everything below follows from: with N plugins on screen the store is poked 20·N
times a second.

## Why there are two ways to subscribe

`subscribe` wakes on **any** plugin. `subscribeTo(id, …)` wakes only on one.

The whole-map channel is the honest one for a reader that genuinely needs the whole map —
st0's `MidiFeedback`, which pushes every value back out to a control surface, and the DJ desk's
`useDeckSet` (`packages/ui-turntables/src/useDeckSet.ts`). Those draw nothing, so a re-render
costs a function call.

It is the wrong channel for anything that *draws*. A single whole-map subscription at the root
of a tree of N nodes turns 20·N notifications into 20·N full-tree renders, each rendering N
nodes — **quadratic in the number of plugins on screen**. That is what makes a mixer heavy on a
song with many tracks: the strips are the graph's own cards, one plugin each, and every strip
re-renders on every other strip's frame.

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

## Asking an INSTALLED plugin what it has

Everything above is about a plugin *loaded in a project*. `EngineClient.listPluginParams(format,
id)` asks a different question: what does this plugin, sitting on disk, register? The `id` is the
one the catalogue reports — for it, the id is the file.

It is **slow**, and the reason is the answer: the engine has to load the plugin binary to ask,
which for a big instrument is seconds. It does that on a thread of its own and on an engine that
opens no device, so nothing playing is disturbed — but a caller should expect the wait and say so
on screen rather than looking broken.

Only for **externals**. What the engine ships is answered from `@studio/song`'s generated table
with nothing running at all, which is faster and available with no engine at hand.

`showNativePluginUIOf(format, id)` is the companion, slow for the same reason — it loads the same
binary — but where the first answers with a list of names, this opens what the plugin itself
draws. It is for the module being authored against a plugin the open project does not load, where
a list of names is not enough to know what a knob does. The instance is an **orphan**: the engine
holds it on its offline edit, on no track and no session, so turning a knob there changes no
module, no project and no file. There is no reply either — the window opens on the ENGINE's
screen, which is the musician's machine, and this browser may not be on it.

### Why the reply is called `plugin-param-list`

Not `plugin-params`: that name belongs to the reply carrying a loaded INSTANCE's current values.
The two are different questions — what a plugin type HAS versus what this one is set to — and
sharing a name would feed a type's list (an array) into the live-value path, which reads it as a
map.

The `format` and the `id` ride back with the answer because the ask is slow and a caller may have
moved on or asked about another plugin. Matching on them is what stops a late reply from filling
in the wrong panel.

## Where to put the subscription

At the leaf that displays the number, not at the root that owns the tree — the same rule the
chains renderer's `InputMeterBar` and `FaderMeter` already follow for meter levels. See
`packages/ui-chains-react/docs/hosting.md`.
