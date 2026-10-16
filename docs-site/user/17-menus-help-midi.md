# Context menus, help and MIDI learn

## Right-click menus

Right-click almost anything in the timeline or the chains graph to see what you can do with it. Every entry is a **command**, built from what you clicked:

- An entry the click already answers completely (for example *mute* on a track) **runs at once**.
- An entry that still needs something (for example *rename*, which needs the new name) is **pre-written in the command bar**, with the keyboard on the missing field.

Because the menu is built from the command list, every command whose first arguments are "the thing you clicked" appears on it. Right-clicking a track offers the `track …` commands, and also commands like `event add` that take a track first.

What you can right-click:

| Thing | Typical entries |
|---|---|
| A track's lane or header | mute, solo, highlight, arm, rename, duplicate, order, input, hide, delete, automation, process, group (over the lanes you shift-clicked) |
| A group | mute, solo |
| A node on the graph | bypass, delete, replace, unlink, alternatives, presets, engine, freeze, external window, fork or own the module, clone, MIDI learn; *Download model* when its model is missing |
| A control on a node | set it, automate it, bind or learn a MIDI control, stop the automation |
| An event (a placed clip) | move, resize, split, fades, gain, loop, window, trim, mute, warp, comp, process, remove, consolidate the selection |
| The ruler | add a marker at that point, insert or remove time, loop or clear the loop |
| A marker | delete it |
| A curve's automation row or card | add, move or remove a point |
| A box (assembly) | delete or dissolve it |
| A stretch point in the warp view | remove it |
| A shot on a picture lane | move, length, head, delete |
| A pad in the step sequencer | repeat, skip |
| A note in the piano roll | split, remove, and the region commands |
| A rack tap | note, sample, rename, mute, route, its chain, remove |

When the entries act on different things, the menu has **tabs**, one per kind of thing, with the interface's own (`ui`) tab last. `←` and `→` switch tabs; `Esc`, a click outside, or scrolling closes the menu.

Hovering an entry shows what it does on the status line.

A few entries delete more than one undo step can reliably bring back, such as deleting a track with its whole chain. Those ask for confirmation, showing the exact line they will run.

You choose which menus offer which commands, how entries are named and in which order, on the Commands settings page (see [Settings](./16-settings.md)).

## The help page

Press `?` (or type `ui help`) to open the help page, also reachable at the project's address followed by `/docs` (or `/help`). It is one long document with a table of contents, so `Ctrl+F` finds anything in it:

- **Commands**: how commands and keys work, then the **command reference**, generated from the running app: every command with its description, and the key bound to it (your own keys, if you changed them).
- **Syntax**: the song's file format, file by file.
- **Technical**: how k7 is built.

`Esc` or the back button returns to the editor.

## MIDI learn: playing parameters from a controller

You can drive any control of a module from a hardware MIDI controller plugged into **the computer your browser runs on** (which need not be the engine's machine). It uses the browser's Web MIDI; your browser asks for permission the first time.

To bind a control:

1. Right-click the control on the graph and choose MIDI learn, or type `ui midi learn <module> <param>` (e.g. `ui midi learn synth "Filter Freq"`).
2. The status line says "move a control, or press Esc or run any command to cancel". Move a knob or fader.
3. k7 writes the binding with `module cc` and tells you which device, channel and CC it learned.

To give up instead, press `Esc` or run any other command: the learn is cancelled, nothing is written, and the status line says "MIDI learn cancelled".

If the controller also has a MIDI output, the binding is **bidirectional**: the controller follows the value when it changes in k7 (motorised faders, LED rings). Otherwise it is write only, and the status line says so.

You can also bind by hand: `module cc synth Cutoff 1 74` (channel 1–16, CC 0–127), and unbind with `module cc synth Cutoff none 0`. Bindings are saved in the module's files, so they travel with the project.

A binding is ignored, and reported, when the parameter has no control on the module's panel (there is no range to sweep) or when the module is not running in the engine.

If the browser has no Web MIDI or refuses access, `ui midi learn` says so and nothing changes.
