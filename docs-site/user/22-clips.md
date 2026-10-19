# Events and clips

Two words matter here, and k7 keeps them apart:

- A **clip** is material: an audio file declared in `clips/`, or a sequence of notes in
  `sequences/`. It exists once.
- An **event** is one *use* of a clip on a lane: where it starts, which slice of the material it
  plays, how many times, with which fades. The same clip can be placed many times, on several
  lanes.

Almost every timeline edit changes an event and leaves the clip alone. The few that write new
material — split, consolidate, process — say so.

## Reading an event

| What you see | Meaning |
|---|---|
| Note icon / speaker icon | A sequence / an audio clip. |
| Fill brightness | The material's activity: dim where it is quiet, solid where it is loud. |
| Waveform or mini roll inside | Shown when lanes are expanded (`ui lanes`). |
| Thin vertical rules, with a ↻ glyph when there is room | Where a looped event starts over. |
| Timer icon | The clip is time-stretched (warped). Crossed out when this event declines the stretch. |
| Ghost icon | Another placement of material heard earlier — every placement but the first carries it. |
| Stacked-layers icon | A comped event: several takes heard as one. |
| Dark wedges at the ends | Fade in / fade out. |
| Dimmed, grey, dashed outline | The event is muted. |
| Thin outline on other events | Placements of the same clip as the one under the caret. |

Hover an event to see its name and a summary; the name is drawn while you drag it.

## Clicking and opening

- **Click** an event: it becomes the selection (the rectangle covers it exactly).
- **Double-click**: open its contents in the bottom panel — the waveform for audio, the notes for a
  sequence. See [Clip editors](./23-clip-editors.md).
- **`e`** with the caret on it: open its file in the editor.
- **Click on empty lane**: move the caret there and close what the bottom panel was showing.

## Adding events

### Drop files from your computer

Drag audio or video files from your desktop onto a lane. The lane you drop on and the position under
the pointer (snapped to the nearest drawn tick) decide where they land; a thin line shows the spot
while you drag.

1. Each file is uploaded into `clips/`, its name reduced to letters, digits, `.`, `_` and `-`.
2. A `clips/<name>.k7x` declaration is written beside it.
3. The first file is placed on the lane you dropped on, the second on the next lane of the same
   kind below it, and so on. Files with no lane left are uploaded and declared, but not placed.

A progress bar shows at the foot of the timeline. The status line reports what happened, for
example `2 into clips/ — placing 2`. A file that is neither audio nor video is refused by name; a
drop between rows is refused with "drop it on a lane". A video dropped on a picture lane is placed
there, and its sound is put on an audio lane for you.

Each placement is its own command, so each can be undone separately.

### Place an existing clip

```text
event add gtr gtr_3.1_260814T143012 3:1
```

Puts clip `gtr_3.1_260814T143012` on lane `gtr` at bar 3. Right-click a lane and choose
**event add** to have the track filled in. This is also how you place a take the recorder could not.

### Paste

See [Copy and paste](#copy-and-paste) below.

## Moving events

### By dragging

Press on an event and drag. The event follows the pointer; a dashed outline stays where it was.
Release to write the move.

- The move snaps to the ruler's current unit (bars, beats or finer as you zoom; seconds in seconds
  mode).
- Hold **Ctrl/Cmd** while dragging to move by whole grid steps while keeping the event's own offset
  from the grid.
- Hold **Shift** while dragging to move freely, off the grid.
- Drag onto another lane to move the event there. A lane is highlighted only when it can take this
  kind of event (notes or audio).
- A drag that ends where it started writes nothing.

### With the keyboard

1. Put the caret on the event and press `m` (or type `event move` with nothing after it).
2. `h`/`←` and `l`/`→` nudge it one beat, the caret's own keys. The status line shows `moving riff: 5:1 → 6:1`.
3. Enter writes the move; Esc cancels.

### Typed

```text
event move drums 2:1 3:1             # same lane
event move drums 2:1 3:1 perc        # onto another lane
events move drums,bass 2:1 4:4 +1:0  # every event STARTING from 2:1 to 4:4, one bar later
events move all 9:1 16:4 -0:1        # every lane, one beat earlier
```

An event is addressed by its lane and the position where it **starts**. When the command bar is
asking for `event move`, dragging an event fills the form instead of moving it; when it asks for
`events move`, drawing a rectangle fills the lanes and range.

## Changing an event's length

Each event has a narrow strip at each end. Drag the **left** strip to move its start, the **right**
strip to move its end. The same modifiers apply: Ctrl/Cmd keeps the offset, Shift frees it. While
you drag, the status line reads `resizing: 5:1 → 7:1 (8 beats) — release to commit`.

Typed — the last value is the new **end position**, not a length:

```text
event resize drums 2:1 2:1 4:1
```

Resizing changes this event's own window into the material, clamped to what the clip itself
offers. Other placements of the same clip are untouched.

## Fades

Each event has two small handles at its **top** corners. Drag the left one inwards for a fade-in,
the right one for a fade-out. Fades snap to whole beats; hold Ctrl/Cmd or Shift to free them.

```text
event fadein gtr 2:1 0:1     # one-beat fade-in
event fadeout gtr 2:1 0:2    # two-beat fade-out
event fadein gtr 2:1 0       # remove the fade
```

The last value is a **length** (`0:1` is one beat).

## The tools

