# Command reference: tracks, events and the transport

This is the complete list of commands, in two pages. This page covers the song's time: tracks, sequences and notes, curves, the project, tasks, the transport, events and the selection. The [second page](./14-command-reference-graph.md) covers nodes and modules, the graph, pictures, playlists, libraries, the system, and every `ui` and file command.

Notation: `<arg>` is required, `[arg]` is optional and may be left out (only at the end of a line). A **timecode** is a position written `bar:beat:sixteenth` — `5`, `5:1` and `5:1:1` all work. A **length** is written the same way but means a duration: `1:0` is one bar, `0:1` one beat. A **note** is a name (`C4`, `F#3`) or a MIDI number 0–127. Arguments containing spaces are quoted: `"Filter Freq"`.

The same list, generated from the running app, is on the help page (`?`).

## Tracks

| Command | Arguments | What it does |
|---|---|---|
| `track new` | `[name]` | Adds a track. Its name is its id and its filename; without one it is `track-1`, `track-2`… The track gets its mixer strip. |
| `track group` | `<tracks> [name]` | Makes a group lane over several tracks (comma-joined, e.g. `kick,snare`). The group's mute and solo reach every member. A track already in a group leaves it. Named `group-N` if you don't say. |
| `track arrange` | | Colours every track by its category (vox pink, drums red, basses brown, guitars green, keys blue, synths purple, the rest grey) and orders them that way. One undo step. |
| `track order` | `<track> <position>` | Puts a track at a position, 1 being the top; past the end is the bottom. |
| `track duplicate` | `<track>` | Duplicates a track with its chain and its events. |
| `track duplicate empty` | `<track>` | Duplicates a track with its chain but no events. |
| `track rename` | `<track> <name>` | Renames a track and its file. The whole name, prefix included, is typed (e.g. `track rename ge.lead vo.lead`); references to it follow. |
| `track input` | `<track> <kind>` | Adds an `audio` or `midi` input feeding the track. Refused when it already has one. |
| `track hide` | `<track>` | Sets a track aside: it is not drawn, played or compiled, and its files stay. |
| `track unhide` | `<track>` | Brings back a hidden track. |
| `track delete` | `<track>` | Deletes a track and the chain it starts (input, instrument, effects). The right-click menu asks for confirmation first. |
| `track mute` | `<track>` | Toggles a track's (or group's) mute. |
| `track solo` | `<track>` | Toggles a track's (or group's) solo. Soloed tracks silence the rest; several can be soloed. |
| `track highlight` | `<track>` | Toggles a highlight: the track plays 10 dB louder, its fader untouched. |
| `track automation add` | `<track> <param>` | Draws a curve against one of the track's parameters (e.g. `track automation add gtr Filter Freq`). |
| `track automation remove` | `<track> <param>` | Stops automating a parameter; the curve file stays. |
| `track process` | `<track> <chain>` | Bounces every file the track's clips play through a chain and keeps the result (e.g. `@k7-core/amp-room`). |
| `track transcribe` | `<track_in> <track_out>` | Listens to the video a picture lane places with whisper and writes the transcript as subtitles on the picture lane `track_out` (created if new, its subtitles replaced if not). |

## Sequences and notes

Positions inside a sequence are in **beats** from its start (decimal numbers).

| Command | Arguments | What it does |
|---|---|---|
| `sequence new` | `[name]` | Adds an empty 4-bar sequence. |
| `sequence list` | | Lists the MIDI sequences. |
| `sequence double` | `<sequence>` | Doubles a sequence's length, its notes played twice. |
| `sequence note new` | `<sequence> <note> <start> <end>` | Adds one note (e.g. `sequence note new melody C4 4 6`). |
| `sequence note velocity` | `<sequence> <note> <start> <velocity>` | Sets a note's velocity, 0..1 (1 clears the field). |
| `sequence note repeat` | `<sequence> <note> <start> <n>` | Retriggers a pad `n` times inside its step (2 or more; `off` removes it). |
| `sequence note skip` | `<sequence> <note> <start> <n>` | Silences a pad every `n`th pass (2 plays one pass in two, 4 three in four; `off` removes it). |
| `sequence note timerange` | `<sequence> <note> <start> <newStart> <newEnd>` | Moves a note or changes its length. |
| `sequence note move` | `<sequence> <note> <start> <newNote> <newStart>` | Moves a note to another key or beat, keeping its length and velocity. |
| `sequence note split` | `<sequence> <note> <start> <at>` | Cuts a note in two at a beat inside it. |
| `sequence note remove` | `<sequence> <note> <start>` | Removes one note. |
| `sequence note add` | `<sequence> <notes>` | Appends already-timed notes, as JSON `[{t,d,k,v?}]` in beats. Used by the editors. |
| `sequence notes remove` | `<sequence> <loNote> <hiNote> <from> <to>` | Deletes every note in a region (`to` excluded). |
| `sequence notes transpose` | `<sequence> <loNote> <hiNote> <from> <to> <semitones>` | Transposes the notes in a region. |
| `sequence notes quantize` | `<sequence> <loNote> <hiNote> <from> <to> <grid>` | Snaps note starts in a region to a grid in beats (0.25 is a sixteenth in 4/4). |
| `sequence notes velocity` | `<sequence> <loNote> <hiNote> <from> <to> <velocity>` | Sets the velocity of every note in a region. |
| `sequence notes move` | `<sequence> <moves>` | Moves several notes in one write, JSON `[[note,start,newNote,newStart],…]`. |
| `sequence record` | `<track> <notes>` | Records notes into a new sequence placed on a lane (JSON, song beats). Used by MIDI recording. |
| `sequence edit roll` | `<sequence>` | Shows a sequence's notes as a piano roll in the bottom panel. |
| `sequence edit tracker` | `<sequence>` | Shows them as a tracker. |

