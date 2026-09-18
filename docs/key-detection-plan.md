# Plan — key detection, and what it would really cost

**No key is detected.** KEY holds the pitch without saying which one, so there is no harmonic
mixing and no Camelot wheel. The other two points of the desk audit are done — the playlist
pre-warms ([prewarm.md](../packages/st0-plugins/docs/turntables/prewarm.md)) and the grid is correctable
([grid.md](../packages/st0-plugins/docs/turntables/grid.md)). This one is different in kind: it is not a
missing button, it is a **measurement**, and it is in the C++.

## Where it would live

`engine/st0-engine/engine/Waveform.cpp`, the `--waveform <file>` mode: one pass that decodes, builds
the envelopes, detects the transients, estimates the tempo, and writes `{file}.cache`.

Three things to have read before proposing anything:

**The pass is ENTIRELY time-domain.** A streaming decode, sample by sample, summed to mono; the
three bands come out of two one-pole followers, and the tempo envelope out of a fixed hop. **No FFT
anywhere.** A chromagram is usually an FFT affair, so that is the first real design choice, not an
implementation detail.

**The FFT is nevertheless already there.** `juce_dsp` is a declared dependency of
`tracktion_engine` (`tracktion_engine.h`, line 28), so `juce::dsp::FFT` is already linked and costs
nothing to reach. Nothing uses it in the engine today, but nothing has to be added to the build.

**The sidecar is VERSIONED**, and that is the heaviest consequence:

```cpp
// v2 added `transients` + `sensitivity`, v3 `bpm`, v4 the three bands
out += "{\"v\":4,\"fingerprint\":\"";
```

`waveformCache.ts` requires `MIN_CACHE_VERSION = 4`. Going to v5 **invalidates every existing
sidecar**: every song is re-analysed on first opening. Pre-warming absorbs that — it walks the
playlist by itself as soon as the surface has its list — so the invalidation is paid in the
background rather than on the first record put on.

## The cost is a non-issue, and it is measured

What the pass costs today, on six real songs from this machine (`--waveform`, RelWithDebInfo):

| song | duration | analysis | of real time |
|---|---|---|---|
| Sans titre | 204 s | 386 ms | **0.19 %** |
| En Bande organisée | 376 s | 636 ms | 0.17 % |
| In da club | 249 s | 457 ms | 0.18 % |
| Take on me | 246 s | 456 ms | 0.19 % |
| Money Money Money | 188 s | 389 ms | 0.21 % |
| P.I.M.P | 15 s | 82 ms | 0.54 % |

**A fifth of a per cent of real time**, and perfectly linear: ~0.19 % on anything over a minute
(the 0.54 % of the 15 s song is process startup, not analysis). A twenty-song playlist pre-warms in
**about ten seconds**.

So **there is no budget to defend.** Even an approach ten times more expensive would stay under 2 %
of real time and a playlist would stay under two minutes in the background. The criterion is not
speed but ACCURACY and the shape of the code — which removes the resonator bank's main argument and
leaves the FFT, the usual way, better understood, and already linked.

## The ground truth it lacks

Chromagram over 12 classes, then correlation against major/minor profiles —
Krumhansl-Schmuckler, or Temperley's revised profiles. `argmax` over 24 gives tonic + mode.

**No labels in the files** — the 302 mp3s were scanned, ten carry any ID3 text at all, none carries
a `TKEY`. **Seventeen keys have been supplied by hand**, and that is what the measurement below
rests on.

What remains available without them is SYNTHETIC material, whose key is known because it was
written. That does not measure accuracy on real material, and
`packages/audio-probe/src/key.test.ts` says so in its header rather than letting anyone believe
otherwise. It measures what breaks silently: a mis-mapped pitch class, a profile turned the wrong
way, a wheel whose neighbours are not neighbours.

## Measured on real material — and it fails

Seventeen songs of known key, decoded to mono 22 k and put through the detector
(`@studio/audio-probe/key`):

| | right |
|---|---|
| EXACT key, Temperley profile | **9/17 — 53 %** |
| exact key, Krumhansl profile | 9/17 — 53 % |
| COMPATIBLE Camelot code (what a DJ needs) | 13/17 — 76 % |

**That is below the threshold this plan set itself.** "A detection wrong one time in four is worse
than none": this one is wrong one time in two on the key, and one in four on compatibility. It must
not be wired to the desk as it stands. The two profiles tie, so the material still does not separate
them — for a new reason: both are wrong.

### Two real defects, and the settings they justify

**The frame is a DURATION, not a sample count.** 4096 samples give 5.4 Hz bins at 22 k but
**11.7 Hz at 48 k**, the rate the engine runs at — so a C++ port would resolve worse than the
prototype, silently. `FRAME_SECONDS` is what keeps the resolution independent of the file.

