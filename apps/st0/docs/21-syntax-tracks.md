# Tracks

A track is a **module**. It lives in `nodes/<name>.yaml` like every other use of a module,
and what it `extends` says what kind of lane it is. There is no `tracks/` folder.

Five built-in modules, and none of them has a file anywhere — they belong to the studio, so a
lane costs exactly one file, its own:

| extends | carries | its events come from |
|---|---|---|
| `@studio/audio-track` | audio | `events:` |
| `@studio/sequence-track` | notes | `events:` |
| `@studio/audio-strudel-track` | audio | `strudel:` |
| `@studio/sequence-strudel-track` | notes | `strudel:` |
| `@studio/group-track` | nothing — it is a relationship | nothing |

Five because there were always two questions, and `type: single | group | strudel` beside
`contentType: audio | sequences` only ever asked one of them at a time. What signal a lane
carries and where its events come from are both read off one `extends:` now, and neither can go
missing or disagree with the other.

A track has no `volume` and no `pan`. They were the one part of its sound that lived outside its
chain — nothing could be placed after them, and the graph could not show where they applied. A
level is a MODULE now: put a `mixer` at the end of the track's chain and set its `Volume`, `Pan`
and three tone bands (see Instruments).

**And no `mute` either.** A lane is a module, so it has the bypass button every module node
carries, and that is its mute: one name in `graph.yaml`'s `bypassed:` (see Chains). On a source,
bypass reads as *produces nothing* rather than *passes through untouched* — which is what muting
a lane has always meant. Solo is not written down at all: the surface derives it by bypassing
every other lane.

A placement says WHERE a clip goes and HOW MANY TIMES — nothing about what it plays. How long it
sounds comes from the material's own `from`/`to` window (see Material), multiplied by `loop`.
There is no `length` and no `offset` here: trimming belongs to the clip, so every placement of it
plays the same thing and no two lines can disagree about what that is.

Two things a placement may switch OFF for itself, and both are written by
`event disable <what>`:

| field | absent means | what `event disable …` writes |
|---|---|---|
| `disabled: true` | it plays | `event disable play` — silenced, still drawn (dimmed) |
| `warp: false` | it uses the clip's stretch map | `event disable warp` — plays at the sample's own rate |

The polarities are opposite because the defaults are: an event plays unless told otherwise, and it
warps because the CLIP is warped. `warp: false` is one placement declining a map that belongs to
the material and is shared by every other placement of it — which is what you want when the map
fits the song the clip was warped into and a second use of it wants the sample as recorded. The
timeline draws that event's stretch icon with a line through it.

Neither field is ever written at its default: switching one off and back on leaves the file
exactly as it was.

## nodes/<name>.yaml — audio

```yaml schema=Module
extends: "@studio/audio-track"
# color: "#c8a97e"   # the lane's colour, and its icon's in the timeline
# disabled: true     # excluded from the render entirely, chains and all
events:
  - { ref: kick, start: "1:1:1" }
  - { ref: snare, start: "2:1:1", loop: 4 }   # four passes of the snare's window, back to back
  - { ref: kick, start: "6:1:1", fadeIn: "0:1:0", fadeOut: "0:1:0" }

# Timecodes are always written QUOTED. Under YAML 1.2 (what we read) bare
# 1:1:1 is already a string — but under 1.1 it is the number 3661.
```

## nodes/<name>.yaml — MIDI

A lane of sequence refs. A sequence lane never holds audio: which of the two it carries is what
it extends, and a module has one output port.

```yaml schema=Module
extends: "@studio/sequence-track"
events:
  - { ref: melody, start: "1:1:1" }
  - { ref: melody, start: "5:1:1", loop: 8 }   # the same sequence, eight times over
```

## nodes/<name>.yaml — group

No material and no signal of its own — only the member lane names it nests.

```yaml schema=Module
extends: "@studio/group-track"
tracks: [pad, kit]
```

## nodes/<name>.yaml — strudel

Streams one `algo/` pattern; the lane's name picks the part by its `.label`. Which of the two
strudel modules it extends decides how the events read: `@studio/sequence-strudel-track` makes
them MIDI notes for the chain's instrument, `@studio/audio-strudel-track` makes them sample
one-shots.

```yaml schema=Module
extends: "@studio/sequence-strudel-track"
strudel: algo/pattern.strudel
```

## takes — what the lane was playing before

Record over an event, or round a loop, and what was there is not lost: it is moved into a
**take**, another list of placements on the same lane. The timeline draws each one as a row
indented under the lane, playing nothing.

```yaml schema=Module
extends: "@studio/audio-track"
events:
  - { ref: gtr_3.1_260815T221030, start: "3:1:1" }   # the newest pass — what plays
takes:
  - events:
      - { ref: gtr_3.1_260815T220641, start: "3:1:1" }   # the pass before it
  - name: quieter one          # optional; the row shows it instead of "take 2"
    events:
      - { ref: gtr_3.1_260815T220914, start: "3:1:1" }
```

`track take select <track> <n>` **swaps**: take `n` goes onto the lane and what the lane was
playing becomes take `n`, so listening to another pass loses nothing and running it again puts
everything back. It is the right-click **Move a take onto the track** on a take's row.
`track take delete <track> <n>` removes one, and the events it held with it. Once you have picked
the pass you want — by listening round them, which leaves it on the lane — `track take keep
<track>` deletes all the others.

After a recording that left several passes, the waveform panel lists them in a sidebar: clicking
one puts it on the lane so you hear it in the song, and **garder celle-ci** is that last verb.

A take belongs to the alternative it was played in — `takes:` is an ordinary module field, so a
lane running one of its `alternatives:` has that set's takes and not the module's own.

## One name space

A lane and a module share one set of names, because they are the same kind of thing. A chain
step naming `lead` must mean exactly one node, so a lane may not be called what a module is
called — which in practice means a lane and the synth it feeds need different names:

```yaml exempt="two files, shown together"
# nodes/melody.yaml       -> the lane
# nodes/synth-melody.yaml -> the 4OSC it plays through
```

That is the one thing to know when moving an old project over: a track and its instrument that
happened to share a name now have to be told apart.

## What went away

`type:` and `contentType:` are gone — one `extends:` says both. So are `mute:` and `solo:` (see
above).

A lane's **alternatives** and its **freeze** are still here, and both belong to every module now
rather than to lanes alone: `alternatives:` holds other sets of attributes (for a lane, one of
those attributes is its `events:`), and `frozen:` names a render standing in for everything
upstream of the module rather than for that one lane. Both are in Instruments.

One field is simply gone:

- **`video_source:`** — an audio track taking its placements from a video track, so a shot and
  its sound could not drift. Nothing reads it.

All five schemas are `.strict()`, so a file still carrying any of them says so by name and by
line rather than being read and dropped.
