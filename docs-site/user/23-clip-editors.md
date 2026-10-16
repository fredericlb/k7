# Clip editors: waveform, piano roll, step sequencer

Double-click an event on the timeline and its contents open in the **bottom panel**, under the
timeline, which stays on screen. An audio event opens the **waveform**; a sequence opens one of
three **note views**. Clicking empty lane space closes it again.

Both kinds of editor draw the same ruler as the timeline, offset to where the event sits in the
song, and show the playhead as it passes through.

## The audio clip panel

### Header

| Control | Effect | Command |
|---|---|---|
| **N/M bars**, **all** | How many bars of the file are shown; **all** shows the whole file. | — (view) |
| **the event** | Shown when you have scrolled away from the part the event plays; jumps back to it. | — |
| **gain** slider | This event's own gain, −6 to +6 dB, applied before the lane's chain. Commits on release; double-click for 0 dB. | `event gain <track> <at> <dB>` |
| **loop** | Loop the event: it plays its window twice, and the loop points appear in the ruler. Click again to stop looping. | `event loop <track> <at> on|off` |
| **view** | standard · onsets · warp · takes (below). | `ui wave <view>` |
| **threshold** (onsets view) | The onset detector's sensitivity, 0.25 to 8. | — |
| **trim** | Opens a gate: a threshold slider (−80 to −10 dBFS) and a preview of what would be kept (`keeps 1.20s → 14.85s`). The **trim** button inside applies it to this event's window; the audio is untouched. | `event trim <track> <at> <dB>` |
| **operations** | A searchable list of every chain the project and libraries offer. Picking one bounces this clip through it for good. | `clip process <clip> <chain>` |
| Trash (after a recording) | Discard the recording: its event leaves the lane. | |
| ✓ **done** | Close the panel. | |

The **mouse wheel** over the waveform zooms in and out in bars; Ctrl+wheel zooms finely.

The picture is a single waveform whose height is the peak and whose colour is the balance of low,
mid and high frequencies.

### The four views

A column of four buttons on the left of the waveform picks the view; the keys `a` (standard),
`o` (onsets) and `w` (warp) work while the panel is open, and Esc returns to standard. The view
decides what a press on the waveform does.

**standard** — the event's window into the file is lit, its two edges drawn. Drag an edge to change
which slice the event plays (`event window <track> <at> <from-sec> <to-sec>`). On a looped event the
same drag moves the loop points instead (`event loop points …`).

**onsets** — the detected attacks (transients) as pins along the bottom.

| Gesture | Command |
|---|---|
| Click anywhere inside the event | Add an onset the detector missed — `clip onset add <clip> <sec>` |
| Click a pin | Remove it — `clip onset remove <clip> <sec>` |
| Drag a pin | Move it — `clip onset move <clip> <from-sec> <to-sec>` |

Your corrections are kept as a difference from what the detector found, so they survive changing the
threshold. A time within 25 ms of an existing onset means that onset.

**warp** — the clip's stretch points: a dashed rule at the moment of the source, a blue handle where
its beat lands. The onsets are drawn as grey lines for reference.

| Gesture | Command |
|---|---|
| Double-click | Drop a stretch point there. |
| Drag a point's blue handle | Say which beat that moment should land on — `clip warp <clip> <src-sec> <beat>` |
| Right-click a point | **warp remove** — `clip warp remove <clip> <src-sec>` |

A clip with no stretch map gets its start and end pinned the first time; those two alone change
nothing, and the third point is what bends the time. Moving a point changes only the two segments
on either side of it. The map belongs to the clip and every placement plays it; to have one event
play the clip at its own rate, use `event status warp <track> <at> off`. A warped event shows a
timer icon on the timeline.