The tool strip at the left holds five tools. A tool changes what a **press on an event** does; it
does not change the keys.

| Tool | Key | Command | A press on an event… |
|---|---|---|---|
| Arrow | `a` | `ui tool pointer` | Selects, drags, opens — everything above. |
| Blade | `b` | `ui tool cut` | Cuts the event at the beat you pressed (snapped; Shift for free). |
| Eraser | `d` | `ui tool erase` | Takes the event off the lane. |
| Mute | — | `ui tool mute` | Silences the event, or gives it its sound back. |
| Crossfade | `x` | `ui tool crossfade` | Crossfades it with its neighbour (below). |

The pointer becomes the tool's icon while a tool is held. Esc or `a` gives the arrow back. Each
press is one command and one undo step.

### Cutting (split)

The blade, `Ctrl+B` (cut at the playhead on the caret's lane) and the typed command all run the
same verb:

```text
event split drums 2:1 3:1    # the event starting at 2:1, cut at 3:1
```

Splitting writes **new material**: a sequence is divided into two sequence files; an audio clip is
rendered into two new audio files (which needs an engine). The original clip stays on disk, since
another lane may still play it. A cut exactly on the start or the end is refused ("nothing to cut"),
and so is a looped event.

### Consolidating

The inverse of a split: one new clip written over a range of **one** lane, joining splits, merging
different clips or flattening a stack, with silence kept where nothing played.

```text
selection consolidate drums 2:1 6:1
```

Draw a rectangle over one lane, right-click an event in it and choose **selection consolidate** —
the range is filled in.

### Muting one event

```text
event status mute drums 2:1:1         # toggle
event status mute drums 2:1:1 on      # silence it
```

A muted event stays in place with its length and fades, drawn dimmed; the engine skips it.

### Crossfading two events

With the crossfade tool, press on an event:

- on its **right half** to crossfade it into the next audio event,
- on its **left half** to crossfade the previous one into it.

A click makes a half-beat crossfade; drag sideways to size it (the status line shows the length);
hold **Alt** while pressing to remove the crossfade. The two events are made to overlap by that
length, using material neither was playing, and each fades over the overlap.

```text
event crossfade gtr 5:1 9:1 0:0:1   # an eighth-note crossfade between the events at 5:1 and 9:1
event crossfade gtr 5:1 9:1 0       # remove it
```

## Other event settings

These are on the event's right-click menu (with the event already filled in) and in the clip
editor's header. Each acts on this event only.

| Command | Effect |
|---|---|
| `event window vox 24:1 52.36 69.82` | Which slice of the audio file the event plays, in **seconds** into the file. |
| `event trim vox 24:1 -40` | Cut the silence off both ends, at a gate in dBFS (default −40). Moves the window; the audio is untouched. |
| `event gain vox 24:1 -1.5` | The event's own gain, −6 to +6 dB, before the lane's chain. `0` removes it. Audio only. |
| `event loop drums 5:1 on` | Play the window twice (`off` once; bare toggles). |
| `event loop points drums 5:1 4 8` | Which part loops — beats into a sequence, seconds into an audio file. |
| `event status warp drums 2:1:1 off` | Play the clip at its own rate, ignoring its stretch map. |
| `event process gtr 5:1 @k7-core/amp-room` | Bounce this event's file through a chain and keep the result. Other events on the same material keep the original. |
| `event remove drums 2:1:1` | Take the event off the lane. The clip stays in `clips/`. |

The clip itself can also be changed for every placement at once: `clip process`, `clip warp`, and the
onset commands — see [Clip editors](./23-clip-editors.md).

## Copy and paste

The timeline and the note editors share one clipboard.

| Key | Command | Effect |
|---|---|---|
| `c` or Ctrl+C | `selection copy` | Copy the events that **start** inside the rectangle — or, with no rectangle, the event under the caret. |
| `p` or Ctrl+V | `selection paste` | Put them down with the rectangle's top-left at the caret. |
| Backspace | `selection delete` | Remove what the rectangle holds, or the event under the caret. In an open roll or sequencer, the notes instead. |

Pasted events keep everything they had — window, fades, loop count, mute, warp — and only their
start moves. The first copied row lands on the caret's lane and each following row on the next lane
down. Rows that run out of lanes are left out, and the status line says how many
(`3 events pasted — 1 had no lane and were left`). A paste is one command, so one Ctrl+Z undoes it
all.

Copying notes and pasting them on the timeline is refused ("the clipboard holds notes, not
events"), and the other way round.

## Seeing an edit before it lands

When you remove, mute, split, crossfade or move a range by command, the lanes show the result at once —
the event disappears, dims or shows its cut — and the next reload of the song makes it true. If the
command is refused, the lane goes back to what it was. Drags keep the event where you dropped it
until the reload arrives.

## Positions and lengths

Every command here takes timecodes `bar:beat:eighth:sixteenth`. Two kinds, easy to mix up:

| Kind | Counts from | Examples |
|---|---|---|
| Position | 1 | `5` or `5:1` is the start of bar 5; `5:3` its third beat; `5:1:2` the second eighth. |
| Length | 0 | `1:0` is one bar, `0:1` one beat, `0:0:1` one eighth. `0` means none. |

The song file reference covers timecodes in full.

## See also

- [Clip editors](./23-clip-editors.md)
- [Undo and history](./28-undo-history.md)
