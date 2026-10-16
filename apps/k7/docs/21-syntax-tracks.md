# Tracks

A track is a **module**. It lives in `nodes/<name>.yaml` like every other use of a module,
and what it `extends` says what kind of lane it is. There is no `tracks/` folder.

Three built-in modules, and none of them has a file anywhere — they belong to the studio, so a
lane costs exactly one file, its own:

| extends | its events come from |
|---|---|
| `@meta/track` | `events:`, written down here |
| `@meta/strudel-track` | `strudel:`, streamed while the transport rolls |
| `@meta/group-track` | nothing — it is a relationship |

**A track is not audio or MIDI.** It holds events, and each one names a clip or a sequence, so
each one is audio or notes on its own. One lane can hold both: two bars of a sampled riff and a
line for a synth, on one row, with one colour and one strip.

A lane has two outputs, `audio` and `midi`, and an event leaves by the one its material fits.
`graph.yaml` names the output when the two need different chains:

```yaml schema=GraphFile
modules:
  gtr#audio: [ amp ]      # the events naming clips
  gtr#midi:  [ synth ]    # the events naming sequences
```

…and says nothing when they do not, which is the ordinary case:

```yaml schema=GraphFile
modules:
  gtr: [ amp ]            # everything this lane holds, down one chain
```

A track has no `volume` and no `pan`: they would be the one part of its sound sitting outside its
chain, with nothing placeable after them and no way for the graph to show where they apply. A
level is a MODULE — put a `mixer` at the end of the track's chain and set its `Volume`, `Pan`
and three tone bands (see Instruments).

**And no `mute` either.** A lane is a module, so it has the bypass button every module node
carries, and that is its mute: one name in `graph.yaml`'s `bypassed:` (see Chains). On a source,
bypass reads as *produces nothing* rather than *passes through untouched* — which is what muting
a lane means. Solo is not written down at all: the surface derives it by bypassing
every other lane.

A placement says WHERE a clip goes and HOW MANY TIMES — nothing about what it plays. How long it
sounds comes from the material's own `from`/`to` window (see Material), multiplied by `loop`.
There is no `length` and no `offset` here: trimming belongs to the clip, so every placement of it
plays the same thing and no two lines can disagree about what that is.

Two things a placement may switch OFF for itself, and both are written by
`event status <what>`:

| field | absent means | what `event status …` writes |
|---|---|---|
| `disabled: true` | it plays | `event status mute on` — silenced, still drawn (dimmed) |
| `warp: false` | it uses the clip's stretch map | `event status warp off` — plays at the sample's own rate |

Both take `on`, `off` or `toggle`, and toggle when you leave it out. **`on` switches the named
state on**: `event status mute on` silences the event, `event status warp on` makes it follow the
clip's map. One rule, both commands.

Note that the FILE spells warp the other way round — `warp: false` is what a declining event
carries — because an absent field there has to mean "it warps, because the clip does". The
command says what you want; the file says what is unusual about this placement.

The polarities are opposite because the defaults are: an event plays unless told otherwise, and it
warps because the CLIP is warped. `warp: false` is one placement declining a map that belongs to
the material and is shared by every other placement of it — which is what you want when the map
fits the song the clip was warped into and a second use of it wants the sample as recorded. The
timeline draws that event's stretch icon with a line through it.

Neither field is ever written at its default: switching one off and back on leaves the file
exactly as it was.

## nodes/<name>.yaml — clips

```yaml schema=Module
extends: "@meta/track"
# color: "#c8a97e"   # the lane's colour, and its icon's in the timeline
# disabled: true     # excluded from the render entirely, chains and all
events:
  - { ref: kick, start: "1:1:1" }
  - { ref: snare, start: "2:1:1", loop: 4 }   # four passes of the snare's window, back to back
  - { ref: kick, start: "6:1:1", fadeIn: "0:1:0", fadeOut: "0:1:0" }
  - { ref: kick, start: "8:1:1", gain: -2 }   # this event alone, 2 dB down

# Timecodes are always written QUOTED. Under YAML 1.2 (what we read) bare
# 1:1:1 is already a string — but under 1.1 it is the number 3661.
```

`fadeIn` and `fadeOut` are **lengths**, not positions: `"0:1"` is one beat. That matters because
both spellings are legal timecodes and nothing downstream can tell them apart — the same beat
written as a position is `"1:2"`, and it would read back as five.

You do not have to type them. Each end of a clip has a **corner handle** on the timeline: drag it
inwards to open a fade, back out to close it. Ctrl frees the grid, like every other drag there. Or
say it:

```
event fadein  gtr 2:1:1 0:1     # one beat in
event fadeout gtr 2:1:1 0:2     # two beats out
event fadeout gtr 2:1:1 0       # …and gone — the field is removed, not written as zero
```

`gain` is **this event's own level**, in dB from −6 to +6, applied to the clip before the lane's
chain: a take that came in hotter than its neighbours is brought down here, not on the lane's fader,
which would move them all. It is the **gain** slider in the clip panel's header, or:

```
event gain gtr 2:1:1 -1.5       # a dB and a half down
event gain gtr 2:1:1 0          # back to unity — the field is removed
```

