# The four stems, and what a set calls them

The rationale behind `packages/song-schema/src/stems.ts`. How a separation is RUN is
`packages/stem-separation/docs/stemSplit.md`; what the desk draws is
`packages/ui-turntables/docs/stems.md`.

## The order is the knowledge

`STEMS` lists the four sources IN THE ORDER the model returns them. That list is knowledge, not a
preference: the output tensor is `[1, 4, 2, N]` and nothing in it says which index is the bass, so
getting it wrong silently swaps two stems — a fader labelled `bass` that removes the drums, which
reads as a broken separator rather than a wrong list.

It lives in this package, which everything else depends on, because it is needed in three places
that cannot import each other: the inference writes the files (`@studio/file-service`), a set's graph
declares a lane per stem (`scaffoldSet`), and the desk loads one clip per lane
(`@studio/ui-turntables`).

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

`stemCut` is still exported and nothing writes one. It names a node a set used to carry, and
removing one is the only way a migration can name it — see below.

## How loud a part plays: the PLATTER's own gain

```
lane output = Gain · part      Gain = 0 → the instrument is gone
                               Gain = 1 → as the separation wrote it
                               Gain = 2 → twice as present
```

`STEM_PARAM` is `Gain`, on the `studio_turntable` node that reads the part's file. No module.

That is the fourth shape this has had, and the first three are worth recording, because all three
were defensible and it was measurements that ended two of them.

### Three forms, and what killed each

**`Cut`, 0 to 1, which only knew how to subtract.** The graph carried a `sub(0, Cut)` to force the
sign. It cost a node and, more expensively, it cost the rest position: at rest the knob was at one
end of its travel, and "add more of this instrument", which every remix wants, did not exist.

**`Level`, −1 to 1, signed.** The deck played the record and this lane SUBTRACTED the part from it:
`mix + (Level · stem)`. At 0 the lane was silent and the output was the original file, **sample for
sample**. It was the most attractive of the three, and it held until somebody measured what happens
when the tempo moves.

**`Level`, 0 to 2, a plain level.** The lane carries the part *itself* and the four sum. This is
where the module became a `gain(Level)` and nothing else.

**`Gain`, 0 to 2, on the platter** — today. Same arithmetic, one node fewer.

### Why the subtraction was abandoned

A subtraction only cancels if the two signals stay aligned to the sample. Three things break that
alignment, and the first two are fixable:

1. **The sample rate.** The model works at 44.1 kHz; a stem written at that rate against a 48 kHz
   master drifts within a second. Fixed: `stem-separation` writes at the record's rate.
2. **The decoder.** An mp3 carries an encoder delay — 1105 samples on the record measured — that
   ffmpeg trims and JUCE does not. Fixed too, by decoding once.
3. **Time-stretching, which does not get fixed.** A pitch-preserving stretcher is **non-linear**: it
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

The song itself is at −16 dB: with pitch held, the "subtraction" was removing nothing at all. Only
resampling survives, because its schedule does not look at the content — the same linear combination
of samples for all five files. The general rule is there: *any* content-independent stretch keeps
the cancellation, *no* stretch that listens to the signal keeps it.

A subtraction therefore only worked at the record's own tempo. A sum asks for nothing: each part
stretches on its own and the result is what it is. It is also what every commercial stem deck does —
Traktor since the Stem Decks, Serato, rekordbox, VirtualDJ: they play the parts, none subtracts.

### What that cost, in numbers

The argument for the signed form was that **the four stems do not sum back to the song**: HT-Demucs
emits four waveforms each trained to resemble its source, with no conservation constraint. True, and
the gap was measured rather than assumed — three 20 s windows across one song:

| position | song | residual of `master − Σstems` | gap |
|---|---|---|---|
| 30 s | −15.6 dB | −50.0 dB | 34.4 dB |
| 90 s | −16.2 dB | −49.4 dB | 33.2 dB |
| 150 s | −16.8 dB | −51.1 dB | 34.3 dB |

So at rest the output is no longer the record sample for sample, but the record to within 34 dB,
stably from end to end. The error is correlated with the signal — it would be heard as a very slight
blur, not as hiss. That is the price, and it is written here so nobody rediscovers it by hunting.

What remains besides — and cannot be removed — are the artefacts **proportional to what you take
out**: whatever leaked from one instrument into another stays when you cut the first. Bass and drums
are the two this model separates best; `other` is the catch-all and the most fragile.

### Why no module any more

There WAS one, `@st0/audio/separation/stemcut`, and its own page argued at length that a fader could
not do the job. That argument was about `MixerPlugin`:

| | what it accepts |
|---|---|
| `MixerPlugin` (`Volume`) | dB, floor at −60 — silence is not reachable |
| a send (`SendDoc.level`) | the same, through `gainToDecibels` |
| `Kind::gain` in the DSP graph | `buffer.applyGain(start, n, r(n.in[0]))` — **an unbounded float** |

It was right, and it expired when the platter became a node. `TurntablePlugin` declares
`add("gain", "Gain", 0.0f, 2.0f, 1.0f)` and multiplies by it directly, so 0 is exact silence: the
same range, the same rest, the same units the module had. The chain was
`stemPlatter → stemCut → trim`, which is `gain(1) → gain(Level)` — two linear gains in series. The
module went, and with it eight compiled DSP graphs per set.

Making a part disappear must be a position on the travel and not an asymptote, and unity must be in
the MIDDLE of it. That is the one thing all four forms have had in common, and the only one there
was never any doubt about.

### Migrating a set that still has the module

`npx tsx packages/song/scripts/migrateStemGain.ts <projet.st0> --write` — it carries each cut's
`Level` onto its platter's `Gain`, repoints the binding, and removes the node. Older sets walk the
whole chain in order: `migrateSetStems` → `migrateSetPlatter` → `migrateStemGain`.

Each of those describes ONE step of this history, so each spells its param out instead of importing
`STEM_PARAM` — a constant that has now moved three times. A migration that follows a moving constant
silently skips the steps between.

## What the assembly still requires

- **The four parts must be laid down together.** Same `start`, same warp, same `slip`: four parts a
  few milliseconds apart is a flam on every hit. `withDecks` fills them in one place for that, and a
  test demands it.
- **The record's lane is EMPTY when the song is separated.** The four parts *are* the record;
  playing it as well would double it.
- **They sum BEFORE the EQ**, because a deck's strip equalises what it sends to the fader, not each
  instrument apart.
- **A new record resets the four gains.** `deckFile` is part of a plugin's identity
  (`engine/moteur/docs/projectDiff.md`), so putting a song on re-creates the platter and its `Gain`
  goes back to the declared 1. The desk clears its own knobs in `putOn` to match — without that it
  would draw a cut that is not applied, and nothing would say so.
- **The test that decides**: all four at unity, render, compare with the record — it must stay about
  34 dB under the music, and not 10. Everything else in this assembly is an opinion; that one is a
  measurement.
