# Timecodes

Everything placed on the musical grid — an event's start, a fade, a marker, a curve point — is written
as a **timecode**: numbers separated by colons, counting bars, beats and subdivisions of the
project's time signature.

```k7x
start("5:1:1") // bar 5, beat 1
fadeIn("0:1") // one beat long
```

## The fields

```text
bar : beat : half-beat : quarter-beat . ticks
```

| Field | Worth | In 4/4 |
|---|---|---|
| bar | one bar of the time signature | 4 quarter notes |
| beat | one beat of the time signature (the denominator's note value) | a quarter note |
| half-beat | half a beat | an eighth note |
| quarter-beat | a quarter of a beat | a sixteenth note |
| `.ticks` | 960 ticks per quarter note, added after the last field | 1/960 of a quarter note |

You may stop after any field: `"5"`, `"5:1"`, `"5:1:1"` and `"5:1:1:1"` all name the start of bar 5.
The ticks are a remainder, not an index: `"5:1.480"` is bar 5, beat 1, plus half a quarter note.

The beat follows the denominator. In 6/8 a beat is an eighth note and a bar is six of them, so
`"2:1"` is three quarter notes after `"1:1"`.

Write at most four colon fields. A longer chain is accepted but read by an older rule in which each
level below the beat is a quarter of the one above; k7 never writes one.

## Positions and durations

The same notation is read two ways, depending on the field:

- A **position** says *where*. It is **1-based**: the song starts at `"1:1:1"`. Event `start`,
  marker keys, curve point `time`, comp `from`/`to`, take `start`, crossfade `at`, curve
  conditions.
- A **duration** says *how long*. It is **0-based**: `"1:0"` is one bar, `"0:2"` two beats,
  `"0:0:1"` half a beat. Event `fadeIn`/`fadeOut`, crossfade `length`, an LFO's `duration`.

Examples in 4/4:

| Written | As a position | As a duration |
|---|---|---|
| `"1:1:1"` | the very start | — |
| `"2:1"` | bar 2 (4 beats in) | — |
| `"1:3"` | beat 3 of bar 1 (2 beats in) | — |
| `"1:1:2"` | half a beat in | — |
| `"1:1:1:2"` | a quarter beat in | — |
| `"1:0"` | — | one bar (4 beats) |
| `"0:2"` | — | two beats |
| `"0:0:1"` | — | half a beat |
| `"0:0:0.240"` | — | a sixteenth note (240 ticks) |

When k7 writes a timecode it uses the shortest exact form: `"2:1"` rather than `"2:1:1:1"`, and
ticks only when the position falls between sixteenths.

## Always quote a timecode

Write every timecode in quotes, as the string it is:

```k7x
events([ref("melody").start("1:1:1")])
```

Every timecode field requires a string. `start(5)` is a number, and is refused with
`expected a timecode like 25:1, 8:1:2 or 8:1:2:2.120`. An unquoted `5:1:1` does not parse at all.

## Where seconds are used instead

Some fields are measured in seconds on the wall clock rather than in bars, because they describe a
file or a picture rather than the music:

| Field | Unit |
|---|---|
| A clip's `from` / `to` | seconds into the source file (a number), or a timecode |
| An event's `from` / `to` | seconds (a number) or a timecode — see [Lanes and events](./34-lanes-events.md#the-window-from-and-to) |
| A sequence's `from` / `to` | timecodes only, positions inside the sequence |
| Everything in a picture lane (`video_tracks/`) | decimal seconds |
| A clip's `onsets` corrections | seconds into the source |
| An ADSR curve's stages | milliseconds |

Because a picture lane is in seconds, changing the tempo moves the bar grid under a shot rather than
moving the shot.

A sequence's notes use a third unit, **beats** (quarter notes) as plain numbers: `t: 2.5` is two and a
half beats into the sequence. See [Clips, sequences and curves](./33-material.md#sequences).
