# The camera — panning and zooming

`camera.ts` holds the arithmetic; `DomChains` holds the element and one frame loop. The rules
below are about **feel**, and the framing rules — `fitKey`, `fitted` vs `userMoved`, the camera
that survives an unmount — are a separate set, in
[l8's chainsGraph.md](../../../apps/l8/frontend/docs/chainsGraph.md).

## The camera is not React state

This is the load-bearing decision. The camera used to be `useState`, so **every pointer move
of a pan re-rendered the whole graph** — every node, every widget, every fader and meter, plus
the SVG cable layer — and none of it is memoised. All of that to change a translation the
compositor would have done alone.

So the camera lives in refs and is written straight onto `.dgx-world` as a transform. Two
things follow, and both are why it was worth doing:

- **Nothing in the render reads `x` or `y`.** Look for them: there is no consumer. A pan is
  therefore *entirely* free of React.
- **Zoom has exactly three consumers**, and `lodFor` is all of them: `widgets`, `labels` and
  the cable `boost`. Above `WIDGET_MIN_SCALE` — the range where every node draws its full
  panel and a render costs the most — none of the three moves, so zooming there commits no
  state either. Below it the boost is rounded to 5% steps, because a stroke width nobody is
  measuring is not worth re-rendering a graph for.

The `transform` is deliberately **absent from the JSX**. Rendering it would mean React
reasserting a value on every unrelated re-render, fighting the loop for the element mid-gesture.

## One loop, started by a gesture, stopped by stillness

`requestAnimationFrame` is the right clock for this: it is when the browser is about to paint,
so writing the transform any earlier buys nothing, and a trackpad or a 240 Hz mouse firing
faster than the display collapses to one write per frame instead of one per event.

The loop runs while a gesture is live and stops when the camera settles — an idle graph
schedules no frames at all.

## Pan is instant, zoom glides

They are smoothed differently on purpose:

- **A pan tracks the finger 1:1.** Easing it would be lag, not smoothness. It writes the
  current camera and the goal together, so there is nothing to chase.
- **A zoom eases toward a goal.** A wheel notch is a discrete ~10% jump, and applying it whole
  is exactly the step you can see. The glide is exponential with a half-life in **milliseconds**,
  not a fraction per frame: two 8 ms frames on a 120 Hz screen must leave what one 16 ms frame
  leaves at 60, or the same gesture arrives 2.4× sooner on the better screen.

`dt` is clamped, because a backgrounded tab hands back one enormous frame and the glide would
land in a single jump — the one frame where the absence of smoothing is most visible.

A notch multiplies **the goal**, not what is on screen. Spinning the wheel fast therefore
stacks up instead of each notch being swallowed by the one still in flight. A pointer-down on
the canvas cancels the glide where it got to: you are steering now, it should not slide on.

## The anchor is exact for the whole flight

`zoomAbout` keeps the world point under the cursor under the cursor. It is applied on **every
frame** with that frame's own zoom, not once from the two ends — which is what stops the graph
drifting under the pointer during the glide and snapping back at the end.

## The wheel is a PAN. The pinch is the zoom.

`isZoomWheel` is the whole rule: `ctrlKey` (or `metaKey`) means zoom, anything else means pan.

That is not a preference, it is the only signal there is. On a Mac trackpad — and on a Windows
precision touchpad — a **pinch** arrives as a wheel event with `ctrlKey` set, synthesised by the
browser; **two fingers sliding** arrive as a plain wheel with `deltaX`/`deltaY`, indistinguishable
from a mouse wheel. A trackpad has no third thing to send. So as long as the plain wheel zoomed,
every attempt to pan a Mac trackpad zoomed instead, which is exactly what it did here until
10 August 2026.

The cost is stated plainly: **a mouse wheel now pans**, and zooming with a mouse means holding
Ctrl. That is the Figma / Miro / Maps arrangement, and it is the price of the trackpad working
at all — there is no rule that gives a plain wheel to zoom and to pan at once.

Panning moves the camera **with the fingers, 1:1, with no glide** — the same rule a drag follows
(above), because both are a hand pushing the world about and easing that is lag. A slide also
cancels a zoom still in flight, exactly as a pointer-down does. The deltas are screen pixels and
so is the translation, which is why no zoom enters that arithmetic.

## `deltaMode` is not optional

A wheel is measured in pixels almost everywhere, in **lines** by Firefox, and in pages in the
rare full-page mode. Reading a delta raw means one notch moves 100 units in Chrome and 3 in
Firefox: a 30× difference, which does not read as "slower there", it reads as the wheel being
broken. `wheelPixels` normalises all three, and `wheelFactor` is that in an exponent.

The listener is native and `passive: false` — it must `preventDefault` the page scroll anyway,
and being the handler itself avoids a React synthetic event per notch, of which a trackpad
sends a great many.

## The same rule, elsewhere

l8's timeline, piano roll and waveform draw the same line in `usePanZoom.ts`, but not with this
code: those are **scroll containers**, so their pan is the browser's own — a plain wheel is
simply handed back, momentum and axis locking included, and only the pinch is intercepted. A
pane scrolls; this one translates. Shared rule, different mechanism.
