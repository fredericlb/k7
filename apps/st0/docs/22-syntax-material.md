# Material

## clips/<id>.yaml

An audio clip — a source path, resolved against the project folder, and optionally a window into it.

```yaml schema=Clip
source: clips/kick.wav

# The FILENAME is the id: this is clips/kick.yaml.

# from: 0.25   # start the sample 0.25s into the file, not at its beginning
# to: 1.5      # …and end it there, not at the file's end
# from: "2:1"  # …or musically: bar 2, beat 1 OF THE FILE, at the project tempo
```

`from`/`to` trim the SAMPLE. They belong to the clip and not to a placement, so every track that plays the clip
plays the same trimmed material — say it once, in the file that owns it.

The spelling picks the unit: a bare number is **seconds**, tempo-independent, so the trim never moves; a
**timecode** string is musical, converted at the project tempo. Both, because both are right for different
material — a trimmed field recording wants seconds, a take played to the click wants "start at bar 2".

A timecode edge is a **position in the file**, read exactly like the `start:` beside it: `"1:1"` is the file's
beginning, `"2:1"` is its second bar. It is not a duration — "two bars in" would be `"3:1"`.

The window is the whole story about how long the clip sounds. A placement adds only where it starts and, with
`loop: N`, how many times the window is played — so its extent on the timeline is N × (`to` − `from`), and there
is nowhere for a second answer to live. With no `to`, the clip runs to the end of its file, which is the natural
way to place an untrimmed recording; a `loop` then has nothing to count and is refused when the project is read.

Opening the file shows its waveform fitted to the source's **whole** duration, with the window shaded, so the two
numbers can be placed by eye rather than guessed. Whole means whole: the window shades that picture and does not
also crop it, or trimming a clip would redraw the pane as the trim and leave nothing to judge putting it back.

Opening a **placed** clip — clicking it in the timeline — shows the other half instead: the window it repeats is
marked in violet, with a fainter line where each later pass begins, and the header counts them (`loop 4b × 3`).
That is what explains the pane's width, because it spans the clip's whole extent on the timeline: a clip looped
three times is one pass of material and two passes of the same thing again.

## sequences/<id>.yaml

A MIDI sequence holds its notes inline as compact {t,d,k,v} structs — t/d in beats, k a MIDI key, v an optional 0..1 velocity. Toggle Tracker to edit them on a grid.

`from`/`to` window the NOTES, exactly as a clip's window the sample: this sequence is that slice of them, and a
placement plays it `loop` times. Timecodes only, and positions — `"1:1"` is the first beat, `"5:1"` the fifth
bar. No bare numbers here, unlike a clip: a number in a clip means seconds into a file, and the same spelling
meaning beats one folder over is a rule only ever learned by getting it wrong.

Left out, the window is everything the notes cover, rounded up to the bar — so a two-bar pattern whose last hit
falls on the fourth sixteenth is still two bars long, and repeats of it do not drift.

The piano roll and the tracker mark that window the same way the waveform does — a lit band with its two edges
picked out — and here it says one more thing: notes lying **outside** it are in the file and are not played. A
window that starts past the first beat, or ends before the last hit, is exactly when that is worth seeing.

They mark it whether the sequence is PLACED on a track or opened as a file: `sequences/melody.yaml` in the editor
draws the same band, read from the text as you type it, and a `to:` reaching past the last note keeps its bars on
the grid rather than clipping them — the silence at the end is deliberate, and the band is what says so.

Each note also carries a thin line across it: its **velocity**, at the bottom of the note for 0 and at the top
for full. Drag a note up or down to change it (`sequence note velocity` on the command bar). A note that says
nothing about velocity draws at full and stays that way in the file — dragging one back to the top removes the
`v` rather than writing `v: 1`.

```yaml schema=Sequence
# sequences/melody.yaml
# from: "1:1"        # start at the sequence's own beginning (the default)
# to: "3:1"          # …and end it at bar 3, whatever the last note does
# use_rack: drumrack   # a rack module whose symbols name these notes —
#                      # the tracker then labels rows by symbol, not by key
notes:
  - { t: 0, d: 1, k: 60 }
  - { t: 1, d: 1, k: 62 }
  - { t: 2, d: 1, k: 64 }
  - { t: 3, d: 1, k: 65 }
```

