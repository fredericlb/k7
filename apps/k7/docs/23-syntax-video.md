# Video

A song holds picture as well as sound. One line in `project.k7x`, and lanes of picture beside the
lanes of sound:

```k7x schema=ProjectFile
project({
  viewport: [1280, 720, 30], // the frame every lane draws into: width, height, EXPORT fps
})
```

`viewport` has no default: a frame invented for you would silently letterbox every shot, and
you would find out at the export.

The lanes draw in the order of their rows: the **top** picture row is in front. Drag a row to
restack it, or `picture lane order pip 1` to send `pip` to the back. Both write `trackOrder`, the
one order every lane of the song shares.

Add a `surfaces/viewport.k7x` to see it (see the Surfaces page); without one the lanes still
draw on the timeline and nothing composites them.

## Everything here is a SECOND

Your song's lanes are placed in bars, against a tempo you can change afterwards. A shot is
placed in seconds, against the wall clock, and **nothing moves it** — changing `tempo:` slides
the bar grid under your cut rather than moving the cut.

Both are on the one timeline. Its ruler reads bars or minutes-and-seconds — the clock button in
its header — and what a drag snaps to is whichever ticks are showing.

## A picture lane — footage

A lane of picture is a lane like any other, in `nodes/<id>.k7x`, that extends
`@meta/picture-track`. Its events are SHOTS. `length(0)` runs to the end of the source; `from`
trims the head of the source, while `start` says where on the timeline the shot sits. Muting it
(**M**, or `picture mute`) **hides** it — a picture lane plays no sound (see A shot's sound, below).

```k7x schema=Module
// nodes/main.k7x
extends("@meta/picture-track")
color("#c8a97e") // its colour in the timeline
frame([0, 0, 1280, 720]) // where it draws in the viewport, x y w h; omit for the whole frame
events([ref("shot_a").start(0).length(4), ref("shot_b").start(4).length(0).from(2.5)])
```

Drag a shot's **body** to move it, its **left edge** to trim the head (which moves
`from` by the same amount, so the frame under the new edge is the one that was there),
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

```k7x schema=Module
extends("@meta/picture-track")
events([
  ref("shot_a")
    .start(4)
    .length(6)
    .animate({
      scale: [[0, 1], t(6).v(1.2).ease("inout")], // a slow push in…
      x: [[0, 0], [6, -80]], // …drifting 80 px left
      opacity: [[0, 0], [0.5, 1]], // …faded up over half a second
      rotate: 2, // a constant: tilted throughout
    }),
])
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

```k7x schema=Clip
// clips/interview.k7x
source("clips/interview.mov") // what the camera wrote
optimized("clips/interview.optimized.mp4") // full size, playable — the preview and the export use it
proxy("clips/interview.proxy.mp4") // small — the preview only
```

The copies appear on their own once they are written. Dropping footage on a picture lane runs it
for you. An export never uses a proxy, so the file you render keeps the source's resolution. If it
meets a file the browser cannot read, it says which one, before it starts.

An image (`png`, `jpg`, `webp`…) is a shot too: drop it on a picture lane and it is placed for
five seconds, held still. Give it `scale` and `x` keys for a slow push across a photograph.

## Speed, freeze and reverse

```k7x schema=Module
extends("@meta/picture-track")
events([
  ref("run").start(0).length(4).speed(0.5), // slow motion
  ref("face").start(4).length(3).speed(0), // held on its first frame
  ref("glass").start(7).length(2).from(5).speed(-1), // backwards from 5 s
])
```

`speed` is how fast the source runs under the shot: `2` is double, `0.5` half, `0` freezes on
`from`, and a negative speed runs **backwards from** `from`. The shot keeps its place
and its length; what changes is how much of the source it uses. The timeline labels a retimed
shot `×0.5`, or `freeze`. From the command bar: `picture speed main 0 0.5`.

Its sound follows at the same speed, with the pitch moving like a tape's — or, with
`pitch("keep")` on the shot, stretched at its own pitch, so a voice in slow motion stays a voice.
A reversed or frozen shot is silent. The preview steps a reversed shot frame by frame, so it plays choppier there than
in the export.

## Exporting

`project export video mp4` renders the picture with the song's sound. Add words to change the
render: `size=720p` (or `size=1280x720`), `quality=low`, `medium`, `high` or `max`, and a range,
`from=1:30 to=2:00`. A range gives a file that starts at that moment.

`picture render` makes the same file without keeping a browser open: the server renders it in
the background and puts it in `exports/`, so you can close the tab and come back. It takes the
same words — `picture render mp4 size=720p from=1:30 to=2:00`, or `none` for a silent film. It
is slower than the browser, and WebM is the safe choice there: the server may have no MP4
encoder. A camera lane renders nothing, since there is no live picture to take.

`project export timeline otio` hands the **cut** to another editor instead: every picture lane as
an OpenTimelineIO timeline, which DaVinci Resolve opens and `otioconvert` turns into Final Cut,
Premiere or Avid formats. `project export timeline edl main` writes one lane as an EDL, which
every editor reads. Both name your original camera files, and both carry the shots, the gaps,
the dissolves and the speeds. Moves, picture-in-picture positions, shaders and the shots' sound
stay here.

A cut can come back the same way. Put the `.otio` or `.edl` in the project (an `imports/` folder
is a good home) and run `picture import imports/cut.otio`: each video track becomes a new picture
lane, `import-1`, `import-2` and so on, laid over the lanes you already have. Its media is
found by the path the file gives, then by name in `clips/`. Anything missing is still placed, and
the command lists what to copy into `clips/`. Dissolves come back as fades, and speeds as speeds.
Audio tracks are left out: run `picture sound import-1` to get each shot's own sound.

## Grading a shot, and LUTs

Two shaders come with every workspace: `@k7-core/shaders/grade` (exposure, contrast, saturation,
temperature, each neutral at its middle) and `@k7-core/shaders/look` (a `.cube` LUT, with a strength
knob). Wire one onto a lane and it grades the whole lane. To grade a single shot, give it a node of
its own that nothing feeds, landing on the lane, and name that node on the shot:

```k7x schema=Module
// nodes/warm.k7x
extends("@k7-core/shaders/grade")
params({ P4: 0.7 }) // a touch warmer
```

```k7x schema=Module
// nodes/film.k7x
extends("@k7-core/shaders/look")
lut("looks/film.cube") // a LUT from your colourist, in the project
```

```k7x schema=GraphFile
modules({ warm: ["main"], film: ["main"] })
```

```k7x schema=Module
extends("@meta/picture-track")
events([
  ref("interview").start(0).length(6).effect("warm"),
  ref("street").start(6).length(4).effect("film"),
])
```

A shot's effect is applied to the picture as it was filmed, before it moves or crosses into the
next shot. Several shots naming the same node share its settings, so a scene graded together stays
together.

## A shot's sound

A picture lane carries its shots' sound too, played by the **engine** as its second half,
`main#audio`, with its own row, fader, mute and solo: hiding the picture keeps the sound, and
muting the sound keeps the picture. Wired to nothing it plays straight to the mix; wire it like
any lane to put an EQ on the dialogue:

