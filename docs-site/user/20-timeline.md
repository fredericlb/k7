# The arrangement timeline

The timeline is where a song is laid out in time: one lane per track, the events placed on them, a
ruler across the top, and a playhead that follows the engine. It is a pane like the editor or the
chains graph, and it exists only in a project that declares it — an `arrangement` or `video`
project does; a `mix` project opens on its desk instead, and a `live` project has no timeline at all.

Press `2` (or type `ui timeline`) to bring it to the front.

Everything you do on the timeline is a command. A drag, a key or a right-click entry produces the
same line you could have typed in the command bar, and that line is what changes your song's files.
That is why every edit here can be undone with Ctrl+Z, and why every gesture has a typed
equivalent, listed beside it on these pages.

## What is on screen

| Part | What it shows |
|---|---|
| Tool strip | A narrow column on the left: the five tools (arrow, blade, eraser, mute, crossfade), then three view toggles — ruler unit, expanded lanes, automation rows. |
| Corner button | **+ lane**, above the track names. It runs `track new`. In a project with a picture frame it opens a small menu: **audio lane** or **video lane**. |
| Ruler | Bar numbers (or minutes and seconds), markers, task flags and the loop band. |
| Name column | One header per lane: icon, name, live meter and the **M** / **S** / **A** buttons. It stays put while the lanes scroll under it. |
| Lanes | The events, drawn by start and length, with fades, loop marks and badges. |
| Playhead | A thin white line, driven by the engine's transport. |
| Minimap | A thin overview of the whole song under the panes, one row per lane. |

The transport sits in the header: play/pause, stop, a running clock and the record button, with the
song's tempo and time signature and the metronome on the right.

## Reading the ruler: bars or seconds

The ruler counts in **bars** by default: `5` is bar 5, `5.3` is its third beat. Click the clock
button at the foot of the tool strip (or type `ui ruler`) to read it in **seconds** instead
(`1:30`, `1:30.5`). In a song with a picture, the finest second ticks fall on frames and are
labelled `12f`.

The unit changes only what you read and what drags snap to; your song is always placed in beats.
The ladder of ticks thins out or fills in as you zoom, so numbers never overlap.

## Moving around

### Zoom and pan

| Gesture | Effect |
|---|---|
| Mouse wheel over the lanes | Zoom in or out, keeping what is under the pointer in place. |
| Ctrl/Cmd + wheel, or a trackpad pinch | Zoom the same way. |
| Two-finger slide on a trackpad | Pan (the browser's own scroll). |
| Shift + wheel | Never zooms — scrolls instead. |
| Two-finger pinch on a touchscreen | Zoom. |
| Middle-button drag | Pan in any direction. |
| Drag **up or down** on the ruler | Zoom continuously, anchored where you pressed. |

At rest the whole song fits the pane width. Zooming in makes the lanes wider than the pane so you
can pan along them.

### The zoom stack

There is a second, keyboard-driven way to zoom: frame a region and make it the whole view.

1. Draw a selection rectangle (see below).
2. Press `z` (`ui zoom`). The rectangle's beats **and** its lanes become the view.
3. Press `z` again on a new rectangle to zoom further; each level is remembered.
4. `Shift+Z` (`ui zoom out`) goes back one level, `0` (`ui zoom reset`) back to the whole song.

While zoomed, the status line says so — `zoom 2: bars 9–16, 4 rows (shift+z out · 0 reset)` — so
you never forget you are looking at part of the song.

### The minimap

Click or drag across the minimap to move the playhead anywhere in the song. It always maps the
whole song to its width, outlines the clip or lane open in the editor, and marks the caret.

## The caret

The timeline has a **caret** — a highlighted cell, one beat wide, on one lane. It is independent of
the playhead: playback never moves it, and only you do.

| Key | Moves the caret |
|---|---|
| `h` or ← | One beat left. Past the first beat it selects the lane's **name** instead of a beat. |
| `l` or → | One beat right. |
| `k` or ↑ | One lane up. |
| `j` or ↓ | One lane down. |
| `t` | Not a move: sends the **playhead** to the caret (`transport locate`). |

When the caret is on a lane's name, up and down walk every row (group headers, automation rows,
picture lanes); when it is on a beat, they skip to rows that can hold events.

