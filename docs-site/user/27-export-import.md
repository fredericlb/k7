# Exporting a mixdown and importing other DAWs' projects

## Exporting the mix

Open the **Share / export** panel from the header (`ui share`). Under **Mixdown**:

| Button | Command |
|---|---|
| Export MP3 | `project export audio mp3` |
| Export WAV | `project export audio wav` |

The whole song is rendered offline — the same chains, the same automation — and your browser
downloads the file, named after the project (`winter.wav`). Nothing is written into the project.
The status line reads "rendering WAV mixdown…", then "exported winter.wav".

The render runs on a machine that has an engine: the server's own, or the machine your project is
playing on. MP3 needs ffmpeg on that machine; without it the export says so and WAV still works.
If no engine is available at all, the export fails with "no engine to render with".

### Exporting one timeline

A project with other timelines than **Main** shows a **Timeline** choice above the two buttons. Pick
one and the export renders that timeline alone, from its start, exactly as you hear it when it is
open in the timeline pane: through the lane it is placed on, with that lane's instrument and
effects. The file is named after it (`winter-verse.wav`). From the command bar the timeline is a
third word, `main` being the song itself:

```
project export audio wav verse
project export audio mp3 main
```

The video export, publishing to k7 and share links are always of Main: a timeline has no picture of
its own, and publishing is publishing the song.

A song with a picture also offers a video export there; it is covered in the Picture section of
this guide.

The same panel also publishes a link to the song or sends it to the rehearsal recorder; those are
covered in the getting-started section (shares).

## Bouncing through a chain

To print an effect into the audio for good, run the material through a chain. The result is written
beside the source as a new file (`riff_amp-room_261015T101500.wav`), the clip is pointed at it, and
the previous file stays available to undo — Ctrl+Z asks for confirmation before restoring a bounced
file.

```text
track process gtr @k7-core/amp-room          # every clip the lane plays
clip process riff @k7-core/amp-room          # one clip, wherever it is placed
event process gtr 5:1 @k7-core/amp-room      # one event only; the others keep the original
```

The clip editor's **operations** menu runs `clip process` on the open clip. Running the same chain
again replaces the last result; a different chain stacks on it. There is no normalize command: a
library's `normalize` module, in a chain, is how you normalise.

`event process` gives the event its own copy of the clip first when other events share it, so a
right-click on one event never changes the others. It refuses a comped event (consolidate it first)
and a sequence.

## Importing another DAW's project

k7 translates three kinds of project into a new k7 project in your workspace:

| File | From |
|---|---|
| `.dawproject` | Any DAW that writes the open DAWproject format. |
| `.zip` of an Ableton project | The folder Live's **File → Collect All and Save** leaves, zipped. |
| `.als` | A Live set, imported from the file tree only (its samples are named by path and must sit beside it in the workspace). |

### From the file tree

Put the file in your workspace, then click it in the editor's file tree (or type
`project import winter.dawproject`). A dialog asks **Import DAW project?**; **Import** translates it
and shows a log; **Open project** opens the result.

### By dropping it

Drop a `.dawproject` or an Ableton `.zip` on a workspace on the home page. It is translated into a
project of its own; the dropped file itself is not kept. A lone `.als` is refused there.

### What crosses over

| Carried | Notes |
|---|---|
| Tempo, time signature, sample rate | |
| Tracks, their names, colours, volume, pan, mute | A muted track arrives bypassed. |
| Audio clips with their windows, fades and warp markers | Missing samples are listed, and the clips that play them are left out. |
| MIDI clips with their notes and velocities | |
| Disabled clips | Arrive muted. |
| Plugins | Each becomes a module; its state is carried as parameters when they can be read, otherwise as a preset file. A plugin this machine does not have is stubbed and listed. |
| Sends and return tracks (DAWproject) | Wired as chains; a send at less than full level arrives at full level, and the log says so. |

What is reported rather than imported: automation, Ableton return tracks and group tracks
(flattened), Session-view clips, take-lane clips that were not comped, Live's own devices, and the
structure of racks (their plugins are carried). A MIDI track whose instrument cannot cross over —
a Live drum rack, for instance — plays a stand-in from the library (a rack for drums, a synth
otherwise), and the log names it so you can replace it on the graph.

An archive that would unpack to more than 1 GB is refused.

The new project is named after the file; importing the same file again makes `name-2` rather than
overwriting.

## See also

- [Mixing, metering and mastering](./26-mixing.md)
- [Undo and history](./28-undo-history.md)
