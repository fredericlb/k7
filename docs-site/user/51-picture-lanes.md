# Picture lanes and shots

A **picture lane** is a layer of the frame. It holds **shots**: placements of clips, each saying
where on the timeline it starts, how long it lasts, and where in its source it starts playing.

## Clips: the sources

A clip is a file in `clips/` that says which source file it is. Its kind is read off the
source's extension:

| extension | kind |
|---|---|
| `.mp4` `.mov` `.m4v` `.webm` `.mkv` | video |
| `.png` `.jpg` `.jpeg` `.webp` `.gif` `.avif` | still image — one picture, held for as long as the shot lasts |
| `.srt` `.vtt` | subtitles — see [Titles, shapes and subtitles](./55-titles-and-subtitles.md) |
| anything else | audio (not picture) |

```js
// clips/counter.k7x
source("clips/counter.mp4")
```

A video clip may carry three more fields, normally written for you:

| field | what it is | written by |
|---|---|---|
| `sound` | an audio file holding the video's sound, which the engine plays | `picture sound` |
| `optimized` | a full-resolution copy every browser can decode | `picture prepare` |
| `proxy` | a small copy for previewing heavy footage | `picture prepare` |

One clip can be placed any number of times, on any number of lanes.

## Lanes

Create a lane with `picture lane new`:

```text
picture lane new broll
```

A picture lane is a lane like an audio one: a file in `nodes/` (in `tracks/` in a project with
chains), its name being the lane's name. What makes it a picture lane is its first line,
`extends("@meta/picture-track")`. The command above writes `nodes/broll.k7x` and lists `broll` in the
project's `trackOrder` above the other picture lanes, so it draws on top. A picture lane cannot
share a name with an audio lane.

A lane file's fields:

| field | meaning |
|---|---|
| `color` | the lane's colour |
| `frame` | `[x, y, w, h]`: where the lane draws in the frame, in viewport pixels; leave it out to fill the frame |
| `events` | the shots, in order |

```js
// nodes/pip.k7x — a picture-in-picture in the bottom-right corner
extends("@meta/picture-track")
frame([960, 540, 320, 180])
events([ref("bars").start(0).length(8).from(0)])
```

`picture rect pip 960 540 320 180` writes the same four numbers, and so does dragging the lane
in the viewport (see [The viewport and transitions](./53-viewport.md)).

