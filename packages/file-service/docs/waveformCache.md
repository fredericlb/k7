# waveformCache.ts — extended notes

The on-disk waveform cache is computed BY THE ENGINE. The C++ side decodes an audio file once (any
format JUCE reads — wav/aiff/flac/ogg/…), downsamples it to a placement-independent peak+RMS
envelope, **detects its transient onsets**, and writes all of it next to the source as
`{source}.cache` (JSON), stamped with a cheap content fingerprint.

This module is the Node side: it computes the SAME fingerprint to tell whether a sidecar is still
valid, spawns the engine to (re)build a missing or stale one, and reads the envelope back. Clip
region slicing and the tempo grid stay in `@studio/audio-probe/waveform` — this only produces the
`FileEnvelope` those consume.

Sidecars sit next to the audio rather than in a central store, so they travel with the file and the
engine can write one during an offline decode. They are hidden from the file tree and gitignored.

## The content fingerprint

**MUST match `engine/moteur/engine/Waveform.cpp` byte for byte.**

FNV-1a/64 over the file SIZE (8 little-endian bytes), then up to `HEAD` bytes from the front and up
to `TAIL` bytes from the end. String form: `"<size>-<hex16>"`.

- At most `HEAD + TAIL` bytes are read whatever the file's length, so it stays fast on large audio.
- It depends only on file CONTENT, not mtime, so C++ and Node compute the identical value.
- For small files the head and tail ranges overlap — both sides read the same overlapping bytes, so
  the hash still agrees.

## Transients live here too

Detecting them per CLIP REGION, on the envelope freshly resampled to that region, is wrong in two
ways, and neither is a performance problem:

- a short clip resamples the file envelope **up**, so the detector runs on interpolated detail the
  file never had;
- the same audio drawn at two sizes — the timeline clip and the slice editor's whole-source view —
  then disagrees about where its onsets are.

Detecting once, on the file's own envelope at its native resolution, fixes both. The engine does it
while it is already downsampling, so it costs nothing extra, and `regionWaveform` only shifts them
by the clip's in-point and drops the ones outside the shown span.

Stored in FILE SECONDS rather than bucket indices: a consumer maps them onto whatever region it
draws, and seconds survive a change of bucket density that indices would not.

### Which part of the file a region shows

`regionWaveform` has to answer the same question the engine answers, or picture and sound part
company. Two things decide it, each easy to get wrong:

