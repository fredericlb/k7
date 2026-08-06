# Resizing an event

Dragging a clip's edge is the one gesture that does not map onto a field. There is no
length to set: a placement says WHERE its material goes and HOW MANY TIMES, and the extent
is derived — `loop` × the window the material itself declares (`PlacementSchema`, and
`clipWindow.test.ts` for why the window lives there).

So a resize writes `from`/`to` on the **clip or sequence**, and touches the placement only
for what genuinely belongs to it.

## It used to write `length`

`resizeTrackPlacement` wrote `start` + `length` on the placement — the shape from before the
window moved onto the material. `PlacementSchema` is `.strict()` and has no `length`, so the
edit did not merely go to the wrong place: **the track file stopped loading altogether**,
with `clips.0.length: Unrecognized key`. One drag of an edge in the timeline broke the song
until the key was deleted by hand.

It was also written unquoted — `length: 4:0:0` — because `TIMECODE_KEYS` (rightly) does not
list a key that is not in the model. Had the schema accepted it, YAML 1.1 would have read it
as sexagesimal. Two bugs, one root: a field that does not exist.

## The two cases

Which one applies is decided by `loop`, not by the drag:

| | what the drag sets |
|---|---|
| one pass | the **window**. Both edges move `from`/`to` — dragging the left edge trims into the material, as an in-point does in any DAW |
| looped | the **count**. The window is left alone and `loop` is rounded to whole passes |

The looped case follows `materialWindow.ts`, which recognises "a whole number of passes" as
the case carrying the intent: the length was a consequence of the repeat. Lengthening a
looped clip means another pass, not a longer window — and a partial pass is not something
`loop:` can express anyway.

## Units differ by material

A clip's window is **seconds into a file**, which knows nothing of the tempo. A sequence's is
**beat positions** in its own notes. `clipResize.ts` converts the dragged beats into whichever
the material uses, and `materialFile.ts` writes it — deleting `from` when it lands on zero,
since absent means "the material's start" and a file of zeroes makes "not trimmed" and
"trimmed to the beginning" read alike.

A window authored as a timecode is read as one and rewritten in the canonical units for its
kind. That is a normalisation, and the only place a resize changes a spelling it did not have
to.

## The window is SHARED, and the command says so

This is the consequence worth stating. `from`/`to` belong to the material, so resizing one
placement resizes **every** placement of that clip — four kicks placed from one `kick.yaml`
all change together. That is the model working as designed ("every placement of it plays the
same thing"), not a leak, but it is surprising at a timeline where you dragged exactly one
edge.

So `event resize` reports which material it windowed and how many other placements it
reached. Nothing else in a song changes under you unannounced, and this does.

There is no command that gives one placement its own copy of a clip. If per-placement trims
turn out to be what people actually want, that is the feature to add — a split that writes a
new material file — rather than a `length` on the placement, which is the thing this model
removed on purpose.
