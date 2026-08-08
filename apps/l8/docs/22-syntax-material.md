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
numbers can be placed by eye rather than guessed.

## sequences/<id>.yaml

A MIDI sequence holds its notes inline as compact {t,d,k,v} structs — t/d in beats, k a MIDI key, v an optional 0..1 velocity. Toggle Tracker to edit them on a grid.

`from`/`to` window the NOTES, exactly as a clip's window the sample: this sequence is that slice of them, and a
placement plays it `loop` times. Timecodes only, and positions — `"1:1"` is the first beat, `"5:1"` the fifth
bar. No bare numbers here, unlike a clip: a number in a clip means seconds into a file, and the same spelling
meaning beats one folder over is a rule only ever learned by getting it wrong.

Left out, the window is everything the notes cover, rounded up to the bar — so a two-bar pattern whose last hit
falls on the fourth sixteenth is still two bars long, and repeats of it do not drift.

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

## clips/<id>.yaml — warped

A stretch map carried over from an imported DAW project. `markers` pairs [timeline beat, source second], monotonic, at least two — the clip follows the song tempo instead of its own. Written by the importer; rarely authored by hand.

```yaml schema=Clip
source: clips/break.wav
warp:
  algorithm: elastique
  markers:
    - [0, 0]
    - [4, 1.9382]
    - [8, 3.8764]
```
