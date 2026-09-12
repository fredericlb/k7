# project.yaml

The rationale behind `packages/song-schema/src/yaml/projectSchema.ts` — the file's two tiers, the
fields that are dead and still accepted, and the archetypes.

## The master fader's range

`MASTER_MAX_DB` is +12 because the engine applies this with a gain of its OWN
(`MasterGainPlugin`), dB straight to a linear factor with no fader curve in the way. Tracktion's
`decibelsToVolumeFaderPosition` is `exp((dB - 6) / 20)` clamped to `[0, 1]`, so +6 is the top of
THEIR fader and every value above it sets the same position — silently — but nothing here goes
through it. A master trim is the one place that ceiling would be a limitation rather than a shape,
since a mix built with headroom sits far below full scale and asking for +12 there is ordinary. -100
is where the app calls silence, which is where that same curve reaches zero.

Both bounds are exported so the schema and the `project master` verb cannot come to disagree: a
command that accepted what the file refuses would write a project that will not load. The engine's
own parameter is wider still (to +24), so widening this again is a one-line change.

`masterVolume` is a fact about the mix rather than about this machine, which is why it is in
`project.yaml` and not in `settings.yaml` beside the metronome: it moves playback, `--render` and a
freeze together, and it travels in a share. A monitoring level that only changed what you hear in
this room would be a different field in a different file. Absent means UNITY, and unity is never
written. See `packages/song/docs/masterVolume.md`.

## The fields that are DEAD and still accepted

Refusing a key is not free: this object is `.strict()`, so dropping one would turn every project
already carrying it into a folder that no longer opens. `deadProjectFields` reports them as a warning
instead, naming the lines to delete — which is what keeps "accepted" from meaning "silently
ignored".

- `modules_from` / `libraries_from`: a project sees the workspace's `_modules`/`_libraries` and the
  médiathèque because of where they are (`sharedFolders.ts`), so nothing reads these.
- `video`: what draws the frame is a `surfaces/` file, and what says a song HAS picture is
  `video_tracks/` existing — a boolean agreeing with neither would just be a third answer.
- `type`: it names the DIALECT for the one case the folder name cannot — a repository that IS the
  project, with no suffix to read. There is ONE dialect compiled, so a folder saying nothing is it
  and nothing branches on the answer. Not an enum, and not dropped.
- `project_type`: nothing reads it — what a project draws is what its `surfaces/` folder says. Not
  an enum either, deliberately: refusing a typo in a field nobody consults would be a compile error
  about nothing.

## `viewport` and `layers`

PICTURE's, and read only by the picture compile — the frame its lanes draw into and their draw
order, bottom first. They sit in the SHARED settings tier because one schema validates every dialect
(the loader has no type to branch on when it reads the header), and a song is where they belong:
`loadVideoProject` is a second compile of the same folder, not a second kind of project
(`packages/song-video/docs/picture.md`).

## The archetypes

Three are named after the SURFACE they open on, because that is the whole of what is being chosen.
The fourth is named after what it IS, being the one that opens on none:

| archetype | the surfaces it writes, and what fills them |
|---|---|
| `arrangement` | `timeline` — a lane, a synth, a pattern |
| `mix` | `turntables` — two decks meeting at a crossfade, an empty `songs.yaml` |
| `video` | `timeline` + `viewport` — the arrangement, plus a lane of picture |
| `live` | **none** — an input, the lane it lands on, and the master run (`packages/song/docs/liveProject.md`) |

There is ONE list, and it names archetypes rather than kinds of folder: every project is an `.st0`
folder that opens in st0, and what differs is the screen it asks for. Closing the layout down when
there is no timeline, and silencing the warning about one, are `surfaces/` questions answered there:
a project draws what it DECLARES (`packages/song/docs/surfaces.md`). A second field saying almost the
same thing could only drift from it — a folder declaring a timeline while calling itself `live` would
be a legal state nothing could resolve.

`live` is the sharpest case of that, and the reason it costs no new machinery: **nothing on disk says
`live`**. The archetype is what you ask for at creation; what lands is a folder with no `surfaces/`
in it, and being surfaceless is a fact anyone can read off the folder rather than a word that could
disagree with it.

**`mix` writes a SET**, and that pair of names is the one mismatch here. `mix` is what you ASK for,
named like its two neighbours; a set is what lands on disk — `songs.yaml`, decks, a desk — and
`packages/song/docs/setProject.md` is its page. One word cannot be right for both audiences.

## Marker keys

`WALL_CLOCK` is v1's marker key: a wall-clock position — `90`, `12.5`, `1:30`, `1:30.5`. A superset
of `TIMECODE` where it overlaps, which is the point: `"90"` and `"1:30"` are legal under both, and
the DIALECT decides what they mean — bar 90 in a song, ninety seconds in a cut. The decimal part is
what a musical timecode cannot say, and the only thing outside the overlap. It is quoted for the same
YAML 1.1 sexagesimal reason every other timecode here is.

## `soloed`

Solo as PROJECT STATE, several at once: any entry silences every lane not listed (the engine's
`applySoloMute` resolves it across the mixer). A root sibling like `trackOrder`, being a list of lane
ids about the mixer rather than one of the song's settings. Absent or empty, nobody is soloed, and a
group's id solos its members.

## `metronome_level`

How loud the click is, 0.2 … 1. NOT a way to silence it — `metronome: false` is that, and the range
says so: Tracktion clamps its click gain to those two bounds (`Edit::setClickTrackVolume`), so a 0
written here would come back as 0.2 and the file would state a level the engine does not play.
Refused at the schema rather than clamped, for the reason a pad effect's `1` is: a value that means
something other than what it says is worse than an error.
