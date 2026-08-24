# Drawing a cable

One socket answers two gestures, and this page is about why that needs saying at all.

## What it does

**Drag**: press a free output, the dashed cable follows the cursor, release over a free input of
the same signal. **Or click, then click**: the same two sockets, with the button released in
between — the cable stays in hand and a second press lands it.

Pressing an *occupied* jack lifts the cable end plugged into it instead; from there both gestures
behave the same, and what lands is a replug rather than a new arrow.

## Why the socket takes the PRESS

A single `onClick` gives only the second gesture. A click event does not exist until the button
is already back up, so there is nothing to draw a cable *during* a drag — and press-and-pull, the
gesture everyone tries first, connects nothing.

Worse than inert, too. Stopping propagation on the click but not on the **press** lets the press
reach the host's `onPointerDown` and arm a canvas pan: pulling away from a socket slides the
entire graph sideways under the cursor, and the release — landing on an element that was never
the one pressed — fires no click on the input at all. The one gesture a person reaches for first
does the one thing they did not want, with no sign that a cable was refused.

The node header states the same rule, and its comment says *"the same press must not also arm a
pan — the reason every header control stops it too."*

## How both fit in one socket

`patchAct(phase, held, armedFrom, here)` in `patchGesture.ts` is the whole decision:

| | no cable in hand | cable in hand |
|---|---|---|
| **press** | arm | land |
| **release** | nothing | land — *unless* `here` is the socket the press armed from |

That last exception is the entire trick. A click is a press and a release on the same socket; by
landing nothing there, the click leaves the cable in hand for a second one. A drag releases
somewhere *else*, so it lands. Neither gesture needs a timer, a mode, or a distance threshold, and
neither has to know the other exists.

## The trap in taking the press

Stopping the press also stops the pan it would otherwise arm — and that pan's `pointerup` is
otherwise the only thing that resets `suppressClick`, the flag that swallows the click ending a
pan. Cut the
pan without replacing that reset and the flag latches: pan the canvas once, and every socket in
the graph goes dead until something else pans.

So the press clears it itself. A press starts a gesture, which means it can never be the click
that ended a previous one — the flag has nothing true to say about it.
