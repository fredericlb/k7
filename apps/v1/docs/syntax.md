# The files, at a glance

The reference — what each key means and why — is
[packages/song/docs/v1Project.md](../../../packages/song/docs/v1Project.md). This is the
shape, for when you only need to remember the spelling.

## project.yaml

```yaml
type: v1
project:
  name: "the film"
  viewport: [1280, 720, 30]   # width, height, EXPORT fps. Required.
  layers: [main, pip]         # draw order, bottom first. Every lane must be listed.

markers:
  "0": "cold open"
  "1:30.5": "the cut"         # WALL-CLOCK, quoted. Seconds or m:ss[.mmm].
```

## clips/&lt;id&gt;.yaml — a source

```yaml
source: clips/shot_a.mp4
```

The filename is the id. One clip file can be placed any number of times, on any number of
lanes.

## video_tracks/&lt;id&gt;.yaml — footage

A lane of picture. Placements are in **seconds**. `length: 0` runs to the end of the
source; `source_from` trims the head. `mute` here means **hidden**.

```yaml
kind: video
# name: "A-roll"     # the lane's label; the FILENAME is still its id
x: 0, y: 0, w: 1280, h: 720   # where in the viewport; omit for the full frame
clips:
  - { ref: shot_a, start: 0, length: 4 }
  - { ref: shot_b, start: 4, length: 0, source_from: 2.5 }
```

## video_tracks/&lt;id&gt;.yaml — shapes

A generated lane instead of footage: rectangles, circles and text composited over the
picture. Sizes are viewport pixels, and the lane's own rect is ignored — each shape carries
its geometry.

```yaml
kind: shape
shapes:
  - { type: square, x: 40, y: 40, w: 200, h: 120, background_color: "#c8a97e" }
  - { type: circle, x: 300, y: 100, r: 60 }
  - { type: text, content: "LEMO", x: 40, y: 200 }
```

A square's and a text's `x,y` is its top-left; a circle's is its **centre**.
