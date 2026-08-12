# Picture — a song's other half

An `.l8` folder holds sound **and image**. Same folder, same loader, read twice:

| file | read by the SONG compile | read by the PICTURE compile |
|---|---|---|
| `project.yaml` | `tempo`, `sampleRate`, `timeSignature`, `markers` | `viewport`, `layers`, `markers` |
| `nodes/<id>.yaml` | the lanes | — |
| `chains.yaml` | the signal graph | — |
| `clips/<id>.yaml` | a source (audio) | a source (video) |
| `video_tracks/<id>.yaml` | — | one file per picture LANE |

`loadProject` produces the `ProjectDoc` the C++ engine is handed. `loadVideoProject`
produces the `VideoProjectDoc` `@studio/ui-eyes` composites. **They share no field.**

## Why two documents and not one

This is the part worth keeping. `ProjectDoc` once carried four picture fields, and a
`withoutVideo` step existed at the single choke point on the way to the engine to take them
back off again. A document with a section that is deleted before it is sent describes two
things, and the deletion is a rule you can only learn by finding the one function that
applies it.

Two compiles over one folder says the same thing structurally: the engine's document has no
frame in it because **nothing ever put one there**, not because something removed it.

That is also why `video_tracks/` is still its own entity folder rather than a key inside a
lane. Picture and sound share the folder they live in and nothing else.

## Everything in a video lane is a SECOND

A song's positions are **musical**: `start: "5:1"` is bar 5 beat 1, and what that means in
seconds depends on the tempo, which the author is free to change afterwards. A placement's
positions are **wall-clock**: `start: 4` is four seconds, and no setting anywhere can move
it.

Both are drawn on the one timeline, and the ruler reads either — bars, or minutes and
seconds (`apps/l8/frontend/docs/picture.md`). The conversion is exact and reversible in both
directions because there is **one `tempo:` and no tempo map**: a shot at 4.5s sits at beat 9
at 120 bpm, and that is a fact about the drawing rather than about the file.

So re-typing `tempo:` **slides the grid under the shot**. It does not move it. The file says
seconds and goes on saying seconds. If you want a cut that follows the music, place it in
bars — which is what an audio lane is for.

### This is what changed

Picture used to be an app of its own (`apps/v1`, a `.v1` folder) for exactly one reason: l8's
timeline was in beats, so video lanes were **read-only** in it — drawn by converting seconds
to beats, and editable only by opening their file. A whole half of the app could be looked at
and not touched.

The ruler reading both units is what retired that. The lanes are editable here now: the three
drags are in `apps/l8/frontend/docs/picture.md`, and they write seconds back.

## `viewport` is required, and `layers` is the membership

```yaml
project:
  name: "the film"
  tempo: 120                  # the SONG's; picture never reads it
  viewport: [1280, 720, 30]   # width, height, EXPORT fps
  layers: [main, pip]         # draw order, bottom first
```

**`viewport` has no default**, and that is a choice: a frame invented by the loader would
silently letterbox every shot in the project, and you would find out at the export. The third
element is the fps, which *is* defaulted (30) because it is used by rendering to a file and by
nothing else — realtime follows the transport.

**`layers` is the order AND the membership**, and both halves are enforced. A name with no
file is an error you would expect. A file no name lists is *also* an error, and that is the
one worth stating: such a lane compiles perfectly and simply never appears, which is exactly
the failure this codebase refuses to ship.

A song with no `video_tracks/` folder needs neither line. `GET /video-doc` answers with an
**empty** document for it rather than an error, so "this song has no picture" and "this song's
picture will not compile" stay two different answers.

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
opening the file, so it uses the same convention a length-0 audio clip does. `source_from`
trims the head *of the source*, leaving `start` to say where on the timeline the shot sits:
the same separation between MATERIAL and ARRANGEMENT that a song's `from`/`to` versus `start`
makes.

**`mute` means hidden.** There is no sound on a lane, so the word had to mean the other
thing; the alternative was a second word for the one gesture every lane in every app has.

A `kind: shape` lane draws rectangles, circles and text instead, in viewport px, and holds
no placements at all — which is why the timeline hatches it rather than drawing an empty
row that looks like a lane you forgot to fill.

## `markers:` is shared, and the dialect decides

One `markers:` schema serves both readings, so the key form is a superset: a song's are
`bar:beat:tick`, and wall-clock ones are `"90"`, `"12.5"`, `"1:30.5"`. Hours are deliberately
unsayable — `1:30:00` would be indistinguishable from a musical `bar:beat:tick` — so a
three-hour cut writes `10800`.

## What is NOT done

- **`video_source`.** An audio lane inheriting a video lane's placements, so a shot and its
  sound could not drift. It was dropped when the two became two folders; they are one folder
  again, so it *could* exist. It is simply not written.
- **Video chains.** `VideoPluginDoc` (`video_effect` / `video_transition`) has a shape in the
  document and no path from a `chains.yaml` into the renderer. Nothing offers the file, for
  the reason the `layers` check above exists: a file nothing reads is the silent-acceptance
  failure.
- **Export.** `@studio/ui-eyes`'s `exportScene` works frame-by-frame through WebCodecs; no
  surface mounts a button for it.
