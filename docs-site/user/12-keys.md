# Keyboard shortcuts

Every shortcut in k7 **runs a command**, the same line you could type in the command bar. A key and its command can therefore never disagree, and you can rebind the simple ones (see [Settings](./16-settings.md)). The tooltips of buttons show the key currently bound to them.

Moving a caret or growing a selection is not a command: those keys belong to the view that has the caret, and are listed at the end of this page.

## When keys are listened to

- While you type in a text field (the command bar, a rename box, the editor), every key goes to the field.
- While a button, link or dropdown has the focus, only the transport keys and `Esc` reach k7; `Enter` stays the button's.
- The Commands settings page and the module builder take the keyboard for themselves while they are open.
- `Ctrl` is `⌘` on a Mac for the chords below. Other chords (`Ctrl+1`, `Alt+…`) are left to the browser.

## Opening the command bar

| Key | Does |
|---|---|
| `Shift` `Shift` (twice within 0.4 s) | Puts the keyboard in the command bar |

## Global keys

| Key | Command | Notes |
|---|---|---|
| `?` | `ui help` | Opens the help page |
| `1` | `ui editor` | Editor page |
| `2` | `ui timeline` | Timeline page |
| `3` | `ui chains` | Chains page |
| `4` | `ui turntables` | DJ desk page |
| `f` | `ui <focused pane>` | Puts the focused pane full window |
| `Tab` (or `Shift+Tab`) | `ui focus next` | Next page of the project |
| `Space` | `transport toggle` | Play / pause, wherever you are except in a text field |
| `Shift+Space` | `transport replay` | Back to where playback last started, and play again |
| `Enter` | `transport rewind` | Back to the start |
| `t` | `transport locate` | Playhead to the caret |
| `,` | `transport step prev` | Playhead one grid step back (one frame when zoomed in on a picture) |
| `.` | `transport step next` | Playhead one grid step forward |
| `Shift+R` | `transport record` | Global record on or off |
| `Shift+L` | `transport loop` | Loop the selection, or clear the loop |
| `Ctrl+C`, `c` | `selection copy` | Copy the selected events or notes (or what the caret is on). `Ctrl+C` with text selected on the page is the browser's own copy |
| `Ctrl+V`, `p` | `selection paste` | Paste at the caret |
| `Ctrl+B` | `selection split` | Split the clip under the playhead, on the caret's lane |
| `Ctrl+Z` | `project undo` | In the editor, undoes your typing first, then the project |
| `Ctrl+Y`, `Ctrl+Shift+Z` | `project redo` | Same rule |

## `Esc`

`Esc` backs out one layer at a time, in this order: the overlay in front (`ui popin close`), the event in the bottom panel (`ui slot close`), the piano roll's mode (`ui roll select`), the waveform's view (`ui wave standard`), the timeline tool (`ui tool pointer`), a page other than the home page (`ui global`), and finally the bottom panel (`ui close`).

## Keys that depend on where the caret is

| Key | When | Command |
|---|---|---|
| `m` | a clip is under the caret | `event move` (pick the clip up, then nudge it) |
| `m` | on a track | `track mute <track>` |
| `m` | on a picture lane | `picture mute <lane>` |
| `s` | on a track | `track solo <track>` |
| `s` | on a picture lane | `picture solo <lane>` |
| `r` | on a track | `transport arm <track>` (record arm) |
| `r` | on a picture lane | `ui picture arm <lane>` |
| `e` | a MIDI clip or sequence is under the caret | `ui edit sequence <name>` |
| `e` | an audio clip is under the caret | `ui edit clip <name>` |

## Timeline keys

These act only while the timeline is the page in front.

| Key | When | Command |
|---|---|---|
| `v` | always | `ui select` — caret ⇄ selection rectangle |
| `z` | a selection exists | `ui zoom` — frame the selection |
| `Shift+Z` | zoomed in | `ui zoom out` |
| `0` | zoomed in | `ui zoom reset` — the whole song |
| `a` | | `ui tool pointer` |
| `b` | | `ui tool cut` (the blade) |
| `d` | | `ui tool erase` |
| `x` | | `ui tool crossfade` |
| `+` | | `track new` |
| `Backspace` | | `selection delete` — the rectangle, or what the caret is on |

The `mute` tool has no key; use `ui tool mute`.

## Clip editor keys

These act while a clip is open in the bottom panel.

| Key | When | Command |
|---|---|---|
| `Backspace`, `x` | a clip's grid is open | `selection delete` |
| `a` | piano roll open | `ui roll select` |
| `n` | piano roll open | `ui roll create` |
| `d` | piano roll open | `ui roll remove` |
| `a` | audio waveform open | `ui wave standard` |
| `o` | audio waveform open | `ui wave onsets` |
| `w` | audio waveform open | `ui wave warp` |

When two views could take the same letter, the one in front wins: the piano roll, then the waveform, then the timeline.

## Keys owned by a view

| Where | Key | Does |
|---|---|---|
| Timeline | `h` `j` `k` `l` or arrows | Move the caret (left, down, up, right). Left of the first beat selects the lane's label |
| Timeline, selecting | same keys | Grow or shrink the rectangle |
| Timeline, selecting | `Esc` | Drop the rectangle; the caret lands where it ended |
| Timeline, moving a clip (`m`) | `←` or `j` / `→` or `m` | Nudge the clip one step left / right |
| Timeline, moving a clip | `Enter` | Commit the move |
| Timeline, moving a clip | `Esc` | Cancel the move |
| Clip grid (roll, tracker) | `h` `j` `k` `l` or arrows, `v`, `Esc` | Same caret and rectangle as the timeline |
| Editor | `Ctrl+S`, `:w` (vim) | Save now (see [The text editor](./15-text-editor.md)) |
| Editor | `Ctrl`-click on a name | Open the file that name refers to |
| Right-click menu | `←` / `→` | Switch tab |
| Right-click menu | `Esc` | Close |
| Command bar | see [The command bar](./11-command-bar.md) | |
| Help page | `Esc` | Back to the editor |
| Settings panel | `Esc` | Close |

## Changing a key

In the Commands settings page (`ui settings commands`) you can give any command a key, take its default key away, or move a key to another command. Only plain one-key shortcuts can be changed this way; the keys that depend on where the caret is (`m`, `s`, `r`, `e`, `Esc`, the tool and mode letters…) stay as listed above. A key you give to a command is taken from the command that had it. Your keys are saved with your account and work in every browser you use, including a second device driving a surface.
