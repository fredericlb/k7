# Command reference: graph, picture, system and the interface

The second half of the command list. The [first half](./13-command-reference-song.md) covers tracks, sequences, curves, the project, tasks, the transport and events, and explains the notation.

## Nodes

A **node** is one use of a module in the project's graph.

| Command | Arguments | What it does |
|---|---|---|
| `node new` | `<category/name> [node-name] [extends-ref] [at]` | Creates a node of a module and puts it in the graph, wired to nothing. Named `<module>_<n>` unless you name it. With `extends-ref`, a module picked from a catalogue gets its folder created first. `at` is a position `x,y` on the graph (filled in by a click). |
| `node delete` | `<node>` | Deletes a node: its file, its preset and its place in the graph. |
| `node replace` | `<node> <extends-ref>` | Points a node at another module, keeping its place (and its name, unless the name was made automatically). |
| `node insert` | `<before> <after> <node> [at]` | Splices a node into the cable between two nodes. |
| `node stack` | `<node> <new>` | Puts a node just made right under another, the two in one subchain. |
| `node bypass` | `<node> [state]` | Bypasses a node so it passes sound untouched; `on`, `off`, or bare to toggle. |
| `node param` | `<node> <param> <value>` | Sets one control: a plugin parameter (quoted if it has spaces), `@channel`, `@monitor`, `@gain`, or a file the module carries (`nam`, `onnx`; `none` clears it). |
| `node automate` | `<module> <param> <curve> [trigger]` | Drives a parameter with a curve; `none` takes the binding off. For an envelope, `trigger` names the module whose note-ons restart it. |
| `node freeze` | `<node>` | Bakes the node and everything upstream into one render; again to unfreeze. |
| `node engine` | `<node> [name]` | Runs a node as another of its module's engines; without a name, lists them. |
| `node alternative create` | `<node> [name]` | Adds an empty alternative and switches to it. |
| `node alternative copy` | `<node> [name]` | Adds an alternative holding a copy of the current one, and switches to it. |
| `node alternative select` | `<node> [name]` | Switches to another alternative. |
| `node preset apply` | `<node> [scope] [name]` | Loads a preset's values (`workspace` or a library's name as scope); without a preset, lists them. |
| `node preset save` | `<node> <name> [scope]` | Saves the node's values as a new preset (scope defaults to `workspace`). |
| `node preset update` | `<node> <scope> <name>` | Overwrites an existing preset with the node's values. |
| `node external-ui` | `<module>` | Opens an external plugin's own window. |
| `node record save` | `<file> <name>` | Sends a recorder node's take to the media library's recordings. |
| `node tap note` | `<node> <symbol> <note>` | Sets the MIDI note a rack tap fires on (0–127; 36 is a GM kick). |
| `node tap sample` | `<node> <symbol> <sample>` | Sets the library sample a tap plays (`@<library>/<path>`), or `none`. |
| `node tap add` | `<node> [symbol]` | Adds a tap on the note after the highest; named `T<n>` without a name. |
| `node tap at` | `<node> <note> [symbol]` | Adds a tap on a given free note. |
| `node tap insert` | `<node> <side> <tap> [symbol]` | Adds a tap `before` or `after` another, on the nearest free note. |
| `node tap rename` | `<node> <symbol> <name>` | Renames a tap. |
| `node tap mute` | `<node> <symbol> [state]` | Mutes or unmutes a tap; toggles without `on`/`off`. |
| `node tap out` | `<node> <symbol> <subchain>` | Routes a tap to a subchain on its own output; `none` brings it back. |
| `node tap chain add` | `<node> <symbol> <module>` | Adds a module at the end of a tap's own chain. |
| `node tap chain remove` | `<node> <symbol> <id>` | Removes one node of a tap's chain; removing the last sends the tap back to the main output. |
| `node tap chain move` | `<node> <symbol> <id> <way>` | Moves a node of a tap's chain `up` or `down`. |
| `node tap remove` | `<node> <symbol>` | Removes a tap. |

## Modules

| Command | Arguments | What it does |
|---|---|---|
| `module new` | `<category/name> [extends-ref]` | Creates a module, and only that (follow it with `node new` to use it). `extends-ref` inherits a plugin or library module. |
| `module clone` | `<category/name> <newName>` | Clones a module folder in the same category. |
| `module fork` | `<ref>` | Makes a library module yours: `@account/…` extends it, and this project plays the fork. |
| `module own` | `<ref>` | Gives an engine plugin (`@engine/…`) a folder in this project, so it can carry a panel and presets. |
| `module cc` | `<module> <param> <channel> <cc>` | Binds a MIDI controller to a parameter (channel 1–16, CC 0–127); `none` as the channel unbinds. |
| `module create rack` | | Opens the rack builder: a pad grid that becomes a samples rack. |

## The graph and assemblies