```k7x schema=GraphFile
modules({ "main#audio": ["dialog-eq"], "dialog-eq": ["MIX"] })
```

Each shot is heard exactly where it is seen: from its `from`, cut where a later shot covers it,
and cross-faded under a `fadeIn`. Move or trim a shot and its sound moves with it. In a project
kept as chain files, which name no port, the sound is an audio lane naming the picture lane
instead, whose events are main's shots:

```k7x schema=Module
// tracks/dialog.k7x — in a chain project only
extends("@meta/track")
video_source("main") // this lane's events ARE main's shots
```

What it plays is the clip's `sound:`, an audio file extracted from the video once, because the
engine cannot open every video container on every machine:

```k7x schema=Clip
// clips/shot_a.k7x
source("clips/shot_a.mp4")
sound("clips/shot_a.sound.wav")
```

You never write either by hand. Dropping a video on a picture lane runs `picture sound <lane>`,
which extracts each shot's sound. Run it yourself for footage placed some other way. A shot whose
file has no sound stays silent, and a lane with no sound at all gets no sound row.

To take one shot's sound away and keep its picture, delete its clip on the sound row, or run
`picture silence main 4` on the shot starting at 4 s. Either writes `silent: true` on the shot;
the same command again brings the sound back. A silent shot still cuts the sound of the shots
under it, as it hides their picture.

## Shapes and texts are MODULES

A rectangle, a circle or a line of text is a module in `modules/shapes/`, wired in `graph.k7x`
to the lane that draws it. Sizes are viewport pixels, and the geometry is `params:` — which is
what a curve drives, so a title can move.

```k7x schema=Module
// modules/shapes/title/module.k7x
type("shape")
shape("text") // square | circle | text
content("LEMO") // text only — the words
font("sans-serif") // …and the family they are set in
color("#c8a97e") // the fill, any CSS colour
params({
  x: 40,
  y: 200,
  font_size: 72, // text only; a circle takes `r`, a square `w` and `h`
})
```

```k7x schema=GraphFile
modules({
  title: ["titles"], // the shape draws on the picture lane it is wired to
  titles: ["RENDER"],
})
```

A shape wired to nothing is reported rather than drawn, since a blank lane cannot say why it is
blank.

### When a shape is on screen

The lane says so, with the same `events:` a lane of footage uses — **an event with no `ref` is an
activation**: a span with no picture in it, saying the lane is on. `length: 0` runs to the next
one, and the last one runs on to the end.

```k7x schema=Module
// nodes/titles.k7x
extends("@meta/picture-track")
events([start(4).length(4)])
```

A lane stating no event at all shows its shapes throughout. `from` and the two fades are
refused here — there is no source to trim and no picture to cross into.

### Titles: several lines, a box, a shadow

A text's `content` keeps its line breaks, and with a `w` its words wrap inside that width.
`align` sets each line left, centred or right in it; `background` puts a box behind the lines and
`padding` the room around them; `shadow: true` lifts the text off a busy picture. That is a lower
third:

```k7x schema=Module
// modules/shapes/lower_third/module.k7x
type("shape")
shape("text")
content(`Ada Lovelace
Analyst`)
align("left")
background("rgba(0, 0, 0, 0.6)")
shadow(true)
params({ x: 80, y: 560, w: 520, font_size: 40, line_height: 1.2, padding: 14 })
```

To fade it in, give its activation an `animate:` with `opacity` keys (see Moving a shot).

### Subtitles: an `.srt` or `.vtt` file is a clip

Drop a subtitle file on a picture lane of its own and its cues show at their times, from where you
placed it. Its look is set on its clip file:

```k7x schema=Clip
// clips/subs.k7x
source("clips/subs.srt")
font("sans-serif")
font_size(36)
color("#ffffff")
background("rgba(0, 0, 0, 0.6)")
align("center")
position("bottom") // bottom, top or middle
margin(40) // px from that edge
```

Everything but `source` is optional: unsaid, captions are white, centred near the bottom, with a
shadow instead of a box. Move the placement to slide every cue together, as you would a shot. A
cue the file gets wrong is named in the picture's warnings rather than skipped quietly. Captions
are drawn into the picture, so an export carries them, and they are left out of a cut handed to
another editor, since the `.srt` itself is what that editor takes.
