# Tracks

## tracks/<id>.yaml — audio

A single track of positioned audio clips. Times are bars:beats:ticks.

A track has no `volume` and no `pan`. They were the one part of its sound that lived outside its chain — nothing
could be placed after them, and the graph could not show where they applied. A level is a MODULE now: put a
`mixer` at the end of the track's chain and set its `Volume`, `Pan` and three tone bands (see Instruments).
`mute` and `solo` stay here, because they are relationships between tracks rather than a stage in one signal.

A placement says WHERE a clip goes and HOW MANY TIMES — nothing about what it plays. How long it sounds comes
from the material's own `from`/`to` window (see Material), multiplied by `loop`. There is no `length` and no
`offset` here: trimming belongs to the clip, so every placement of it plays the same thing and no two lines can
disagree about what that is.

```yaml schema=Track
type: single
contentType: audio
# color: "#c8a97e"   # the lane's colour, and its icon's in the timeline
# mute: false
# solo: false
# disabled: true     # excluded from the render entirely, chains and all
# docs: "the main groove"
# todos: ["swap the snare"]
clips:
  - { ref: kick, start: "1:1:1" }
  - { ref: snare, start: "2:1:1", loop: 4 }   # four passes of the snare's window, back to back
  - { ref: kick, start: "6:1:1", fadeIn: "0:1:0", fadeOut: "0:1:0" }

# Timecodes are always written QUOTED. Under YAML 1.2 (what we read) bare
# 1:1:1 is already a string — but under 1.1 it is the number 3661.
```

## tracks/<id>.yaml — MIDI

A single track of sequence refs — a sequences track never holds audio.

```yaml schema=Track
type: single
contentType: sequences
clips:
  - { ref: melody, start: "1:1:1" }
  - { ref: melody, start: "5:1:1", loop: 8 }   # the same sequence, eight times over
```

## tracks/<id>.yaml — frozen

Freezing a track bounces it through its own modules and plays that render instead, so an amp sim or a heavy synth costs nothing until you want to edit it again. Run `track freeze <track>` to freeze, and again to unfreeze — it is a toggle, like mute and solo. Playback stops while the render is made.

The render goes in `tracks/`, named for the track, and `frozen:` points at it. While it is set the track plays that file and its modules are gone from what the engine builds — they are already inside the wav, which is why they show a snowflake and refuse to be edited. What stays live is the STRIP: the track's mixer module is the one thing a freeze does not bake in, along with mute, solo and the track's sends. The render was bounced with every knob on that module flattened, so it applies exactly once, on playback — a frozen lane you cannot set the level of would not be a mix.

The freeze stops where the track stops. A chain's modules belong to the track that feeds them, so a bus — anything several chains route into — is never baked; it keeps running on the render's output like it did on the live one.

Unfreezing removes both the attribute and the render. A `frozen:` naming a file that isn't there is not an error either: the track simply plays live, which is what a fresh clone of a project does when the wav wasn't committed.

```yaml schema=Track
type: single
contentType: sequences
frozen: tracks/melody.wav   # written by `track freeze melody`; delete it and the track plays live again
clips:
  - { ref: melody, start: "1:1:1" }
```

## tracks/<id>.yaml — sourced from a video track

An audio track can take its material from a VIDEO track instead of authoring it: it inherits that track's placements and plays their AUDIO — same files, same cuts, picture left to the renderer, so a shot and its sound can't drift apart. It authors no clips of its own then. Video placements are in seconds and get converted to beats at the project tempo. For the sound without the picture, mute the video track.

```yaml schema=Track
type: single
contentType: audio
video_source: main   # video_tracks/main.yaml — its clips, audio only
```

## tracks/<id>.yaml — group

No material of its own — only the member track ids it nests.

```yaml schema=Track
type: group
tracks: [pad, kit]
```

## tracks/<id>.yaml — strudel

Streams one algo/ pattern; the id (or name) picks the lane by its .label. contentType decides how events read: sequences = MIDI notes, audio = sample one-shots.

```yaml schema=Track
type: strudel
strudel: algo/pattern.strudel
contentType: sequences
```