| Command | Arguments | What it does |
|---|---|---|
| `graph chain connect` | `<from> <to>` | Draws a cable from one node to another (`name#port` for a specific port). |
| `graph chain disconnect` | `<from> <to>` | Removes one cable. |
| `graph chain replug` | `<from> <to> <newFrom> <newTo>` | Moves one end of a cable. |
| `graph unlink` | `<node>` | Takes a node out of its chain, joining what fed it to what it fed. |
| `graph move` | `<node> <x> [y]` | Pins a node's place on the graph; `auto` hands it back to the layout. |
| `graph organize` | | Clears every pinned position and lays out the whole graph again. |
| `graph pin` | `<positions>` | Records the layout's own positions (JSON). Sent by the graph view. |
| `assembly new` | `<ref> <name>` | Puts a templated box of nodes from the library in the graph, wiring included. |
| `assembly delete` | `<name>` | Deletes a box and every node it holds. |
| `assembly dissolve` | `<name>` | Stops drawing a box, keeping its nodes. |

## Pictures (video lanes)

Positions on a picture lane are in **seconds** (or `m:ss`). A shot is addressed by its lane and where it starts.

| Command | Arguments | What it does |
|---|---|---|
| `picture lane new` | `[name]` | Adds a picture lane, named `layer-N` if you don't say. |
| `picture lane order` | `<lane> <position>` | Reorders a lane; 1 draws first, under the rest. |
| `picture mute` | `<lane>` | Hides or shows a lane. |
| `picture solo` | `<lane>` | Solos a lane; soloed lanes hide the rest of the picture. |
| `picture rect` | `<lane> <x> <y> <w> <h>` | Where a lane draws in the frame, in pixels. |
| `picture add` | `<lane> <ref> <at> [length] [sourceFrom]` | Places a clip on a lane. |
| `picture move` | `<lane> <at> <to>` | Moves a shot along its lane. |
| `picture length` | `<lane> <at> <seconds>` | How long a shot lasts; 0 runs to the end of its source. |
| `picture head` | `<lane> <at> <to>` | Trims a shot's head, holding its tail. |
| `picture split` | `<lane> <at> <where>` | Splits a shot in two. |
| `picture delete` | `<lane> <at>` | Removes a shot; the clip it names stays. |
| `picture key` | `<lane> <at> <prop> <when> <value> [ease]` | Sets a keyframe on `x`, `y`, `scale`, `opacity` or `rotate`; ease `linear`, `in`, `out`, `inout` or `hold`. |
| `picture unkey` | `<lane> <at> <prop> <when>` | Removes a keyframe. |
| `picture speed` | `<lane> <at> <factor>` | Retimes a shot: `2` double speed, `0.5` slow motion, `0` a freeze, `-1` backwards, `1` its own pace. |
| `picture sound` | `<lane> [track]` | Plays a picture lane's sound on an audio lane (`<lane>-sound` by default), extracting what is missing. |
| `picture prepare` | `<lane>` | Makes each shot's video playable: an optimized copy for codecs a browser cannot decode, a proxy for footage above 1080p. |
| `picture interchange` | `<format> [lane]` | Writes the picture's cut for another editor: `otio` carries every lane, `edl` one (the bottom lane unless named). |
| `picture import` | `<file> [prefix]` | Reads an `.otio` or `.edl` file of the project into new picture lanes (`import-1`, `import-2`… unless a prefix is given). Media are found by path, then by name in `clips/`. |
| `picture render` | `[format] [sound] [settings]` | Renders the picture on the server in the background, into `exports/`, with no browser left open: `webm` or `mp4`, sound `wav` or `none`, settings such as `size=720p quality=high from=0:10 to=0:40`. |

## Playlists and libraries

| Command | Arguments | What it does |
|---|---|---|
| `playlist new` | `<name>` | Creates an empty set list in the workspace's `_playlists/` (subfolders allowed). |
| `playlist song add` | `<playlist> <song> [variant]` | Appends a song; quote the song to name a variant after it. |
| `playlist song remove` | `<playlist> <position>` | Removes a line by its number. |
| `playlist song move` | `<playlist> <from> <to>` | Reorders a line. |
| `playlist stems` | `<playlist> [chain]` | Separates every song of a set list into stems, skipping songs already done. |
| `library versions` | | Shows each library's pinned version, the versions this machine holds, and whether a newer one is ready. |
| `library upgrade` | `<library> [version]` | Moves the workspace to another library version (`draft`, a number, or the newest this k7 runs). |

## The system (this machine)

| Command | Arguments | What it does |
|---|---|---|
| `system plugins list` | `[format]` | Lists every cached plugin, optionally of one format (`vst`, `vst3`, `au`…). |
| `system plugins scan` | | Scans the installed plugins again. |
| `system channel list` | | Shows the input and output channel labels. |
| `system channel set` | `<dir> <chans> <label>` | Labels channels (`in` or `out`, `3` or a pair `3+4`). |
| `system channel clear` | `<dir> <chans>` | Removes a channel label. |
| `system channel type` | `<channel> <mode>` | Makes an input pair `stereo` or `mono`; either half names the pair. |
| `system stems` | `<chain>` | Sets the chain this machine separates a record into stems with; empty clears it. |
| `system instrumental` | `<chain>` | Sets the chain that makes an instrumental; empty clears it. |
| `system onnx` | `<providers>` | Sets the execution providers separation runs on, in order (`cpu`, `dml`, `cuda`, `coreml`); empty goes back to `cpu`. |
| `system cue` | `<channels>` | Sets the output pair the headphone cue leaves by (`3+4` or a label); empty clears it. |

