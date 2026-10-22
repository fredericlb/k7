# Picture — a song's other half

An `.k7` folder holds sound **and image**. Same folder, same loader, read twice:

| file | read by the SONG compile | read by the PICTURE compile |
|---|---|---|
| `project.k7x` | `tempo`, `sampleRate`, `timeSignature`, `markers` | `viewport`, `layers`, `markers` |
| `nodes/<id>.k7x` | the lanes | where each timeline is placed |
| `graph.k7x` | the signal graph | — |
| `clips/<id>.k7x` | a source (audio) | a source (video) |
| `video_tracks/<id>.k7x` | — | one file per picture LANE |
| `timelines/<id>.k7x` | its `lanes:` | its `pictures:`, drawn on the lanes of their names (`@studio/song` `docs/timelines.md`) |

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
(`apps/k7/frontend/docs/picture.md`). The conversion is exact and reversible in both directions
because there is **one `tempo:` and no tempo map**: a shot at 4.5s sits at beat 9 at 120 bpm,
which is a fact about the drawing rather than about the file.

So re-typing `tempo:` **slides the grid under the shot**. It does not move it. The file says
seconds and goes on saying seconds. A cut that should follow the music is placed in bars —
which is what an audio lane is for.

## `viewport` is required, and `layers` is the membership

```k7x
project({
  name: "the film",
  tempo: 120, // the SONG's; picture never reads it
  viewport: [1280, 720, 30], // width, height, EXPORT fps
  layers: ["main", "pip"], // draw order, bottom first
})
```

**`viewport` has no default.** A frame invented by the loader would silently letterbox every
shot in the project, and you would find out at the export. The third element is the fps, which
*is* defaulted (30) because it is used by rendering to a file and by nothing else — realtime
follows the transport.

**`layers` is the order AND the membership**, and both halves are enforced. A name with no file
is an error you would expect. A file no name lists is *also* an error, and that is the one
worth stating: such a lane compiles perfectly and simply never appears.

### A picture that BUILDS can still be wrong

`loadVideoProject` throws for what cannot be built at all — a missing `viewport`, a `layers:` that
names nothing. Everything else goes in **`warnings`**, and `GET /video-errors` reports them beside
the throws.

The one that made this necessary: a placement naming a clip that is not there. It compiles — to a
shot with an empty `source` — and then draws nothing, on a lane that otherwise looks perfectly
ordinary. `picture add` says so once, at the moment of placing, and then it is gone; a lane blank
for that reason had no way left to tell you. A throw would be wrong here, since the rest of the
frame is fine and should still draw.

A song with no `video_tracks/` folder needs neither line. `GET /video-doc` answers with an
**empty** document for it rather than an error, so "this song has no picture" and "this song's
picture will not compile" stay two different answers.

### Making a lane is therefore TWO writes

`createVideoTrackFile` (`packages/song/src/loader.ts`) writes `video_tracks/<id>.k7x` **and**
appends `<id>` to `project.layers`, and the verb behind it — `picture lane new` — is what k7's
timeline calls. It looks the project file up *before* either write: the half-done state is the one
above, a lane that compiles perfectly and never appears, and it would have to be repaired by hand.

The new lane is appended, so it draws **last** — on top, and at the TOP of the timeline's picture
rows, which are listed front-first (`apps/k7/frontend/docs/picture.md`). It states **no**
`x`/`y`/`w`/`h`, which is the whole frame — see the lane section below for why that had to be made
true first.

## A lane, and what `mute` means on one

```k7x
// video_tracks/main.k7x
x(0) y(0) w(1280) h(720)    // where in the viewport; omit for the full frame
events([
  ref("shot_a").start(0).length(4),
  ref("shot_b").start(3).length(0).source_from(2.5).fade_in(1),
])
```

`fade_in`/`fade_out` say how a shot arrives and leaves, in seconds; a bare number is a dissolve and
a map names a kind. Overlapping two shots and fading the later one in is a cross-dissolve —
[transitions.md](transitions.md). `animate:` says how the shot moves while it is on, in keys from
its own start — [animation.md](animation.md).

The rect is also what the VIEWPORT drags: selecting a layer there and moving or resizing it runs
`picture rect`, which writes these four keys (`apps/k7/frontend/docs/picture.md`).

