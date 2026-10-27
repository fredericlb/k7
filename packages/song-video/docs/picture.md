# Picture — a song's other half

An `.k7` folder holds sound **and image**. Same folder, same loader, read twice:

| file | read by the SONG compile | read by the PICTURE compile |
|---|---|---|
| `project.k7x` | `tempo`, `sampleRate`, `timeSignature`, `markers`, `trackOrder` | `viewport`, `trackOrder` (the draw order), `markers` |
| `nodes/<id>.k7x` (`tracks/` in a chain project) | the sound lanes | the picture lanes (`@meta/picture-track`), and where each timeline is placed |
| `graph.k7x` | the signal graph | a picture lane's bypass (its mute), cameras, shapes, shaders |
| `clips/<id>.k7x` | a source (audio) | a source (video) |
| `timelines/<id>.k7x` | its `lanes:` | its `pictures:`, drawn on the lanes of their names (`@studio/song` `docs/timelines.md`) |

`loadProject` produces the `ProjectDoc` the C++ engine is handed. `loadVideoProject`
produces the `VideoProjectDoc` `@studio/ui-eyes` composites. **They share no field.**

## Why two documents and not one

The engine's document has no frame in it because nothing ever puts one there. A single
document with a picture section would need that section stripped at the one choke point on the
way to the wire — and a rule you can only learn by finding the function that applies it.

Two compiles over one folder say the same thing structurally, and say it where anyone can see
it. The split is by META REF, not by folder: a picture lane is a lane node like a sound lane —
muted, soloed, ordered and renamed as every lane is — and `extends("@meta/picture-track")` is what
sends it to this compile. `lanesOf` answers the sound lanes only, `pictureLanesOf` the rest
(`packages/song/src/trackModule.ts`).

A sound lane is not typed by what it carries, but a picture lane must be: an EMPTY one — what
`picture lane new` makes — would otherwise read as an empty sound lane, and the rows, the graph
card and both compiles need its kind before its first shot.

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

## `viewport` is required, and the rows are the draw order

```k7x
project({
  name: "the film",
  tempo: 120, // the SONG's; picture never reads it
  viewport: [1280, 720, 30], // width, height, EXPORT fps
})
trackOrder(["drums", "pip", "main"]) // the rows; the top picture row draws in front
```

**`viewport` has no default.** A frame invented by the loader would silently letterbox every
shot in the project, and you would find out at the export. The third element is the fps, which
*is* defaulted (30) because it is used by rendering to a file and by nothing else — realtime
follows the transport.

**The draw order is the rows' order**, derived and never stated apart: the picture lanes in
`trackOrder` order, the TOP row in front, which is the rule the timeline draws by. One list, so a
row dragged is a layer restacked, and the rows and the frame cannot disagree. Membership is the
lane file alone: a picture lane `trackOrder` leaves out still draws, sorted after the ones it
names, as any lane is.

### A picture that BUILDS can still be wrong

`loadVideoProject` throws for what cannot be built at all — a missing `viewport`, a lane whose
last open-ended shot fades out. Everything else goes in **`warnings`**, and `GET /video-errors` reports them beside
the throws.

The one that made this necessary: a placement naming a clip that is not there. It compiles — to a
shot with an empty `source` — and then draws nothing, on a lane that otherwise looks perfectly
ordinary. `picture add` says so once, at the moment of placing, and then it is gone; a lane blank
for that reason had no way left to tell you. A throw would be wrong here, since the rest of the
frame is fine and should still draw.

A song with no picture lane needs no `viewport`. `GET /video-doc` answers with an
**empty** document for it rather than an error, so "this song has no picture" and "this song's
picture will not compile" stay two different answers.

### Making a lane writes the lane AND the rows

`createPictureLaneFile` (`packages/song/src/projectFiles.ts`) writes the lane file **and** states
`trackOrder` with the new lane above the picture lanes there are, and the verb behind it —
`picture lane new` — is what k7's timeline calls. Above, so it draws in FRONT, where you can see
what you just made; stated, because with no `trackOrder` the order is a sort of the names, which
would bury it wherever its name falls. The other rows keep the order they drew in.

The new lane states **no** `frame`, which is the whole frame — see the lane section below.

## A lane, and what `mute` means on one

```k7x
// nodes/main.k7x
extends("@meta/picture-track")
frame([0, 0, 1280, 720]) // where in the viewport; omit for the full frame
events([
  ref("shot_a").start(0).length(4),
  ref("shot_b").start(3).length(0).from(2.5).fadeIn(1),
])
```

