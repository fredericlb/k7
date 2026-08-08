# A v1 project — a CUT

A `*.v1` folder is read by the same loader as a `*.l8` song, out of the same
`@studio/song`. It is not a second parser: it is the same folder-of-entities you already
know, read as **picture** instead of as sound.

| file | what it holds |
|---|---|
| `project.yaml` | the viewport, the draw order, the markers, plus `type: v1` at the root |
| `clips/<id>.yaml` | one file per SOURCE — `source: clips/shot_a.mp4` |
| `video_tracks/<id>.yaml` | one file per LANE — where each source is placed, or what shapes to draw |

No `tracks/`, no `sequences/`, no `curves/`, no `chains.yaml`: a cut has no signal to
route and no notes to play. What it has is a stack of lanes and a frame to draw them into.

## Everything is a second

This is the whole difference, and it is not a detail of the format — it is why v1 is an
app and not a mode of l8.

A song's positions are **musical**: `start: "5:1"` is bar 5 beat 1, and what that means in
seconds depends on the tempo, which the author is free to change afterwards. A cut's
positions are **wall-clock**: `start: 4` is four seconds, and no setting anywhere can move
it. A single timeline cannot draw both without one of them lying about where it is.

So a v1 project has no `tempo`, no `timeSignature` and no `sampleRate`. They are not
defaulted and ignored — there is nowhere for them to go, and `VideoProjectDoc` has no
field to put them in.

`markers:` follows the same rule. Its keys are wall-clock — `"90"`, `"12.5"`, `"1:30.5"` —
where a song's are `bar:beat:tick`. The two dialects share one `markers:` schema (one
loader validates every project), so the key form is a superset and the DIALECT decides
what a key means. Hours are deliberately unsayable: `1:30:00` would be indistinguishable
from a musical `bar:beat:tick`, so a three-hour cut writes `10800`.

## `viewport` is required, and `layers` is the membership

```yaml
type: v1
project:
  name: "the film"
  viewport: [1280, 720, 30]   # width, height, EXPORT fps
  layers: [main, pip]         # draw order, bottom first
```

**`viewport` has no default**, and that is a choice: a frame invented by the loader would
silently letterbox every shot in the project, and you would find out at the export. The
third element is the fps, which *is* defaulted (30) because it is used by rendering to a
file and by nothing else — realtime follows the transport's own clock.

**`layers` is the order AND the membership**, and both halves are enforced. A name with no
file is an error you would expect. A file no name lists is *also* an error, and that is the
one worth stating: such a lane compiles perfectly and simply never appears, which is
exactly the failure this codebase refuses to ship. Throwing turns it into a line to fix.

## A lane, and what `mute` means on one

```yaml
# video_tracks/main.yaml
kind: video
x: 0, y: 0, w: 1280, h: 720    # where in the viewport; omit for the full frame
clips:
  - { ref: shot_a, start: 0, length: 4 }
  - { ref: shot_b, start: 4, length: 0, source_from: 2.5 }
```

`length: 0` runs to the end of the source — a duration the compiler cannot know without
opening the file, so the engine of the format is the same one a length-0 audio clip uses.
`source_from` trims the head *of the source*, leaving `start` to say where on the timeline
the shot sits: the same separation between MATERIAL and ARRANGEMENT that a song's
`from`/`to` versus `start` makes.

**`mute` means hidden.** There is no sound on a lane, so the word had to mean the other
thing; the alternative was a second word for the one gesture every lane in every app has.

A `kind: shape` lane draws rectangles, circles and text instead, in viewport px, and holds
no placements at all — which is why the timeline hatches it rather than drawing an empty
row that looks like a lane you forgot to fill.

## Where the picture used to live

All of this was **l8's**, until it wasn't. A song could set `video: true` and carry
`video_tracks/`, and l8 drew a fourth pane for it.

Two things made that worth splitting:

- **The unit.** l8's timeline is drawn in beats and a placement is a timecode; picture is
  cut in seconds. The video lanes were therefore READ-ONLY in that timeline — drawn by
  converting seconds to beats at the project tempo, and editable only by opening their
  file. A whole half of the app could be looked at and not touched.
- **The engine.** A ProjectDoc carried four picture fields that the C++ engine must never
  see, and a `withoutVideo` step existed at the one choke point to take them back off
  again. A document with a section that is stripped before it is sent is a document
  describing two things.

Both are gone. `ProjectDoc` has no picture; `VideoProjectDoc` (videoDoc.ts) has nothing
else. The one thing that genuinely went away with the split is `video_source` — an l8
audio track inheriting a video lane's placements so a shot and its sound could not drift.
That link cannot exist once the two are two folders, and nothing replaces it yet.

## What is NOT done

`VideoPluginDoc` is modelled and not compiled: a `video_effect` / `video_transition` chain
has a shape in the document and no path from a `chains.yaml` into the renderer. v1's
scaffold writes no `chains.yaml` for that reason — offering a file nothing reads would be
the same silent-acceptance failure the `layers` check above exists to prevent.

Export is `@studio/ui-eyes`'s `exportScene`, which works frame-by-frame through WebCodecs;
v1 does not yet mount a button for it.
