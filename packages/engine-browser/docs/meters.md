# Meters at 20 Hz, and the two ways they got expensive

The engine pushes a state frame **20 times a second** — every 50 ms. Every meter on screen is
fed from it. That cadence is the whole design constraint, and both of the mistakes this page
records come from forgetting it.

The subscription side is already right, and `engineStore.ts` says why: a frame held on `App`
re-rendered the whole tree, so the frame is an external store and each meter subscribes to the
one number it draws. What follows is about what happens *after* a meter decides to move.

## A transition shorter than the gap between frames still never finishes

`.dgx-fmeter i` — the shade that masks a fader's VU ramp from the top down — carried
`transition: height .06s linear`. Levels arrive every 50 ms; the ease lasted 60 ms. So every
frame **restarted a transition that had not finished**, and the bar was permanently in flight
toward a value it never reached, trailing about one frame behind the signal for ever. Removing
it made the meter *more* accurate, not less: at 20 Hz a VU already moves smoothly, and a bar
that lands on its value beats a bar that chases it.

The cost was not the easing. It was that `height` **cannot be animated on the compositor**, so
each restart meant a restyle, a reflow and a display-list entry on the main thread — and there
is one of these per fader. A Firefox profile of l8 during playback (~17 s, zoomed in far enough
to draw the widget grids) counted:

- **1 693 `CSS transition` markers, every one of them on `height`**, every one with
  `oncompositor: False`;
- **3 386 `transitionrun` against 2 930 `transitioncancel`** — roughly 200 transitions started
  per second, and almost all of them cancelled by the next frame before finishing.

Over the same window the retained display list stopped doing partial updates altogether:
`PreProcessDisplayList` and `DisplayList merging` fell to zero while
`RetainedDisplayList::DeleteAll` rose, meaning Gecko threw the list away and rebuilt it from
the viewport frame on every single frame. That a flood of modified frames is what pushed it
over its partial-update budget is the likely reading, not a proven one.

**The rule this leaves:** a transition on a value the engine repaints is almost always wrong.
If a meter ever wants ballistics — a slow release, a peak hold — that belongs in the *number*,
computed once where the frame is read, not in a CSS ease that a later frame will cancel.

## An unrounded fraction re-renders on every frame by definition

`useTrackLevel` and `useInputLevel` return a 0..1 position. Returned raw, it differs on
essentially every frame, so the store's `Object.is` never stopped anything and a silent track
cost exactly what a loud one did.

They quantise to **200 steps** now. That is finer than half a percent of the tallest bar any of
them draws, so nothing changes on screen, but a steady signal re-renders nothing at all.
`TimelineTab`'s `LaneMeter` had been rounding its dB for exactly this reason from the start,
with a comment saying so — the graph's own meters simply never got the same treatment.

Round in the **selector**, not in the component. The selector's result is what `Object.is`
compares; rounding after the hook has returned is rounding a value that already re-rendered.

## Scale the bar, never resize it

Every meter here is a flat block of colour, so `transform: scaleX()` from the left (or
`scaleY()` from the top, for the fader's shade) draws pixel-for-pixel what a `width` or a
`height` did — and a transform is not layout. The elements all carry a fixed `width: 100%` /
`inset: 0` and a `transform-origin` now, with only the scale factor coming from the frame.

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

Everything above makes a frame cheap. The next question is whether it needed sending at all,
and for a stopped transport over silent tracks the answer is no — yet a frame still went out
every 50 ms, was parsed, and had every subscriber's selector run over it to conclude that
nothing had moved. That is N selector runs, twenty times a second, to say nothing.

It is now stopped at **both ends**, on purpose, because the two halves fix different failures:

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

## The O(n²) that isn't worth fixing

`useInputLevel` and `useTrackLevel` each do `order.indexOf(trackId)` inside the selector. Every
metered node scanning the whole track order, twenty times a second, is the textbook shape of an
O(n²) per frame — and it has been written up as one, by a standing pass over this repo. It is
recorded here so the next pass does not spend the afternoon again.

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