## Curves (automation)

| Command | Arguments | What it does |
|---|---|---|
| `curve new` | `<name>` | Creates an automation curve (an LFO you then edit). The name is the filename: letters, digits, `_` and `-`. |
| `curve set` | `<curve> <fields>` | Writes a curve whole from JSON, e.g. `{"type":"lfo","shape":"saw","frequency":2,"phase":0,"amplitude":0.5}`. Types: `lfo`, `custom`, `adsr`. |
| `curve point add` | `<curve> <time> <value>` | Places a point (or sets the one at that time). Value 0..1, the curve's range. |
| `curve point move` | `<curve> <time> <newTime> [value]` | Moves a point, keeping its value unless you give one. |
| `curve point remove` | `<curve> <time>` | Removes a point. The last point cannot be removed. |

## The project

| Command | Arguments | What it does |
|---|---|---|
| `project add` | `<at> <length>` | Inserts time, pushing everything after it (events, takes, markers, curve points, picture lanes). |
| `project remove` | `<at> <length>` | Deletes a span of time, pulling everything after it back. Events starting inside it are removed. |
| `project aspect` | `<ratio>` | Sets the frame's shape: `16:9` or `9:16`. |
| `project reload` | | Reloads the song from disk and sends it again. |
| `project master` | `<db>` | Sets the song's output level, -100..+12 dB (0 is unity). |
| `project master fix` | `[peak]` | Lowers the master until the last pass fits, from the peak the header meter held (or the peak in dB you give). The meter's *Fix* button. |
| `project console` | `[system]` | Runs the whole mix through a summing console (e.g. `@k7-core/console/console-6`), or `none`. Without a name, lists them. |
| `project tag` | `[tag]` | Adds a tag shown beside the project on the home page. Without a tag, lists them. |
| `project untag` | `<tag>` | Removes a tag. |
| `project marker new` | `<timecode> <name>` | Adds a named marker (the name may have spaces). |
| `project marker delete` | `<name>` | Deletes a marker. |
| `project surface new` | `<type> <id>` | Declares a surface: an arrangement (`timeline`), a frame (`viewport`), a desk (`turntables`) or a master strip (`mastering`). |
| `project undo` | | Undoes the last change to the project. |
| `project redo` | | Redoes the change you took back. |
| `project export` | `<what> <format> [sound]` | Downloads the mixdown, the picture or the cut: `audio wav` or `audio mp3`; `video <webm or mp4> [wav, mp3 or none]` followed optionally by `size=720p` (or `1280x720`), `quality=…`, `from=<time>`, `to=<time>`; or `timeline <otio or edl> [lane]` for the cut. |
| `project share k7` | | Publishes this song to k7. |
| `project share link` | | Shares a frozen copy of the project by link. |
| `project import` | `<path>` | Imports a `.dawproject`, an `.als` or an Ableton `.zip` from the workspace. |

## Tasks

Tasks live in `TODOS.md` at the root of the workspace, a Markdown checklist you can also edit by hand. A task is addressed by its number in the list.

| Command | Arguments | What it does |
|---|---|---|
| `task add` | `<text>` | Adds a task. |
| `task mark` | `<timecode> <text>` | Adds a task pinned to this project at a position; the timeline flags it in its ruler. |
| `task done` | `<number>` | Ticks or unticks a task. |
| `task remove` | `<number>` | Removes a task. |

## Transport

| Command | Arguments | What it does |
|---|---|---|
| `transport play` | | Starts playback. |
| `transport stop` | | Stops playback. |
| `transport toggle` | | Starts or stops playback. |
| `transport rewind` | | Back to the start. |
| `transport replay` | | Back to where playback last started, and plays again. |
| `transport locate` | | Moves the playhead to the caret. |
| `transport step next` / `transport step prev` | | Moves the playhead one grid step (a frame when zoomed in on a picture). |
| `transport loop` | | Loops the selection, or clears the loop. |
| `transport record` | | Turns the global record enable on or off. |
| `transport arm` | `<track>` | Toggles a track's record arm; armed tracks record when you play with record on. |
| `rec` | `<track>` | Arms or disarms a track exactly as its A button does: an instrument lane in the browser, an audio lane in the engine. This is what `r` runs on the caret's lane. |
| `transport panic` | | Silences every note and resets every plugin. |
| `transport metronome` | | Turns the metronome on or off (bar starts emphasised). |
| `transport metronome volume` | `<level>` | Sets the metronome's level, 0.2..1. |