**The bottom of the spectrum does not resolve.** A semitone is 3.9 Hz at C2 against 5.4 Hz of
resolution: the bottom octave smears each note over its neighbours and votes for the wrong class.
The low bound is C3 (7.8 Hz), the lowest semitone this frame separates.

> A parameter sweep found 11/17 by raising the bound to G3. Rejected: the best of twenty-four
> configurations, chosen on the same seventeen songs that measure it, is not an estimate — it is
> overfitting on a two-song margin.

### The leads have been tried. None works.

`packages/audio-probe/scripts/key-truth.ts` replays the seventeen songs against four variants:

| variant | exact (Temperley) | exact (Krumhansl) | Camelot |
|---|---|---|---|
| **base** | **9/17** | 9/17 | **13/17** |
| log energy | 7/17 | 6/17 | 11–12/17 |
| harmonics removed | 8/17 | 10/17 | 12/17 |
| log + harmonics | 9/17 | 7/17 | 11/17 |

Removing harmonics gains nothing: one point for Krumhansl, one fewer for Temperley — noise over
seventeen songs, not progress. Log energy is frankly worse.

What that says is more useful than a 6 % gain: **the problem is not in the chromagram folding.** A
profile correlation over a global two-minute chromagram throws away the temporal structure — and
that is where the tonic lives (the cadences, the ends of phrases, the last note). Detectors claiming
85–95 % are not this detector better tuned; they do something else. Going and getting them is a
signal-processing project, not a tuning exercise.

### What holds anyway

| material | detected | margin |
|---|---|---|
| I–V–vi–IV major, **all twelve keys** | right, 12/12 | 0.185 |
| i–iv–V–i minor, **all twelve** | right, 12/12 | **0.410** |
| i–VI–III–VII minor (aeolian), all twelve | the RELATIVE MAJOR | 0.185 |

On synthetic material the detector is right 12/12 in major and 12/12 in minor with a dominant, and
gets the relative wrong on an aeolian minor. That last is not a bug: `i–VI–III–VII` in C minor
contains **exactly** the seven notes of E flat major. No chromagram can tell them apart, because
there is nothing to tell apart — the difference is which of the two sounds like home, and that is
not in the pitch-class histogram. The second row succeeds precisely because the V puts a leading
note in, the one note the relative major has not got.

**And that error costs a DJ nothing**, which is the reason to carry on: a key and its relative share
the Camelot HOUR and differ only in the letter — `8A` against `8B` — and the wheel declares them
compatible. The commonest error therefore lands on a code that mixes with the right one. A test
checks it over all twelve.

The margin does **not** separate those two cases (0.185 on both sides): it says "it is one of these
two relatives", not which. That is honest information and must be presented as such rather than as
a confidence.

## What shipping it would require

- **The same escape hatch as the grid**: a correctable key, in `mix.yaml`, beside `bpm` and `beat`.
  Same gesture, same file, same reason (an opinion belonging to that set), and it costs one `key:`
  field.
- **Saying what is not known.** A weak correlation must display as a doubt and not as an answer —
  the grid already has that vocabulary with `confident`.

The Camelot wheel is a pure table: 24 keys → `1A`…`12B`, and two songs mix if their codes are
identical, adjacent (±1) or of opposite mode at the same number. No measurement in it, so nothing to
decide — and nothing useful either while the measurement is unreliable. The display fits in the
tempo column, under KEY, where pitch is already the subject.

## The way out: separate the WHEEL from the DETECTOR

The audit asked for "no harmonic mixing, no Camelot wheel". It is the WHEEL that is the feature; the
detector is only one way of filling its box, and the less reliable of the two.

The other way is already 90 % built:

- `mix.yaml` already carries per-set corrections, `bpm` and `beat`, with their shared entry editor.
  A `key:` beside them is the same field, the same gesture, the same file;
- the wheel, its neighbours and `compatible()` are written and tested — they never depended on the
  detector;
- and a playlist is twelve to thirty songs, not two hundred and seventy-nine. The seventeen keys of
  this bench were given by hand in a minute.

An entered key is **100 % right**, where a detected one is 53 %. For one use — deciding whether two
records mix — that is the difference between a feature and a trap.

Cheapest first:

1. `key:` in `mix.yaml` + the wheel on screen. The whole feature, with no detection at all, on the
   grid's exact model. **This is the recommendation.**
2. An import: read a `TKEY` when a file carries one (none here, but bought files often do), and
   offer it as a starting value.
3. The detector, one day, as a PROPOSAL marked doubtful — never as an answer — if somebody takes up
   the signal processing.

## What is acquired and will not need redoing

The test bench (seventeen labelled songs, decoded by ffmpeg), the Camelot wheel and its neighbours,
the transposition tests that catch a shifted class mapping, and the cost — 0.19 % of real time,
which will never be the problem.

What remains: a chromagram that counts harmonics as notes.
