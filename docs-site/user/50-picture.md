# Picture: video in a k7 project

A k7 song can carry **picture** as well as sound. Video lanes sit on the same timeline as your
audio and MIDI lanes, a floating **viewport** window composites them in real time against the
playhead, and the result renders to a video file with the song's mixdown as its soundtrack.

This part of the guide covers:

| page | what it covers |
|---|---|
| this page | video and live-video projects, the frame, seconds against bars, the command reference |
| [Picture lanes and shots](./51-picture-lanes.md) | lanes, clips, placing and trimming shots, a shot's sound |
| [Speed and animation](./52-speed-and-animation.md) | slow motion, freezes, reverse; moving, scaling and fading a shot with keyframes |
| [The viewport and transitions](./53-viewport.md) | the viewport window, draw order, placing a lane in the frame, dissolves and custom transitions |
| [Effects and shaders](./54-effects-and-shaders.md) | shader chains on a lane, on a shot, on the whole frame; colour grading and LUTs; audio-reactive picture |
| [Titles, shapes and subtitles](./55-titles-and-subtitles.md) | text blocks, boxes and dots, `.srt` and `.vtt` subtitles |
| [Webcam and live video](./56-webcam-and-live-video.md) | the `live-video` project, a camera on a lane, recording camera takes, a second device |
| [Preparing footage](./57-preparing-footage.md) | optimized copies, proxies, stills, what a browser can play |
| [Exchanging cuts](./58-exchanging-cuts.md) | handing the cut to another editor and bringing one back (OTIO, EDL) |
| [Rendering the picture](./59-rendering-the-picture.md) | exporting from the browser, rendering on the server |

## Two kinds of picture project

When you create a project you pick an **archetype** (see the getting-started pages in the
[index](./00-index.md)). Two of them carry picture:

| archetype | shown in the dialog as | what you get |
|---|---|---|
| `video` | "the timeline and the viewport — the arrangement, plus a picture lane" | everything an `arrangement` project has, plus a picture lane `main`, a sample clip declaration, the viewport surface, and the picture's output run in the graph |
| `live-video` | "the same rig, plus a webcam and the viewport it fills" | the `live` rig (an input, a fader, the master run with its recorder) plus a webcam node and the viewport. No timeline and no lanes: the camera fills the frame on its own |

You can also add picture to any existing song: create a picture lane with `picture lane new`
(it needs a `viewport` in the project file, see below), or bring a cut in with
`picture import`, which writes the viewport for you if the song has none.

## What a picture project holds

A video project is a folder like any song. The picture adds these files:

