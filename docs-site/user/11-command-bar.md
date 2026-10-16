# The command bar

Everything you can do in k7 is a **command**: a line of words such as `track mute gtr` or `event fadein vox 24:1 0:1`. Every button, menu entry and key in the editor runs one of these lines, and you can type any of them yourself. The command bar is where you do that.

## Opening it

On a computer the command bar is always docked at the bottom of the window, under the footer. To put the keyboard in it:

- press **Shift twice quickly** (within 0.4 s), or
- click it.

On a phone, open the menu and pick **Commands**: the bar appears as a popin and goes away when it loses the keyboard.

## Finding a command

Type what you want done **in your own words**. The bar lists matching commands as sentences ("Mute or unmute a track"), with the command's name at the right. Matching is fuzzy and works on both the sentence and the name, so "mute a track", "mute" and "trmu" all find `track mute`.

- Nothing is listed until you type a character.
- Commands you used lately are nudged up the list. This history is kept in this browser (the last twelve).
- The list opens upwards: the best match is just above the input. `↑` walks up the list, `↓` back down.
- `Enter` or `Tab` picks the highlighted command.
- `Esc` clears the bar and gives the keyboard back.

If nothing matches, `Enter` runs the line exactly as you typed it. This is how you run a full line with its arguments already written, for example `track new gtr`.

The sentences follow your interface language (English or French). The command names themselves are always English.

## Filling in the arguments

When the command you pick needs arguments, the bar turns into a **form** on the same row: the command's name, then one field per argument, each coloured by the kind of thing it asks for (a track, a module, a file, a marker, a choice, a timecode, a number, a note, free text). Beside the field, a hint says what it accepts, for example "1-based, counting lanes from the top" or "bar:beat:sixteenth — 5, 5:1, 5:1:1".

While k7 waits for an argument, the bar turns orange with a blue glow.

| Key | In the form |
|---|---|
| typing | filters the field's suggestions (fuzzy) |
| `↑` / `↓` | moves through the suggestions |
| `Tab` | takes the highlighted suggestion, then moves to the next field |
| `Enter` | takes the highlighted suggestion if it changes the field; otherwise runs the command if every required field is filled; otherwise jumps to the first missing field |
| `Esc` | first closes the suggestion list; a second `Esc` abandons the command |

Suggestions come from the open project: its tracks, modules, nodes, curves, sequences, markers, clips, audio files, picture lanes, playlists, libraries, the files of the tree, and so on. A few arguments offer a fixed list (`in` / `out`, `on` / `off`, the five timeline tools…).

Optional arguments (shown as optional in the hint) can be left blank; the command runs without them.

A value with spaces is quoted for you when the line is assembled, for example `node param synth "Filter Freq" 69`.

## Gestures fill the form

While the form waits for an argument, a click elsewhere in the window can answer it. For example, the timeline caret answers some commands on its own:

| Command | Answered by the caret |
|---|---|
| `event split` | the track, the event under the caret, and the cut position |
| `selection consolidate` | the tracks, start and end of the selection rectangle |
| `project add`, `project remove` | the position (`at`) only; you still type the length |

When the caret answers every argument, the command runs at once.

A right-click menu entry that still needs an argument also lands in the bar, pre-written, with the caret on the missing field. See [Context menus, help and MIDI learn](./17-menus-help-midi.md).

## What happens when a command runs

- The line is written to the Logs panel (`› track mute gtr`).
- k7 shows the result on the status line. A **refusal** (the command was understood but declined, for example a track that does not exist) is shown in amber and nothing is changed.
- A command that writes files is one step of the project's undo history: `Ctrl+Z` takes it back.
- A badly shaped argument is caught before anything runs: a timecode must look like `5`, `5:1` or `5:1:1`, a number must be a number, a note must be a name like `C4` or `F#3` or a MIDI number 0–127.

## `ui` commands

Commands that only change what you see (pages, panels, tools, zoom, language…) start with `ui`, for example `ui timeline` or `ui settings io`. They never touch the song and never move the transport. If you type a `ui` command without its `ui` prefix, k7 tells you to add it, and the other way round.

The full list of commands is in the [Command reference](./13-command-reference-song.md) and its [second part](./14-command-reference-graph.md).

## Your own names, icons, keys and order

The **Commands** settings page lets you rename any command, give it an icon, give it a key, choose which right-click menus offer it and reorder how menus list them. See [Settings](./16-settings.md).

## On the home page

The home page (the list of workspaces and projects) has its own small command bar with the commands that make sense there: `project new`, `project copy`, `project rename`, `project delete init` then `project delete confirm`, and `system workspace new`. They are described in the Getting started section.