Muting a picture lane hides it; its shots' sound has a mute of its own (see
[Hearing a shot's sound](#hearing-a-shots-sound)). Like an audio lane's mute,
it is the lane's bypass in the graph, not a field of the lane file. The lanes draw in the order
of their rows: a picture row above another draws in front of it.

Solo is not stored in the lane file: soloed lanes are listed in the project's `soloed` list, the
same list audio lanes use. Soloing a picture lane silences no sound, and soloing an audio lane
hides no picture.

## Shots

Each entry of `events` is one shot:

| field | meaning |
|---|---|
| `ref` | the clip id. An entry with no `ref` is an **activation**, used on lanes of shapes (see [Titles, shapes and subtitles](./55-titles-and-subtitles.md)) |
| `start` | where on the timeline the shot starts, in seconds |
| `length` | how long it lasts, in seconds; `0` (or absent) means "to the end of the source", or to the next shot's start when one follows |
| `from` | how far into the source the shot starts, in seconds |
| `fadeIn` `fadeOut` | how the shot arrives and leaves — see [The viewport and transitions](./53-viewport.md) |
| `speed` | how fast the source runs under the shot — see [Speed and animation](./52-speed-and-animation.md) |
| `pitch` | how a retimed shot's sound follows its `speed`: `"tape"` (the default, pitch moves with speed) or `"keep"` (stretched at its own pitch) |
| `silent` | `true` takes the shot's sound away and keeps its picture |
| `animate` | keyframes moving the shot inside its lane — see [Speed and animation](./52-speed-and-animation.md) |
| `effect` | a shader run applied to this shot alone — see [Effects and shaders](./54-effects-and-shaders.md) |

```js
// nodes/main.k7x
extends("@meta/picture-track")
events([
  ref("counter").start(0).length(4).from(0),
  ref("bars").start(3).length(5).from(1.5).fadeIn(1),
])
```

### Which shot is on top

Shots on one lane may overlap. Where they do, the shot **later in the file** covers the earlier
ones. That is how a dissolve works: the incoming shot starts before the outgoing one ends and
fades in over it. A lane shows at most two shots at a time; if three overlap, the two later in
the file win.

A `length: 0` shot with nothing after it runs to the end of its source. On the timeline it is
drawn dashed and amber, at a provisional four seconds, because its real length is only known
once the source is opened.

## Placing shots

**Drop files on the timeline.** Drop video, image or subtitle files onto a picture lane: each
file is uploaded into `clips/`, declared as a clip named after the file, and placed where you
dropped it. A still is placed with a length of five seconds. Several files go onto the lane
under the pointer and the picture lanes below it, one each. After a drop of video, k7 also runs
`picture sound` and `picture prepare` on the lane, so the shots are heard and their footage is
made playable.

**Or use the command:**

```text
picture add main shot_a 12.5 4
picture add main shot_a 1:02 0 3.5
```

The arguments are the lane, the clip id, where it lands, then optionally the length (left out,
it runs to the end of its source) and the `from`. A clip id with no `clips/` file is
reported rather than refused: the shot is written and draws nothing until the clip exists.

## Editing shots on the timeline

| gesture | what it writes |
|---|---|
| drag a shot's body | `start` |
| drag its right edge | `length` |
| drag its left edge | `start`, `from` and `length` together, so the tail stays put and the frame under the edge does not change |

Drags snap to the ruler's ticks. Hold Ctrl to move by whole steps of the ruler's unit while
keeping the shot's own offset; hold Shift to move freely. A drag that ends where it started
writes nothing.

The timeline tools work on shots too: the **cut** tool splits a shot where you click
(`picture split`), the **erase** tool removes it (`picture delete`). The mute tool does not
apply to a single shot.

With the caret on a picture lane, `m` hides it, `s` solos it and `r` arms it for camera
recording.

Right-click a shot for **move**, **length**, **head** and **delete**, each filled in with that
shot's lane and start.

A shot that is retimed shows its speed in its label (`×0.5`, `freeze`).

## Editing shots with commands

```text
picture move main 12.5 20        # the shot starting at 12.5 now starts at 20
picture length main 20 4         # it lasts 4 seconds
picture length main 20 0         # it runs to the end of its source
picture head main 20 21          # trim the first second; the tail stays where it was
picture split main 20 22.5       # two shots of the same clip, cut at 22.5
picture delete main 20           # remove it
```

`picture head` moves the in-point at the shot's speed, so a slowed or reversed shot keeps the
right frame under its new head, and its animation keys shift with it. It refuses to walk the
head back past the source's first frame, and refuses a `length: 0` shot (whose extent nobody
has measured yet).

`picture split` makes two placements of one clip: the first keeps how the shot arrives
(`fadeIn`), the second keeps how it leaves (`fadeOut`), and the animation is cut so each half
plays exactly what the whole shot played over its span.

Two shots starting at the same instant on one lane cannot be addressed by these commands: move
one of them in the file first.

## Setting in and out points with the readers

When a picture lane's file is open in the text editor, a strip of small video readers appears,
one per shot. Play or scrub a reader to the frame you want, then:

- **Set From** writes the reader's current time into that shot's `from`;
- **Set To** writes its `length` (the reader's time minus `from`).

## Hearing a shot's sound

A picture lane carries its shots' sound too, played by the engine as the lane's second half,
`main#audio`. It has its own row, fader, mute and solo: muting the picture lane hides it and keeps
the sound, and muting `main#audio` silences it and keeps the picture. Wired to nothing it plays
straight to the mix; wire `"main#audio"` in `graph.k7x` like any lane to put an EQ on the dialogue.

To get the sound, run:

```text
picture sound main
```

For each video clip on the lane, k7 extracts its sound once into a `.sound.wav` file beside the
video and writes it as the clip's `sound`. Each shot is then heard exactly where it is seen: a cut
in the picture is a cut in the sound, and a dissolve is a crossfade. Running it again only does
what is missing. A clip with no sound stays silent; a lane whose shots are all silent gets no sound
row.

The sound row cannot be edited with the `event …` commands: edit the shots instead, and the sound
follows. Deleting a clip on the sound row is the exception: it writes `silent: true` on that shot,
which keeps its picture. `picture silence main 4` does the same for the shot starting at 4 s, and
brings the sound back when run again.

In a project kept as chain files, which name no port, the sound plays on an audio lane instead:
`picture sound main dialog` makes it (named `<lane>-sound` unless you name it), with a
`video_source` field naming the picture lane and its events taken from the shots.
