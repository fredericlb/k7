# Video

## video_tracks/<id>.yaml — footage

A lane of picture. Placements are in SECONDS, not beats — video is wall-clock material and gets converted at the project tempo when an audio track sources it. `length: 0` runs to the end of the source; `source_from` trims the head. `mute` here means hidden.

```yaml schema=VideoTrack
kind: video
# name: "A-roll"     # the lane's label; the FILENAME is still its id
clips:
  - { ref: shot_a, start: 0, length: 4 }
  - { ref: shot_b, start: 4, length: 0, source_from: 2.5 }

# x/y/w/h place the lane inside the viewport; omit for full frame.
```

## video_tracks/<id>.yaml — shapes

A generated lane instead of footage: rectangles, circles and text composited over the picture. Sizes are viewport pixels.

```yaml schema=VideoTrack
kind: shape
shapes:
  - { type: square, x: 40, y: 40, w: 200, h: 120, background_color: "#c8a97e" }
  - { type: circle, x: 300, y: 100, r: 60 }
  - { type: text, content: "LEMO", x: 40, y: 200 }
```