A shot's fields are spelled like an audio event's where they mean the same thing — `start`,
`from`, `fadeIn`, `fadeOut` — so one `PlacementSchema` (`song-schema/src/yaml/placementSchema.ts`)
validates both, and the compile, which knows each ref's material, refuses an audio-only field on a
shot and the reverse. `frame` is the camera module's spelling for the same fact.

`fadeIn`/`fadeOut` say how a shot arrives and leaves, in seconds; a bare number is a dissolve and
a map names a kind. Overlapping two shots and fading the later one in is a cross-dissolve —
[transitions.md](transitions.md). `animate:` says how the shot moves while it is on, in keys from
its own start — [animation.md](animation.md).

The rect is also what the VIEWPORT drags: selecting a layer there and moving or resizing it runs
`picture rect`, which writes the `frame` (`apps/k7/frontend/docs/picture.md`).

**A lane stating no `frame` fills the frame**, as a camera layer does. The hazard is a default of
`0`: a 0x0 quad in FRONT of the full-frame lane, drawing nothing — which reads as "the reorder did
not work" rather than as "this lane has no size", because a lane with no size looks exactly like a
lane. `videoProject.test.ts` pins both halves, the default and a rect that IS stated.

`length: 0` runs to the end of the source — a duration the compiler cannot know without opening
the file, so it uses the same convention a length-0 audio clip does. On an ACTIVATION, which has
no source, the renderer's own rule is the whole of it: to the next event, or forever. `from` trims the
head *of the source*, leaving `start` to say where on the timeline the shot sits: the same
separation between MATERIAL and ARRANGEMENT that a song's `from`/`to` versus `start` makes.

**`mute` means hidden.** There is no sound on a lane, so the word has to mean the other thing;
the alternative is a second word for the one gesture every lane in every app has. It is the lane's
BYPASS, as every lane's mute is — `bypassed:` in `graph.k7x`, `bypass` on a chain project's item —
not a field of the lane file.

**And `solo` is `project.k7x`'s `soloed:`** — the SAME list a song's lanes use, not a second one.
Each compile filters it to its own lanes, so soloing a shot silences nothing and soloing a guitar
hides nothing; any picture solo hides every un-soloed picture lane, which is the mixer-wide rule
audio already keeps. The fold is the browser's, since the browser is what composites
(`packages/k7-plugins/src/video/pictureMix.ts`) — the engine resolves the audio half and is told about no
lane of picture at all.

Sound and picture lanes share one name space — they are all lane nodes — so a name in `soloed:`
is exactly one lane, and creating or renaming a lane refuses a name either kind already holds.

Beyond its meta ref a picture lane has no `kind:`. What it draws is decided by what is wired to it: its own placements, a
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

A picture lane draws its placements. Wire an `io: camera` node to it in `graph.k7x` and
it draws a live picture instead — the same lane, the same rect, the same `mute`, the same passes
over it. That is the one thing in the picture model that comes off `graph.k7x`'s SOURCES rather
than out of the lane's events, and it is why it costs no new road: everything a live layer needs, a
lane already had. See [packages/song/docs/camera.md](../../song/docs/camera.md).

An export leaves such a layer out: a lens has no frame at *t*, and a render walks a timeline.

The other one is a **shape** — a rectangle, a circle, a line of text — which is a module too, and
lands on a lane the same way. Everything it draws is in its `params:`, which is what lets a curve
move it. [shapes.md](shapes.md) is the page.

## Every lane ends on its strip

A lane's colour and transparency are its STRIP's, a `video-mixer` node last in its run, as a sound
lane's level is its mixer's: one node per lane, made with it and back-filled on open
([../../song/docs/videoMixer.md](../../song/docs/videoMixer.md)).

## What is not there

- **`video_effect` chains.** That shape of `VideoPluginDoc` is modelled and uncompiled: nothing
  turns one into anything a renderer runs. Its SIBLINGS both have a format now — a `shaders`
  module compiles all the way to a GLSL pass on the frame ([shaders.md](shaders.md)), over the
  `graph.k7x` → renderer path, and a **transition** has one that is deliberately not that path
  ([transitions.md](transitions.md)): a cut NAMES it, so it is never wired. What is missing is a
  plugin format for `video_effect` alone.
- **A fadeOut that reveals the shot beneath it on the SAME lane.** A reveal belongs to the incoming
  shot, and its `fadeIn` is at its own start ([transitions.md](transitions.md)).
