# waveformCache.ts — extended notes

The on-disk waveform cache is computed BY THE ENGINE. The C++ side decodes an audio
file once (any format JUCE reads — wav/aiff/flac/ogg/…), downsamples it to a
placement-independent peak+RMS envelope, **detects its transient onsets**, and writes all
of it next to the source as `{source}.cache` (JSON), stamped with a cheap content
fingerprint.

This module is the Node side: it computes the SAME fingerprint to tell whether a
sidecar is still valid, spawns the engine to (re)build a missing/stale one, and reads
the envelope back. The clip-region slicing and the tempo grid stay in
`@studio/commands/waveform` — this only produces the `FileEnvelope` those consume.

Sidecars sit next to the audio rather than in a central store, so they travel with the
file and the engine can write one during an offline decode. They're hidden from the file
tree and gitignored.

## The content fingerprint

**MUST match `engine/moteur/engine/Waveform.cpp` byte for byte.**

A cheap, cross-language fingerprint: FNV-1a/64 over the file SIZE (8 little-endian
bytes), then up to `HEAD` bytes from the front and up to `TAIL` bytes from the end.

- It reads at most `HEAD + TAIL` bytes regardless of file length, so it stays fast on
  large audio.
- It depends only on file CONTENT (not mtime), so C++ and Node compute the identical
  value.
- For small files the head/tail ranges overlap — both sides read the same overlapping
  bytes, so the hash still agrees.

String form: `"<size>-<hex16>"`.

## Transients live here too, and that moved them

They used to be detected in `@studio/commands/waveform`, per CLIP REGION, on the envelope
freshly resampled to that region. Two things were wrong with it and one was not a
performance problem:

- a short clip resamples the file envelope **up**, so the detector ran on interpolated
  detail the file never had;
- the same audio drawn at two sizes — the timeline clip and the slice editor's whole-source
  view — therefore disagreed about where its onsets were.

Detecting once, on the file's own envelope at its native resolution, fixes both. The engine
does it while it is already downsampling, so it costs nothing extra, and
`regionWaveform` now only shifts them by the clip's in-point and drops the ones outside the
shown span — exactly what it already did for warp markers.

Stored in FILE SECONDS rather than bucket indices: a consumer maps them onto whatever region
it draws, and seconds survive a change of bucket density that indices would not.

### Which part of the file a region shows

`regionWaveform` has to answer the same question the engine answers, or the picture and the
sound part company. Two things decide it, and each was got wrong once:

- **The in-point** is `sourceFrom + offset`, not `offset` alone. The compiler puts an audio
  clip's in-point in `sourceFrom` (seconds into the file, from `clips/<id>.yaml`'s `from`) and
  leaves `offset` at 0, so a drawing reading only `offset` began every trimmed clip at the file's
  head. `clipPositionFor` in `EditBuilder.cpp` sums the same two.
- **The rate** is `warpStretch(warp, tempo)` — timeline seconds per source second, the ratio
  `applyClipWarp` hands Tracktion. A warped clip covers *less* of its file per bar than an
  unwarped one, so drawing the file at its own rate made the waveform drift away from the sound
  across the clip, by the stretch ratio.

Both are pinned in `waveform.test.ts`. What is deliberately NOT done here: a clip's `length`
still prices its source window 1:1 (`winBeats` in `nodeProject.ts`), so a warped clip stops
before its `to` — the drawing follows the engine in that rather than correcting it, because
changing `length` would change what is played.

### The detector MUST match too

`detectTransients` in `@studio/commands/waveform` is the **reference implementation**, and
`Waveform.cpp` mirrors it. Nothing in production calls the TypeScript one any more — it stays
as the written spec, and `waveform.test.ts` is the contract both are held to. Same
arrangement as the fingerprint above. Change one, change the other, and bump the version.

### Sensitivity is per source, and sticky

The threshold (standard deviations above the mean jump, default **2**) is written INTO the
sidecar beside the onsets it produced. Asking for a different one re-detects and rewrites, so
every other view of that audio agrees from then on; asking for none keeps whatever is there.

Two consequences worth knowing:

- **`--waveform-batch` takes a per-line sensitivity** (`<path>\t<sensitivity>`), and the Node
  side sends each file the threshold its previous sidecar carried. Without that, rebuilding a
  re-recorded take's envelope would silently reset a threshold somebody tuned.
- **Clearing the waveform cache resets it to the default.** This is a cache, and that is what
  a cache means. If the setting ever needs to outlive one, it has to move into the project —
  at which point it stops being derived, and that is a different decision from this one.

