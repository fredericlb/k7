# The waveform widget's draw loop

A waveform widget is a small `<canvas>` on a node, showing the min/max envelope the engine
drains from a tap on that module. It had three separate ways of costing more than it drew, and
they are worth keeping apart because each has its own rule.

## 1. It never stopped

The draw was a self-rescheduling `requestAnimationFrame` with an empty dependency array, so it
ran at the screen's rate — 60, 120 or 144 Hz depending on the monitor — **for as long as the
widget was mounted**. Transport stopped, module silent, tap absent: it drew a flat centre line
sixty times a second anyway, once per widget on screen.

It is now driven by a dirty flag and stops when there is nothing new. The rule is the one
`camera.md` states for the pan and the zoom and `wobble.md` states for the ripple: **started by
an event, stopped by stillness.** A settled graph schedules no frames.

## 2. It measured the DOM inside the draw

`canvas.getBoundingClientRect()` ran on every frame, to decide whether the backing store needed
resizing. That is a style flush per frame per widget — the exact cost the comment on the cable
canvas forbids two thousand lines below in the same file, which took its host size from a
`ResizeObserver` for precisely this reason. The widget now does the same.

The device pixel ratio is still read in the draw, because `window.devicePixelRatio` is a
property read and not a layout read.

## 3. It re-rendered to hand the same numbers to a ref

The envelope came through `useEngineState` with an equality function that returns true only
when **both** arrays are empty:

```ts
(a, b) => a === b || (a.length === b.length && a.length === 0)
```

A frame carries a new array whenever the tap has anything to say, so a live widget re-rendered
on every one of them — and the render body did nothing with the value except assign it to
`envelopeRef`. A React render per frame, per widget, to move a number into a box.

It reads the store directly now (`store.subscribe` into a ref), the way `RecordingPane` and
`useMidiRecording` already did in st0. **A live tap re-renders nothing.** The subscription still
runs on every frame, but it is a map lookup and a length check, and it marks the canvas dirty
instead of the component.

## The cap

The loop is capped at `WOBBLE_FPS` (30), imported from `@studio/ui-chains/cableCanvas` rather
than redeclared — one number for every ornament on this canvas. At a 20 Hz source the cap
essentially never bites; it is there so that a faster engine cannot turn this back into a
screen-rate loop by accident.