- **The in-point** is `sourceFrom + offset`, not `offset` alone. The compiler puts an audio clip's
  in-point in `sourceFrom` (seconds into the file, from `clips/<id>.yaml`'s `from`) and leaves
  `offset` at 0, so a drawing reading only `offset` begins every trimmed clip at the file's head.
  `clipPositionFor` in `EditBuilder.cpp` sums the same two.
- **The rate** is `warpStretch(warp, tempo)` — timeline seconds per source second, the ratio
  `applyClipWarp` hands Tracktion. A warped clip covers *less* of its file per bar than an unwarped
  one, so drawing the file at its own rate makes the waveform drift away from the sound across the
  clip, by the stretch ratio.

Both are pinned in `waveform.test.ts`. What is deliberately NOT done here: a clip's `length` still
prices its source window 1:1 (`winBeats` in `nodeProject.ts`), so a warped clip stops before its
`to` — the drawing follows the engine in that rather than correcting it, because changing `length`
would change what is played.

### The detector MUST match too

`detectTransients` in `@studio/audio-probe/waveform` is the **reference implementation**, and
`Waveform.cpp` mirrors it. Nothing in production calls the TypeScript one — it is the written spec,
and `waveform.test.ts` is the contract both are held to. Change one, change the other, and bump the
version.

### Sensitivity is per source, and sticky

The threshold (standard deviations above the mean jump, default **2**) is written INTO the sidecar
beside the onsets it produced. Asking for a different one re-detects and rewrites, so every other
view of that audio agrees from then on; asking for none keeps whatever is there.

- **`--waveform-batch` takes a per-line sensitivity** (`<path>\t<sensitivity>`), and the Node side
  sends each file the threshold its previous sidecar carried. Without that, rebuilding a re-recorded
  take's envelope silently resets a threshold somebody tuned.
- **Clearing the waveform cache resets it to the default.** This is a cache, and that is what a
  cache means. If the setting ever needs to outlive one, it has to move into the project — at which
  point it stops being derived, and that is a different decision.

## The tempo

The engine also estimates a **bpm** while decoding, and writes it into the sidecar. It is what pl8
seeds a song's `song.yaml` with; the person edits it afterwards, and nothing overwrites an edited
value.

**0 means "no tempo found"** — silence, one sustained note, free time — and is never a guess.

Method: a half-wave-rectified first difference of the envelope, autocorrelated over 60–200 bpm,
weighted by a Gaussian in log2-tempo centred on 120 (Ellis's prior), then parabolically interpolated
around the winning lag.

Two details measured rather than assumed, on synthetic click tracks:

- **The tempo envelope is not the stored one.** `peak` is capped at 8192 buckets, so a five-minute
  track lands at ~27 Hz and a beat is a dozen samples wide. Tempo needs uniform time resolution, so
  the decode loop fills a *second* envelope at a fixed hop (~187 Hz at 48k). With it, a five-minute
  128 bpm track reads 127.89.
- **The prior is a preference, not a fold.** Hard-folding into an 80–160 window reports 174 as 87
  and 75 as 150 — it breaks both cases it is meant to help. With no weighting at all, raw
  autocorrelation reports 140 as 70, because for a periodic signal the double lag correlates about
  as well.

With the prior: 120→119.8, 90→90.0, 140→140.3, 128 (5 min)→127.9, 75→75.0, silence→0. **174 reads
87**, one octave down: at that distance the prior favours 87, and no autocorrelation can tell a
genre apart. A known limit of this class of detector, acceptable only because the value is a
starting point somebody edits.

## The version gate

The sidecar carries `"v"`, and `readSidecar` **requires the current version**
(`MIN_CACHE_VERSION`).

Load-bearing rather than tidy: an older sidecar has a perfectly matching fingerprint — the audio has
not changed — so without the gate every freshness check passes and the file never gets the new field
at all. Raise it with every field the engine starts writing, at the price of everything already
analysed being analysed once more. `waveformCacheVersion.test.ts` pins it.

## Caching layers

1. **In-memory memo** — so a burst of requests for the same source does not re-read the sidecar and
   re-fingerprint the file every time. Keyed by source path; a changed mtime drops the entry (the
   fingerprint is authoritative, mtime is the cheap first gate).
2. **The freshness verdict** — `cacheFresh` reads the whole sidecar and hashes 128 kB of the audio,
   so `staleWaveformSources` over a project of 110 takes spends ~190 ms answering "nothing to do",
   and st0's browser asks for a prewarm after every command on the same single process compiling
   that command's answer. A source judged fresh is remembered against the size+mtime of BOTH files,
   so the next ask is two `stat`s. Only YES is remembered: a stale source is about to be rebuilt
   anyway. The fingerprint still DECIDES.
3. **The sidecars** — the durable cache.

`ensureFileEnvelope` throws when the engine binary is unavailable: this is engine-only, there is no
JS decoder fallback. `runWaveformBatch` computes every stale sidecar in ONE engine process
(`--waveform-batch`), paying JUCE's startup cost once instead of per file.

## The three bands

The sidecar carries `low` / `mid` / `high` beside `peak` and `rms`: the same envelope split at
200 Hz and 4 kHz, in the same bucket space, hence a waveform coloured by what is in it
(`packages/ui-turntables/docs/waveform.md`).

The three fields stay **optional** in `FileEnvelope`. The version gate means an up-to-date service
only serves sidecars that carry them — but a surface reading them must degrade to a plain envelope
rather than to an empty one, and an optional type is what forces it to.

## waveformOps.ts — the per-session layer over the sidecars

`waveformOps.ts` slices the engine-computed file envelopes to clip regions, memoises the sliced
results, and prewarms the whole active project in the background. The durable cache is still the
sidecars above; everything in that file is in memory and per session.

### What the memo signature has to fold

`wfSig` folds the envelope's content fingerprint plus the placement, tempo and bucket count the
region math reads. `sourceFrom`, `sourceTo` and the warp markers are in there because they decide
WHICH part of the file the region shows and at what rate: leave them out and trimming a clip's
`from` leaves the old picture on screen. The markers themselves go in, not just "is it warped" —
moving one changes the rate.

**A CACHE IN FRONT OF THIS ONE HAS TO FOLD THE SAME THINGS.** st0's timeline keeps its own entry per
clip, and filed under the id alone it puts that exact bug back one layer up: the block goes on
drawing the untrimmed envelope. Its mirror of this signature is
`apps/st0/frontend/src/clipEnvelope.ts`; change one and read the other.

The sensitivity rides in the signature too, because re-detecting changes the onsets and nothing
else, and a memo keyed only on the fingerprint would keep serving the previous threshold's answer.
The onset corrections ride there for the same reason.

### `whole` means the MATERIAL, not the placement

The clip as its own file defines it, so the span is the source's full duration instead of whatever
musical length a track happened to place it with. That is the view a `clips/<id>.yaml` wants: you
are editing the sample there, and `from`/`to` can only be judged against the whole of it. `whole`
therefore reverses the usual precedence — the definition carries no start/length/offset, which is
exactly what makes the span the file.

Because the window is the thing being JUDGED against the file, it must not also crop the picture.
`regionWaveform` opens the region AT `sourceFrom` and blanks whatever lies past `sourceTo` (two
different cuts — only the first shortens the span), so passing the definition's window through
redraws the pane as the trim itself: head gone, tail flat, and no way left to see what was cut or to
judge putting it back. It also draws two different pictures for the two spellings of one field,
since `mapClip` reads only a NUMERIC `from:`/`to:` — exactly what `clip trim` writes — and a
TIMECODE window escapes it. Drawn windowless and shaded instead, both draw the same one.

The window that is SHADED is the PLACEMENT's, not the definition's. A material states no window at
all (`packages/song/docs/materialCut.md`): a clip file describes the bytes, a placement describes
the use. Shading with the definition's leaves every whole-file view unshaded, and a caller with no
`eventWindow` of its own, like the take review, then frames on the whole file and puts its mark at
zero instead of at the take's head. Handed a bare material name, there is no placement to ask and
the answer is honestly nothing to shade.

The tempo grid is passed down so a TIMECODE `from:`/`to:` resolves to seconds here as it does in the
compiler. An imported song writes nearly all of them that way, and without it the definition comes
back with no window at all.

### The material behind an id

A clip's id identifies a PLACEMENT (`bass_2_0@16`), and the two lookups want different things out of
it: `findClip` wants the placement, while `clips/<ref>.yaml` and the onset corrections are
properties of the file every placement of it shares. Handed a bare material name — which the route
also is, for the whole-file view — `materialRefOf` returns it unchanged.

The clip's own onset corrections are applied to the DETECTED set before anything maps it into the
region. Resolved once here rather than in each surface, so the slice widget, the clip block and the
take review all draw the same onsets without knowing corrections exist. The raw set is sent beside
it, mapped the same way, so an editor can tell which pins it may only refuse and which it may pick
up.

### Prewarm, cancel and clear

Prewarm runs in two phases: rebuild every stale sidecar in ONE engine process, so a song of fresh
clips pays JUCE startup once, then memoise the sliced results on the fast no-spawn path. A newer
prewarm — or a delete — takes over: on Windows a held `.wav` blocks a rename, so cancelling has to
kill the child and not merely stop consuming it.

`clear` drops the memo and every `{source}.cache` sidecar, which is a walk since they sit beside
their audio. The sweep uses the tree's own hidden-name rule, so it never clears where the user does
not consider their workspace to be, and each unlink has its own catch so one sidecar the engine
still holds open does not abandon the rest.
