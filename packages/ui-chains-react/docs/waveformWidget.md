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
`useMidiRecording` do in st0. **A live tap re-renders nothing.** The subscription still runs on
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
