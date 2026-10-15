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
— a picture lane plays no sound (see A shot's sound, below).

```yaml schema=VideoTrack
# name: "A-roll"     # the lane's label; the FILENAME is still its id
# color: "#c8a97e"   # …and its colour in the timeline
events:
  - { ref: shot_a, start: 0, length: 4 }
  - { ref: shot_b, start: 4, length: 0, source_from: 2.5 }

# x/y/w/h place the lane inside the viewport; omit for full frame.
```

Drag a shot's **body** to move it, its **left edge** to trim the head (which moves
`source_from` by the same amount, so the frame under the new edge is the one that was there),
or its **right edge** to set its extent. Opening a lane file in the editor also gives you a
reader per placement, with Set From / Set To.

To cut a shot in two, use the blade (`b`) and click where to cut, or put the caret on the lane
and press **Ctrl+B** to cut at the playhead. Both work the same way on audio lanes. On picture,
the cut writes a second placement of the same clip, so nothing is rendered and the frames do
not change; its sound follows on its own.

In seconds mode, once the song has a picture, the ruler's fine ticks are **frames** (`12f`).
Every drag and every cut lands on one, and `,` / `.` step the playhead one tick back or
forward: a frame, once you are zoomed in.

## Moving a shot

A shot can pan, zoom, turn and fade inside its lane, with keys written on the placement:

```yaml schema=VideoTrack
events:
  - ref: shot_a
    start: 4
    length: 6
    animate:
      scale: [[0, 1], { t: 6, v: 1.2, ease: inout }]   # a slow push in…
      x: [[0, 0], [6, -80]]                            # …drifting 80 px left
      opacity: [[0, 0], [0.5, 1]]                      # …faded up over half a second
      rotate: 2                                        # a constant: tilted throughout
```

A key is `[time, value]`, its time in seconds **from the shot's own start**, so the animation
moves with the shot. `x` and `y` are pixels, `scale` is a factor about the lane's centre,
`opacity` runs from 0 to 1 and `rotate` is in degrees, clockwise. Write `{ t, v, ease }` to ease
the movement leaving a key: `in`, `out`, `inout`, or `hold` to stay put until the next key.

The lane's rectangle crops the shot, so a push-in on a picture-in-picture stays inside its box.
Splitting a shot keeps each half's animation exactly, and trimming its head keeps the keys on
the same frames.

From the command bar, `picture key main 4 scale 10 1.2 inout` sets a key on the shot starting at
4 s, at 10 s on the timeline. `picture unkey main 4 scale 10` removes it.

## Footage a browser cannot play, and stills

Phones and cameras write video a browser cannot always play: HEVC, ProRes, 10-bit footage. 4K plays,
but slowly enough to hold a lane behind the music. `picture prepare main` looks at each shot on the
lane and, in the background, makes what it needs:

```yaml schema=Clip
# clips/interview.yaml
source: clips/interview.mov                 # what the camera wrote
optimized: clips/interview.optimized.mp4    # full size, playable — the preview and the export use it
proxy: clips/interview.proxy.mp4            # small — the preview only
```

The copies appear on their own once they are written. Dropping footage on a picture lane runs it
for you. An export never uses a proxy, so the file you render keeps the source's resolution. If it
meets a file the browser cannot read, it says which one, before it starts.

An image (`png`, `jpg`, `webp`…) is a shot too: drop it on a picture lane and it is placed for
five seconds, held still. Give it `scale` and `x` keys for a slow push across a photograph.

## Speed, freeze and reverse

```yaml schema=VideoTrack
events:
  - { ref: run,   start: 0, length: 4, speed: 0.5 }                 # slow motion
  - { ref: face,  start: 4, length: 3, speed: 0 }                   # held on its first frame
  - { ref: glass, start: 7, length: 2, source_from: 5, speed: -1 }  # backwards from 5 s
```

`speed` is how fast the source runs under the shot: `2` is double, `0.5` half, `0` freezes on
`source_from`, and a negative speed runs **backwards from** `source_from`. The shot keeps its place
and its length; what changes is how much of the source it uses. The timeline labels a retimed
shot `×0.5`, or `freeze`. From the command bar: `picture speed main 0 0.5`.

Its sound follows at the same speed, with the pitch moving like a tape's. A reversed or frozen
shot is silent. The preview steps a reversed shot frame by frame, so it plays choppier there than
in the export.

## A shot's sound

The picture lane plays no sound. The **engine** plays it, from an ordinary audio lane that names
the picture lane it follows:

```yaml schema=Module
# nodes/dialog.yaml
extends: "@meta/track"
video_source: main     # this lane's events ARE main's shots
```

The lane has no `events:` of its own. Each shot on `main` is heard exactly where it is seen:
from its `source_from`, cut where a later shot covers it, and cross-faded under a `fade_in`.
Move or trim a shot and its sound moves with it. Everything else is an audio lane like any other:
a fader, a chain, a mute, a solo.

What it plays is the clip's `sound:`, an audio file extracted from the video once, because the
engine cannot open every video container on every machine:

```yaml schema=Clip
# clips/shot_a.yaml
source: clips/shot_a.mp4
sound: clips/shot_a.sound.wav
```

You never write either by hand. Dropping a video on a picture lane runs `picture sound <lane>`,
which extracts each shot's sound and makes the lane the first time. Run it yourself for footage
placed some other way. A shot whose file has no sound stays silent, and a lane with no sound at
all gets no audio lane.

## Shapes and texts are MODULES

A rectangle, a circle or a line of text is a module in `modules/shapes/`, wired in `graph.yaml`
to the lane that draws it. Sizes are viewport pixels, and the geometry is `params:` — which is
what a curve drives, so a title can move.

```yaml schema=Module
# modules/shapes/title/module.yaml
type: shape
shape: text            # square | circle | text
content: "LEMO"        # text only — the words
font: sans-serif       # …and the family they are set in
color: "#c8a97e"       # the fill, any CSS colour
params:
  x: 40
  y: 200
  font_size: 72        # text only; a circle takes `r`, a square `w` and `h`
```

```yaml schema=GraphFile
modules:
  title: [ titles ]    # the shape draws on the picture lane it is wired to
  titles: [ RENDER ]
```

A shape wired to nothing is reported rather than drawn, since a blank lane cannot say why it is
blank.

### When a shape is on screen

The lane says so, with the same `events:` a lane of footage uses — **an event with no `ref` is an
activation**: a span with no picture in it, saying the lane is on. `length: 0` runs to the next
one, and the last one runs on to the end.

```yaml schema=VideoTrack
# video_tracks/titles.yaml
events:
  - { start: 4, length: 4 }
```

A lane stating no event at all shows its shapes throughout. `source_from` and the two fades are
refused here — there is no source to trim and no picture to cross into.
