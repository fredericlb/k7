# Clips, sequences and curves

**Material** is what a lane plays: audio and video **clips**, and MIDI **sequences**. A material
file describes the material once; a lane's events say where and how often it is used. One clip can
be placed any number of times, on any number of lanes.

**Curves** are automation shapes that drive a module's parameters.

All three are flat files named by their id: `clips/kick.k7x` is the clip `kick`.

## Clips

A clip file names a media file and, optionally, which part of it to use. Whether a clip is audio or
video is decided by the source's extension: `.mp4 .mov .m4v .webm .mkv` are video, anything else is
audio.

```k7x
// clips/kick.k7x
source("clips/kick.wav")
```

```js
// clips/loop.k7x
source("clips/loop.wav")
from(0.25)
to("2:1")
```

### Audio clip fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `source` | text, required | — | The audio file, relative to the project folder. |
| `from` | seconds (number ≥ 0) or timecode | the file's start | Where the clip's window opens in the source. |
| `to` | seconds or timecode | the file's end | Where it closes. When both are numbers, `to` must be greater than `from`. |
| `warp` | map | none | A stretch map, usually from an imported project. See below. |
| `onsets` | map | none | Corrections to the onsets the engine detected. See below. |

A timecode window edge is converted to seconds with the project's tempo and metre.

**`warp`** — lays moments of the source onto the timeline:

| Field | Type | Meaning |
|---|---|---|
| `algorithm` | text, required | The stretch algorithm name (an imported map says which; `elastique` when read without one). |
| `markers` | list of `[beat, source second]` pairs, at least two | Where each moment of the source lands. Must rise monotonically. |
| `disable` | true/false | Switch the map off while keeping it in the file. |

An event can also opt out of a clip's map with `warp: false` (see [Lanes and events](./34-lanes-events.md)).

**`onsets`** — a clip's onsets are detected by the engine; this map only stores your corrections,
in source seconds:

| Field | Type | Meaning |
|---|---|---|
| `added` | list of numbers ≥ 0 | Onsets you added. |
| `removed` | list of numbers ≥ 0 | Detected onsets you removed. |

### Video clip fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `source` | text ending in a video extension, required | — | The video file. |
| `sound` | text, an audio file | none | The video's sound, extracted once to an audio file the engine can read. Written by k7. |

A video clip takes no window: the trim of a shot is on the picture lane's event (`source_from`).

## Sequences

A sequence is a list of MIDI notes. Times are in **beats** (quarter notes) from the start of the
sequence, as plain numbers; fractions are allowed, so microtiming is just a decimal.

```k7x
// sequences/melody.k7x
notes([t(0).d(1).k(60), t(1).d(1).k(62).v(0.8), t(2).d(0.5).k(64)])
```

```js
// sequences/melody.k7x
notes([
  t(0).d(1).k(60),
  t(1).d(1).k(62).v(0.8),
  t(2).d(0.5).k(64),
])
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `notes` | list, required | — | The notes, fields below. May be empty. |
| `from` | timecode | the first note | Where the sequence's window opens, a position inside the sequence. |
| `to` | timecode | the end of the last note | Where it closes. |
| `use_rack` | text | none | A rack node whose pad names label these notes in the note editors (`BD`, `SN`…). An editor aid only; the notes stay plain MIDI. |

Each note:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `t` | number ≥ 0, required | — | Onset, in beats. |
| `d` | number above 0, required | — | Duration, in beats. |
| `k` | whole number 0–127, required | — | MIDI key (60 is middle C). |
| `v` | number 0–1 | `1` | Velocity. |
| `repeat` | whole number ≥ 2 | once | Retrigger: play the note this many times inside its own duration. |
| `skip` | whole number ≥ 2 | every pass | Fall silent on every n-th pass of the pattern. |

`repeat` and `skip` are mostly used on step-sequencer pads.

### The short note form (k7x only)

In a `.k7x` sequence you may write the notes as a string, Strudel mini-notation style. k7 expands it
into the note list above before reading it.

```js
notes("c4 e4 g4 c5")                        // one note per beat
notes(seq("c4 [e4 g4] ~ c5").step(0.5))     // half-beat steps
notes(seq("[c4,e4,g4]@2 a3!2").v(0.7))      // velocity for every note
```

| Syntax | Meaning |
|---|---|
| `c4`, `f#3`, `bb2`, `60` | A note: a name with its octave (C4 is 60), or a MIDI number |
| space | Next step |
| `~` | A rest |
| `[a b]` | Subdivide one step |
| `[a,b,c]` | Play together (a chord) |
| `x@n` | This step lasts `n` steps |
| `x!n` | Repeat this step `n` times |
| `seq("…")` with `.step(n)` | Each step is `n` beats (default 1) |
| `seq("…")` with `.v(n)` | Velocity 0–1 of every note |

