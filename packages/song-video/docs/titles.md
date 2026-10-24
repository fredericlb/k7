# Titles and captions

Two kinds of text reach the picture, for two different jobs:

- a **title** is a `text` SHAPE module ([shapes.md](shapes.md)), placed by hand, styled by its
  module, on screen for its lane's activation spans and moved by their `animate:`
  ([animation.md](animation.md));
- **captions** are a subtitle FILE, `.srt` or `.vtt`, placed on a picture lane as a clip, with
  every cue showing at its own time.

Both are set by one function (`packages/ui-eyes/src/text.ts`), so a line wraps, aligns and sits in
its box the same way whichever made it.

## A title is a block, not a line

```k7x
// modules/shapes/lower_third/module.k7x
type("shape")
shape("text")
content(`Ada Lovelace
Analyst`) // a written break is kept
align("left") // left | center | right, inside `w`
background("rgba(0, 0, 0, 0.6)") // a box behind the lines, hugging them
shadow(true) // for text straight over a picture
params({ x: 80, y: 560, w: 520, font_size: 40, line_height: 1.2, padding: 14 })
```

`w` is the width the lines WRAP in. A single word wider than it is condensed to fit, as a line
always was, rather than broken in the middle or spilling out of the box. Without a `w` a line is
as long as it is written, and `align` hangs it on `x`: its left edge, its centre or its right
edge. The box hugs the lines actually drawn, not the width they wrap in, so a short title in a
wide column does not drag a wide box behind it.

Geometry is `params:`, so a curve can drive it ([shapes.md](shapes.md)). Everything else is a
field, a string or a switch no knob can be.

## Captions are MATERIAL, placed like a shot

```k7x
// clips/subs.k7x
source("clips/subs.srt")
font_size(36) // px of the viewport
background("rgba(0, 0, 0, 0.6)") // absent, the text carries a shadow instead
position("bottom") // bottom | top | middle
margin(40) // px from that edge

// nodes/subtitles.k7x
extends("@meta/picture-track")
events([
  ref("subs").start(0), // the file's 00:00:00 at the song's 0 s
])
```

A subtitle file is a clip and not a lane's setting, for the reason a video file is. Its cue
times are in seconds OF THE FILE, and the placement puts that file on the timeline: moving the
placement moves every cue, `from` trims the head, and two placements of one file are two
runs of it. That is what a translator's file needs. It was timed against the cut it was made for,
and the cut moves.

The style is on the clip because it belongs to the file: one style per language, and every
placement of it alike. The defaults are a broadcast's: white, centred, 5% of the frame's height,
6% up from the bottom, a shadow when there is no box. Captions have their own lane, since a clip
on a lane covers the shots under it there ([transitions.md](transitions.md)).

The cues are read at COMPILE time, so the browser is handed text rather than a file to fetch, and
a block that cannot be read is said in the picture's `warnings`, by its number, rather than
dropped without a word. Markup in a cue is stripped, a cue being drawn as plain lines.

## How a cue reaches the frame

A cue is static while it is on, so it is drawn ONCE into a viewport-sized canvas and uploaded the
way a still is (`packages/ui-eyes/src/captionFrames.ts`): no video element, no decoder, and between
two cues the lane carries nothing. The export draws the same frames.

## What a caption does not do, and where it does not go

- **Per-cue styling** (VTT's `::cue` CSS, a cue's `align:` setting) is ignored. One style per
  file is what a subtitle track is; a cue that needs to stand apart is a title.
- **Handed to another editor**, captions are left out: OTIO and an EDL have no subtitle track they
  agree on ([interchange.md](interchange.md)). The `.srt` itself is the file to hand over.
- **No burned-in/soft choice.** Captions are drawn into the picture, so an export carries them in
  the frame. A soft track inside the container is a muxer feature this export does not use.
