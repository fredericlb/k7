# A shot's animation — keys on the placement

```k7x
// nodes/main.k7x
extends("@meta/picture-track")
events([
  ref("shot_a")
    .start(4)
    .length(6)
    .animate({
      scale: [[0, 1], t(6).v(1.2).ease("inout")], // a slow push in
      x: [[0, 0], [6, -80]], // …drifting left
      opacity: [[0, 0], [0.5, 1]], // …faded up over half a second
    }),
])
```

`@studio/song-schema`'s `keyframes.ts` is the format and its arithmetic; `ui-eyes`' `motion.ts`
is what draws it ([../../ui-eyes/docs/motion.md](../../ui-eyes/docs/motion.md)).

## Keys live ON the placement, in seconds from the shot's start

Not in `curves/`, which is where a module's automation lives ([../../song/docs/curves.md](../../song/docs/curves.md)).
A curve is a function of SONG time, its positions are bar timecodes, and its values are
normalised 0..1 against a parameter's range. Each of those is wrong for a shot:

- **A shot moves.** An animation is part of the shot, so moving it, splitting it or placing it
  again must carry the animation along. Keys measured from the shot's own start do that with no
  rewrite; song-time points would stay behind.
- **A shot is in seconds.** The picture has no tempo, so bar positions would be a second dialect
  for the same timeline ([picture.md](picture.md)).
- **The values have units.** A pan is in px and a turn is in degrees. A range to normalise them
  against would be a number nobody chose.

## Five properties, each relative to the lane's rect

`x` and `y` are px offsets, `scale` a factor about the rect's centre, `opacity` 0..1 and
`rotate` degrees, clockwise. Unstated is at rest. Each property is ONE number when it does not
move, or a list of keys: `[t, v]`, or `{ t, v, ease }` when the ease has to be said.

**A key's `ease` shapes the segment that LEAVES it.** That way the ease is written once, on the key
the movement starts from, and the last key's ease means nothing. `hold` stays put and jumps at the
next key. The curves are quadratic: enough for a pan, and nothing that overshoots past a key.

Before the first key the first value holds, and after the last the last value holds. A key may
sit at a negative time or past the shot's end, and that is not an error: it is how a split keeps
an eased segment exact (below).

## Edits keep the animation on its frames

- **A split** (`picture split`) gives each half exactly what it played. The tail's keys are the
  same keys shifted by the head's length, rather than resampled at the cut, so an eased segment
  running across the cut plays on unchanged. Each half then keeps only the keys that still shape
  it, plus the nearest one beyond each edge.
- **A head trim** (the left-edge drag, `picture head`) moves `from`, and the keys move
  with it, so they stay on the same frames of the source.
- **A move** changes nothing, since the keys never named a timeline time.

## What it moves, and what it does not

A shot moves INSIDE its lane's frame, and the lane's rect crops it, so a push-in on a
picture-in-picture stays in its box. The other choice, an uncropped shot, would look different
mid-dissolve than on either side of it, because a blend mixes both pictures in the lane's frame.
Moving the box itself is animating the LANE, which this format does not yet express.

An activation can animate as well, and on a lane of shapes that moves every shape it draws.

`picture key` and `picture unkey` set and remove one key at a TIMELINE time, so a key goes where
the playhead is. The file stores it from the shot's start (`packages/commands/src/verbs/pictureKeys.ts`).