| file | what it says |
|---|---|
| `project.k7x` | `viewport` (the frame's size and export frame rate) and `layers` (the picture lanes, in draw order) |
| `video_tracks/<lane>.k7x` | one picture lane: where it draws in the frame and the shots it places, in seconds |
| `clips/<id>.k7x` | a source file — a video, a still image or a subtitle file — that shots name by id |
| `surfaces/viewport.k7x` | asks for the viewport window; without it the lanes still compile and still show on the timeline, but nothing composites them |
| the graph or chain files | `RENDER` (where every picture lane arrives) and `VIDEO_OUT` (the frame that leaves); shader runs on lanes |

The examples in this guide use the `.k7x` spelling. A `.yaml` file holds exactly the same keys.

```js
// project.k7x
project({
  name: "video-demo",
  tempo: 120,
  sampleRate: 48000,
  timeSignature: "4/4",
  viewport: [1280, 720, 30],
  layers: ["main", "pip", "title_layer"],
})
```

### The frame: `viewport`

`viewport: [width, height, fps]` is the size, in pixels, every picture lane draws into. There
is no default: a project with picture lanes and no `viewport` does not compile, and says so. The
third number is the **export** frame rate (30 when you leave it out); live playback follows the
transport rather than a frame rate.

To change the frame's shape without typing numbers, use `project aspect`:

```text
project aspect 9:16
```

The two shapes are `16:9` and `9:16`. The long edge is kept, so a 1280×720 project asked for
9:16 becomes 720×1280; a stated export fps is kept too.

### Draw order: `layers`

`layers` lists the picture lanes **bottom first**: the first one draws underneath, the last one
on top. It is also the list of which lanes exist. A name with no lane file is an error, a lane
file no name lists is an error, and a name listed twice is an error. `picture lane new` and
`picture lane order` keep it right for you.

## Seconds, not bars

Everything about picture is in **decimal seconds** (`12.5`) or **minutes and seconds**
(`1:30.5`), never in bars and beats. Picture is cut against the wall clock; your audio lanes are
placed against the tempo. Both are drawn on one timeline, and the ruler can count either way:
the clock button in the timeline header (or `ui ruler`) switches the ruler between bars and
seconds. In seconds, the ruler's finest ticks are frames at the export frame rate.

Because a shot's file says seconds, changing `tempo` slides the bar grid under a shot rather
than moving the shot.

Markers in `project.k7x` are read by the picture as wall-clock points too.

## Showing the viewport

The viewport is a floating window over whichever page is on screen: move it by its title bar,
size it by its corner. Show or hide it with:

- the viewport button in the side toolbar (on a phone, the viewport entry of the menu),
- the command `ui viewport`.

Hiding it keeps everything loaded, so showing it again is instant. See
[The viewport and transitions](./53-viewport.md).

## Command reference

Every picture command can be typed in the command bar. Times are seconds or `m:ss`. A shot is
addressed by its lane and **where it starts**.

| command | what it does |
|---|---|
| `picture lane new [name]` | add a picture lane (named `layer-N` when you do not say), on top of the others |
| `picture lane order <lane> <position>` | move a lane in the draw order; `1` draws first, underneath |
| `picture mute <lane>` | hide or show a lane (`m` with the caret on the lane) |
| `picture solo <lane>` | solo a lane: soloed lanes hide the rest of the picture (`s` with the caret on the lane) |
| `picture rect <lane> <x> <y> <w> <h>` | place and size a lane in the frame, in viewport pixels |
| `picture add <lane> <clip> <at> [length] [source_from]` | place a clip on a lane |
| `picture move <lane> <at> <to>` | move a shot |
| `picture length <lane> <at> <seconds>` | set how long a shot lasts; `0` runs to the end of the source |
| `picture head <lane> <at> <to>` | trim a shot's head, its tail staying where it is |
| `picture delete <lane> <at>` | remove a shot (the clip it names stays) |
| `picture split <lane> <at> <where>` | cut a shot in two |
| `picture speed <lane> <at> <factor>` | change a shot's speed: `2`, `0.5`, `0` (freeze), `-1` (backwards), `1` |
| `picture key <lane> <at> <prop> <when> <value> [ease]` | set an animation keyframe |
| `picture unkey <lane> <at> <prop> <when>` | remove an animation keyframe |
| `picture sound <lane> [track]` | play the lane's shots' sound on an audio lane |
| `picture prepare <lane>` | make optimized copies and proxies for the lane's footage |
| `picture interchange <otio\|edl> [lane]` | write the cut for another editor into `exports/` |
| `picture import <file> [prefix]` | read an `.otio` or `.edl` into new picture lanes |
| `picture render [webm\|mp4] [wav\|none] [settings]` | render the picture on the server, into `exports/` |
| `project export video <webm\|mp4> [wav\|mp3\|none] [settings]` | render the picture in this browser and download it |
| `project export timeline <otio\|edl> [lane]` | write the cut and download it |
| `project aspect <16:9\|9:16>` | set the frame's shape |
| `ui viewport` | show or hide the viewport window |
| `ui picture arm [lane]` | arm a picture lane for camera recording; bare, it disarms (`r` with the caret on the lane) |
| `ui ruler` | switch the timeline ruler between bars and seconds |

`project add` and `project remove` (insert or delete time) move picture lanes too: every shot
starting after the point moves by the same span, converted to seconds at the song's tempo.
