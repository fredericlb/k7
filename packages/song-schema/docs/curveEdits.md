# Editing a curve file

The rationale behind `packages/song-schema/src/yaml/curveFile.ts`. What a curve IS and how it is
baked lives in `packages/song/docs/curves.md`; this page is about editing
`curves/<id>.yaml` in place.

Only a `custom` curve has anything positioned in song time (`points[].time`). An LFO is periodic and
an ADSR is fired by note-ons, so neither moves when time is inserted.

## `spliceCurveTime`

The same rule the lanes follow — by the point's own position — and the same round trip: an insert
followed by a delete of the same span returns the file to what it was. Deleting drops the points that
fall INSIDE the span, because a point at a moment that no longer exists has nowhere to be.

A curve of any other type is returned untouched, which is the honest answer rather than a refusal: an
LFO does not move because it is not positioned. What DOES change for it is its phase relative to
everything after the cut, and that is a fact about music, not a thing to fix.

It walks descending, so removing one point does not shift the address of the next, and an unreadable
time is one point left alone rather than a failed splice.

## `curvePoints`

Unreadable entries are skipped rather than throwing: a half-typed file still has to answer "how many
points are there", and the schema is what reports the malformed one.

## `setCurvePoint`

A curve is a function of song time, so two points cannot share a moment — one already there is given
the new value rather than joined by a twin. That is the same "one address, one value" rule
`node automate` follows for a param, and it is what makes the time a usable address for `move` and
`remove`.

Points are sorted on insert because the bake sorts anyway (`bakeCurve`) and the FILE is the thing a
person reads: a curve whose points wander is one nobody can check by eye, and a drag that appended
would scramble it within a minute. A new point is written in flow style, matching what every
hand-written and generated curve looks like.

## `moveCurvePoint`

Remove-then-set rather than an in-place edit of `time`, so the list stays sorted and a move ONTO
another point's moment replaces it — the same collision rule `setCurvePoint` states. It returns null
when nothing is there, which the command reports by address.

A point is matched within 1e-6, like every other timecode address in the repo
(`findPlacementAt`).
