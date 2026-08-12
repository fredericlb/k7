# The cards move — adding, replacing, removing, rearranging

A command that changes the graph used to replace one picture with another between two frames.
Nothing was wrong with the new picture; what was missing was the sentence linking it to the old
one, so reading a change meant comparing two states from memory. A module inserted mid-chain
pushed everything below it down by one rank, and the only way to know *which* card was new was
to already know what had been there.

So a re-layout is drawn as a movement: the cards slide to their new places, an added one fades
up, a removed one fades out.

## FLIP, and why the positions stay React's

React draws every node at its **final** place — `left`/`top` inline, exactly as before — and the
frame loop writes the offset it still has to cover as a `transform`. The two therefore cannot
disagree about where anything is, and a graph at rest carries no inline style at all: turn the
animation off and this file's every write is a no-op on the DOM the old code produced.

That ordering is the whole technique and it is easy to get wrong by one hook. React has already
committed the new positions by the time an effect runs, so a frame painted before the offsets
are on shows the whole graph jump to its destination and then slide back out of it. The first
write therefore happens in a **layout** effect — the hook that runs before the browser paints —
and the loop only continues from there.

`filter: opacity()` carries the fade, not `opacity`. React owns `opacity`: a dimmed node
declares it inline, and an unrelated re-render mid-fade would take the fade back. The two
multiply, which is the right answer for a dimmed node on its way out.

## Identity is the node id, and it was already right

`buildGraph` mints ids from names (`mod:reverb`, `trk:gtr`), dedupes through them, and they are
already React's `key`. So the discriminator this needed existed before it did:

- a re-ordered chain keeps its ids and only **moves**;
- a renamed module is one id **leaving** and another **arriving**, which is what a rename is;
- a module replaced by another is the same, and the two overlap for ~200 ms — the departing card
  fading down under the arriving one, on the same spot.

Nothing here compares labels, sizes or contents.

## What follows the cards, and what steps aside

The signal cables **follow**, every frame. They are the canvas, the camera loop already repaints
it on every frame it runs, and `cablePath` is two socket points — no waypoints, no resampling —
so rebuilding all of them from the interpolated positions costs nothing worth naming.
`rebuildCables` is the one place that decides, so the liveness path agrees with the frame loop
instead of putting the final geometry back under moving cards.

Mid-move a cable is drawn **still**. The ripple is a 1.2 Hz ornament (`docs/wobble.md`) and
200 ms without it is invisible, where resampling every cable per frame to carry it would not be.

The SVG layer — the cable labels, the automation arrows, the hit paths — **steps aside**: it
fades out for the move and comes back. It is React-rendered from the layout that arrived, so
following the cards would mean rebuilding path strings every frame, which is precisely the
blob-image invalidation this package left SVG to escape. Two things follow from the trade, and
both are deliberate: an automation arrow is absent for the length of a move, and a cable is not
clickable while the graph is rearranging — which it should not be anyway.

## A card does not fly across the view

Past a screenful or so, a slide stops reading as one thing going somewhere and starts reading as
something shooting past; half a dozen at once is flicker, not motion. So `planMotion` takes a
`maxTravel`, and anything further **arrives** — fades up where it belongs — instead.

The mixer view is what this is for. Turning it on re-frames the camera *and* pulls every strip
onto one rank (`ui-chains/docs/graphBuild.md`), so cards that were off screen would otherwise
come in from outside it. The cap is a screen and a half, measured in world px through the
camera's own zoom, because what the eye can follow is a fact about the view and not about the
layout.

The camera itself still lands **outright** on a programmatic fit. That is `place`'s stated
decision — "a fit or a chain selection, not a gesture: there is nothing to chase" — and this
change did not overturn it. So a mixer toggle reads as the view cutting to the row while the
cards settle into it.

## The timing

Exponential, like the camera's zoom glide and for the same reason: two 8 ms frames on a 120 Hz
screen must leave what one 16 ms frame leaves at 60, or the same movement arrives sooner on the
better screen. Two half-lives, because the two are not the same job — `MOVE_HALF_LIFE` 70 ms for
travelling (~90 % of the way in 230 ms), `FADE_HALF_LIFE` 45 ms for appearing and disappearing,
since a card left half-there reads as broken rather than as arriving.

There is no new clock. The camera loop already exists, is already frame-rate independent,
already repaints the canvas every frame, and already stops itself when nothing is moving —
`kick()` starts it and a `moving` flag keeps it going. A still graph schedules no frames.

## Where it is off

`motion={false}` on **st0's chain view**, whose layout is rebuilt on every keystroke. A node is
identified by its name, so typing `reverb` is six nodes arriving and five leaving, and the
picture would never be still long enough to read. l8's graph redraws after a *command*, which is
the change worth animating.

`prefers-reduced-motion: reduce` overrules the prop. Nothing here is load-bearing, so the
reduced answer is simply the old one: everything lands at once.

The **first** layout of a mount is never animated. A graph fading up every time its pane mounts
would be an animation about nothing — and on mount the frame loop is not bound yet, so a motion
started there would never be advanced and the whole graph would sit at zero opacity.