**A lane stating no `x`/`y`/`w`/`h` fills the frame.** The compile reads an absent `w`/`h` as the
viewport's, exactly as it already did for a camera layer. It read them as `0` until the first lane
anyone made with `picture lane new` proved what that costs: a 0x0 quad, in FRONT of the full-frame
lane, drawing nothing — which reads as "the reorder did not work" rather than as "this lane has no
size", because a lane with no size looks exactly like a lane. `videoProject.test.ts` pins both
halves, the default and a rect that IS stated.

`length: 0` runs to the end of the source — a duration the compiler cannot know without opening
the file, so it uses the same convention a length-0 audio clip does. On an ACTIVATION, which has
no source, the renderer's own rule is the whole of it: to the next event, or forever. `source_from` trims the
head *of the source*, leaving `start` to say where on the timeline the shot sits: the same
separation between MATERIAL and ARRANGEMENT that a song's `from`/`to` versus `start` makes.

**`mute` means hidden.** There is no sound on a lane, so the word has to mean the other thing;
the alternative is a second word for the one gesture every lane in every app has.

**And `solo` is `project.k7x`'s `soloed:`** — the SAME list a song's lanes use, not a second one.
Each compile filters it to its own lanes, so soloing a shot silences nothing and soloing a guitar
hides nothing; any picture solo hides every un-soloed picture lane, which is the mixer-wide rule
audio already keeps. The fold is the browser's, since the browser is what composites
(`packages/k7-plugins/src/video/pictureMix.ts`) — the engine resolves the audio half and is told about no
lane of picture at all.

One list means one collision: a project that names an audio lane and a picture lane alike — which
it may, the two being different entities — solos both with one word. That is the flat name space
the folder already has, and the two lanes were already indistinguishable in every list that names
one by id.

A lane has no `kind:`. What it draws is decided by what is wired to it: its own placements, a
lens ([camera.md](../../song/docs/camera.md)), or the shape MODULES aimed at it
([shapes.md](shapes.md)).

**An event without a `ref` is an ACTIVATION** — a span saying the lane is ON, with no picture in
it. That is what puts a shape on screen and takes it off again, and it is why a lane of shapes is
drawn like any other rather than hatched: it has events, they simply carry no material. A lane
stating none is on throughout.

## `markers:` is shared, and the dialect decides

One `markers:` schema serves both readings, so the key form is a superset: a song's are
`bar:beat:tick`, and wall-clock ones are `"90"`, `"12.5"`, `"1:30.5"`. Hours are deliberately
unsayable — `1:30:00` would be indistinguishable from a musical `bar:beat:tick` — so a
three-hour cut writes `10800`.

## A lane can be fed by a LENS or by SHAPES instead

`kind: video` says a lane draws its placements. Wire an `io: camera` node to it in `graph.k7x` and
it draws a live picture instead — the same lane, the same rect, the same `mute`, the same passes
over it. That is the one thing in the picture model that comes off `graph.k7x`'s SOURCES rather
than out of `video_tracks/`, and it is why it costs no new road: everything a live layer needs, a
lane already had. See [packages/song/docs/camera.md](../../song/docs/camera.md).

An export leaves such a layer out: a lens has no frame at *t*, and a render walks a timeline.

The other one is a **shape** — a rectangle, a circle, a line of text — which is a module too, and
lands on a lane the same way. Everything it draws is in its `params:`, which is what lets a curve
move it. [shapes.md](shapes.md) is the page.

## What is not there

- **`video_effect` chains.** That shape of `VideoPluginDoc` is modelled and uncompiled: nothing
  turns one into anything a renderer runs. Its SIBLINGS both have a format now — a `shaders`
  module compiles all the way to a GLSL pass on the frame ([shaders.md](shaders.md)), over the
  `graph.k7x` → renderer path, and a **transition** has one that is deliberately not that path
  ([transitions.md](transitions.md)): a cut NAMES it, so it is never wired. What is missing is a
  plugin format for `video_effect` alone.
- **A fade_out that reveals the shot beneath it on the SAME lane.** A reveal belongs to the incoming
  shot, and its `fade_in` is at its own start ([transitions.md](transitions.md)).