## The tempo

The engine also estimates a **bpm** while it is decoding, and writes it into the sidecar. It is
what pl8 seeds a song's `song.yaml` with; the person edits it afterwards, and nothing
overwrites an edited value.

**0 means "no tempo found"** — silence, one sustained note, free time — and is never a guess.

Method: a half-wave-rectified first difference of the envelope, autocorrelated over 60–200 bpm,
weighted by a Gaussian in log2-tempo centred on 120 (Ellis's prior), then parabolically
interpolated around the winning lag.

Two details that were measured rather than assumed, on synthetic click tracks:

- **The tempo envelope is not the stored one.** `peak` is capped at 8192 buckets, so a
  five-minute track lands at ~27 Hz and a beat is a dozen samples wide. Tempo needs uniform
  time resolution, so the decode loop fills a *second* envelope at a fixed hop (~187 Hz at
  48k). With it, a five-minute 128 bpm track reads 127.89.
- **The prior is a preference, not a fold.** Hard-folding into an 80–160 window reported 174 as
  87 and 75 as 150 — it broke both cases it was meant to help. With no weighting at all, raw
  autocorrelation reported 140 as 70, because for a periodic signal the double lag correlates
  about as well.

Measured, after the prior: 120→119.8, 90→90.0, 140→140.3, 128 (5 min)→127.9, 75→75.0,
silence→0. **174 still reads 87**, one octave down: at that distance the prior favours 87, and
no autocorrelation can tell a genre apart. That is a known limit of this class of detector, and
it is acceptable only because the value is a starting point somebody edits.

## The version gate

The sidecar carries `"v"`. v2 added `transients` and `sensitivity`, v3 added `bpm`, and
`readSidecar` **requires the current version**.

That gate is load-bearing rather than tidy: an older sidecar has a perfectly matching
fingerprint — the audio has not changed — so without it every freshness check would pass and
the file would never get the new field at all. Raise it with every field the engine starts
writing. `waveformCacheVersion.test.ts` pins it.

## Caching layers

1. **In-memory memo** — so a burst of waveform requests for the same source doesn't
   re-read the sidecar and re-fingerprint the file every time. Keyed by source path; a
   changed mtime drops the entry (the fingerprint is authoritative, but mtime is the
   cheap first gate). Cleared implicitly by process lifetime.
2. **The freshness verdict** — `cacheFresh` reads the whole sidecar and hashes 128 kB of the
   audio, so `staleWaveformSources` over a project of 110 takes spent ~190 ms answering
   "nothing to do". l8's browser asks for a prewarm after every command, on the same single
   process that is compiling that command's answer. A source judged fresh is remembered against
   the size+mtime of BOTH files, so the next ask is two `stat`s. Only YES is remembered: a
   stale source is about to be rebuilt anyway. The fingerprint still DECIDES — this only skips
   asking again about two files neither of which has moved, which is the gate layer 1 already
   stands on.
3. **The sidecars** — the durable cache.

`ensureFileEnvelope` takes the fast path (memo, or a sidecar whose fingerprint still
matches) and otherwise spawns the engine to decode and rewrite. It throws when the
engine binary is unavailable: this is engine-only, there is no JS decoder fallback.

`runWaveformBatch` computes every stale sidecar in ONE engine process
(`--waveform-batch`), paying JUCE's startup cost once instead of per file. `onResult`
fires per file as it finishes so a caller can drive a live progress count, and each done
source is dropped from the memo so the next read picks up the fresh sidecar.

## v4 — les trois bandes

Le sidecar porte maintenant `low` / `mid` / `high` en plus de `peak` et `rms` : la même
enveloppe découpée à 200 Hz et 4 kHz, dans le même espace de buckets, d'où une waveform colorée
par ce qu'il y a dedans (`packages/ui-turntables/docs/waveform.md`).

`MIN_CACHE_VERSION` monte avec, et c'est la moitié qui porte : un sidecar v3 a une empreinte qui
CORRESPOND, donc sans la bump chaque contrôle de fraîcheur passerait et le fichier n'obtiendrait
jamais ses bandes. Le prix est que tout ce qui est déjà analysé l'est de nouveau, une fois.

Les trois champs restent **optionnels** dans `FileEnvelope`. La porte de version fait qu'un
service à jour ne sert que du v4 — mais une surface qui les lit doit se dégrader vers une
enveloppe simple plutôt que vers une vide, et un type optionnel est ce qui l'y oblige.
