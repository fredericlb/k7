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

## tracks/<id>.yaml — alternatives

A lane can hold several arrangements and play one of them. Another take of the same part, a
chorus with the double and one without, a version you want back if the new one turns out worse —
they live side by side in the same file, and switching between them is one line.

**`clips:` is the first alternative.** The others go under `alternatives:`, and `alternative:`
says which is playing — by name, or by position when it has none. Leave `alternative:` out and
the track plays its own `clips:`, which is why a song that never uses this keeps exactly the file
it always had.

Names are optional. An unnamed one answers to its number, counting `clips:` as 1 — so the first
entry under `alternatives:` is "2". A name wins over a number, so a variant you deliberately call
`2` is the one `alternative: 2` selects. A name that matches nothing falls back to the first
rather than silencing the lane.

The first alternative cannot be named: it has nowhere to carry one. It is always "1".

```yaml schema=Track
type: single
contentType: audio
alternative: doux        # which one plays; absent = the clips below
clips:
  - { ref: gtr-A, start: "1:1:1" }
alternatives:
  - name: doux           # unnamed, it would answer to "2"
    clips:
      - { ref: gtr-B, start: "1:1:1" }
  - clips: []            # "3" — an empty take, waiting for a pass
```

Everything you do to a lane goes to the alternative that is playing: drag a clip while the
second is up and it is the second that changes, and the first is exactly where you left it.

From the timeline, the arrow at the left of the lane's header lists them and switches; its
bottom two entries start another, empty or as a copy of the one playing. The lane says which
variant it is on beside that arrow whenever it is not the first — otherwise a lane whose clips
"went missing" would look like a bug.

From the command bar, `track alternative <track> <name>` switches, `track alternative new
<track> [name]` adds an empty one and `track alternative copy <track> [name]` adds a copy. With
no name at all, `track alternative <track>` lists what the track has.

There is no command to delete one: it is three lines of YAML, and removing it by hand is both
clearer and reversible in the editor's own undo.

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

## tracks/<id>.yaml — `video_source`, which no longer does anything

An audio track used to be able to take its material from a VIDEO track — inheriting its
placements and playing their audio, so a shot and its sound could not drift apart. Picture
now lives in its own kind of project, a `.v1` folder cut in seconds, and that link cannot
cross the gap.

The key is still **accepted**, so a song that has one still opens; it is simply read by
nothing, and the line can be deleted. A track carrying it authors its own `clips` again.

```yaml schema=Track
type: single
contentType: audio
video_source: main   # dead — delete it, and place the clips here instead
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
