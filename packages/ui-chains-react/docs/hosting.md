# Hosting the graph — extended notes

## What this package is, and what it is not

`DomChains` is the RENDERER: HTML nodes over a canvas of signal cables, an SVG layer between
them for what does not move (labels, automation arrows, hit paths), the camera, the widgets,
the interaction. It draws what `@studio/ui-chains` laid out and knows nothing about where
a graph came from.

A host owes the cable canvas nothing — it sizes itself off the graph host and draws itself
outside React — but it does need the host to give `DomChains` a real size, which `fit()` also
requires. See `@studio/ui-chains`' `docs/wobble.md` for why the cables are not DOM.

What stays in each app is the **shell**: fetching `/graph`, the reload polling, the chain
list beside the canvas, the parked camera (a graph unmounts with its pane, so the camera
has to live above it), and optimistic state like a pending bypass. st0' `ChainsTab` is
~560 lines of that against ~2500 shared here.

There is deliberately no `ChainsShell` yet. Promote one when two apps have written the
same sidebar — guessing it now would be guessing.

The camera is the one piece of that shell the package does name: `Cam` and `CamStore` are
exported, because otherwise every surface writes `useRef<{x,y,k}|null>(null)` with its own
near-identical comment over it. A shape is not a sidebar; it is worth naming early.

## What a host must supply

**`icons` — required, and the compiler enforces it.** The glyphs are the app's vocabulary,
not the graph's: st0 draws the same track icons in its mixer and its timeline, so they
cannot live here without those two importing a chains package. They reach the nested node
components through a context, but the PROVIDER is not a caller's job — the component takes
`icons` as a required prop and provides it itself. There is no arrangement in which a host
forgets and the graph throws at render.

They reach `Node` through a context rather than through props because it is nested several layers
down, and threading them through every layer is the kind of thing that made `DomChains.tsx` grow
the way it did. The throw in `useIcons` is unreachable: the compiler is the guarantee.

`icons` carries one thing that is not a glyph: **`trackLabel`**, a lane's name without the
instrument code its icon was picked from. It rides here rather than in the graph document because
it is the same knowledge and the same table — which codes exist is `@studio/song-schema`'s, and a
package that draws a graph must not depend on the one that parses a song. It is the only OPTIONAL
member: a host that supplies none gets full names, which is merely plainer, never wrong.

The MODULE glyph is the exception, and `moduleIcons.tsx` ships it: it is keyed on
`WebModuleCategory`, which is the graph's own vocabulary, and its only consumer anywhere was the
chains icon table. `Glyph` — a viewBox and a body — is declared there rather than imported from
st0's `trackIcons` where it started, because that file stayed in the app for the reason above.
Two fields is a cheaper duplication than the coupling.

**`runCommand`** (the `command` prop) — a `@studio/commands` SID line. Every app that can
edit a graph has one.

**Live engine state**, through `@studio/engine-browser`: `engineStore` for meters and the
playhead, `params` for the ~20 Hz plugin parameter feed. Both are external stores, so a
frame re-renders the node that reads it and nothing else.

### Can this host TAKE a value back? — the writability flags

`Channels` carries a pair of booleans per value channel, and they answer different questions.
`offlineChannel` asks whether the host handles module params at all — an EMPTY map is a
legitimate state (nothing set yet), so the offer has to be a fact of its own rather than inferred
from the map's size. `offlineWritable`, `pluginWritable`, `trackWritable` and `rackTriggerable`
then ask whether it can take one BACK.

Showing without taking is legitimate: the desk's graph knows a deck's tempo while the desk that
sets it is unmounted. What is not legitimate is a knob that turns against a host with nowhere to
put the value, and that lie is what the second half of each pair exists to avoid. Nothing else
catches it: the send is an optional call (`setPluginParam?.()`, `onTrackSet?.()`), so a host that
passes neither still gets a widget that drags, moves its optimistic override, sends nothing, and
has no engine frame coming to correct it. A pad on a host that cannot make a sound is likewise
drawn and inert, never clickable-and-silent.

`rehearsal` is the fifth, and it is not one of the pair: it says there is nowhere to send a value
and none is needed, because the override IS the value. Without it the module builder's card draws
every widget read-only until a plugin happens to be loaded — which is exactly the panel you
cannot try out yet. See `ModulePreview.tsx` above.

