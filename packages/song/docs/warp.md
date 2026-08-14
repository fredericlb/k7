# A clip's stretch map

```yaml
# clips/break.yaml
source: clips/break.wav
warp:
  algorithm: elastique
  markers:
    - [0, 0]        # [timeline beat, source second]
    - [4, 1.9382]
    - [8, 3.8764]
```

Each pair pins a **moment of the source** to a **beat of the timeline**. Both axes rise: the
source only runs one way and so does the song. At least two points, because one says where a
single moment lands and nothing about the rate anywhere — it cannot be applied at all.

It used to be import-only: written by the `.dawproject` translator, drawn by `WaveformView`, read
by the engine, and editable nowhere. `clip warp` is the other half.

## Moving a point leaves its neighbours alone

Only the two segments touching the point change their rate. The alternative — spreading the change
outward so the whole clip re-times a little — sounds smoother, and means one drag alters material
at the far end of the clip, which nobody can see from the handle they are holding. Predictability
won, and it is also what every other DAW does.

`setWarpPoint` therefore **refuses** a beat that would pass a neighbour rather than clamping it. A
map whose beats do not rise with its seconds is not a slower clip: it is a clip that plays
backwards over that span. And a handle that stops moving says more than one that lands somewhere it
was not dropped.

## One verb places and moves

`clip warp <clip> <sec> <beat>`. From the waveform those are one gesture — you drag a mark onto a
beat, and whether one was already there is not a thing you decide beforehand. Within a millisecond
of an existing point it moves that point; otherwise it inserts one, in source order.

`clip warp remove <clip> <sec>` drops one, never below two.

## Seeding is deliberately silent

A clip with no map gets two anchors — its start and its end, from the placement's beats and the
envelope's seconds. That map is an **identity**, and `applyClipWarp` skips a two-point warp whose
ratio is 1: the source already runs at the project tempo, and entering Tracktion's auto-tempo path
for it is both pointless and a bug that path has (the engine's own comment records what it costs).

So seeding changes no sound, which is right — a clip you have not stretched should sound exactly as
it did. The **third** point is what makes it a warp.

## `algorithm` is documentation

The engine ignores it. A warp is realised through Tracktion's auto-tempo, with the intermediate
markers becoming LoopInfo beat points so each segment stretches independently. The field is written
because the schema requires it and kept when one is already there; it records where the map came
from and nothing else.

## What is not there yet

**Dragging a stretch point on the waveform.** The marks are drawn in the clip panel now — on the
canvas, through `timeToX`, so they cannot drift from the onsets beside them — but they are not
handles, and the reason is a real fork rather than an omission:

the panel's x axis is **source seconds**. A horizontal drag on that axis can mean two different
edits — *pin a different moment to this beat*, or *make this moment land on a different beat* — and
they are not the same command. `WaveformView`'s axis is the clip's display time, where the second
reading is the obvious one; the panel's is not. Deciding that is a design call, not a wiring one.