## curves/<id>.yaml — LFO

An automation curve. An LFO is generated: shape, frequency in cycles per BAR, optional phase. `polarity` decides how a module's automation maps it — unipolar sweeps the parameter's whole range, bipolar rides ± half a range around wherever the knob sits.

```yaml schema=Curve
type: lfo
shape: sine          # sine | triangle | saw | square
frequency: 0.5       # cycles per bar
polarity: bipolar    # unipolar | bipolar
# phase: 0.25        # 0..1
```

## curves/<id>.yaml — custom

A drawn curve: timecoded points, interpolated between. At least one point; times are the same bars:beats:ticks the timeline uses, so they must be quoted.

```yaml schema=Curve
type: custom
polarity: unipolar
points:
  - { time: "1:1:1", value: 0 }
  - { time: "3:1:1", value: 1 }
  - { time: "5:1:1", value: 0 }
```

## curves/<id>.yaml — adsr

An envelope, in **milliseconds**, restarted every time an event fires it — where the two curves
above are functions of song time and run whether anything plays or not. Bind it like any other
curve; what makes it an envelope is that `trigger` names the module whose note-ons restart it,
and leaving that out means the module the curve drives (a filter envelope follows its own synth).

All four stages are durations, sustain included. A keyboard holds sustain until you let the key
go; this envelope is laid down in advance from the notes it will be fired by, so its length has
to be knowable — there is no note-off to wait for. `level` is the one value that is not a time:
where decay lands and sustain holds.

Milliseconds, and not bars, for the reason the LFO is the other way round: an envelope is a
gesture of the hand, and a 20 ms attack is 20 ms whatever the tempo.

```yaml schema=Curve
type: adsr
attack: 5           # ms, 0 is instant
decay: 120          # ms, down to `level`
sustain: 200        # ms — a HOLD, not a level
release: 400        # ms, back to nothing
level: 0.6          # 0..1, where decay lands
polarity: unipolar  # unipolar | bipolar
```

Two notes closer together than the envelope is long do not stack: the running one is cut where
the next fires. One automation lane holds one value, so there is nothing to sum. Per-note
modulation, where overlapping notes each keep their own envelope, is the plugin's own business.

## clips/<id>.yaml — corrected onsets

The engine detects onsets in the audio itself — the transient marks the slicer cuts on, and the grey
lines a clip draws. One threshold governs the whole file, so raising it finds more of them and lowering
it finds fewer. This block is for the ones it still gets wrong.

```yaml schema=Clip
source: clips/prise-01.wav
onsets:
  added: [1.24]        # a hit the detector missed, in SECONDS into the file
  removed: [3.51]      # something it marked that is not a hit
```

What is stored is the **difference**, not the resulting list, and that is the point: the detected set is
rebuilt whenever the audio or the threshold changes, so a finished list would go stale the moment you
moved the sensitivity — and moving it is what the sensitivity is for. A correction outlives every
re-detection, because it says "there is also one here" and "there is not one there" rather than "here is
the answer".

Moving an onset is a removal and an addition, which is what moving it is. A time within 25 ms of an
existing onset means that one, so an approximate second is enough — and a hit re-detected a few
milliseconds away is still the hit you refused.

Seconds into the file, never a timecode: an onset is a fact about the material, and would slide out from
under it if it were musical and you edited the tempo.

The recorder writes these for you — the review screen at the end of a take draws the onsets over the
waveform and lets you drag, add and remove them — and `clip onset add|remove|move` is the same edit from
the command bar.

## clips/<id>.yaml — warped

A stretch map: `markers` pairs [timeline beat, source second], monotonic, at least two — the clip follows the song tempo instead of its own. Written by the importer, and editable with `clip warp <clip> <sec> <beat>`, which places a point or moves the one already at that second. `clip warp remove` drops one. Moving a point leaves its neighbours where they are, so only the two segments touching it change rate. A clip with no map gets its two anchors seeded on the first call — that map is an identity and changes no sound; the third point is what makes it a warp.

```yaml schema=Clip
source: clips/break.wav
warp:
  algorithm: elastique
  markers:
    - [0, 0]
    - [4, 1.9382]
    - [8, 3.8764]
```
