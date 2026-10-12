# Meters at 20 Hz, and the two ways they get expensive

The engine pushes a state frame **20 times a second** — every 50 ms. Every meter on screen is
fed from it. That cadence is the whole design constraint, and both of the mistakes this page
guards against come from forgetting it.

The subscription side is settled, and `engineStore.ts` says why: a frame held on `App`
re-renders the whole tree, so the frame is an external store and each meter subscribes to the
one number it draws. What follows is about what happens *after* a meter decides to move.

## A transition shorter than the gap between frames still never finishes

Give a meter `transition: height .06s linear` and every frame **restarts a transition that has
not finished**: levels arrive every 50 ms, the ease lasts 60 ms. The bar is then permanently in
flight toward a value it never reaches, trailing about one frame behind the signal for ever.
Dropping the ease makes the meter *more* accurate, not less: at 20 Hz a VU already moves
smoothly, and a bar that lands on its value beats a bar that chases it.

The cost is not the easing. It is that `height` **cannot be animated on the compositor**, so
each restart means a restyle, a reflow and a display-list entry on the main thread — one per
fader. It reads plainly in a Firefox profile of playback, zoomed in far enough to draw the
widget grids: `CSS transition` markers on `height`, every one with `oncompositor: False`, and
almost as many `transitioncancel` as `transitionrun` — roughly 200 transitions started per
second, nearly all cancelled by the next frame before finishing.

Over such a window the retained display list stops doing partial updates altogether:
`PreProcessDisplayList` and `DisplayList merging` fall to zero while
`RetainedDisplayList::DeleteAll` rises, meaning Gecko throws the list away and rebuilds it from
the viewport frame on every single frame. That a flood of modified frames is what pushes it
over its partial-update budget is the likely reading, not a proven one.

**The rule:** a transition on a value the engine repaints is almost always wrong. If a meter
ever wants ballistics — a slow release, a peak hold — that belongs in the *number*, computed
once where the frame is read, not in a CSS ease that a later frame will cancel.

## An unrounded fraction re-renders on every frame by definition

`useTrackLevel` and `useInputLevel` return a 0..1 position. Returned raw it would differ on
essentially every frame, so the store's `Object.is` would stop nothing and a silent track would
cost exactly what a loud one does.

They quantise to **200 steps**. That is finer than half a percent of the tallest bar any of
them draws, so nothing changes on screen, but a steady signal re-renders nothing at all.
`TimelineTab`'s `LaneMeter` rounds its dB for the same reason.

Round in the **selector**, not in the component. The selector's result is what `Object.is`
compares; rounding after the hook has returned is rounding a value that already re-rendered.

## Scale the bar, never resize it

