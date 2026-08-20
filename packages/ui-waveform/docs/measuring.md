# The canvas is sized in PIXELS, so its width has to be right before the first paint

`Waveform` draws into a canvas whose `style` carries an explicit `width` in px, not `100%`.
That is deliberate and [Waveform.tsx](../src/Waveform.tsx) says why at the element: every x the
drawing computes uses the measured width, and so do the DOM marker pins beside it, so letting CSS
stretch the canvas to some other width would scale the picture and leave the pins where they were
— a teal line and its flag disagreeing by however far the two differ.

The cost of that choice is that **the measurement is load-bearing**. Two rules pay for it.

## Measure synchronously, then observe

A `ResizeObserver` alone reports after the first paint, so the first frame is drawn at whatever
the `useState` default guessed — 800 px. On a component that mounts once with its pane, nobody
sees it. On one that **remounts**, it is plainly wrong for as long as the browser takes to deliver
the callback, and it looks like a bug in the drawing rather than in the measuring: the wave stops
short of its own frame, with the panel's background beyond it.

st0's clip panel is exactly that case. After a take it swaps in `lecture de la prise…` while the
file is fetched, so the picture that comes back is a **fresh mount** — starting from the guess
again, every time, which is why "the waveform doesn't fill the panel" was a thing that happened
only after recording.

So the box is measured in a `useLayoutEffect`, before paint, and the observer only keeps it right
afterwards.

## A zero measurement is IGNORED, never floored

A box measured before layout, or while its pane is `hidden` — which is how st0 keeps panes mounted
and off screen — reports nothing. Flooring that to 1 latches a one-pixel canvas: a pane whose size
does not change again never fires the observer a second time, so nothing would ever correct it.

Keeping the last real width is wrong for at most one resize. Latching is wrong until the panel is
closed.

There is no floor besides that, and the reason is the same as the one at the top: a floor wider
than the box is a canvas drawn wider than it is shown. A narrow pane gets a narrow waveform, which
is simply what it has room for.
