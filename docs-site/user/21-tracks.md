# Tracks and lanes

A **track** is a lane on the timeline and, at the same time, a node in the chains graph: the lane is
where its events sit, and the chain behind it (instrument, effects, the mixer strip) is what they
play through. One lane holds audio clips and note sequences alike — what it accepts depends on
what is wired to it: a lane takes notes when its MIDI output is wired and audio clips when its
audio output is.

A track's name is also its file name. A name such as `ge.lead` carries an instrument prefix (`ge`
for guitar), which decides the icon drawn beside it; the header shows the name without that
prefix, and the tooltip shows it in full.

## Making a track

- Click **+ lane** in the corner above the names, or press `+` while the timeline is in front.
- Or type it, with or without a name:

```text
track new            # named track-1, track-2, …
track new bass
```

A new track comes with its own mixer strip, so its fader works straight away. In a project with a
picture frame, the corner button asks whether you want an **audio lane** or a **video lane**
(picture lanes are covered in the picture section of this guide).

A track needs an **input** before it can record. In the per-track view (double-click its header)
use **audio in** or **midi in**, or type:

```text
track input gtr audio
track input keys midi
```

This is refused when the lane already has an input.

## The lane header

Each header shows, left to right:

| Element | Meaning |
|---|---|
| Green fill behind the name | The lane's live output level, from −60 dB (empty) to +6 dB (full). |
| Red bar along the bottom | The input level, shown only while the lane is armed. |
| Icon | The instrument family the name's prefix declares, in the track's colour. A question mark when the prefix declares nothing. |
| Alternative badge | Shown only when the lane's node has several sets of settings ("alternatives"). Amber when it is not playing the first. Click it for the lane's menu: switch alternative, create or copy one, freeze/unfreeze. |
| Name | Amber when soloed, red when armed. |
| **M** | Mute (orange when on). |
| **S** | Solo (yellow when on). |
| **A** | Arm for recording (red when on). The whole lane turns red while armed. |

A lane is drawn dimmed when you cannot hear it: muted, muted by its group, or silenced because
another lane is soloed.

### Mute, solo, highlight

| Button / key | Command | What it writes |
|---|---|---|
| **M**, or `m` with the caret on the lane | `track mute bass` | The lane's bypass, in the graph. Toggles. |
| **S**, or `s` | `track solo bass` | Adds or removes the lane from the project's soloed list. Several lanes can be soloed at once; any soloed lane silences the others. |
| — | `track highlight bass` | Plays the lane 10 dB louder while it is on, without moving its fader. Toggles. |

Mute and solo flip on screen at once and are confirmed when the song reloads.

### Arming

**A** arms a lane for recording, and so do the `r` key with the caret on the lane and `rec bass`.
An audio lane is armed in the engine (`transport arm bass` does only that). A lane fed by a MIDI
input is armed in the browser instead: notes are captured where your keyboard is. Arming writes nothing to
your song and is forgotten when the engine stops. See [Recording](./25-recording.md).

## Selecting, grouping and reordering lanes

| Gesture on a header | Effect |
|---|---|
| Click | Select the lane (the caret moves to its name). |
| Shift+click | Add the lane to (or remove it from) a set of picked lanes. |
| Double-click | Open the lane's file in the editor, frame its chain in the graph, and show its modules side by side in the bottom panel. Nothing is written. |
| Drag up or down | Move the lane to another position. |
| Right-click | The track's menu (below). |

### Groups

A **group** draws as a grey header above its member lanes. It holds no events itself, but its mute
and solo reach every member. To make one, shift-click the lanes, right-click one of them and choose
**Group the N tracks**, or type:

```text
track group kick,snare,hats drums
```

A track already in another group leaves it. Right-click a group header for its mute and solo.

### Order and colour

Dragging a header writes the whole lane order into the project. Typed:

```text
track order gtr 2       # 1 is the top; past the end is the bottom
track arrange           # colour every lane by its family and order them that way
```

`track arrange` sorts vocals, drums, basses, guitars, keys, synths, then the rest, each family in
shades of one colour (vox pink, drums red, basses brown, guitars green, keys blue, synths purple,
the rest grey). It overwrites the colours the lanes had.

## The track menu

Right-click a lane (its header or its empty space) to see every command that takes a track first.
Commands that need one more value open in the command bar with the track already typed. The list
includes:

| Entry | Command | Notes |
|---|---|---|
| mute / solo / highlight | `track mute|solo|highlight <track>` | Toggles. |
| order | `track order <track> <position>` | |
| duplicate | `track duplicate <track>` | Same chain, same events. |
| duplicate empty | `track duplicate empty <track>` | Same chain, no events. |
| rename | `track rename <track> <new-name>` | The new name is typed whole, prefix included (`vo.lead`). The graph, the lane order and the solo list follow. |
| input | `track input <track> audio|midi` | |
| hide | `track hide <track>` | Sets the lane aside: not drawn, not compiled, not played; its files are kept. `track unhide <track>` brings it back (typed only, since a hidden lane is on no screen). |
| delete | `track delete <track>` | Asks first. Removes the lane and the chain it starts — input, instrument, effects, strip. Clips and sequences stay on disk. |
| automation add / remove | `track automation add <track> <param>` | See [Automation](./24-automation.md). |
| process | `track process <track> <chain>` | Bounce every file the lane's clips play through a chain, for good. |
| event add | `event add <track> <clip> <position>` | Place an existing clip on this lane. |
| arm | `transport arm <track>` | |
| ui file | | Opens the lane's own file. |

You can hide entries you never use, or rename them, in **Settings → Commands**.

## Lanes you cannot edit

- A **generated** lane (filled live by an algorithmic pattern) is hatched. It holds no events of its
  own: nothing can be moved onto it or dropped on it. `m` and `s` on it act on its group.
- A **frozen** lane plays a render of itself. Its block is drawn but cannot be moved or cut;
  double-clicking it opens the notes it was made from. Unfreeze from the alternative badge's menu or
  with `node freeze <track>`.

## See also

- [The arrangement timeline](./20-timeline.md)
- [Events and clips](./22-clips.md)
- [Mixing and metering](./26-mixing.md)
