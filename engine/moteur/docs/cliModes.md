# The engine's offline CLI modes

Besides serving WebSocket clients, `studio-moteur` runs a few one-shot jobs. The engine
owns them because it owns audio decoding — any format JUCE reads, not just WAV.

## `--waveform <file> [<sensitivity>]`

Turn an audio file into a compact, **placement-independent** peak + RMS envelope, detect its
**transient onsets** and estimate its **tempo**, and write all of it beside the file as
`{file}.cache` (JSON, `"v":3`).

The tempo is autocorrelation over a second, fixed-rate envelope built in the same decode pass —
the stored one is capped in size and coarsens on a long file, which is right for drawing and
useless for finding a beat. `0` means none was found, and is never a guess. What it gets right
and what it does not, measured on click tracks, is in
`packages/file-service/docs/waveformCache.md`.

The sidecar is stamped with a cheap content fingerprint, and the file service recomputes
the SAME fingerprint to decide whether the cache is stale — see
`packages/file-service/src/waveformCache.ts`. **The two fingerprint definitions must stay
byte-for-byte identical**, and so must the two transient detectors: `detectTransients` in
`@studio/commands/waveform` is the reference this file mirrors, and its unit test is the
contract. Changing either means changing both and bumping `"v"`.

`sensitivity` is the detector's threshold in standard deviations above the mean envelope
jump; omitted, it is **2**. It is written into the sidecar beside the onsets it produced, so
the setting is per source and survives until something asks for a different one.

Onsets are stored in FILE SECONDS. Detection happens here, once, at the file's own envelope
resolution — not per clip region in Node, which resampled a short clip's envelope UP and made
the same audio disagree with itself at two zoom levels. Clip-region slicing and the bar/beat
grid still stay in Node; this only produces the whole-file envelope and its onsets.

## `--waveform-batch` (stdin)

One line per file, so a song with many fresh clips pays JUCE's startup once. A line is
`<path>` or `<path>\t<sensitivity>`; it prints `ok\t<path>` or `err\t<path>` per file, flushed,
and one bad file never aborts the batch.

The per-line threshold exists so a prewarm can rebuild a stale envelope **without resetting a
sensitivity somebody tuned** — the Node side reads each file's previous sidecar and sends it
back.

## `--normalize <targetPeak> <in1> <out1> [<in2> <out2> …]`

Peak-normalize a set of clips with a **single shared gain**: decode every input, find the
loudest peak across all of them, compute one `gain = targetPeak / maxPeak`, and write each
input scaled by it — preserving sample rate, channel count and bit depth. Prints a JSON
manifest `{ maxPeak, gain, count }`.

One shared gain is what lets a whole track's clips be normalized together: the loudest hits
the target and the rest keep their relative levels. The `normalize` command in the brain
decides *which* clips and updates the references to the new files.
