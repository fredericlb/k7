# Exchanging cuts with other editors

k7 reads and writes the two formats every video editor exchanges a cut in:

- **OpenTimelineIO** (`.otio`), which carries every picture lane as a video track;
- **CMX 3600 EDL** (`.edl`), the oldest format every editor still reads, which carries one track.

What is exchanged is the **cut** — which shots, where, from where in which file — not the media.
The files name your camera originals, so the other editor relinks to them.

## Handing your cut to another editor

```text
picture interchange otio          # every lane, into exports/cut.otio
picture interchange edl           # the bottom lane, into exports/cut.edl
picture interchange edl broll     # one named lane
```

`project export timeline otio` (or `edl [lane]`) does the same and downloads the file.

What is written:

| in k7 | in OTIO | in the EDL |
|---|---|---|
| picture lanes, bottom first | one video track each | one lane only |
| shots | clips naming the source file, relative to `exports/` | events with source and record timecodes; the file name in a `* FROM CLIP NAME:` comment |
| empty time | gaps | skipped by the record timecodes |
| overlapping shots | flattened: the shot later in the file covers the earlier, as in the viewport | the same |
| `fade_in` | a dissolve | a dissolve pair |
| `speed` | a linear time warp; `0` a freeze frame | an `M2` speed line |

Times are rounded to whole frames at the project's export frame rate. EDL record timecodes start at
`01:00:00:00`. The timeline is named after the song.

Left out, and listed after the command runs:

- activations (lanes of shapes) and subtitle clips, which have no track both formats agree on;
- a last shot with `length: 0` whose source length cannot be measured.

Animation, effects, transitions other than the dissolve, and lane rectangles are not carried.

## Bringing a cut in

Copy the `.otio` or `.edl` file into the project folder, then:

```text
picture import imports/cut.otio
picture import cut.edl conform-
```

The second argument is the prefix of the new lanes' names (`import-` by default, giving
`import-1`, `import-2`, …, skipping names already taken). The cut's lanes are **added** on top of
what is there; nothing existing is changed.

What happens:

- each **video track** of an OTIO file (the one track of an EDL) becomes a new picture lane;
- each shot's media is looked for at the path the file gives, then by its file name in `clips/`.
  A clip already declared on that file is reused; otherwise `clips/<name>.yaml` is declared for it;
- media that cannot be found is placed anyway, and listed at the end ("not found, placed anyway —
  copy into clips/: …"). Copy those files into `clips/` and the shots draw;
- a song with no `viewport` gets `[1920, 1080, <the cut's frame rate>]`;
- audio tracks are left out and said: a shot's sound comes from `picture sound` here.

### OTIO details

Both the older `Clip.1` media references and the newer `Clip.2` media-reference maps are read.
Gaps advance the time; a `LinearTimeWarp` becomes the shot's `speed`, a `FreezeFrame` speed `0`.
A transition centred on a cut becomes this app's `fade_in`: the incoming shot starts at the
transition's first half and fades over its whole length, the outgoing one runs through the second
half. Nested stacks or tracks are not carried and are listed: flatten them in the other editor
first. The frame rate is read from the first clip.

### EDL details

An EDL does not state its frame rate, so it is read at the project's export frame rate (25 when the
project has no viewport yet). Record times are measured from the first event, so a cut conformed at
`01:00:00:00` lands at 0. Dissolve pairs become `fade_in`, `M2` lines become speeds, `FROM CLIP
NAME` / `TO CLIP NAME` comments give the media's name. Wipes are read as cuts, events on audio
tracks are skipped, and both are listed.