Only an audio event has one. A sequence's events all play through the lane's one instrument, so
there is no level that is one event's alone; its notes' velocities are how it gets louder.

## nodes/<name>.yaml — sequences

The same file. Nothing here says "MIDI": these events name `sequences/…`, so they are notes, and
they leave by the lane's `midi` output.

```yaml schema=Module
extends: "@meta/track"
events:
  - { ref: melody, start: "1:1:1" }
  - { ref: melody, start: "5:1:1", loop: 8 }   # the same sequence, eight times over
```

## nodes/<name>.yaml — both

Also the same file — one lane holding both kinds at once:

```yaml schema=Module
extends: "@meta/track"
events:
  - { ref: riff, start: "1:1:1" }     # a clip  — leaves by `audio`
  - { ref: melody, start: "3:1:1" }   # a sequence — leaves by `midi`
```

Wire it bare (`gtr: [ amp ]`) and all of it goes through the amp, notes included, which is
probably not what you meant — k7 warns and tells you the two keys to write. Wire `gtr#audio:`
and `gtr#midi:` and each half takes its own chain.

If you wire only ONE of them and the lane holds the other kind, the project refuses to load and
names the key to add. That is deliberate: a clip with nowhere to go would be drawn on the
timeline and simply never heard.

## nodes/<name>.yaml — group

No material and no signal of its own — only the member lane names it nests. On the timeline,
shift-click the names of the tracks to group, then right-click one of them and pick **Group the N
tracks** (or type `track group kick,snare drums`). A track already in a group moves to the new one.

```yaml schema=Module
extends: "@meta/group-track"
tracks: [pad, kit]
```

## nodes/<name>.yaml — strudel

Plays one `algo/` pattern, in the engine; the lane's name picks the part by its `.label`. The
first lane on a file (by name) also plays the unlabelled events and any label no lane claims. How
an event reads is the EVENT's business: a sound that resolves to a sample — in the project's
`samples/`, then `$DIRT_SAMPLES`, then `$STRUDEL_SAMPLES`, as `<name>/*.wav` or `<name>.wav` —
plays as a one-shot, anything else plays as a note for whatever instrument the chain provides
(`s(…)` then picks a waveform, not a plugin). So one pattern lane can be half drums and half
melody.

A pattern lane holds nothing until the transport rolls, so it is the one case where the WIRING
has to say what the file cannot: `pad#midi: [ synth ]` is where "these events are notes for the
synth" is written down. Wired bare, the lane plays both through one chain; its samples enter at
the head of it, so an instrument there covers them — wire `#audio` and `#midi` apart for a kit and a
synth on one lane. Saving the pattern file changes what plays without stopping.

```yaml schema=Module
extends: "@meta/strudel-track"
strudel: algo/pattern.strudel
```

## Moving the whole song along

`project add <at> <length>` opens a span of time at a point; `project remove` closes one. From the
timeline the caret answers the position, so it reads as "insert two bars here".

Everything positioned in song time moves together — every lane's events, its
alternatives, the markers, any drawn automation curve, and the video lanes. A fade or a clip window
is a **length** and stays put.

An event already playing **across** the point stays where it is, decided by its start. That is the
same rule `events move` and `selection consolidate` follow, and it is why inserting time never
writes new material.

## One name space

A lane and a module share one set of names, because they are the same kind of thing. A chain
step naming `lead` must mean exactly one node, so a lane may not be called what a module is
called — which in practice means a lane and the synth it feeds need different names:

```yaml exempt="two files, shown together"
# nodes/melody.yaml       -> the lane
# nodes/synth-melody.yaml -> the 4OSC it plays through
```

In a project where a lane and its instrument share a name, that is the one thing to tell apart.

## What a lane file may not say

There is no `type:` and no `contentType:`. The kind of lane is its `extends:`, and what it plays
is the events' business — an event names a clip or a sequence, and no word at the top of the file
can be more true about that than the event is. No `mute:` and no `solo:` either (see above).

Nor is there a typed track module. Four names a lane file may still carry, and what each one
becomes:

| a file saying | write |
|---|---|
| `@meta/audio-track` | `@meta/track` |
| `@meta/sequence-track` | `@meta/track` |
| `@meta/audio-strudel-track` | `@meta/strudel-track` |
| `@meta/sequence-strudel-track` | `@meta/strudel-track` |

An audio lane and a sequence lane kept side by side for one part are one lane — and if the two
halves need different chains, that is what `#audio:` / `#midi:` is for.

Such a project opens with a refusal naming every lane. A **streaming** lane is the one that needs
more than the new name: only `graph.yaml` can say whether a pattern's events are notes or samples
(`pad#midi: [ synth ]`).

A lane's **alternatives** and its **freeze** belong to every module rather than to lanes alone:
`alternatives:` holds other sets of attributes (for a lane, one of those attributes is its
`events:`), and `frozen:` names a render standing in for everything upstream of the module rather
than for that one lane. Both are in Instruments.

A lane playing a video's sound says `video_source:` instead of `events:` — see the Video page.

Every schema is `.strict()`, so a file carrying any of them says so by name and by line
rather than being read and dropped. There is no migration code and no second accepted spelling: an
`extends:` naming one of the four above names a module that does not exist, and says so.
