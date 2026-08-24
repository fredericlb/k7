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

Two things write one: the `.dawproject` translator on import, and `clip warp`. `WaveformView`
draws it and the engine reads it.

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

## One EVENT can decline it

The map is the clip's, so every placement of that clip stretches by it. `event status warp` is
one placement saying no: it writes `warp: false` on the event (`PlacementSchema`), and the
compiler simply omits the map from that event's `ClipDoc`.

Dropped at the COMPILER rather than in the engine, deliberately. The engine is handed a document
and never asks why — an event with no `warp` is an event that does not warp, which is exactly what
it should be told, and nothing in `ProjectDoc.h` had to learn a new state.

What the surfaces get instead is `warpOff` beside it, which the engine ignores. It exists because
`warped` alone cannot tell *never stretched* from *stretched, switched off here*: the timeline
draws the first as no icon, and the second as the stretch icon with a line through it. A `warp:
false` on a clip that has no map at all sets nothing — there is no state to mark.

The polarity is the opposite of `disabled`'s and follows the default: an event plays unless told
otherwise (`disabled: true` is written), and it warps because the clip does (`warp: false` is
written). Both writers DELETE rather than write the default, so a round trip leaves the file
byte-identical.

What it is for: the map fits the song the clip was warped INTO. A second use of that sample
somewhere else — another tempo, another song, a one-shot — wants it at its own rate, and the only
way before was to copy the file.

## …and so can the MATERIAL

```yaml
# clips/break.yaml
warp:
  algorithm: elastique
  disable: true      # keep the map, stop stretching
  markers: [...]
```

`disable: true` is the same refusal one level up: no placement of this clip stretches, and the map
stays in the file. Where `warp: false` says *not this event*, this says *not this material* — and
the reason to have both is that a sample used once and a sample used twenty times need the same
answer written in different places.

**It keeps the map, and that is the whole point.** Deleting `warp:` would say the same thing to the
engine, but a map is the expensive half: an import computes it, and a hand-placed one is minutes of
dropping beats onto hits. "Don't stretch this for now" has to be one word to write and one to
remove, or it is not a switch — it is a decision you make once and cannot walk back.

The compiler folds the two refusals into one answer:

```ts
const off = p.warp === false || cm.warp?.disable === true;
```

One flag, because what a SURFACE draws is the refusal and not its author — the timeline crosses the
stretch icon either way. `disable: false` is the absent value written out and changes nothing, so a
round trip through the flag leaves nothing behind.

Two consequences worth knowing:

- **The waveform's stretch marks disappear** while it is off. They are derived from the compiled
  clip's map through the region's own mapping, and with no map that mapping is identity — marks
  drawn on it would point at beats the picture places nowhere. The markers stay in the text you
  are looking at, which is where you switched them off.
- **A `to:` written as a timecode still resolves at the project tempo.** The window and the map are
  independent: one says which slice of the file plays, the other how that slice is stretched onto
  the grid. Switching the map off does not un-quote the window.

## The UNPLACED clip carries the map too

`loadAudioClipDoc` builds the clip on its own — what the clip editor asks for when it wants the
whole file — and it carried no map at all, so the warp view drew no stretch marks and `warpStretch`
priced a warped clip at 1. It reads through the same `readClipWarp` the node compiler uses now.
There is no placement here to decline one, which is the only half of the rule above this side does
not have.

## `algorithm` is documentation

The engine ignores it. A warp is realised through Tracktion's auto-tempo, with the intermediate
markers becoming LoopInfo beat points so each segment stretches independently. The field is written
because the schema requires it and kept when one is already there; it records where the map came
from and nothing else.

## The map's end IS the file's end

`applyClipWarp` hands Tracktion the map's beat span as the length of the **whole source** and lets
auto-tempo stretch. So the last marker's second is not merely the last thing pinned — it is what
tells the engine how long the take is, and therefore at what tempo it was played. A map whose end
falls short of the file says the take is slower than it is.

Which is what a bounce does to it. `clip process … normalize` renders the material through a chain
and points the clip at the render, and `--render` appends **two seconds** for reverb and release.
A 17.920 s take at 110 bpm comes back 19.920 s long, so an untouched map has the engine read
32.834841 beats over 19.92 s as **98.9 bpm** and play everything 11% slow — and, since an unlooped
clip is capped at its window in SOURCE seconds, cut the phrase before its end.

`retimeWarpMarkers(markers, seconds)` is the repair, and `processChain` calls it as it repoints.
Three rules, and each is the conservative one:

- **every existing point keeps its second.** A bounce renders the raw file unwarped at position
  zero (`bounceDoc`), so the material lands sample-for-sample where it was — zero frames of lag,
  measured. Only the END moves.
- **what is appended continues at the map's own overall rate.** A tail is not musical material,
  and the rate the take already had is the one thing here that is measured rather than assumed.
- **a shorter file is the same statement backwards**: points past the new end describe audio that
  is not there, so they go and the last lands on the end. Two points are kept whatever happens — a
  one-point map states nothing about rate and cannot be applied.

It answers `null` when nothing needs to change, so a bounce that changed no duration leaves the
clip file byte-identical rather than churning every map it touches.

## What is not there yet

**Dragging a stretch point on the waveform.** The marks are drawn in the clip panel now — on the
canvas, through `timeToX`, so they cannot drift from the onsets beside them — but they are not
handles, and the reason is a real fork rather than an omission:

the panel's x axis is **source seconds**. A horizontal drag on that axis can mean two different
edits — *pin a different moment to this beat*, or *make this moment land on a different beat* — and
they are not the same command. `WaveformView`'s axis is the clip's display time, where the second
reading is the obvious one; the panel's is not. Deciding that is a design call, not a wiring one.