`seq(…)` accepts only `step` and `v`. When k7 later changes a note of a sequence written this way,
the string is replaced by the full note list.

## Timelines

A **timeline** is an arrangement of its own — lanes of events — placed **whole** as one event on a
lane of the song, which is the timeline called **Main**. A verse written once and played three
times, a fill reused across a set.

```js
// timelines/verse.k7x
length("8:0") // eight bars, whatever it holds
lanes([
  lane("drums").events([ref("kick").start("1:1")]),
  lane("bass").events([ref("bassline").start("1:1")]),
])
```

A lane places it by `ref`, like a clip: `events([ref("verse").start("9:1")])`.

- **It sounds through the lane it is placed on.** Its own lanes have no instrument, effects or
  fader; everything they hold plays through the song lane the event sits on.
- **Its length is fixed.** `length` is a duration; left out, it is what the lanes hold, rounded up
  to the bar. What runs past it is cut, and the event cannot be resized, looped, windowed or faded —
  it takes `gain` and `disabled` only.
- A timeline may hold another one, but never itself. No timeline may be named `main`.

## Curves

A curve is a shape over time that a module's automation binds to one of its parameters (see
`automations:` in [Node and module fields](./35-node-fields.md#automation)). Its output is read 0..1
(unipolar) or −1..1 (bipolar) and scaled into the parameter's range.

There are four types, chosen by `type`.

```k7x
// curves/sweep.k7x — drawn by hand
type("custom")
points([time("1:1:1").value(0), time("2:1:1").value(1), time("4:1:1").value(0.2)])
```

```k7x
// curves/wobble.k7x — one sine cycle per bar, swinging -1..1
type("lfo")
polarity("bipolar")
frequency(1)
```

### Fields every curve but `onoff` takes

| Field | Type | Default | Meaning |
|---|---|---|---|
| `polarity` | `unipolar` or `bipolar` | `unipolar` | 0..1 or −1..1. |
| `amplitude` | number 0–1 | `1` | Scales the whole output. |
| `cut` | `none`, `positive` or `negative` | `none` | Keep only one half of the output. |
| `conditions` | list | none (runs for the whole song) | When the curve runs. See below. |

### `type: lfo`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `shape` | `sine`, `triangle`, `saw`, `square` | `sine` | The waveform. |
| `frequency` | number above 0 | `1` | Cycles per bar. |
| `phase` | number 0–1 | `0` | Where in the cycle it starts. |
| `duration` | duration timecode | `"0"` (for ever) | How long it runs, for example `"2:0"` for two bars. |

### `type: custom`

| Field | Type | Meaning |
|---|---|---|
| `points` | list of `{ time, value }`, at least one | `time` is a position timecode, `value` a number. The curve ramps between points. |

### `type: adsr`

An envelope restarted by an event (typically a note-on of the module named as the automation's
`trigger`). All stages are in **milliseconds**.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `attack` | number ≥ 0 | `0` | Rise time; 0 is instant. |
| `decay` | number ≥ 0 | `0` | Fall time to `level`. |
| `sustain` | number ≥ 0 | `0` | How long it holds at `level` — a duration, not a level. |
| `release` | number ≥ 0 | `0` | Fall time to zero. |
| `level` | number 0–1 | `0.5` | Where the decay lands. |

### `type: onoff`

For an on/off (boolean) parameter. Each point holds until the next; there is no ramp.

| Field | Type | Meaning |
|---|---|---|
| `points` | list of `{ time, value }`, at least one | `value` is `0` or `1`. |
| `conditions` | list | As below. |

### Conditions

Without `conditions`, a curve runs for the whole song. With several, it runs whenever any of them
holds; outside them the parameter holds its value at the nearest edge.

| Condition | Fields | Runs |
|---|---|---|
| `{ type: start, at }` | `at`: position | from that moment on |
| `{ type: end, at }` | `at`: position | until that moment |
| `{ type: between, start, end }` | two positions | between the two |
| `{ type: event, event }` | `event`: an event name such as `noteOn` | from each event of the node it automates |

Each condition also takes `retrigger: true`, which restarts the curve's own time at the start of each
stretch instead of letting it carry on from the song's start.

```k7x
type("lfo")
frequency(2)
conditions([type("between").start("9:1").end("17:1").retrigger(true)])
```
