# Navigating a media pane

`src/panZoom.ts` is the navigation the media panes share. They scale to **FIT** by default, so
there is nothing to scroll until you zoom: `useHZoom` scales horizontally, anchored so the point
under the cursor stays put, and `usePanScroll` pans on a MIDDLE-mouse drag. It is unit-free on
purpose — the caller multiplies its own lane width, in beats or in seconds.

Space is not a pan modifier, because Space is the transport toggle in every app that mounts these.

## Telling a wheel from a hand

A mouse wheel and a trackpad slide arrive as the **same event** and mean opposite things here. A
wheel is a detent, discrete, and the natural thing for it to do over an arrangement is ZOOM — which
is what this pane was asked for. A trackpad slide is a hand pushing the view about, and zooming
there is what made every attempt to pan a trackpad zoom instead; that is why a plain wheel stopped
zooming in the first place. So the two are told apart rather than legislated over.

`isMouseWheel` reads three signals, most reliable first:

1. **`deltaMode` other than pixels** — lines or pages. Only a real wheel is ever reported that way
   (Firefox does it for mice), so it settles the question on its own.
2. **`wheelDeltaY`**, the legacy field Chrome and Safari still carry. A mouse reports it in
   multiples of 120 — the detent, from the Windows API that named it — while a trackpad reports
   three times its pixel delta, which lands on 120 only by accident. This is what separates a Mac
   trackpad from a Mac mouse, and nothing standard does.
3. Failing both (Firefox in pixel mode), **the shape of the delta**: a notch is integral, has no
   horizontal component, and is LARGE, where a finger's is small and often fractional
   (`MOUSE_NOTCH_MIN`).

It is **wrong in one direction only, by design**: an unrecognised device is treated as a surface, so
it keeps the behaviour that was there before. A trackpad that zooms is a broken trackpad; a mouse
that pans is merely a mouse that does not zoom yet.

`isZoomWheel` is the other half. On a Mac trackpad — and on a Windows precision touchpad — a PINCH
arrives as a wheel event with `ctrlKey` set, synthesised by the browser, while two fingers sliding
arrive as a plain wheel. `metaKey` joins it because Cmd+scroll is the same intention on a Mac mouse.

## `wheelZooms` is the whole rule, in one place

The hook that uses it is an effect on a DOM node, which nothing in this repo can mount, so a
condition written inline there could only be verified by hand. Order matters, and each line answers
a different question:

1. a **pinch** (or Cmd/Ctrl+wheel) zooms whatever the device — it is the one gesture the browser
   marks for us, and Ctrl+Shift+wheel is still a pinch with a finger resting on Shift;
2. **Shift** is left alone, because every browser already reads it as "scroll sideways". It is the
   one scroll gesture a mouse keeps once the bare wheel has become the zoom;
3. otherwise it is the **device** that decides.

What a mouse gives up by zooming is that the wheel no longer walks the lanes vertically; its pan is
the middle-drag or Shift+wheel. A trackpad SLIDE is handed straight back to the browser, whose
native scroll is the pan — with the momentum, the axis locking and the rubber-banding a hand-rolled
`scrollLeft` would have to counterfeit, on both axes at once.

## A notch and a pinch cannot share an answer

A mouse wheel arrives as ONE event per detent, with a large delta nobody reads the size of, so a
fixed step per event (`WHEEL_STEP`) is exactly right. A trackpad PINCH arrives as Ctrl+wheel: a
stream of small continuous deltas, dozens a second. Given the notch's fixed step, that stream
multiplied 1.15 per event and slammed into the zoom limit before the fingers had finished moving —
which is how "pinch does not work" is really spelled. Scaled BY the delta, it tracks the fingers.

The delta is clamped first: a browser that reported a pinch in hundreds rather than in units would
otherwise jump a decade in one event.

Inside the handler the test is `e.ctrlKey` and **not** `isZoomWheel(e)`. The guard says WHETHER to
zoom, this says how much, and the two disagree on purpose: a ctrl-wheel is a trackpad pinch, while
Cmd+wheel is a Mac mouse, one notch per detent. Both reach there; only the first is a pinch. The
dominant axis wins, because a pinch is `deltaY` but Ctrl held on a horizontal wheel is still
someone asking to zoom.

## The ceiling is derived, not chosen

