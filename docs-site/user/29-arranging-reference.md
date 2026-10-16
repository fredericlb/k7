# Keys and commands for arranging

A quick reference for everything on pages 20 to 28. Every key runs a command you can also type in
the command bar; the keys that depend on what the caret is on say so. You can rebind the simple keys
in **Settings → Commands**.

## Keys on the timeline

| Key | Command | Notes |
|---|---|---|
| `2` | `ui timeline` | Bring the timeline to the front. |
| `h` `j` `k` `l` / arrows | — | Move the caret (or grow the selection). |
| `v` | `ui select` | Start or drop a selection rectangle. |
| `z` | `ui zoom` | Zoom to the selection. |
| `Shift+Z` | `ui zoom out` | One zoom level back. |
| `0` | `ui zoom reset` | The whole song. |
| `Shift+L` | `transport loop` | Selection → loop; no selection → clear the loop. |
| `t` | `transport locate` | Playhead to the caret. |
| `,` / `.` | `transport step prev` / `next` | One drawn tick. |
| Space | `transport toggle` | Play / stop. |
| `Shift+Space` | `transport replay` | Replay from where playback last started. |
| Enter | `transport rewind` | Back to the start. |
| `Shift+R` | `transport record` | Record enable. |
| `m` | `track mute <lane>` / `event move` | On a lane / on an event. |
| `s` | `track solo <lane>` | |
| `r` | `rec <lane>` | The lane's **A** button: MIDI in the browser, audio in the engine. |
| `e` | `ui edit clip|sequence <clip>` | Open the event's file. |
| `+` | `track new` | |
| `c`, Ctrl+C | `selection copy` | |
| `p`, Ctrl+V | `selection paste` | |
| Backspace | `selection delete` | |
| Ctrl+B | `selection split` | Cut at the playhead, on the caret's lane. |
| `a` | `ui tool pointer` | |
| `b` | `ui tool cut` | |
| `d` | `ui tool erase` | |
| `x` | `ui tool crossfade` | |
| Esc | — | Backs out one layer: a popup, the tool, the selection, a fullscreen pane. |
| Ctrl+Z / Ctrl+Y | `project undo` / `project redo` | |

In move mode (`m` on an event): `h`/← and `l`/→ nudge one beat, Enter writes, Esc cancels. `j`/`k` do nothing there: a key move stays on its lane, and a drag is what changes lanes.

## Keys in the clip editors

| Key | Where | Command |
|---|---|---|
| `a` | waveform / roll | `ui wave standard` / `ui roll select` |
| `o` | waveform | `ui wave onsets` |
| `w` | waveform | `ui wave warp` |
| `n` | roll | `ui roll create` |
| `d` | roll | `ui roll remove` |
| `x`, Backspace | roll, sequencer | `selection delete` |
| Esc | waveform / roll | back to standard / select |

## Mouse modifiers

| Modifier | During a drag of an event, an edge or a note |
|---|---|
| none | Snap to the grid the ruler draws. |
| Ctrl / Cmd | Move by whole grid steps, keeping the offset from the grid. |
| Shift | Free, off the grid. |

Fades snap to whole beats; Ctrl/Cmd or Shift frees them. With the crossfade tool, Alt removes the
crossfade. On the timeline, Shift+click on a lane grows the selection; Shift+click on a header picks
lanes for grouping.

## Commands by task

| Task | Commands |
|---|---|
| Lanes | `track new`, `track rename`, `track duplicate [empty]`, `track delete`, `track hide`, `track unhide`, `track order`, `track arrange`, `track group`, `track input` |
| Mix | `track mute`, `track solo`, `track highlight`, `node param <strip> Volume <dB>`, `project master`, `project master fix`, `project console` |
| Events | `event add`, `events add`, `event move`, `events move`, `event resize`, `event remove`, `events remove`, `event split`, `selection consolidate` |
| Event settings | `event fadein`, `event fadeout`, `event crossfade`, `event window`, `event trim`, `event gain`, `event loop`, `event loop points`, `event status mute`, `event status warp`, `event process` |
| Clips | `clip process`, `clip warp`, `clip warp remove`, `clip onset add|remove|move`, `track process` |
| Notes | `sequence new`, `sequence list`, `sequence note new|remove|move|split|velocity|timerange|repeat|skip|add`, `sequence notes remove|transpose|quantize|velocity|move`, `sequence double`, `sequence record`, `sequence edit roll|tracker` |
| Automation | `curve new`, `curve set`, `curve point add|move|remove`, `node automate`, `track automation add|remove`, `ui curve`, `ui automate` |
| Recording | `transport arm`, `transport record`, `transport metronome [volume]`, `event take arm|disarm|remove`, `event comp`, `event comp fade`, `module cc`, `ui midi learn` |
| Time | `project add`, `project remove`, `project marker new`, `project marker delete`, `task mark` |
| Views | `ui ruler`, `ui lanes`, `ui automation`, `ui tool`, `ui wave`, `ui roll`, `ui mixer`, `ui history`, `ui share` |
| Files | `project export audio|video`, `project import` |

## Timecodes

| | Example | Meaning |
|---|---|---|
| Position | `17:3` | Bar 17, beat 3 (counted from 1). |
| Position | `17:3:2` | …its second eighth. |
| Length | `2:0` | Two bars (counted from 0). |
| Length | `0:0:1` | One eighth. |

Event windows (`event window`, `clip warp`, onsets) are in **seconds** into the file; note commands
are in **beats** from the start of the sequence.
