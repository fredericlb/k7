# The waveform widget's draw loop

A waveform widget is a small `<canvas>` on a node, showing the min/max envelope the engine
drains from a tap on that module. Three rules keep it from costing more than it draws, and they
are worth keeping apart because each has its own reason.

## 1. It stops

The draw is steered by a dirty flag and schedules nothing when there is nothing new. A
self-rescheduling `requestAnimationFrame` with an empty dependency array runs at the screen's
rate instead — 60, 120 or 144 Hz depending on the monitor — **for as long as the widget is
mounted**: transport stopped, module silent, tap absent, it still draws a flat centre line sixty
times a second, once per widget on screen.

The rule is the one `camera.md` states for the pan and the zoom and `wobble.md` states for the
ripple: **started by an event, stopped by stillness.** A settled graph schedules no frames.

## 2. It does not measure the DOM inside the draw

The host size comes from a `ResizeObserver`, the way the cable canvas takes its own.
`canvas.getBoundingClientRect()` in the draw — to decide whether the backing store needs
resizing — is a style flush per frame per widget, the exact cost the comment on the cable canvas
forbids two thousand lines below in the same file.

The device pixel ratio IS read in the draw, because `window.devicePixelRatio` is a property read
and not a layout read.

## 3. It does not re-render to hand the same numbers to a ref

It reads the store directly (`store.subscribe` into a ref), the way `RecordingPane` and
`useMidiRecording` do in k7. **A live tap re-renders nothing.** The subscription still runs on
every frame, but it is a map lookup and a length check, and it marks the canvas dirty instead of
the component.

Through `useEngineState` it would not. The equality function that returns true only when **both**
arrays are empty:

```ts
(a, b) => a === b || (a.length === b.length && a.length === 0)
```

re-renders a live widget on every frame the tap has anything to say, since a frame carries a new
array whenever it does — and the render body does nothing with the value except assign it to
`envelopeRef`. A React render per frame, per widget, to move a number into a box.

## The cap

The loop is capped at `WOBBLE_FPS` (30), imported from `@studio/ui-chains/cableCanvas` rather
than redeclared — one number for every ornament on this canvas. At a 20 Hz source the cap
essentially never bites; it is there so that a faster engine cannot turn this back into a
screen-rate loop by accident.

## A take is folded as it grows

A recorder's card draws the whole take, decimated to the card's width keeping the extremes. The
take only grows — the store pushes onto one array and starts a new one for a new take — so the
card folds each paint's NEW points into buckets it keeps (`GrowingDecimate`, in
`packages/ui-chains/src/decimate.ts`) rather than decimating the whole take again: an hour of take
is some forty thousand points, and a rolling take paints up to thirty times a second.

The STORE accumulates the take, not the card: the whole picture arrives in ONE frame when the
socket connects, often before the card exists (engine-browser's `takeEnvelope.ts`), and a card
folding it itself would miss that frame every time. Averaging the points instead of keeping the
extremes would draw a quiet take.

The buckets have power-of-two widths with fixed edges, which is what lets an append touch only the
last one; when they outnumber the pixels, pairs merge. So a long take draws between half the width
and the width in points rather than exactly the width, and every extreme survives either way.

## The two labels are DOM, and they DO re-render

Everything above is about keeping the envelope out of React. A recorder's card carries two things
that go the other way — `no record` when the node holds nothing, and the take's clock over the
picture — and both are ordinary elements over the canvas rather than text drawn into it.

The rule is not contradicted, because these are not per-frame data:

- **Text on a canvas costs a repaint of the whole box** to change one character, and it would have
  to be re-measured, re-shaped and re-rasterised on every one of them. Two absolutely-positioned
  spans cost the compositor nothing and are stylable in the same stylesheet as the rest of a card.
- **`useTakeReadout` compares on the TEXT.** It subscribes to the store the same raw way the
  envelope does, but hands back the same object unless the string changed — so a 20 Hz frame
  re-renders the card about ten times a second while a take is rolling, and never at all while one
  is not. The envelope would have been a render per frame per widget for ever.

The message and the waveform are exclusive: `blankRef` tells the paint to clear and return, so
nothing is drawn beside those words — not even the centre line an empty envelope would draw. It is
a ref, so the paint reads it without a dependency; an effect on the boolean asks for the one frame
that makes the change visible.
