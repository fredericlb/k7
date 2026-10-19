# The metronome

A button in the bottom bar, beside the transport. Lit, a click marks the music's beat, with the
first beat of each bar higher. Off and black the rest of the time.

## It is not always offered, and that is the subject

A click has to be on **one** beat. Two decks running freely have two, and a click on one is a
click against the other — so the button goes dark rather than choose. It lights in exactly two
cases:

- **one deck loaded**: that is its beat;
- **both synchronised**: the master's, since the sync put the other on it.

That beat must also have been **measured**. A tempo says how often a beat arrives, not which
instant is one, and `beats.ts` already refuses to publish a phase the onsets did not give (see
[bpm.md](bpm.md), the Rayleigh test). A click on the wrong half of the beat is not a degraded
metronome, it is a false one, and you would play to it. So: no phase, no click. Of the three
songs in `example.k7` that rules out the Bashung, whose detected tempo is simply wrong.

The wish is **kept** even when the possibility disappears: loading a second deck stops the click,
resyncing brings it back, without going through the button again.

## Why it is NOT the engine's metronome

The engine has one — `settings.metronome`, a boolean, and it is k7's. It clicks on the
**document's** grid: `DOC_TEMPO` beats, counted from transport zero.

On a timeline that is enough, because the document's tempo IS the music's. On the desk none of it
holds:

- the document tempo is **frozen** at 120, deliberately, so two decks can play at two BPM;
- a deck's music is **not on the timeline at all**: it is in a platter, at a position the plugin
  carries itself;
- its first beat is where the recording put it, not on a document beat.

The two grids have no reason to meet. That click would **flam** against the music — worse than no
click, since you would play to it.

## What the desk does instead

One more track in the document, with a `4osc` and **a one-bar MIDI clip, looped**.

The notes are placed in document beats used purely as a **unit of duration**: one deck beat is
`DOC_TEMPO / target` document beats. At 128 against a 120 document that is 0.9375 — a non-integer,
and fine, since nobody counts those beats. The document tempo is never touched and no deck is
moved.

A looped bar rather than a note per beat: the clip is rebuilt at **every step** of a tempo drag,
and six minutes of song is a thousand notes to resend and to diffuse for a sound that repeats
every four.

The click is an **envelope**, not a waveform: immediate attack, over in thirty milliseconds,
nothing held. The pitch is the note's, so the downbeat is simply higher — like the engine's
`clickTrackEmphasiseBars`, and for the same reason: hearing where the bar starts IS the feature,
not a separate option.

## The transport that carries it follows the decks

The desk has no transport button ([mix.md](mix.md)) — it needs none for the music, but this clip
only sounds while the transport rolls. The rule that replaces the button is therefore **the
transport follows the decks**: it rolls from zero as soon as a deck turns, and stops when none
does. That ties the click to what is playing, which is what a metronome wants: it cannot be left
clicking on a stopped desk, nor go quiet while a record plays.

## It has the SPACING and it has not the PHASE

> **The click is the transport's last inhabitant.** A deck is a platter and carries its own
> position; this clip sits on a timeline nobody follows. So it gives the right **spacing**
> between beats and an **arbitrary offset** against the music — that is, a flam, exactly what the
> section above refuses the engine's metronome.

The clip starts at **zero** and this page says the phase is missing rather than simulating it.

**The remedy is not decided.** Two shapes, neither tried:

- **one more platter**, playing a click file; it would then share the others' position and rate,
  which half the work already knows how to do (`plattersOf`);
- **a live anchor**: at a given instant both the deck's needle and the transport are known, so
  the next downbeat can be placed. It is recomputed on every document send, and it drifts the
  moment a hand touches the record.

**There is no bench for the placement**, because there is no phase for it to measure: one can
only exist alongside an anchor. The mark an anchor will have to meet, measured when the click
rode a clip: **30 clicks, maximum deviation 3.0 ms before a tempo change and 3.1 ms after** — the
3 ms being the onset detector's rise time, i.e. the measurement floor.

### The track stays when the click is off

Not for tidiness. `ChangeKind::TrackRemoved` is a **stub** in the engine (`EngineHost.cpp`): a
track dropped from the document stays in the edit. A metronome you could not switch off would be
a worse bug than the feature is a feature — so silence is an **empty clip list**, clip removal
being genuinely implemented.

It is also the pattern the decks' document already follows: both tracks are always present,
loaded or not, so that loading is a diff and not a track appearing.

### It is added, not declared

`withDecks` puts it **after** the project's tracks. It is the only track in the document
`graph.k7x` says nothing about, and that is owned: the metronome is a desk command, not a
property of the set. What the project declares stays the project's business.

## What is not there

The level is **fixed** (−6 dB on its own strip). No control: the desk has no room for another
knob, and a metronome you cannot hear is a metronome that is off.

It leaves through the **engine's interface**, with the music, not through the browser. That is
the constraint that decides: a click made in the tab would arrive with its own output latency,
tens of milliseconds off the music — useless for exactly what a metronome is for.