**takes** — the takes and comping view, described in [Recording](./25-recording.md#takes-and-comping).

### Loop points in the ruler

With **loop** on, a brace appears in the panel's ruler. Drag either end to move a loop point; the
event keeps its length on the timeline and the number of passes is recomputed. Nothing is written
until you let go, then it is one `event loop points` command (seconds into the file for audio).

## The note views

A sequence opens in one of three views. The view switch at the top offers:

| View | For |
|---|---|
| **sequencer** | One step per cell, one row per sound of the rack downstream — drum programming. It needs the lane to be wired to a rack, and says so otherwise. |
| **piano roll** | What a grid cannot say: velocities, notes off the grid, notes the rack does not name. |
| **tracker** | The file's notes as text: the arrows move, the keys type. It edits the sequence file itself. |

The same views can be opened by command: `sequence edit roll melody`, `sequence edit tracker melody`.

All note views share the timeline's caret keys: `hjkl` or the arrows move a caret over the grid,
`v` grows it into a rectangle, Esc drops the rectangle, Shift+drag draws one with the pointer.
`Shift+L` loops the rectangle, `c`/Ctrl+C copies the notes in it, `p`/Ctrl+V pastes at the caret,
Backspace (or `x`) deletes what the rectangle holds, or the note under the caret when there is no
rectangle: one note is `sequence note remove`, several are one `sequence notes remove`, a single undo
step either way. Pasted notes that would fall off the keyboard are left out
(`2 off the keyboard, left out`).

### Piano roll

The roll has its own modes, chosen from its strip or with keys:

| Mode | Key | A press… |
|---|---|---|
| select | `a` | Drag frames a rectangle; a note can be moved, stretched or its velocity set. |
| create | `n` | Drag draws a note — its pitch where you start, its length where you let go. |
| remove | `d` | Clicking a note takes it off. |
| takes | | The takes view. |

`ui roll select|create|remove` does the same. Shift+drag draws a rectangle in every mode. A
sequence file with no event placing it opens on the same roll, with the same modes, so you can draw
and remove notes there too; it has no ruler to seek on and no event loop.

Gestures on a note (select mode):

| Grip | Effect | Command, sent on release |
|---|---|---|
| The body | Move it in time and pitch. | `sequence note timerange …` (time) or `sequence note move …` (pitch, keeping length and velocity) |
| The left or right edge | Stretch its start or end. | `sequence note timerange <seq> <note> <start> <newStart> <newEnd>` |
| The white line inside it | Drag up or down for velocity (0 at the note's bottom, 1 at its top). | `sequence note velocity <seq> <note> <start> <0..1>` |
| The body of a note inside the rectangle | Move every note of the rectangle together. | `sequence notes move <seq> <json>` |

A press on a note plays it at its velocity, so you can judge by ear. Drags snap to the grid; Ctrl/Cmd
keeps the note's offset from it and Shift frees it. A note drawn outside the event's window is
refused, since it would not sound.

Right-click a note for **remove**, **split** (at the caret, when it falls inside the note) and, when
the click lands inside a rectangle, the four region commands:

```text
sequence notes remove    melody C4 C5 0 4
sequence notes transpose melody C4 C5 0 4 12      # semitones, clamped onto the keyboard
sequence notes quantize  melody C4 C5 0 4 0.25    # snap starts to a sixteenth; lengths kept
sequence notes velocity  melody C4 C5 0 4 0.7     # 1 clears the field
```

A rectangle is two keys (inclusive) and a span of beats from the sequence's start (the far edge
excluded); a note belongs to it when it **starts** inside. Each region command is one undo step.

### Step sequencer

Rows are the sounds of the rack the lane plays; columns are steps. The precision switch above the
grid picks the step: 1/2, 1/4, **1/8** (default), 1/16 or 1/32. A row whose note no sound answers to
is marked "off the rack".

| Gesture on a cell | Effect | Command |
|---|---|---|
| Click an empty cell | Lay a hit there. | `sequence note new <seq> <note> <start> <end>` |
| Click a lit cell | Take it off. | `sequence note remove <seq> <note> <start>` |
| Drag a lit cell up/down | Set its velocity. | `sequence note velocity …` |
| Ctrl+drag a lit cell | Move it to another step or row. | `sequence note move …` |
| Shift+wheel on a lit cell | Nudge it by a hundredth of a step. | `sequence note move …` |
| Drag inside a selection | Move every note in it (refused when a note would leave the grid or land on one that stays). | `sequence notes move …` |
| Click a row's name | Hear that sound. | |

Right-click a lit cell for its two effects:

| Entry | Command | Effect |
|---|---|---|
| repeat ×2 / ×4, repeat off | `sequence note repeat drums C1 4 2` | Retrigger the hit 2 or 4 times inside its own step. |
| skip 1/2 / 1/4, skip off | `sequence note skip drums C1 4 2` | Silence the hit one pass in 2 (or in 4). |

Backspace or `x` clears the caret's pad or the rectangle's, as in the roll. A sequencer row is a rack
sound rather than a semitone, so the rows of a rectangle are not always neighbouring notes: when the
key range from its lowest to its highest row would also take a note on a row outside it, the delete
is refused (`can't delete in one go — the rows between hold other notes`) and nothing is removed.
Select fewer rows, or clear the pads one by one.

Any whole number from 2 up can be typed. The **×2** button doubles the sequence: its window twice as
long, its notes played twice (`sequence double drums`).

### Typed note commands

| Command | Effect |
|---|---|
| `sequence new lead` | An empty 4-bar sequence. |
| `sequence list` | List the sequences. |
| `sequence note new melody C4 4 6` | Add a note: key (`C4`, `F#3` or a MIDI number), start and end in beats. |
| `sequence note remove drums C1 4` | Remove the note on C1 starting at beat 4. |
| `sequence note split melody C4 4 5` | Cut it in two at beat 5; both halves keep the velocity. |
| `sequence double drums` | Twice as long, played twice. |

Beats count from the start of the sequence (0 is its first beat).

## See also

- [Events and clips](./22-clips.md)
- [Automation](./24-automation.md)
- [Recording](./25-recording.md)
