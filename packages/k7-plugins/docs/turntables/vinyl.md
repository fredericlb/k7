# The record, and what it shows

The vinyl is not just spinning décor: it **fills** as the track plays — empty at 0 %, full at
100 % — and carries the cue points as circles.

## A layer that does NOT turn

The disc turns — at 33⅓ rpm when it plays at pitch, and **at whatever speed it really plays**
otherwise ([bpm.md](bpm.md)) — so progress and cues live in a **second SVG**, sibling of the first,
still. Drawn inside the turning disc they would ride with it: a rotating sector says nothing about
progress, and a cue would sit somewhere different at every instant. Same reason the label holds
still.

DOM order is the stack: disc, then progress and cues, then label. The layer is
`pointer-events-none`, so clicks always reach the centre — a record is changed by its label.

## The sector, and its two traps

A sector starting at noon and turning clockwise, translucent: what it covers is the part of the
track **already played**, and the grooves stay legible underneath. Noon and clockwise because that
is where every clock and every DJ player puts the start.

Two details SVG geometry punishes silently, both pinned by a test:

- **At 100 %, an arc whose ends coincide draws NOTHING.** A record that has just finished would
  look like one not started. The full circle is a separate path.
- **Past halfway, an arc takes the shortest way round** unless forbidden (`largeArcFlag`). A track
  at 75 % would draw its own complement: nearly finished shown as barely begun.

## Redrawn per frame, never by React

Position is read from a **ref** inside a `requestAnimationFrame` and written straight into the
path's `d` attribute. A prop would re-render the whole component — two decks, their labels, their
cues — to move one edge, several times a second. Same arrangement the waveform uses, for the same
reason.

It reads the deck's **drawn** needle, steered between engine pushes ([needleClock.md](needleClock.md)):
a 60 fps render off a value that jumps 20 times a second reads as stutter.

A frame writes only what changed — the path when the wedge moved, the rotation when the angle
did. And the loop **parks** once the record is stopped and has coasted down, with no hand on it:
nothing turns, so nothing is scheduled. A parked record still looks at its needle a few times a
second, because a cue dropped on a stopped deck moves the wedge without anything else changing;
a new rate or a hand on the grooves wakes the frame loop again.

## The FILE's clock, on both sides

Progress and cues are computed in seconds **inside the file**, not on the timeline. A stretched
deck is no further into its record than an unstretched one at the same bar — and a dropped cue
stays at the same point of the circle whatever the tempo fader does. `sourceAt` does the
conversion, the same one the cues use ([cues.md](cues.md)).

With no known length — the seconds between load and the arrival of the analysis — the sector stays
empty and the cues are not drawn. A circle turning at a speed inferred from an invented duration
would mean nothing.

## Cues are RADII

Each cue is a line from **centre to rim**, at the angle of its moment, in **its button's colour** —
3 is the same colour here, on the button, on both decks and on every track. That is what lets you
see cue 3 coming without reading anything.

A radius rather than a dot on a ring, and that is not decorative: a dot has to be hunted for; a
line crosses the whole face, so the sector's edge arriving on it shows without being watched. And
two cues a second apart stay two lines instead of merging into a blob.

The label covers the inner third, where a record keeps its own centre anyway.

## And it is taken by hand

The grooves accept a drag: the disc follows the finger and the audio follows the disc. That is
[scratch.md](scratch.md), including what it does and does not offer. The label keeps its click —
the two gestures contest no pixel.
