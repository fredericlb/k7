# The camera — panning and zooming

`camera.ts` holds the arithmetic; `DomChains` holds the element and one frame loop. The rules
below are about **feel**, and the framing rules — `fitKey`, `fitted` vs `userMoved`, the camera
that survives an unmount — are a separate set, in
[k7's chainsGraph.md](../../../apps/k7/frontend/docs/chainsGraph.md).

## The camera is not React state

This is the load-bearing decision. The camera lives in **refs** and is written straight onto
`.dgx-world` as a transform. As `useState`, **every pointer move of a pan would re-render the
whole graph** — every node, every widget, every fader and meter, plus the SVG cable layer, none
of it memoised. All of that to change a translation the compositor would have done alone.

Two things make it hold:

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
from a mouse wheel. A trackpad has no third thing to send. So a plain wheel that zooms turns
every attempt to pan a Mac trackpad into a zoom.

The cost is stated plainly: **a mouse wheel pans**, and zooming with a mouse means holding
Ctrl. That is the Figma / Miro / Maps arrangement, and it is the price of the trackpad working
at all — there is no rule that gives a plain wheel to zoom and to pan at once.

Panning moves the camera **with the fingers, 1:1, with no glide** — the same rule a drag follows
(above), because both are a hand pushing the world about and easing that is lag. A slide also
cancels a zoom still in flight, exactly as a pointer-down does. The deltas are screen pixels and
so is the translation, which is why no zoom enters that arithmetic.

## A pinch, where there is no wheel at all

The touchscreen gesture uses **touch events** rather than the pointer flow the rest of the file
runs on: that flow drives node drags, widget drags and cable draws, and a second finger arriving
mid-gesture would be read as a second drag. Here the rule is simply "two fingers means zoom", and
the pan in progress is dropped.

It is measured from the camera the gesture STARTED on rather than frame to frame, because a ratio
of ratios accumulates rounding — pinch out and back in, and you would not land where you began.
`zoomAbout` reads the camera it is given, so handing it the gesture's own start is what makes the
whole pinch absolute. It is written straight onto `cam` with no glide: the fingers are the
animation.

## A host may keep every card whole

`alwaysDetailed` turns the far LOD off: `widgets` and `labels` read as on at any zoom, and only the
cable `boost` still follows the camera. It is for a view whose cards ARE the subject — k7's
per-track row, a handful of one lane's modules — where a card collapsing to its name is a card you
came to look at and can no longer use. The full graph keeps the LOD, because at the zoom that
frames forty nodes the panels are unreadable and are the costliest thing to render.

The cost is the one the LOD exists to avoid: a whole panel drawn at a scale where nobody can read
it. On a row it is bounded by the lane's length, which is why it is a host's choice and not a
default.

## A ROW is navigated differently

When the graph is arranged as a row (k7's mix panel), the wheel walks ALONG it and nothing moves
vertically — there is only one line of cards, and a view that drifts off it is a view of nothing.
The same holds for a drag: both axes normally, but a row drops the vertical, since a gesture with
only one useful direction out of two is worse than one with a single honest direction. The wheel
takes whichever axis the device reports, because a mouse has no `deltaX` to offer and its notch
has to drive x here.

## A FIXED camera belongs to the fit

`fixed` turns every gesture off: no wheel, drag, pinch or double-click moves the camera. Because
no gesture ever takes the camera, the fit is never given up, and the ResizeObserver re-frames on
every resize. It is for a graph sized to be framed exactly: k7's pinned mixer column, whose
width is the card's aspect ratio at the pane's height (`@studio/ui-chains`'s docs/graphBuild.md).
A camera you could scroll there would only move the card out of its own column.

## `deltaMode` is not optional

A wheel is measured in pixels almost everywhere, in **lines** by Firefox, and in pages in the
rare full-page mode. Reading a delta raw means one notch moves 100 units in Chrome and 3 in
Firefox: a 30× difference, which does not read as "slower there", it reads as the wheel being
broken. `wheelPixels` normalises all three, and `wheelFactor` is that in an exponent.

The listener is native and `passive: false` — it must `preventDefault` the page scroll anyway,
and being the handler itself avoids a React synthetic event per notch, of which a trackpad
sends a great many.

The RATE is a separate question from the units, and it does not live here: `wheelFactor`
normalises with `wheelPixels` and then defers to `zoomGesture` in `@studio/ui-chains`, because
that is the half of the graph with tests and because the arrangement panes settle the same
question the same way. A trackpad pinch cannot share a notch's coefficient — a notch is one
event with a large delta, a pinch is dozens of small ones a second, so one coefficient for both
makes the pinch crawl.

## Telling a mouse wheel from a trackpad

`isMouseWheel` exists because the two arrive as the same event and mean opposite things: a wheel
is a **detent**, discrete, and the natural thing for it to do on a graph is zoom; a trackpad
slide is a hand pushing the view about, and zooming there turns every attempt to pan a Mac
trackpad into a zoom. So the two are told apart rather than legislated over.

Three signals, most reliable first:

1. **`deltaMode` other than pixels** — lines or pages. Only a real wheel is ever reported that
   way (Firefox does it for mice), so it settles the question on its own.
2. **`wheelDeltaY`**, the legacy field Chrome and Safari still carry. A mouse reports it in
   multiples of 120 — the detent, from the Windows API that named it — while a trackpad reports
   three times its pixel delta, which lands on 120 only by accident. This is what separates a
   Mac trackpad from a Mac mouse, and nothing standard does.
3. Failing both (Firefox in pixel mode), **the shape of the delta**: a notch is integral, has no
   horizontal component, and is large, where a finger's is small and often fractional.

It is wrong in one direction only, by design: an unrecognised device is treated as a surface, so
it pans. A trackpad that zooms is a broken trackpad; a mouse
that pans is merely a mouse that does not zoom yet.

## Framing a set — `fitTo`, and the camera a host borrows

`fitTo` answers whether it actually FRAMED. A host with no size yet — a pane still hidden, a
canvas one render early — frames nothing, and a caller that recorded that as done would never try
again. So it is asked, and retried on the next render.

`axis: "height"` fills the height and lets the set run off the right, where it pans. That is for a
ROW: fitting both axes divides the pane between however many members it has and the scale falls
with each one, and below `WIDGET_MIN_SCALE` the widget grid is dropped altogether — so a wide
enough row would frame to a rank of bare name cards. `zoom` multiplies the fitted zoom, and below
1 it pulls BACK from a perfect fit, which is what a view wants when the set it framed is the
subject and not the whole story: the mixer row asks for 0.8, so the cards that feed the strips
stay in the frame around them.

`ChainsCamApi`'s `get`/`set` are for a view that TAKES the camera and owes it afterwards — the
mixer arrangement borrows it to show the row and hands it back when it closes. It reads the LIVE
camera rather than the parked one (`camStore`, written only when a glide settles), which is the
difference between restoring where you were and where you last stopped.

## A frame that spills is left-aligned

`frameOriginX` centres a fitted set across the pane, except when the content is wider than the
pane. Centring a spilling set puts its middle on screen and hides both ends — and for a rank of
channel strips the first one is precisely what you look for to know where you are. So a spilling
set is left-aligned inside the same margin the pad allows, and its tail runs off the right where
it pans.

## The same rule, elsewhere

k7's timeline, piano roll and waveform draw the same line in `usePanZoom.ts`, but not with this
code: those are **scroll containers**, so their pan is the browser's own — a plain wheel is
simply handed back, momentum and axis locking included, and only the pinch is intercepted. A
pane scrolls; this one translates. Shared rule, different mechanism.

## A double-click frames a node, and a double-click on nothing comes back

A double-click on a card's HEADER — or anywhere on the card once it is zoomed out to its name, when
there is no header to aim at — flies the camera onto that card: centred, filling `FRAME_FILL` of the
pane on its tighter axis, and never past `FRAME_MAX_ZOOM`. Past that, a small card is legible and
the graph around it has gone, which is the opposite of why you looked. Only the header takes it
because the body is full of controls, and a double-click on one of those types a value
(`widgets.md`).

A double-click on the BARE canvas flies back to where the camera was before the first node was
framed. Visiting several cards in a row keeps that first camera, so one double-click on nothing
always returns to the overview you started from, however far you wandered; panning and zooming by
hand in between does not replace it either, since "back" means back to the view you left. With
nothing to come back to, it does nothing.

It is a FLIGHT rather than a jump (`flyStep`), because a jump loses the one thing a zoom onto a card
has to keep: where it was. What moves is the zoom and the world point at the pane's centre, both on
the wheel's own half-life, so the card stays on screen the whole way — interpolating the screen
offsets instead drags it off an edge and back. Any wheel, drag or pinch drops the flight at once:
the hand outranks a double-click that is still arriving. A ROW (the mixer) takes none of this; it
is walked along, not zoomed into.
