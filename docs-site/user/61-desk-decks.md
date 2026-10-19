# The DJ desk: decks

The desk shows two decks facing each other, **A** on the left and **B** on the right, with a mixer column between them and a row of buttons along the bottom. Each deck is a mirror of the other: its tempo fader on the outer edge, its channel strip on the inner edge.

This page covers what a deck does. The channel strip, the faders, the crossfader and the headphones are on [The DJ desk: mixer and effects](./62-desk-mixer.md).

## Layout of one deck

From top to bottom, a deck column holds:

| Part | What it is |
|---|---|
| Stem knobs | Four knobs (drums, bass, vocals, other), only when the project wires them. See [mixer and effects](./62-desk-mixer.md#stems). |
| The record | A spinning vinyl with the song on its label. Drawn only when the desk is tall enough. |
| The waveform | The song scrolling under a fixed playhead. Always drawn. |
| Cue buttons | Eight hot cues, numbered 1 to 8. |
| Loop row | Beat jump, loop in/out, loop lengths, halve/double, roll. |
| Title | The loaded song's name, when the record is too small to carry it. |

On the outer edge sits the **tempo column**: the BPM readout, the tempo fader, the pitch percentage, the `÷2` and `×2` buttons, the key, the **KEY** switch and the deck's **play** button.

The desk sizes itself to the room it has. In a small pane the record is not drawn and the waveform grows instead; full screen (`4`) shows everything.

## Loading a song onto a deck

There are two ways.

**From the song browser**

1. Click the **label** in the middle of the record (it reads "platine A" or "platine B" when the deck is empty). When the record is not drawn, use the playlists panel instead.
2. A dialog titled **Platine A** (or **B**) lists the songs of the set list, sorted by artist then title.
3. Type to search: every word must appear in the artist or the title; accents and case are ignored (`alizee` finds "Alizée").
4. Click a song, or press **Enter** to load the first playable one.

Rows show a disc icon when the song is on this machine, and a cloud icon (greyed, not clickable) when it is "not in this machine's cache yet". A song whose folder carries no audio is greyed too.

**By dragging from the playlists panel**

Open the playlists panel (footer list icon, or `ui playlists`), and drag a row onto a deck. The whole deck accepts the drop and is outlined while you hover. The row must belong to the playlist the desk names; otherwise the desk says "that song is not in this surface's playlist".

When a song lands on a deck:

- Its waveform shows "analysing the song…" until the engine has measured it. The first analysis of a file takes a few seconds; after that it is read from a cache. See [Preparing a gig](./65-gig-prep.md) to analyse a whole set list in advance.
- The tempo fader and the beat grid appear once the analysis lands.
- A loop or stem setting from the previous record is dropped.
- If the deck was already turning, it keeps turning with the new record.

If the playlist line names a **variant** (for example an instrumental), that version is what plays, and the deck's title shows it after a `·`.

## Playing and stopping a deck

Each deck has its own **play** button at the foot of its tempo column. Press it to start the deck; press it again to stop. The other deck carries on.

- The button is greyed while the deck is empty.
- There is no master play button on the desk. The two decks are independent, like two turntables.

## The record

The vinyl turns while the deck plays, at a speed that reflects the deck's tempo: a record sped up turns faster. A wedge fills the disc as the song plays, and each set cue is drawn as a coloured mark around the dial.

| Gesture | Effect |
|---|---|
| Click the label | Opens the song browser for this deck. |
| Drag the grooves round | Scratches: the record follows your hand, forwards or backwards, and the pitch changes with it. Letting go hands the record back to what it was doing. |

A scratch works on a stopped deck too, as long as it holds a record.

## The waveform

The waveform shows 8 seconds of the song with the playhead fixed in the middle; the song slides under it.

| Drawn | Meaning |
|---|---|
| Coloured waveform | The song, coloured by frequency band. |
| Yellow lines | The beat grid (estimated from the analysis). |
| Orange lines | Bar lines: every fourth beat. The desk assumes 4/4. |
| Grey ticks | Detected transients (onsets). |
| A shaded band | The running loop. |
| Times at the edges | Elapsed and remaining time. |
| `120.0 BPM` (top right) | The tempo the analysis found. "tempo inconnu" means none was found, so there is no grid. |

**Drag the waveform** to shuttle through the song: drag left to go forward, right to go back. The distance from where you pressed is a speed, not a step: a little is slow, a long pull runs up to 16 times real time. Small trembles (under 4 pixels) do nothing. When you let go, the deck jumps to where the band landed. Shuttling needs a song loaded and its tempo measured.

## Tempo

The tempo fader runs from 10 to 300 BPM, with a notch at the song's own tempo. **Up is faster.**

| Element | Meaning |
|---|---|
| Number above the fader | The tempo the deck plays at, in BPM. `—` when no tempo is known. |
| Percentage under the fader | How far from the song's own tempo. It turns amber past ±16 %, the range of a real deck, where the stretch becomes audible. |
| Double-click the fader | Back to the song's own tempo. |
| `÷2` / `×2` | Correct the analysis when it found double or half the real tempo. |
| `BPM` with a pencil | The media library holds a corrected tempo for this song. |
| A code such as `12A` | The song's key on the Camelot wheel, when someone has typed it into the media library. The desk does not detect keys. |
| **KEY** | Keylock. See below. |

### Correcting the tempo (÷2 and ×2)

Tempo detection often lands on an octave error: 174 for an 87 BPM song, or the reverse. `÷2` and `×2` write the corrected tempo **into the media library**, where it belongs to the record: every project that plays the song afterwards gets the corrected value. If the fader had not been moved, the deck keeps playing at the song's real speed. If the write fails, the desk says "the tempo could not be corrected in the media library".

### KEY (keylock)

By default a deck behaves like a record: speeding it up raises the pitch. Press **KEY** to hold the pitch while the tempo changes. The switch belongs to the deck, so it stays on when you change records.

With KEY on, the tooltip warns that a separated song's stems no longer sum exactly. A scratch always changes pitch, whatever KEY says.

## Sync

The two **SYNC** buttons sit at the two ends of the bottom row. They are one choice: **SYNC A** means "deck A leads".

1. Both decks need a tempo (the buttons are greyed otherwise: "both decks need a tempo").
2. Press **SYNC A**. Deck B takes deck A's tempo, and its beats are moved to line up with A's.
3. Press **SYNC A** again to release.

Notes:

- When the analysis found no reliable beat grid on one of the songs, the tooltip says "tempo only": the tempos match but the beats are not aligned.
- While synced, the following deck's fader moves on its own and is greyed. You can still grab it: moving it cancels the sync.
- Each song's beat grid is measured, not assumed. A song whose onsets are too irregular has no grid; the tempo can still be matched.

## Hot cues

Each deck has eight cue buttons, each with its own colour.

| Gesture | Effect |
|---|---|
| Press and hold for one second | Sets the cue at the moment your finger **landed**, not when the second elapsed. |
| Tap a set cue | Jumps there. A running loop is turned off first. |
| Tap an empty cue | Nothing. |

The cue buttons are drawn on an empty deck too, greyed. Cues are saved in the project's `mix.k7x`, under the song, as seconds into the file, so they survive tempo changes and come back the next time the song is on a deck in this set. Another set has its own cues for the same song. See [The desk's files](./63-desk-files.md#the-cue-sheet-mixk7x).

## Loops

The loop row needs a song with a measured tempo, since loop lengths are counted in beats. It is greyed otherwise.

| Button | Effect |
|---|---|
| `◀` / `▶` | Beat jump: move back or forward by the current step (the last loop length you chose; 4 beats to begin with). A running loop moves with it. |
| `IN` | Marks the loop's start. It stays lit until `OUT`. Pressing `IN` again re-marks. |
| `OUT` | Closes the loop. The length is rounded to whole beats (or to 1/2, 1/4, 1/8 for short loops). |
| `4`, `8`, `16` | Starts a loop of that many beats from where the deck is. Pressing the same button again ends it. |
| `÷2` / `×2` | Halves or doubles the running loop, between 1/8 beat and 32 beats. Its start stays put. |
| Readout between them | The running loop's length (amber), or the next length in grey. |
| Roll (circular arrow) | Hold it: a loop of the current step plays while held; on release the song picks up where it would have been had it played on. |

### Quantise

The **Q** button under the crossfader applies to both decks and is **on** by default. With it on, loop starts, `IN` and beat jumps land on the nearest beat. Off, they land where you press.

## The metronome

The button with the sound-wave icon in the bottom row adds a click on the beat of one deck, with the first beat of each bar accented. It is available when there is exactly one beat to follow:

- one deck loaded, or both decks synced, and
- that deck's beat grid was measured reliably.

Otherwise it is greyed, and its tooltip explains why.

## Other buttons on the bottom row

| Button | Effect |
|---|---|
| Music note with `3/12` | Shown while the desk is analysing the set list in the background: songs done out of total. |
| Circular arrows | Re-reads the list of songs on the engine's machine, after you added songs to the media library. |
| The horizontal bar with a light | The master output meter. The light turns red if the output clipped since playback started. |
