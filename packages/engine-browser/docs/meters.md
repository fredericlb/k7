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
