# A drag follows one pointer, and a cancel is not a release (`src/drag.ts`)

Every drag in the studio's surfaces — a clip on the timeline, a knob on a card, a scratch on the
desk, a divider — goes through `followPointer` or its hook, `usePointerFollow`. It exists because a
drag written as "add `pointermove` and `pointerup` on the window" has three holes, and each one
cost a real failure:

- **It hears every finger.** On a touch screen a second finger's moves steered the first gesture
  and its lift ended both: a scratch on deck A read the knob being turned on deck B as an angle.
  So a drag follows the pointer that pressed, by `pointerId`, and nothing else.
- **A cancel never comes.** The browser takes a gesture back — a system swipe, palm rejection, a
  touch turned into a scroll — with `pointercancel`, never `pointerup`. A drag waiting for the
  release stayed armed: a held scratch kept playing, a knob followed the hover, and the next click
  anywhere committed it. Focus leaving the window is the same case for a mouse.
- **It outlives its component.** A pane that unmounts mid-drag left the listeners on the window,
  calling into callbacks of a view that was gone.

## The three ends, and what each one means

- **`end`** — the pointer was released. This is the only place a gesture commits.
- **`cancel`** — anything else: `pointercancel`, the window losing focus, the disposer being
  called, or the component unmounting (`usePointerFollow` does that on its own). It undoes what
  the gesture SHOWED and writes nothing — a clip goes back, a knob is told its starting value, a
  divider returns to its height. A gesture with nothing to undo (a pan, a rectangle being drawn)
  passes no `cancel`, or the same function as `end`.
- **`move`** — only the pressing pointer's.

A release on a gesture that only ever showed something — a vinyl let go, a held effect button —
is the same act as a cancel, and passes one function for both.

## What does not go through it

A gesture that captures the pointer on its own element (`setPointerCapture`) and listens there
gets the element's own `onPointerCancel`, which the timeline's clip and video drags use: the events
are already routed to one element for one pointer. The chains graph keeps ONE window listener for
all of its gestures — pan, marquee, knob — mounted for the life of the view, and handles
`pointercancel` and `blur` there; a mouse move with no button held while a gesture is active is
read as a release the window never heard, and cancels it.
