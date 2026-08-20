# Video

A song holds picture as well as sound. Two lines in `project.yaml` and a folder of lanes:

```yaml schema=ProjectFile
project:
  viewport: [1280, 720, 30]   # the frame every lane draws into: width, height, EXPORT fps
  layers: [main, pip]         # draw order, bottom first — and the membership
```

`viewport` has no default: a frame invented for you would silently letterbox every shot, and
you would find out at the export. `layers` is enforced both ways — a name with no file is an
error, and a lane no name lists is an error too, because it would compile perfectly and simply
never appear.

Add a `surfaces/viewport.yaml` to see it (see the Surfaces page); without one the lanes still
draw on the timeline and nothing composites them.

## Everything here is a SECOND

Your song's lanes are placed in bars, against a tempo you can change afterwards. A shot is
placed in seconds, against the wall clock, and **nothing moves it** — changing `tempo:` slides
the bar grid under your cut rather than moving the cut.

Both are on the one timeline. Its ruler reads bars or minutes-and-seconds — the clock button in
its header — and what a drag snaps to is whichever ticks are showing.

## video_tracks/&lt;id&gt;.yaml — footage

A lane of picture. `length: 0` runs to the end of the source; `source_from` trims the head of
the source, while `start` says where on the timeline the shot sits. `mute` here means **hidden**
— there is no sound on a lane.

```yaml schema=VideoTrack
kind: video
# name: "A-roll"     # the lane's label; the FILENAME is still its id
events:
  - { ref: shot_a, start: 0, length: 4 }
  - { ref: shot_b, start: 4, length: 0, source_from: 2.5 }

# x/y/w/h place the lane inside the viewport; omit for full frame.
```

Drag a shot's **body** to move it, its **left edge** to trim the head (which moves
`source_from` by the same amount, so the frame under the new edge is the one that was there),
or its **right edge** to set its extent. Opening a lane file in the editor also gives you a
reader per placement, with Set From / Set To.

## video_tracks/&lt;id&gt;.yaml — shapes

A generated lane instead of footage: rectangles, circles and text composited over the picture.
Sizes are viewport pixels. Such a lane holds no placements, so the timeline hatches it.

```yaml schema=VideoTrack
kind: shape
shapes:
  - { type: square, x: 40, y: 40, w: 200, h: 120, background_color: "#c8a97e" }
  - { type: circle, x: 300, y: 100, r: 60 }
  - { type: text, content: "LEMO", x: 40, y: 200 }
```