Clicking on a bare part of a lane puts the caret there. The status line always tells you where it
is — `caret: bass, beat 17` or `selected: track bass`.

Many keys act on **what the caret is on**:

| Key | On a lane | On an event |
|---|---|---|
| `m` | mute the lane (`track mute`) | pick the event up to move it: `h`/← and `l`/→ then nudge it one beat, Enter writes, Esc cancels |
| `s` | solo the lane (`track solo`) | — |
| `r` | arm the lane for recording, as its **A** button (`rec`) | — |
| `e` | — | open the event's file in the editor |
| `c` / Ctrl+C | — | copy the event |
| Backspace | — | remove the event |
| Ctrl+B | cut the event under the **playhead** on this lane | |

## Selecting a region

A selection is a rectangle of lanes × beats.

- **Keyboard**: press `v` (`ui select`). The rectangle starts at the caret; `hjkl` or the arrows now
  grow it. Press `v` again or Esc to drop it — the caret lands where the rectangle ended.
- **Shift + click** on a lane: the rectangle grows from the caret (or the current rectangle's anchor)
  to the cell you clicked. Keep the button down and drag to sweep it across lanes.
- **Drag sideways on the ruler**: selects that span of beats across every lane.
- **Click once on an event**: the event becomes the selection — the rectangle covers exactly it.

While a rectangle is drawn the status line reads
`selection: 8 beats × 3 rows — z zooms in · v cancels`.

What you can do with a selection:

| Key / command | Effect |
|---|---|
| `z` | Zoom to it. |
| `Shift+L` (`transport loop`) | Make it the loop region. |
| `c` or Ctrl+C (`selection copy`) | Copy every event that **starts** inside it. |
| Backspace (`selection delete`) | Remove every event that starts inside it, in one undoable step. |
| Right-click an event inside it | Offers the range commands (`selection consolidate`, `events move`) with the range filled in. |

Picking a tool other than the arrow drops the selection.

## The loop region

`Shift+L` turns the current selection into the transport's loop: an amber band appears in the
ruler, and the engine wraps playback inside it. With no selection, `Shift+L` clears the loop. You
can do the same from a right-click on the ruler: **Loop selection** or **Clear loop**.

The loop belongs to the engine's session, not to the song file. A page reloaded while a loop is
playing shows the loop the engine is holding.

## Markers

Markers name positions in the song (a chorus, a drop). They are drawn as a blue diamond in the ruler
and a blue line down every lane; hover the diamond to read the name.

- **Add**: right-click the ruler where you want it and choose **marker new**; type the name and
  press Enter. The position is snapped to the nearest drawn tick.
- **Delete**: right-click the diamond, **marker delete**.

Typed:

```text
project marker new 17:1 Chorus 2
project marker delete Chorus 2
```

Markers are kept in the project file and move with `project add` / `project remove` (below).

## Task flags

A task from the workspace's task list that is pinned to a position in this song shows as a small
checklist flag at the foot of the ruler — amber while open, grey once done. Hover it to read the
task. Clicking it simply seeks there, like any click on the ruler. Pin one with `task mark`:

```text
task mark 49:1 fix the snare
```

## Inserting and removing time

Two commands push or pull **everything** after a point: every lane's events and takes, markers,
drawn automation points and picture lanes. Fades and windows are lengths, so they are untouched.

```text
project add 17:1 2:0       # insert two bars at bar 17
project remove 17:1 1:0    # remove one bar at bar 17
```

The first number is a **position**, the second a **length** (`1:0` is one bar, `0:1` one beat).
Right-click the ruler and choose **add** or **remove**, and the position is filled in from the
caret; you type only the length. An event already playing across the point stays where it is;
`project remove` deletes events that start inside the removed span.

## Clicking the ruler

| Gesture on the ruler | Effect |
|---|---|
| Click | Move the playhead there, snapped to the nearest drawn tick. Also drops any selection. |
| Drag sideways | Select that span across all lanes. |
| Drag up/down | Zoom. |
| Right-click | Menu: add a marker, insert/remove time, loop or clear the loop. |
| Ctrl+click (macOS) | The right-click menu, not a seek. |

When the command bar is waiting for a timecode, a click on the ruler **answers** it instead of
moving the playhead.

## Playhead keys

| Key | Command | Effect |
|---|---|---|
| Space | `transport toggle` | Play / stop. |
| Shift+Space | `transport replay` | Back to where playback last started, and play again. |
| Enter | `transport rewind` | Back to the start. |
| `t` | `transport locate` | Playhead to the caret. |
| `,` / `.` | `transport step prev` / `next` | One drawn tick back / forward (a frame, zoomed in on a picture). |
| `Shift+R` | `transport record` | Toggle the global record enable. |

Pressing Stop twice within a short moment sends a **panic**: every plugin lets go of its notes and
resets, which also kills a stuck tail (`transport panic`).

## View toggles

| Button (tool strip) | Command | Effect |
|---|---|---|
| Clock | `ui ruler` | Bars ⇄ seconds. |
| Tall lanes | `ui lanes` | Expanded lanes draw each clip's waveform or notes inside it. On by default; folded while a bottom panel is open. |
| Curve | `ui automation` | Show or hide the automation rows under each lane. Only shown when some lane has automation. |

None of these touches the song; they are views of it.

## Other timelines

The song's own timeline is **Main**. Once the project has another one, a bar of tabs above the
lanes names them, Main first; until then there is no bar. Clicking a tab — or double-clicking a
timeline's event on a lane — shows that timeline's lanes in Main's place, edited exactly like
Main's.

**Opening a timeline is listening to it**: play runs it alone from its start, through the lane it
is first placed on, and the playhead follows it. Back on Main, play is the whole song again.

A timeline can hold **video lanes** too. Wherever the timeline is placed, their shots appear on
Main's video lane of the same name, from the moment it starts. Main shows them dashed; double-click
one to open its timeline and edit it there.

| Command | What it does |
|---|---|
| `timeline new [name] [length]` | Make a timeline, four bars long unless you say. |
| `selection timeline [name]` | Turn the selected range of ONE lane into a timeline, placed back where it was. |
| `timeline rename <timeline> <name>` | Rename it, and every event placing it — also on a tab's right-click. |
| `timeline length <timeline> <duration>` | Change what every placement of it plays. |
| `timeline lane new` / `timeline lane remove` | Add or remove one of its lanes. |
| `timeline lane copy <lane> <timeline\|main>` | Copy a lane's events onto another timeline, or into Main — a video lane's shots too, also from its right-click. |
| `picture lane new <timeline>><lane>` | Give a timeline a video lane of its own. |
| `timeline play [timeline]` | Hear one alone; bare, the song again. |

To put a timeline on a lane, **drag its tab onto the lane**: it lands where you drop it, snapped to
the grid. `event add gtr verse 9:1` does the same from the command bar.

The `event` commands reach a timeline's lane as `<timeline>><lane>`: `event add verse>drums kick 3:1`.
How a timeline is written is in [Clips, sequences and curves](./33-material.md#timelines); exporting
one alone, in [Exporting the mix](./27-export-import.md).

## When the song cannot be edited

A song opened from a share link is read-only: the timeline still plays, scrolls and zooms, and you
can mute and solo for yourself, but the edge handles, fade handles, drags, tools and the corner
button are gone.

## See also

- [Tracks and lanes](./21-tracks.md)
- [Events and clips](./22-clips.md)
- [Keys and commands for arranging](./29-arranging-reference.md)