Playing with record on and nothing armed is refused, with a message saying how to arm something.

## Events (clips placed on tracks)

An event is addressed by its track and the timecode where it **starts**.

| Command | Arguments | What it does |
|---|---|---|
| `event add` | `<track> <clip> <timecode>` | Puts an existing clip or sequence on a track. |
| `event move` | `<track> <timecode> <newTimecode> [toTrack]` | Moves an event, optionally onto another track of the same type. Bare `event move` picks up the clip under the caret. |
| `event resize` | `<track> <timecode> <newStart> <newEnd>` | Re-times an event's start and end (an end position, not a length). |
| `event split` | `<track> <timecode> <at>` | Cuts an event in two. Audio is placed twice from the same file, nothing rendered; a sequence becomes two files. |
| `event remove` | `<track> <timecode>` | Removes an event. |
| `event trim` | `<track> <timecode> [gate]` | Cuts the silence off both ends of an audio event, at a gate in dBFS (default -40). |
| `event window` | `<track> <timecode> <from> <to>` | Which slice of its file an event plays, in seconds into the file. |
| `event gain` | `<track> <timecode> <db>` | An audio event's own trim, -6..+6 dB; 0 removes it. |
| `event fadein` / `event fadeout` | `<track> <timecode> <length>` | Fades an event in or out over a length; 0 removes the fade. |
| `event crossfade` | `<track> <a> <b> <length>` | Overlaps two neighbouring audio events and fades one into the other; 0 removes it. |
| `event loop` | `<track> <timecode> <state>` | `on` plays the window twice, `off` once, `toggle` (default) flips. |
| `event loop points` | `<track> <timecode> <from> <to>` | The window an event loops: beats into a sequence, seconds into an audio file. |
| `event status mute` | `<track> <timecode> <state>` | Silences one event without removing it (`on`, `off`, `toggle`). |
| `event status warp` | `<track> <timecode> <state>` | Whether an event follows its clip's stretch map (`off` plays it at its own rate). |
| `event process` | `<track> <timecode> <chain>` | Bounces one event's file through a chain, leaving other events on that material alone. |
| `event comp` | `<track> <timecode> <take> <from> <to>` | Plays one take over a span of an event (song positions). Naming the event's own clip puts it back. |
| `event comp fade` | `<track> <timecode> <seam> <length>` | A crossfade centred on one seam of a comp; 0 removes it. |
| `event take arm` | `<track> <timecode> <from> [to]` | Records the next takes into one event, punched in at `from` and out at `to` or at the stop. |
| `event take disarm` | | The next recording lands on its lane again. |
| `event take remove` | `<track> <timecode> <take>` | Drops one take and every span of the comp it played. |
| `event take midi` | `<track> <timecode> <pass>` | Files a MIDI pass as a take of an event (sent by the takes view). |
| `events add` | `<events>` | Puts a batch of placed events down in one step (JSON). Used by paste. |
| `events remove` | `<events>` | Removes several events in one step (JSON `[{track,start}]`). Used by Backspace on a rectangle. |
| `events move` | `<tracks> <from> <to> <by>` | Moves every event in a range by a signed length (e.g. `events move drums,bass 2:1 4:4 +1:0`); `all` names every track. |

## Clips

| Command | Arguments | What it does |
|---|---|---|
| `clip process` | `<clip> <chain>` | Bounces one clip's file through a chain and keeps the result. |
| `clip warp` | `<clip> <sec> <beat>` | Places or moves a stretch point: pins a second of the source to a beat. |
| `clip warp remove` | `<clip> <sec>` | Removes a stretch point. |
| `clip onset add` | `<clip> <sec>` | Marks an onset the detector missed. |
| `clip onset remove` | `<clip> <sec>` | Removes an onset the detector got wrong. |
| `clip onset move` | `<clip> <from-sec> <to-sec>` | Moves an onset. |

## The selection

These act on the selection rectangle, or on what the caret is on.

| Command | Arguments | What it does |
|---|---|---|
| `selection copy` | | Copies the selected events (timeline) or notes (clip grid). |
| `selection paste` | | Pastes at the caret, on the timeline or in the open grid, depending on what was copied. |
| `selection delete` | | Deletes what the rectangle holds, in one undo step. |
| `selection split` | | Splits the clip under the playhead on the caret's lane (audio or picture). |
| `selection consolidate` | `<tracks> <from> <to>` | Writes one new clip over a range of one track. |