More precisely, `rehearsal` means **a picked module FIELD is shown and never written**. A field is
normally committed by a command that edits a file, and in the builder there is no project node for
that command to reach — so a base dropdown would either write into somebody else's song or do
nothing at all, and either way the panel being written could not be tried out. Only fields are
held back:
a plugin PARAM still goes down the socket, because the plugin behind a preview is an orphan
instance no project owns, turning its knobs is how you hear the module, and nothing about it is
saved either.

### `moduleParams` — a value the graph cannot ask the engine for

`offline` modules compile to nothing the engine holds — a deck's tempo is one — so there is no plugin
to ask and no id to ask it by. Their value lives on whichever surface REALISES them (for the
tempo, the desk that warps the clip), and this prop is how that surface lends it to the graph.
Without it such a widget draws the number the file declares and never changes, which reads as a
knob stuck on its default. Passing it — or `onModuleParam` — is what turns those widgets on at
all: a host that offers neither keeps them inert rather than showing a control that turns against
nothing.

`trackInputs` is a plain record for the same reason, like `engineWarnings` beside it: it is what
the HOST knows about a live input and the graph does not. The chip is drawn only where
`onPickTrackInput` is also given, so a host that cannot change one never shows one.

### `onAlternative` and `onTriggerRack` — what the graph refuses to own

A node's alternative badges say WHICH set was clicked — a name to switch to, or null for the `+`
that copies the one on — and stop there. Running the verb is the host's, because it lands in the
host's undo and reloads the host's project. The badges exist only when the callback is given, like
the command bar and the edge inserts.

`onTriggerRack` is the same shape: the graph says WHICH sound was asked for and stops there. How
one is made audible is the host's — st0 auditions the sample through the file service, the
médiathèque could preview it from its own catalogue — and a host that offers nothing leaves the
pads drawn but silent, which is the right degradation for a surface with no engine behind it.

### `row` — a graph read across

st0's mixer view. It changes what the navigation MEANS rather than what it looks like: the wheel
walks along the row instead of zooming, and nothing pans vertically, because there is one line of
cards and everything above or below it is empty. The cards, the cables and the zoom are untouched.

### The right-click vocabulary — `GraphMenuCtx`

The union is the graph's OWN vocabulary, not the shell's. st0's `MenuCtx` is a superset covering
timeline things (markers, clip placements) this has no way to produce; declaring the narrow union
here is what lets the component say what it emits instead of importing an app's idea of a menu,
and a host whose own type is wider accepts a handler for it unchanged.

`param` is distinct from `module` because the answer is about one KNOB: a MIDI binding is per
param, and the module menu has nothing to say about which one you were pointing at.

### The sink's play button — `SinkPlay`

Opt-in and absent by default. It sits on the OUTPUT and not on the input, because what you want
to hear is the signal after everything in the chain has had it. st0 has a transport of its own
and the desk has a deck, so neither wants a second play button inside the graph; a host with
neither is why the prop exists.

### The parked camera — `CamStore`

Named so it is one thing, rather than a `useRef<{x,y,k}|null>(null)` per surface with a
near-identical comment above each. The graph is torn down with its pane, so the pan and zoom have
to be held by something that outlives it (`apps/st0/frontend/docs/chainsGraph.md`). A host that
omits it gets a fresh frame on every reopen, which is a choice, but rarely the intended one.
`Cam` itself lives in `camera.ts` with everything else that moves it, and is re-exported from
`DomChains.tsx` because a host imports it from the package entry.

**Stable props, and this one is not decoration.** Every node and every widget is memoised, so
a prop whose identity changes on each of the host's renders undoes that for the whole graph.
The ones that matter: `icons` (it reaches the nodes through a context, and context bypasses
`memo` — every app passes a module-level constant, keep it that way), `onWatchWaveform` and
`sinkPlay`. Hoist them to module scope or wrap them in `useCallback`/`useMemo`; an inline
object or lambda in the host's JSX is enough to re-render every card on every frame.