## The interface (`ui`)

These only change what you see; they never edit the song.

| Command | Arguments | What it does |
|---|---|---|
| `ui global` | | Back to the project's home page. |
| `ui editor`, `ui timeline`, `ui chains`, `ui turntables`, `ui mastering` | | Puts that pane full window. |
| `ui viewport` | | Shows or hides the picture window. |
| `ui focus next` | | Next page. |
| `ui close` | | Closes the bottom panel. |
| `ui popin close` | | Closes the overlay in front. |
| `ui slot close` | | Lets the open event go and closes its panel. |
| `ui panel` | `<panel>` | Toggles a bottom panel: `event`, `graph`, `mix`, `logs`. |
| `ui mixer` | | Toggles the mix panel. |
| `ui stack` | | The graph as one column per track, the mix last. |
| `ui notes` | | Shows or hides the project's notes on the graph. |
| `ui logs clear` | | Empties the log panel. |
| `ui file` | `<path>` | Opens a file of the project in the editor, by path or fuzzy name. |
| `ui edit sequence` | `<name>` | Opens a sequence's file in the editor. |
| `ui edit clip` | `<name>` | Opens an audio clip's file in the editor. |
| `ui review` | `<clip>` | Reopens the take review on a clip. |
| `ui select` | | Caret ⇄ selection rectangle. |
| `ui zoom`, `ui zoom out`, `ui zoom reset` | | Frames the selection, zooms back one step, shows the whole song. |
| `ui tool` | `<tool>` | What a press does on the timeline: `pointer`, `cut`, `erase`, `mute`, `crossfade`. |
| `ui wave` | `<view>` | The audio waveform's view: `standard`, `onsets`, `warp`, `takes`. |
| `ui roll` | `<mode>` | The piano roll's mode: `select`, `create`, `remove`, `takes`. |
| `ui ruler` | | Reads the timeline ruler in bars or in seconds. |
| `ui lanes` | | Tall lanes showing each clip's waveform or notes. |
| `ui automation` | | Shows or hides the automation rows. |
| `ui curves` | | Shows or hides the curve cards in the per-track graph view. |
| `ui curve` | `[curve]` | Opens the curve editor on a new curve, or on the one named. |
| `ui automate` | `<node> <param>` | Opens the curve editor on the curve a control follows, or a new one bound to it. |
| `ui builder` | `<module>` | Opens a module in the module builder. |
| `ui assembly` | `<ref>` | Opens an assembly template in the builder. |
| `ui chains builder` | | Opens or closes the library's chains builder. |
| `ui tap chain` | `<node> <tap>` | Edits a rack tap's own chain of effects. |
| `ui model` | `<node>` | Downloads the model a node's module names, onto this machine. |
| `ui midi learn` | `<module> <param>` | Learns a MIDI control for a parameter (see [Context menus, help and MIDI learn](./17-menus-help-midi.md)). |
| `ui picture arm` | `[lane]` | Arms a picture lane to record its camera; bare, disarms. |
| `ui external` | `<surface>` | Copies the link that opens one surface on another device. |
| `ui surface` | `<surface>` | Only says that surfaces are panes, opened with their own `ui` command. |
| `ui settings` | | Opens or closes the settings panel. |
| `ui settings editor`, `ui settings io`, `ui settings project`, `ui settings account` | | Opens the settings panel on that tab. |
| `ui settings commands` | | Opens the Commands page. |
| `ui playlists`, `ui references`, `ui tasks`, `ui history`, `ui share` | | Opens or closes that side panel. |
| `ui vim` | | Turns the editor's vim mode on or off. |
| `ui language` | `<language>` | Changes the interface language: `en` or `fr`. |
| `ui engine` | | Back to the engine picker. |
| `ui workspace quit` | | Leaves this workspace. |
| `ui logout` | | Signs out. |
| `ui help` | | Shows the help page. |
| `ui pin` | `<path>` | Pins a file to the top of the file tree, or unpins it. |
| `ui copy path` | `<path>` | Copies a file's path to the clipboard. |

## Files (the file tree)

These are the file tree's right-click actions as commands.

| Command | Arguments | What it does |
|---|---|---|
| `fs file new` | `<folder> <name>` | Creates an empty file. |
| `fs folder new` | `<folder> <name>` | Creates a folder. |
| `fs file rename` | `<path> <name>` | Renames a file or folder in place. |
| `fs file move` | `<path> <folder>` | Moves a file into another folder (what dragging a row does). |
| `fs file delete` | `<path>` | Sends a file to the workspace's recycle bin, after a confirmation. |
| `fs file upload` | `<folder> [what]` | Opens the system file picker to upload `files` (default) or a whole `folder`. |
