# The DJ desk: mixer and effects

Each deck has a **channel strip** on its inner edge, and the **mixer column** between the decks holds the two channel faders and the crossfader. This page describes every one of these controls. For loading and playing records, see [The DJ desk: decks](./61-desk-decks.md).

The labels on the desk are in French; the table below gives each one with its meaning.

## How knobs behave

Every knob on the desk works the same way:

| Gesture | Effect |
|---|---|
| Drag up / down | Turns it right / left. The full travel is about 160 pixels. |
| Double-click | Back to neutral (the middle for a signed knob, unity for a stem). |
| Arrow keys (when focused) | Up/Right raise it, Down/Left lower it, in 1/80 of the travel. |
| `Home` (when focused) | Back to neutral. |

A coloured arc shows how far from neutral the knob is, and the value is printed under it when it is not at rest (and when there is room). A greyed knob means the project does not wire that control to a module the engine has loaded; its tooltip says "this deck has not got that module loaded".

## The channel strip

Top to bottom, in the order of the signal:

| Label | Control | Range | At rest |
|---|---|---|---|
| **TRIM** | Input gain, ahead of everything else on the deck | −12 to +12 dB | 0 dB |
| **GRAVE** | EQ low band | −20 to +20 dB | 0 dB (flat) |
| **MID** | EQ mid band | −20 to +20 dB | 0 dB |
| **AIGU** | EQ high band | −20 to +20 dB | 0 dB |
| **FILTRE** | One-knob filter: low-pass to the left, high-pass to the right | −100 to +100 | 0 (open) |
| **ECHO** | Amount of echo, dry to wet | 0 to 1 | 0 (dry) |

- **TRIM** evens out records that arrive at different levels; nothing in a set normalises loudness. Set it against the channel meter beside the channel fader, which reads the strip before the fader.
- **FILTRE**: turning left sweeps a low-pass down from 20 kHz to 200 Hz; turning right sweeps a high-pass up from 20 Hz to 4 kHz. In the middle it is inaudible.
- **ECHO** is only drawn when the project wires an echo for that deck. Its delay time is fixed (375 ms in a new set, with a feedback of 0.45) and does not follow the tempo; change `Time` and `Feedback` in `nodes/echoA.k7x` / `nodes/echoB.k7x`.

## Stems

When the project wires stem controls, four knobs appear next to the record:

| Label | Part |
|---|---|
| **BATT** | Drums |
| **BASSE** | Bass |
| **VOIX** | Vocals |
| **RESTE** | Everything else |

Each knob is a **level** for that part: 0 removes it, the middle (1) is the part as recorded, the right end (2) doubles it. Double-click returns to the middle.

Stems need the song to have been **separated** first. The four knobs read differently depending on that:

| What you see | Meaning |
|---|---|
| Knobs live, tooltip "Take an instrument out of the song" | The song is separated; turn away. |
| Knobs greyed | The song has not been separated. Prepare the playlist (`playlist stems`), or add `stems: true` to the surface so the desk separates it itself. |
| A percentage over the knobs | The desk is separating this song now. The knobs light up when it is done. |
| `!` over the knobs | The separation failed; hover for the reason. |

With `stems: true` in `surfaces/desk.k7x`, putting an unseparated song on a deck starts its separation. It takes minutes per song, so prepare a set list the night before instead (see [Preparing a gig](./65-gig-prep.md#separating-stems)). Even without `stems: true`, the desk checks whether a song was separated since the list was read and lights the knobs if so.

Loading a new record on a deck puts its stem knobs back in the middle.

## Channel faders

The mixer column holds one vertical fader per deck, labelled **A** and **B**, each with a level meter beside it.

| | |
|---|---|
| Range | −60 dB (silence) to +6 dB |
| At rest | 0 dB (unity, open) |
| Double-click | Back to 0 dB |
| Meter | Reads the deck's strip **before** the fader: green, amber when hot. |

Most of a transition is made with the channel faders; the crossfader is for cuts. A greyed fader means the project does not wire `deckA.level` / `deckB.level`.

## Crossfader

The crossfader runs across the middle, between the two decks' waveforms, with **A** at the left end and **B** at the right.

- Fully left: only deck A is heard. Fully right: only deck B. The middle: both at half gain (equal gain, not equal power).
- Under it, the percentage readout (when there is room): **double-click** it to recentre.
- Next to it, the **Q** button switches quantise for loops and beat jumps; see [Loops](./61-desk-decks.md#loops).

## Headphones (cue)

The two buttons with a headphone icon, **A** and **B**, in the bottom row, put a deck in your headphones.

- What you hear in the headphones is taken after the EQ and filter and **before** the channel fader and the crossfader: you can listen to a deck that the room does not hear.
- Both start off: a set starts with nothing in the headphones.
- The headphones leave by a **second output pair** of your audio interface, which you name once per machine:

  ```
  system cue 3+4
  ```

  You can also give a label from `system channel list`. Run `system cue ""` to clear it. A machine with no headphone pair named plays the headphone signal nowhere, never into the room.

The button is greyed, with the reason in its tooltip, when the machine has no headphone pair ("this machine has no headphone pair — name one with `system cue 3+4`") or when the project does not wire a headphone send for that deck.

## Momentary effects

Each deck has two buttons beside its SYNC button. Both act **only while held**; releasing (or sliding off the button) ends the effect.

| Button | Effect while held |
|---|---|
| Censor (curved arrow) | The record runs backwards at its own speed. On release it carries on as it was. |
| Echo-out (loop arrows) | The echo goes fully wet and the channel fader drops to silence, so the repeats ring out alone. On release, both return to where they were. |

Echo-out needs the deck's echo to be wired; otherwise its tooltip says "this deck has no echo wired".

## Master meter

The horizontal bar near the right of the bottom row is the master output: the blend after the crossfader, the only meter on the desk that reads it. The small light beside it turns red when the output clipped since playback started, and stays lit until playback restarts.

## Controls reference

| Control | Where | Gesture |
|---|---|---|
| Song browser | Record label | Click |
| Load by drag | Whole deck | Drop a playlist row |
| Play / stop deck | Foot of tempo column | Click |
| Scratch | Record grooves | Drag round |
| Shuttle | Waveform | Drag left/right, release to land |
| Tempo | Tempo fader | Drag; double-click for the song's own tempo |
| Keylock | KEY | Click |
| Tempo correction | `÷2`, `×2` | Click (writes to the media library) |
| Sync | SYNC A / SYNC B | Click to lead, click again to release |
| Hot cue | 1 to 8 | Tap to jump, hold 1 s to set |
| Loop | Loop row | See [Loops](./61-desk-decks.md#loops) |
| Quantise | Q | Click |
| Knobs | Strip and stems | Drag vertically, double-click for neutral, arrows and `Home` when focused |
| Channel fader | Mixer column | Drag; double-click for 0 dB |
| Crossfader | Mixer column | Drag; double-click the % readout to centre |
| Headphones | Headphone A / B | Click |
| Censor, echo-out | Beside SYNC | Hold |
| Metronome | Sound-wave button | Click |
| Re-read songs | Circular arrows | Click |
| Fullscreen the desk | Anywhere in the shell | `4` or `ui turntables` |

## Driving the desk from the graph

Every desk control moves a parameter on a module in the graph. Turning the same parameter on the graph's node card moves the desk too: the tempo fader, for example, follows the tempo node's `Target BPM`. See the Chains section of this guide for the graph.