Everything the host passes as a *callback* is already safe — the renderer reads those through
a ref and binds its own handlers once, precisely so a host is free to pass inline lambdas
(st0's `App` does). It is the non-callback props above that have no such shelter.

Why this is load-bearing: the plugin-param subscription sits on each individual widget rather
than at the root of the graph, so a frame is meant to redraw one control. A churning prop puts
the whole-graph cost back. See `@studio/engine-browser`'s `docs/params.md`.

The engine store is **optional, and the component provides one when you don't** — the same
arrangement `icons` has, for the same reason. `InputMeterBar` renders under every track node
unconditionally, so without the fallback a host drawing a graph outside an
`EngineStoreProvider` throws `useEngineStore used outside <EngineStoreProvider>` at render —
which a module preview and a deck panel both do. Wrap the graph in your own provider to show
live meters; pass nothing and they
read silent, which is the truth for a host with no engine.

### Modules the engine has never heard of — `moduleParams` / `onModuleParam`

Optional, and off unless you pass one of them.

A widget normally resolves to a PLUGIN param, addressed by the step's `pluginId`. An
`offline` module has none: the compiler reads the type and emits no plugin at all, so there
is nothing to watch and no id to watch it by. Its widgets therefore draw nothing and refuse
the hand — correct, and the reason `buildGraphDoc` invents no id for them.

But the value is not nowhere. It lives on whichever surface REALISES the module — a deck's tempo
becomes a clip warp on the desk — and these two props are how that surface lends it:

- `moduleParams: { [module]: { [param]: number } }` — keyed by MODULE name, since there is no
  plugin id to key by. Consulted before the value the file authored.
- `onModuleParam(module, param, value)` — the way back, per frame during a drag.

They are separate because **showing and taking are separate abilities**. The desk's graph can show
a deck's tempo while the desk that sets it is unmounted, and cannot take a new one: realising
a tempo needs that desk's songs and its document. Pass only `moduleParams` and the widget is
read-only — drawn from a value it cannot change, rather than a knob that turns against
nothing. That distinction is the whole point of the pair; a single prop would bring back the
lie the missing `pluginId` avoids.

A host that passes neither is unaffected: it draws those widgets inert. st0 is the only host
that draws a graph.

## What it emits

`onContextMenu(ctx, x, y)` carries a `GraphMenuCtx` — four kinds, the ones a node can be:
`track`, `module`, `chain`, `sink`. That is the graph's own vocabulary. st0' `MenuCtx` is
a superset covering timeline things (markers, clip placements) this cannot produce, and a
host whose type is wider accepts the handler unchanged.

### The patch cable — `onConnect(from, to)`

Click a free OUTPUT jack and a dashed cable follows the cursor; click a free INPUT jack of
the same signal and `onConnect` fires with both ends as **graph.yaml addresses** — `name` or
`name#port`, resolved by `jackRef` exactly as `insertFor` resolves the edge inserts — so a
host can run `graph chain connect from to` verbatim. Esc or any right-click drops the cable in
hand (capture-phase, so neither the host's own Esc handling nor a node menu acts on a press
that only meant "never mind"); a second output click restarts the cable there instead.

The prop is optional and is the gesture's switch: a host that passes nothing keeps inert
sockets, which is what the médiathèque's read-only views and the desk want — the same rule
as the command bar and the edge inserts. Signal compatibility is enforced at the socket (a
midi cable is never offered an audio input); everything else — does the node exist, is the
arrow already there — is the verb's to refuse, because the graph on screen can be older
than the file.

Two siblings complete it, `onDisconnect(from, to)` and `onReplug(from, to, newFrom, newTo)`
(→ `graph chain disconnect` / `graph chain replug`), and together they make cables MOVABLE: clicking an
OCCUPIED jack lifts the cable end plugged into it — the other end stays put, the drawn cable
steps aside for its dashed ghost, and the loose end seeks a jack of the side it came off
(free, same signal). Landing runs the replug, one verb and one undo step for one gesture;
clicking the BARE canvas deletes the arrow (a new cable dropped there simply ceases — it
never existed); Esc or right-click puts it back, writing nothing. A jack carrying several
cables lifts the first — the other end of any of them is one more click away. Lifting is
offered only when both callbacks are given, so a drop always has somewhere to go; automation
plugs lift nothing, their bindings being the module's to edit.

Mechanically: the temporary cable is one dashed path in the world-space SVG, its far end
moved by direct DOM writes on pointermove (no re-render per frame), its near end pinned at
`jackPoint`'s own coordinates so it cannot miss the socket it left. Landing it is the one
place the renderer converts screen to world (the camera's inverse), and only while a cable
is in hand does the host div listen to pointermove at all.

**A host that draws the same cards owes them the same callbacks.** Nothing here can enforce it: a
control whose callback is missing draws anyway — greyed where the widget knows (`actuable`), inert
where it does not (a `filepicker`'s button is enabled whenever the node has a module, since what it
opens is the host's popup and only the host knows whether it has one). st0 draws a graph in three
places — the chains pane, the editor column's panel and a lane's own row — and each one is a separate
prop list; a callback added to one and not the others is a card that works in one view and not in the
next, which reads as a broken app rather than as a view that offers less. `apps/st0/frontend/docs/shell.md`
lists what a lane's row deliberately leaves out, and why those are not the same kind of omission.

`onEdgeInsert` follows the same rule as the sockets below it: **no handler, no `+`**. The
eligibility of an arrow is one thing (`insertFor` — at least one end a module) and whether anything
can answer the click is another, and drawing the affordance on the first alone put a hover target
with a `+` in it on every cable of a read-only snapshot and of a lane's own row. A `+` that does
nothing does not read as "not offered here": it reads as a click that missed.

`onConnect` and `onDisconnect` are optional, and the jacks are clickable only when they are
given: pl8's read-only views and the desk pass nothing and keep their inert sockets, the way they
pass no command bar. LIFTING in particular needs BOTH `onDisconnect` and `onReplug` — the jacks
offer to pick a cable up only when the drop has somewhere to go. Esc or any right-click drops the
cable in hand. `onAutomate` is one callback for BOTH curve cables, because both write one line of
the same verb; absent, the curve sockets are inert and no card offers to take one.

**Which jacks are armed.** At rest, a free OUT starts a new cable and any OCCUPIED jack lifts the
cable end plugged into it — only a free IN answers to nothing, having nothing to give. With a
cable in hand, exactly the jacks that can LAND the loose end light up: the seeking side, free, and
the same signal, because a midi cable has no business in an audio socket. And never back onto the
node the cable LEFT: `graph chain connect` refuses that outright ("can't connect 'x' to itself"),
so offering the socket would only promise a landing the verb throws out. It matters because a
lane has an input, which puts a free socket on the very node most cables leave from.

**The plate and the cable end are one place drawn twice.** A socket's `left` is spread across the
card's WIDTH — signal runs down, so the sockets are on the top and bottom edges — and that
arithmetic must agree with `jackPoint`, which is where the cable's end is computed. A disagreement
reads as a cable that misses its socket.

An ENVELOPE's event socket is drawn whether or not it can take a cable, because the socket is what
says what the curve is; but it only lights, and only answers, when the curve is BOUND — the
trigger is written onto the binding, and a free card has none to write it on.

**Three kinds of cable, landing on three different things.** `signal` runs socket to socket and is
gated by type. `automation` leaves a curve and lands on a WIDGET — a knob, not a hole — which is
why the landing test could not simply be widened. `event` runs socket to socket again, but only
from a module's note-on into an envelope's ear.

The two curve cables commit through ONE callback, `onAutomate`, because both write one line:
`node automate <module> <param> <curve> [trigger]`. An automation cable supplies the first three;
an event cable supplies the trigger and reads the other three off the envelope it landed on —
which is why a curve node carries its binding (`curveOf`) rather than having it parsed back out of
an id.

### The pin — `onMoveNode(module, x, y)`

Drag ANY node's header and drop it: `onMoveNode` fires with the node's name — a module or a
track by its chains name, a curve by its curve id, the sink by "OUT"; all `jackRef`'s answer —
and the drop in whole world px, ready for `graph move` verbatim, which
writes graph.yaml's `positions:`. The layout (`layout()`'s `positions` argument) then places
only the nodes with no pin, so dagre keeps laying out new arrivals while a moved card stays
put for ever.

**Either sign.** A drop above the first track or left of it reports a negative coordinate, and
that is a place like any other: `layout()` reports where the drawing BEGINS (`left`/`top`) next
to how far it reaches, and the camera fit frames that box rather than `width × height` from the
origin. Clamping at `0,0` instead reads as a card sticking to the top edge and sliding
sideways under the hand.

**Zoomed past the widgets there is no header**, so the whole card takes the press instead (see
`Node`'s far branch). The gesture is the same one — a graph you have to zoom INTO before you can
rearrange it stops answering exactly when the arrangement is what you are looking at.

The rule behind the uniformity: **everything that can be added to the graph is a node.** A
curve is not a per-binding stamp — it draws ONCE, with one automation edge per param it
drives, exactly as a module feeding two places is one card with two cables — so "where is
this curve" has one answer and one pin.

Optional and gating like every gesture here: no `onMoveNode`, no draggable headers — and never
in the `row` arrangement, whose whole point is that the strips sit on a line. During the drag
the card moves by an inline transform (React never fights the hand) and its cables follow
through the same rebuilt-geometry path a node motion takes — springs included, so the slack
swings. The transform survives the DROP until the graph containing the write arrives, and the
drop pre-seeds the motion planner's drawn map, so the card neither snaps home for the length of
the round trip nor slides to where it already is. A press that never travelled stays a click.

## The module preview — what is wired, and what is left at rest

`ModulePreview.tsx` is the second host in this package: the module being edited, drawn as the
card it will be in a chain, through the same `buildGraph` → `layout` → `DomChains` pipeline the
full graph takes. Its props are a short list, and each one exists for a reason worth stating.

**`command`.** A preview writes nothing of its own — see `rehearsal` below — so this is only
ever reached by a node's own menu. A host with no command bar passes one that says so out loud.

**`ui`, the grid AS EDITED rather than as saved.** The whole point is to see a widget land
before saving it.

**`bases`, the named bases the module may be set to** — its own `base/` folder plus its
ancestors'. A widget bound to `@base` says nothing about its own entries: the folder's contents
change every time a base is snapshotted, so the graph fills them at draw time and this prop is
where they come in. Without it that dropdown draws "none" alone, and the one thing you cannot
check by reading the panel you just wrote is the one thing the preview would not show.

**`sourceInput` / `onPickSourceInput`.** The source node is a placeholder in this graph
("whatever will feed this"), and an interface input is what makes it a real one — so the module
can be HEARD treating something you play rather than only inspected. Both props or neither: the
chip is a control, and one you cannot click is worse than none. It is keyed by the source node's
id, which is the graph's own name for the placeholder, `PREVIEW_SOURCE`.

**`sourceArmed` / `onToggleSourceArm`** — the `A` button every track node's mixer strip draws.
The strip is part of `TRACK_UI` and is drawn whether or not a host wired the callbacks, so
unwired it reads as a graph you cannot touch. Here it means "let this input through", the only
thing a preview's source can do. The other four
strip controls are left at rest rather than wired to commands this graph has no way to carry
out — a preview's source has no volume to ride and nothing to be muted against.

**`paramsStore` / `onSetParam`** — the loaded plugin's live values and how to change one, what
makes the module's own widgets SOUND rather than merely move. Both or neither. They do not decide
whether a widget answers the mouse: under `rehearsal` every widget turns and holds its position
locally, because a panel is authored long before any plugin is loaded and "is this dropdown the
right way round" is a question about the panel, not about the plugin. What these two add is the
sound.

**`rehearsal`, always on here.** This card is the panel being WRITTEN, tried out. A module field
is committed by a command that edits a file, and the builder has no project node for one to
reach — so a base dropdown here shows the entry you picked and leaves the module alone.

Two more, about the view rather than the module. The **camera lives outside the graph**: the
panel unmounts whenever the editor closes, and a camera that reset on every remount would fight
the person using it. And `fitKey` is the grid's `cols × rows`, so the view re-frames when the
card's SHAPE changes — adding a row should fit the new picture, renaming a label should not move
the camera.

## Styling: one injected sheet

The stylesheet is injected by the component and scoped under `.dgx`, which is what lets it
drop into a host with any CSS setup — no import, no Tailwind config, no build step.

It defines its own `--sand`, `--mauve`, `--card`, `--line`, `--dim` and `--faint`, and
`--accent` **per node kind** — a track, a module and a sink take `--sand`, a curve `--mauve`,
a stub red, an unsupported plugin amber. The accent dot, the selected node's border tint and
the badge read it from whichever node they are inside.
