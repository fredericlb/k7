# Recording: audio, MIDI and takes

k7 records in two places. **Audio** is recorded by the engine, on the machine whose audio
interface the microphone or guitar is plugged into. **MIDI** is recorded by your browser, where your
keyboard is plugged in, and is sent to the song as notes when you stop.

In both cases recording is two switches:

1. **Arm** the lane that should receive the take.
2. Turn **Record** on (the round button in the header, or `Shift+R`), then press Play.

With Record on and nothing armed, Play is greyed out and says: "record is on and no track is armed —
arm a track, or turn record off".

## Giving a lane an input

A lane records only what an input node feeds it. Double-click the lane's header to open its
modules, and use **audio in** or **midi in**, or type:

```text
track input vox audio
track input keys midi
```

Both buttons are greyed out when the lane already has an input.

### The audio input's settings

An audio input's card in the graph has three menus:

| Menu | What it sets | Typed |
|---|---|---|
| **in** | Which interface channel, or pair of channels, it listens to. | `node param vox_in @channel 1` / `@channel 1,2` |
| **width** | Mono or stereo. | (part of `@channel`) |
| **mon** | Monitoring: **off**, **auto** (heard while armed) or **on**. A new audio input starts on auto. | `node param vox_in @monitor auto` |

`node param vox_in @gain -3` sets the input trim in dB. Which physical inputs make a stereo pair is
a fact about your rig, set once with `system channel type 3 stereo`.

### The MIDI input's device

A MIDI input card has one menu, **device**: **any**, or one of the MIDI devices your browser sees.
That choice is written into the song (`node param keys_in @device "Arturia KeyStep"`), so the same
song listens to the same keyboard next time. A name matches loosely: exact first, then ignoring
case, then partial. The card's light blinks whenever any device sends something.

Your browser asks for permission to use MIDI the first time a MIDI lane is armed. If it is refused
or unavailable, the status line says "No MIDI — Web MIDI was refused or is unavailable here".

## Arming

| How | What it arms |
|---|---|
| The lane's **A** button | A MIDI lane in the browser, an audio lane in the engine. |
| `r` with the caret on a lane | The same as its **A** button: `rec <lane>`. |
| `rec vox` | The same, typed. Run it again to disarm. |
| `transport arm vox` | The engine's arm only, typed: for an audio lane. Run it again to disarm. |

Only one MIDI lane can be armed at a time. An armed lane turns red, and its header shows the input
level along its bottom edge. Arming is never saved in the song.

An audio arm is refused when the lane has no input ("has no input — nothing to record"), when it is a
group, or when two armed lanes share the same input.

## Playing while armed (MIDI thru)

Everything you play on the matched device is sent straight to the armed lane's instrument, whether
or not you are recording. There is no separate thru switch.

## Recording audio

1. Arm the lane, turn Record on, press Play.
2. The engine plays a **count-in** first — one bar by default, set by `count_in` in the song's
   `settings.yaml` (at most two bars). The click sounds during the count-in even with the metronome
   off.
3. While the take rolls, a red block grows on the lane, and the bottom panel shows **Count-in**,
   then **Recording**. **Stop the take (Esc)** ends it.
4. When you stop, the take is filed: the audio goes into `clips/` under a name made from the lane,
   the bar it started on and a time stamp — `gtr_3.1_260814T143012.wav` — a `clips/<name>.yaml`
   declares it, and an event is placed on the lane where the recording started.

The armed lane's own playback is silenced from the punch-in point while you record over it.

## Recording MIDI

1. Arm the MIDI lane with its **A** button.
2. Turn Record on and press Play.
3. The bottom panel shows a live piano roll: **Count-in** and a countdown, then **Recording** with
   the bar and beat, the lane and the number of notes. It shows eight bars at a time and slides
   along. The lane also draws the growing take.
4. Press Stop (or **Stop the take (Esc)**).

On stop, the notes are written as a **new sequence** on that lane — `keys-rec-1` in the song's `sequences/` folder — whose
window starts on the bar of the first note and ends on the bar after the last one. The new clip
opens in the bottom panel. Timing is kept exactly as played: nothing is quantized (use
`sequence notes quantize` afterwards, see [Clip editors](./23-clip-editors.md)). Notes played during
the count-in are dropped, except a note up to a quarter of a beat early, which is pulled onto the
first beat. Keys still held at the stop end there. A take with no notes writes nothing.

If the armed lane has no MIDI input wired, the status line says "Nothing records MIDI into keys:
wire a MIDI node to it".

Typed equivalents, for scripts:

```text
sequence record keys [{"t":16,"d":0.5,"k":60,"v":0.8}]   # a new sequence on lane keys, song beats
sequence note add melody [{"t":0,"d":1,"k":64}]           # append to an existing sequence, beats from its start
```

## Takes and comping

You can record several performances **over one event** and choose which plays where. This happens in
the **takes** view of the clip editor: double-click the event, then switch the view to takes.

The view shows one row for the event's own material (**event**) and one per take (**take 1**,
**take 2**, …) on a shared time axis. Each row is bright where it is heard.

| Gesture | Effect |
|---|---|
| Drag across the rows | Choose a span (snapped to a quarter beat). The span shows as "A → B"; Esc or **X** clears it. |
| Click a row, with a span | That take plays over the span — `event comp`. |
| Click a row, no span | Move the playhead there. On a MIDI event, a click picks that whole take. |
| **✓** on a row | Same as clicking it. |
| Trash on a take | Remove the take and every span it played. Its file stays on disk. |
| **●** | Record another take: punched in over the span if there is one, otherwise from the event's start. **■** stops it. |
| Crossfade tool (audio) | Press near a seam between two takes and drag to size its crossfade; Alt removes it. |

The **●** button arms and starts everything for you, plays from the punch-in point, and afterwards
puts things back. A take recorded this way is heard only over the punch; outside it, the event plays
as before.

In the waveform view, a comped event shows its pieces as buttons along the top; drag a piece's edges
to move where one take hands over to the next.

Typed:

```text
event comp gtr 5:1 gtr_5.1_261008T101500 6:1 7:3   # this take over 6:1–7:3 of the event at 5:1
event comp fade gtr 5:1 6:1 0:0:1                   # an eighth-note crossfade at the seam at 6:1
event take remove gtr 5:1 gtr_5.1_261008T101500
event take arm gtr 5:1 6:1 7:1                      # next takes go into this event, punched 6:1 → 7:1
event take disarm                                   # next recording lands on the lane again
```

A comped event shows the stacked-layers icon on the timeline.

## The metronome

The metronome button sits in the header beside the tempo and time signature.

- **Click** (or Enter/Space on it): turn the click on or off — `transport metronome`.
- **Right-click** (or ↓): a volume slider from 20 % to 100 %. It applies when you let go —
  `transport metronome volume 0.4`.

Both are saved in the song's `settings.yaml`. The lowest level is 20 %; for silence, turn the click
off.

## Mapping a controller knob (MIDI learn)

To drive a parameter from a hardware knob:

1. Right-click the control in the graph and choose **midi learn** (or type
   `ui midi learn synth "Filter Freq"`).
2. Move a knob on your controller. That message is captured and not applied.

Press `Esc` or run any other command before moving a knob to cancel the learn; nothing is written.

The binding is written with `module cc synth "Filter Freq" 1 74` into the module's own folder, so it
holds for every use of that module in every project. If your device can also receive MIDI, the knob
is told the value back. Remove a binding from the same right-click menu (**module cc none**) or with
`module cc synth "Filter Freq" none`.

## See also

- [Tracks and lanes](./21-tracks.md)
- [Clip editors](./23-clip-editors.md)
