# The four stems, and what a set calls them

The rationale behind `packages/song-schema/src/stems.ts`. How a separation is RUN is
`packages/stem-separation/docs/stemSplit.md`; what the desk draws is
`packages/k7-plugins/docs/turntables/stems.md`.

## The order is the knowledge

`STEMS` lists the four sources IN THE ORDER the model returns them. That list is knowledge, not a
preference: the output tensor is `[1, 4, 2, N]` and nothing in it says which index is the bass, so
getting it wrong silently swaps two stems — a fader labelled `bass` that removes the drums, which
reads as a broken separator rather than a wrong list.

It lives in this package, which everything else depends on, because it is needed in three places
that cannot import each other: the inference writes the files (`@studio/file-service`), a set's graph
declares a lane per stem (`scaffoldSet`), and the desk loads one clip per lane
(the turntables plugin's `src/turntables/`).

## Where the files go

`stems/` beside the file they came from, never next to it: the médiathèque's scan takes the FIRST
audio file in a song's folder as the master and does not descend, so a stem left alongside could be
played in place of the mixdown. Each is a float WAV — a stem is not a deliverable, it goes back
through a graph.

## The names a SET uses

A deck that can fade one instrument out is five lanes, not one: there is no fan-out in the document
and no plugin with four inputs (`packages/song/docs/ports.md`), so a stem you can move on its own has
to be a track of its own. `stemLane`, `stemPlatter` and `stemControl` are the vocabulary, and they
are here rather than in `scaffoldSet` because the desk has to recognise the lanes the scaffold wrote
— and a browser package cannot import a scaffold that writes files.

`stemLaneOf` is the reverse of `stemLane`, and the desk's way in: it is handed a compiled document
and has to tell a stem lane from the record's without knowing how the graph was written.

`stemCut` is exported and nothing writes one: it names a node older sets carry, and removing one is
the only way a migration script can name it — see below.

## How loud a part plays: the PLATTER's own gain

```
lane output = Gain · part      Gain = 0 → the instrument is gone
                               Gain = 1 → as the separation wrote it
                               Gain = 2 → twice as present
```

`STEM_PARAM` is `Gain`, on the `studio_turntable` node that reads the part's file. No module.

Making a part disappear must be a position on the travel and not an asymptote, and unity must be in
the MIDDLE of it, so that "add more of this instrument" — what every remix wants — exists. A knob
that only subtracts (0 to 1, with a `sub(0, Cut)` in the graph to force the sign) puts the rest
position at one end of its travel and costs a node besides.

### Why the parts are SUMMED and never subtracted from the record

The tempting alternative plays the record and subtracts a part from it — `mix + (Level · stem)`,
signed −1 to 1 — so that at rest the output is the original file sample for sample. It only works
while the two signals stay aligned to the sample, and three things break that alignment:

1. **The sample rate.** The model works at 44.1 kHz; a stem written at that rate against a 48 kHz
   master drifts within a second. `stem-separation` writes at the record's rate.
2. **The decoder.** An mp3 carries an encoder delay — 1105 samples on the record measured — that
   ffmpeg trims and JUCE does not. Decoding once removes it.
3. **Time-stretching, which cannot be fixed.** A pitch-preserving stretcher is **non-linear**: it
   picks its frames and phases from the spectrum it sees, so `stretch(a) − stretch(b) ≠
   stretch(a − b)`. The five clips get the same warp, the same markers and the same `start` — not
   enough, because what the markers do not share is what the algorithm decides between them.

Measured on one song, the five tracks stretched **identically**, residual of `master − Σstems`:

| stretch | residual |
|---|---|
| none | **−49.5 dB** — it cancels |
| rubberband +5 % | −15.9 dB |
| atempo +5 % | −13.1 dB |
| varispeed +5 % | **−49.5 dB** — intact |

The song itself is at −16 dB: with pitch held, a "subtraction" removes nothing at all. Only
resampling survives, because its schedule does not look at the content — the same linear combination
of samples for all five files. The general rule: *any* content-independent stretch keeps the
cancellation, *no* stretch that listens to the signal keeps it.

A subtraction therefore only works at the record's own tempo. A sum asks for nothing: each part
stretches on its own and the result is what it is. It is also what every commercial stem deck does —
Traktor's Stem Decks, Serato, rekordbox, VirtualDJ: they play the parts, none subtracts.

### What the sum costs, in numbers

**The four stems do not sum back to the song**: HT-Demucs emits four waveforms each trained to
resemble its source, with no conservation constraint. The gap, measured over three 20 s windows
across one song:

| position | song | residual of `master − Σstems` | gap |
|---|---|---|---|
| 30 s | −15.6 dB | −50.0 dB | 34.4 dB |
| 90 s | −16.2 dB | −49.4 dB | 33.2 dB |
| 150 s | −16.8 dB | −51.1 dB | 34.3 dB |

So at rest the output is not the record sample for sample, but the record to within 34 dB, stably
from end to end. The error is correlated with the signal — it would be heard as a very slight blur,
not as hiss. That is the price, and it is written here so nobody rediscovers it by hunting.

What remains besides — and cannot be removed — are the artefacts **proportional to what you take
out**: whatever leaked from one instrument into another stays when you cut the first. Bass and drums
are the two this model separates best; `other` is the catch-all and the most fragile.

### Why the gain is the platter's, and no module's

A level needs a gain that reaches exact silence, and the mixer's does not:

| | what it accepts |
|---|---|
| `MixerPlugin` (`Volume`) | dB, floor at −60 — silence is not reachable |
| a send (`SendDoc.level`) | the same, through `gainToDecibels` |
| `Kind::gain` in the DSP graph | `buffer.applyGain(start, n, r(n.in[0]))` — **an unbounded float** |

`TurntablePlugin` declares `add("gain", "Gain", 0.0f, 2.0f, 1.0f)` and multiplies by it directly, so 0
is exact silence, with the range and the rest a level wants. A separate gain module after the platter
would be two linear gains in series, and eight compiled DSP graphs per set for nothing.

## What the assembly still requires

- **The four parts must be laid down together.** Same `start`, same warp, same `slip`: four parts a
  few milliseconds apart is a flam on every hit. `withDecks` fills them in one place for that, and a
  test demands it.
- **The record's lane is EMPTY when the song is separated.** The four parts *are* the record;
  playing it as well would double it.
- **They sum BEFORE the EQ**, because a deck's strip equalises what it sends to the fader, not each
  instrument apart.
- **A new record resets the four gains.** `deckFile` is part of a plugin's identity
  (`engine/k7-runtime/docs/projectDiff.md`), so putting a song on re-creates the platter and its `Gain`
  goes back to the declared 1. The desk clears its own knobs in `putOn` to match — without that it
  would draw a cut that is not applied, and nothing would say so.
- **The test that decides**: all four at unity, render, compare with the record — it must stay about
  34 dB under the music, and not 10. Everything else in this assembly is an opinion; that one is a
  measurement.
