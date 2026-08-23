# Picture — a song's other half

An `.st0` folder holds sound **and image**. Same folder, same loader, read twice:

| file | read by the SONG compile | read by the PICTURE compile |
|---|---|---|
| `project.yaml` | `tempo`, `sampleRate`, `timeSignature`, `markers` | `viewport`, `layers`, `markers` |
| `nodes/<id>.yaml` | the lanes | — |
| `graph.yaml` | the signal graph | — |
| `clips/<id>.yaml` | a source (audio) | a source (video) |
| `video_tracks/<id>.yaml` | — | one file per picture LANE |

`loadProject` produces the `ProjectDoc` the C++ engine is handed. `loadVideoProject`
produces the `VideoProjectDoc` `@studio/ui-eyes` composites. **They share no field.**

## Why two documents and not one

The engine's document has no frame in it because nothing ever puts one there. A single
document with a picture section would need that section stripped at the one choke point on the
way to the wire — and a rule you can only learn by finding the function that applies it.

Two compiles over one folder say the same thing structurally, and say it where anyone can see
it. That is also why `video_tracks/` is its own entity folder rather than a key inside a lane:
picture and sound share the folder they live in and nothing else.

## Everything in a video lane is a SECOND

A song's positions are **musical**: `start: "5:1"` is bar 5 beat 1, and what that means in
seconds depends on the tempo, which the author is free to change. A placement's positions are
**wall-clock**: `start: 4` is four seconds, and no setting anywhere moves it.

Both are drawn on the one timeline, and its ruler reads either — bars, or minutes and seconds
(`apps/st0/frontend/docs/picture.md`). The conversion is exact and reversible in both directions
because there is **one `tempo:` and no tempo map**: a shot at 4.5s sits at beat 9 at 120 bpm,
which is a fact about the drawing rather than about the file.

So re-typing `tempo:` **slides the grid under the shot**. It does not move it. The file says
seconds and goes on saying seconds. A cut that should follow the music is placed in bars —
which is what an audio lane is for.

## `viewport` is required, and `layers` is the membership

```yaml
project:
  name: "the film"
  tempo: 120                  # the SONG's; picture never reads it
  viewport: [1280, 720, 30]   # width, height, EXPORT fps
  layers: [main, pip]         # draw order, bottom first
```

**`viewport` has no default.** A frame invented by the loader would silently letterbox every
shot in the project, and you would find out at the export. The third element is the fps, which
*is* defaulted (30) because it is used by rendering to a file and by nothing else — realtime
follows the transport.

**`layers` is the order AND the membership**, and both halves are enforced. A name with no file
is an error you would expect. A file no name lists is *also* an error, and that is the one
worth stating: such a lane compiles perfectly and simply never appears.

A song with no `video_tracks/` folder needs neither line. `GET /video-doc` answers with an
**empty** document for it rather than an error, so "this song has no picture" and "this song's
picture will not compile" stay two different answers.

## A lane, and what `mute` means on one

```yaml
# video_tracks/main.yaml
kind: video
x: 0, y: 0, w: 1280, h: 720    # where in the viewport; omit for the full frame
events:
  - { ref: shot_a, start: 0, length: 4 }
  - { ref: shot_b, start: 4, length: 0, source_from: 2.5 }
```

`length: 0` runs to the end of the source — a duration the compiler cannot know without opening
the file, so it uses the same convention a length-0 audio clip does. `source_from` trims the
head *of the source*, leaving `start` to say where on the timeline the shot sits: the same
separation between MATERIAL and ARRANGEMENT that a song's `from`/`to` versus `start` makes.

**`mute` means hidden.** There is no sound on a lane, so the word has to mean the other thing;
the alternative is a second word for the one gesture every lane in every app has.

A `kind: shape` lane draws rectangles, circles and text instead, in viewport px, and holds no
placements at all — which is why the timeline hatches it rather than drawing an empty row that
looks like a lane you forgot to fill.

## `markers:` is shared, and the dialect decides

One `markers:` schema serves both readings, so the key form is a superset: a song's are
`bar:beat:tick`, and wall-clock ones are `"90"`, `"12.5"`, `"1:30.5"`. Hours are deliberately
unsayable — `1:30:00` would be indistinguishable from a musical `bar:beat:tick` — so a
three-hour cut writes `10800`.

## What is not there

- **`video_source`.** An audio lane inheriting a video lane's placements, so a shot and its
  sound could not drift. Nothing reads the key.
- **`video_effect` / `video_transition` chains.** Those two shapes of `VideoPluginDoc` are still
  modelled and still uncompiled: nothing turns one into anything a renderer runs. Their SIBLING
  does now — a `shaders` module compiles all the way to a GLSL pass on the frame
  ([shaders.md](shaders.md)), which is also what finally built the `graph.yaml` → renderer path
  this entry used to say was missing entirely. What is left is a plugin format for the other two.
- **Export.** `@studio/ui-eyes`'s `exportScene` works frame-by-frame through WebCodecs; no
  surface mounts a button for it.