Every meter here is a flat block of colour, so `transform: scaleX()` from the left (or
`scaleY()` from the top, for the fader's shade) draws pixel-for-pixel what a `width` or a
`height` would — and a transform is not layout. The elements all carry a fixed `width: 100%` /
`inset: 0` and a `transform-origin`, with only the scale factor coming from the frame.

The same reasoning moves the transports: `TimelineTab`'s `Playhead`, the `Minimap`'s and
`PianoRoll`'s are parked at their left edge and **translated** rather than re-`left`-ed. Those
three also carry `will-change: transform`, which the meters deliberately do not — a playhead is
one node moving continuously for as long as a song plays, which is exactly what promotion is
for, while there is one meter per lane and per node and promoting each would trade a cheap
problem for a layer explosion.

What this does **not** buy is a frame without a new display list. Gecko runs a property on the
compositor for a CSS animation or transition, not for a transform an effect writes; a
JS-driven change still ships a new WebRender scene. What it buys is that the scene costs no
reflow and invalidates a smaller region — the picture cache stops throwing away tiles around
every bar that twitched.

Two sliders inside the widget grid (`w.type === "slider"` and the fader's `fill`/`cap`) still
write `width`/`height`/`top` percentages. They are driven by **plugin parameter** frames rather
than by the engine's state frame, so they only move under automation or a drag, and no profile
has yet put them in the path. Same shape, same fix, when one does.

## The cheapest frame is the one nobody is told about

Everything above makes a frame cheap. The next question is whether it needs sending at all, and
for a stopped transport over silent tracks the answer is no: a frame that goes out every 50 ms,
is parsed, and has every subscriber's selector run over it to conclude that nothing has moved is
N selector runs, twenty times a second, to say nothing.

It is stopped at **both ends**, on purpose, because the two halves fix different failures:

- **`EngineStore.set` drops a frame identical to the one it holds** (`sameFrame`). One pass over
  the frame — scalars, then the three arrays element-wise, then the waveform map by key —
  replaces every subscriber's pass over it. This is the half that works against *any* engine,
  including one that has not been updated, and it is also what covers the case where the engine
  is busy but this particular frame happens to repeat.
- **The engine drops to 4 Hz while a session is idle** (`StateTimer::emit`, `kIdleDivisor`).
  Idle means: not playing, not record-enabled, nothing armed, no waveform tap, no watched
  plugin parameter, and every level under −60 dB. That last clause is not redundant — an
  *audition* sounds without the transport rolling, and a monitored input moves a meter while it
  does. This is the half that also saves the serialisation and the socket traffic, which no
  amount of browser-side cleverness can.

The floor is 4 Hz rather than nothing so that a change made from another tab still lands within
250 ms. Neither half delays a real change: the moment anything is happening, the idle test fails
and the frame differs, so both gates open on the same tick.

## Metering the interface: channel SETS, never raw numbers

`ioLevels` is request/reply rather than a field on the state frame, because asking for it
**enables the input devices it measures**. A surface therefore asks only while the I/O panel is
on screen.

What comes back carries `devices`, the interface's own grouping — `EngineInputDevice`. It is
the one thing that explains a channel that exists and meters nothing, so it must not be dropped
on the way in.

`channels` on such a device is 1-based and is the set `findWaveInput` matches **exactly**: a rig
that pairs its inputs has no device for channel 2 alone, so asking for channel 2 on its own
resolves to nothing and reads as silence. Anything offering a choice of input has to offer these
sets and not raw numbers.

`set-input-stereo` is what makes and unmakes a pair — sent by the file service
(`setInputStereo` in `packages/file-service/src/engineLink.ts`), not by this client. `channel` names the PAIR,
not one side: the interface pairs even/odd hardware channels and nothing else, so 1 and 2 name
the same pair and 2 can never be paired with 3. Nothing comes back — the device layout rides on
`ioLevels`, the only message that carries it, so ask for that again to see the result; the
engine forces the rebuild through before it answers. And the merge **destroys** the two mono
devices, which is the same rule read from the other side: a module still asking for one of those
channels alone now matches no device.

## Waveform taps carry no track index

`subscribeWaveform(id, side)` names a module and a side, and nothing else: the engine finds the
plugin by id and the track from the plugin.

Never send a track index. The graph has none to give, so the only value a caller could invent is
`0` — and an engine that still requires the field **honours** it, metering the song's first
track quietly whatever module you asked about. Omitting the field makes such an engine refuse
the subscription instead, which is the failure you want.

## The O(n²) that isn't worth fixing

`useInputLevel` and `useTrackLevel` each do `order.indexOf(trackId)` inside the selector. Every
metered node scanning the whole track order, twenty times a second, is the textbook shape of an
O(n²) per frame, and any pass over this repo will flag it as one. The measurement is here so
the next one does not spend the afternoon again.

Measured, with realistic track names, over one second of engine frames (20 of them), summed
across every subscriber:

| tracks | `order.indexOf` | a memoised position map |
|---|---|---|
| 15 — the real song | 0.01 ms | 0.03 ms — **slower** |
| 100 | 0.10 ms | 0.02 ms |
| 250 | 0.54 ms | 0.09 ms |

At 250 tracks — sixteen times the size of a real song — the whole thing costs 0.05% of one core,
about 0.1 µs per subscriber per frame. The alternative is a `WeakMap` on the `order` array
holding a `Map` of positions; it wins above roughly 50 tracks and **loses below them**, because
building the Map costs more than the scan it replaces, and the arrays it would be keyed on are
rebuilt whenever the host re-renders.

Read the table as an order of magnitude, not a reading. The same microbenchmark gave anything
from 0.1 to 11 ms/s for the same operation depending on how the id strings were constructed —
common prefix length, whether V8 had interned them — and that spread is itself the answer: this
sits below the React bookkeeping that surrounds it. The costs that *do* show up on a frame are
the ones the rest of this page is about — the re-renders, and the frames that need not be sent.

If a project ever does carry hundreds of tracks, the thing to reach for is not the lookup. It is
the number of subscriptions: one `useSyncExternalStore` per metered node, each checked on every
frame, is the term that grows.
