# The stretch map's points

The rationale behind `packages/song-schema/src/warpPoints.ts` — placing, moving and removing the
points of a clip's stretch map. What warping IS, and what the engine does with a map, is
`packages/song/docs/warp.md`; this page is about the array work.

## `readClipWarp`, and why it exists

There are TWO compilers — `nodeProject` builds a placement, `project.mapClip` builds the unplaced
clip a surface draws before any lane names it — and the clip editor asks for the whole FILE. This is
what puts the map in front of it: without one, no stretch mark is drawn in the warp view and
`warpStretch` prices a warped clip at 1, so the picture is drawn at the wrong rate as well.

The DECLINE is answered separately rather than folded in, because the two callers need different
things from it: a placement that declines still has to say `warpOff` so the timeline can cross its
icon, while an unplaced clip has nobody to say it to. Fewer than two markers is no map — one point
cannot state a rate.

## `beatAtSource` is piecewise

**The engine is piecewise, so the drawing has to be.** `applyClipWarp` gives every interior marker to
Tracktion's `WarpTimeManager`, which re-times each segment on its own (`EditBuilder.cpp`), while
`warpStretch` answers ONE ratio — the first marker to the last. That ratio is the right answer to
"how long is this clip", which is what it is for, and the wrong one for "where is this moment": under
it a point pinned in the middle moves the sound and leaves the picture where it was. The engine's own
`docs/warp.md` is the other half of this.

Outside the map, the end segments' own rate continues. Extrapolating rather than clamping is what
the engine does too — a clip is not silent past its last marker — and it keeps the function
monotonic, which is what makes `sourceAtBeat` an inverse rather than a guess.

## `setWarpPoint`: neighbours stay where they are

Only the two segments touching the moved point change their stretch; the rest of the clip is
untouched. That is what every DAW does, and it is the predictable half of the choice: the
alternative — redistributing the change outward — sounds smoother but means one drag re-times
material at the far end of the clip, which nobody can see from the handle they are holding.

It throws when the move would break the ORDER, because a map whose beats do not increase with its
seconds is not a slower or faster clip, it is a clip that plays backwards over that span. The caller
is told which neighbours it has to stay between rather than being silently clamped: a handle that
stops moving says more than one that lands somewhere it was not dropped. A new point is placed by
SOURCE second — the axis a click on the waveform names.

Both axes must rise: seconds because the source only runs one way, beats because the timeline does
too. Two source seconds within a millisecond are the same point; the UI hands back the exact second
of the marker it grabbed, so that tolerance only has to survive a round trip.

## `removeWarpPoint` refuses to go below two

Two is the schema's own floor and it is not arbitrary: a map with one point states where a single
moment lands and nothing about the rate anywhere, so it cannot be applied at all. Removing the last
INTERMEDIATE point is fine — that leaves an even stretch.

## `seedWarp` changes nothing

The two anchors a clip gets when it has no map yet are its start and its end: an identity map, which
the engine SKIPS. A two-point warp whose ratio is 1 means "the source already runs at the project
tempo", and entering Tracktion's auto-tempo path for that is both pointless and a bug it has
(`applyClipWarp`). So seeding is the right no-op: a clip you have not stretched should sound exactly
as it did. The third point is what makes it a warp.

## `retimeWarpMarkers`, after a bounce

The engine hands Tracktion the map's beat span as the length of the WHOLE source and lets auto-tempo
stretch. So the map's last point has to sit at the file's end, or the engine reads the take's tempo
off the wrong duration: a tail a render appends stretches the whole take slow in proportion, and —
since an unlooped clip is capped at its window in SOURCE seconds — cuts the phrase before its end.

The material itself is untouched by a bounce: same start, same rate, sample for sample. So every
existing point keeps its second, and only the END moves. What is appended continues at the map's own
overall rate, which is the one thing here that is measured rather than assumed — a tail is not
musical material, and the rate the take already had is the honest extension.

Shortening is the same statement backwards: points past the new end describe audio that is no longer
there, so they go, and the last one lands on the end. The first point is the anchor and stays
whatever the new length is. Two points are kept whatever happens, since a one-point map states
nothing about rate.

It returns `null` when nothing needs to change — the caller writes no file, which is what keeps a
bounce that changed no duration a one-line diff. A millisecond either way is the same end, and
rewriting for it would churn the file on every bounce that changed nothing.

The new point is rounded to six decimals, which is what every marker an importer writes already
carries — a microsecond and a millionth of a beat. The map goes in a file a person reads and a diff
shows, and `36.49944379017857` beside `15.336937` is noise in both.
