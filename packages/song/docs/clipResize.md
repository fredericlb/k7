# Resizing an event

Dragging a clip's edge is the one gesture that does not map onto a field. There is no
length to set: a placement says WHERE its material goes and HOW MANY TIMES, and the extent
is derived — `loop` × the window (`PlacementSchema`, and `clipWindow.test.ts` for how the
window is read).

## The window exists at TWO levels

The material's file carries `from`/`to` — the slice of the sample or of the notes it IS,
shared by every placement of it. A **placement may carry the same two words for itself**
(`PlacementSchema`), and the effective window is the most restrictive pair:

```
effective.from = max(material.from, event.from)
effective.to   = min(material.to,   event.to)
```

So an event can only **narrow** what its material plays, never reach outside it. The
compiler does the intersection (`nodeProject.ts`, both kinds), and everything downstream —
the engine, the timeline's extents, the caged clip editors — reads the effective pair
without knowing there were two.

An event window disjoint from the material's is empty and plays nothing; for a sequence,
only a **malformed material** window (its own `to` at or before its `from`) falls back to
the notes' extent, because that case means "the file is wrong", not "play nothing".

The units and spellings are the material's own: a bare number is seconds into a clip's
file, a timecode is a musical position — and on a sequence, the only spelling that means
anything. `TIMECODE_KEYS` already quotes both words wherever they appear.

## `event resize` writes the EVENT

`resizeTrackPlacement` reads both windows, aims the drag at the *effective* one (the extent
on screen), and writes the result on the **placement**: its `start` when the left edge
moved, its `loop` when the event repeats, its own `from`/`to` otherwise. The material's
file is never touched — resizing one of four kicks placed from one `kick.yaml` no longer
resizes the other three, which was the standing surprise of the previous model (the command
used to announce it; now there is nothing to announce).

The event's window is **clamped inside the material's** (`resizeToWindow`'s `bounds`): an
edge written past it would never play, and the drag should land where the sound will. A
left edge dragged past the material's `from` stops there, with the placement's `start`
pulled along so what is left stays under the same beat; a right edge dragged past the
material's `to` stops at the material's end. **Reaching further is the material's edit** —
its own pane, `clip trim`, or the file — not the event's.

An edge that only restates the material's own is **cleared rather than copied**: the
placement then says nothing, which is what "no further restriction" should look like in a
file. The one asymmetry: when the material states no `to` (audio, "to the end of the
source"), the event's `to` is what gives the extent a number, so it is always written.

## The two cases

Which one applies is decided by `loop`, not by the drag:

| | what the drag sets |
|---|---|
| one pass | the **event's window**. Both edges move its `from`/`to` — dragging the left edge trims into the material, as an in-point does in any DAW |
| looped | the **count**. The window is left alone and `loop` is rounded to whole passes |

The looped case follows `materialWindow.ts`, which recognises "a whole number of passes" as
the case carrying the intent: the length was a consequence of the repeat. Lengthening a
looped clip means another pass, not a longer window — and a partial pass is not something
`loop:` can express anyway.

## It used to write the material — and before that, `length`

Two generations of this command are worth remembering. The first wrote `start` + `length`
on the placement; `PlacementSchema` is `.strict()` and had no `length`, so one edge drag
broke the track file until the key was deleted by hand. The second wrote the material's
`from`/`to`, which worked but made every placement of the material resize together — right
for "this clip IS this slice", wrong for "this event should be shorter". The event-level
window is what lets both be true at once, each said at its own level.