`MAX_LANE_PX` is where the limit actually lives. A browser refuses to lay out an element past about
33.5 million pixels, and a lane that asked for more would be silently clipped — `scrollWidth` would
stop agreeing with the width the caller computed, and the anchored zoom would drift a little
further off with every notch. Half of that, so the margin is the browser's own rounding rather than
a guess.

`zoomCeiling` replaced a flat `max: 32`. Thirty-two was a number, not a reason — and it is the one
people MET: past it the wheel simply stopped, with nothing on screen to say why. Derived, the
ceiling is about 13 000× on a laptop pane, which is one 64th of a beat filling the screen on a
five-minute song. Nobody meets that either; what they meet is the material.

The tick layers had a ceiling of their own and it was the real one — a whole-song list saturates at
64 nodes per beat. They window themselves to the pane now (`apps/st0/frontend/src/components/Ruler.tsx`'s
`useVisibleBeats`), which is what makes this number the only one left.

`min` is 1 and stays 1, and that is not the same kind of bound: **1 IS fit**, so below it the pane
would draw the whole thing plus empty space. There is nothing further out to see.

The pane's width is measured by the hook's own `ResizeObserver` rather than taken as a prop: the
hook already holds the element, and a caller measuring it again would be a second answer to one
question. It is remeasured on resize because a window dragged narrower can only be zoomed further,
not less.

## Anchoring, and why the scroll is deferred

`zoomAt` keeps the content under the cursor fixed: it scales that point's x by the zoom ratio and
offsets the scroll, with the gutter — which does not scale — subtracted and re-added around it. The
new `scrollLeft` is stored and applied in a layout effect AFTER the width change renders: computed
on the old width, correct on the new.

It is exposed because the wheel is not the only gesture that zooms. st0's ruler zooms on a vertical
drag and had copied this arithmetic — the same lines, descended from the same commit — **without**
the deferral. Applied straight away, the new `scrollLeft` is clamped by the old `scrollWidth`, so an
anchored zoom drifts. One implementation, both gestures.

`preventDefault` on the wheel stops the page moving *and* stops the browser zooming the whole PAGE
on the same gesture — its own Ctrl+wheel zoom is exactly the gesture we just claimed. Which is why
the listener is `passive: false`; a plain wheel returns before that and scrolls as it always would.

## Two fingers on a touchscreen

Touch events rather than pointer events, deliberately: this container SCROLLS, and the browser
claims a pointer the moment it decides a drag is a scroll — a pinch woven into the pointer flow dies
to a `pointercancel` half-way through. A non-passive `touchmove` that `preventDefault`s for the
length of the gesture is what holds the browser off.

The zoom is measured against the one the gesture STARTED from, not frame to frame: a ratio of ratios
accumulates rounding, and pinching out then back in would not return where it began.

`touch-action: pan-x pan-y` is set by the hook rather than left to each caller's stylesheet.
Panning stays the browser's — it scrolls this container far better than we would — but the pinch is
ours, and that value says exactly that. A surface that mounts this hook and forgets the rule gets a
gesture the browser silently swallows, with nothing on screen to explain it.

## Middle-drag panning

Panning moves the view under the cursor — dragging right reveals content to the left — on whichever
axis actually overflows, so a fit-width lane can still be panned vertically and a zoomed one
horizontally.

The pointer-down handler takes the gesture with both `preventDefault` and `stopPropagation`: no
autoscroll, and no child handler (the roll's note-draw) claiming the press first. The middle-click
autoscroll puck is a `mousedown` default, so it is cancelled there too.

Both listeners are on the **capture** phase: a bubble listener never fires if a child stops
propagation, and it loses the autoscroll race on Firefox. Non-middle buttons return early WITHOUT
stopping the event, so child clicks still work.

## Written twice, on purpose

The chains graph decided the wheel-vs-trackpad question before the arrangement did and holds the
same three signals in `packages/ui-chains-react/src/camera.ts`. It keeps its own zoom factor in
`packages/ui-chains/src/zoomGesture.ts` because its NOTCH branch differs — it scales by the delta
where this one takes a step — and an arrangement package importing the graph's would be the wrong
way round.

Neither package may depend on the other: a pane here scrolls and that one translates, so the rule is
shared but not the code. It is recorded in `docs/inventaire.md`, and tested on both sides so it
cannot drift in silence.
