# Analysing audio without the engine

A `{file}.cache` sidecar carries a peak/RMS envelope, three colour bands, onsets and a tempo.
`engine/moteur` writes one with `--waveform`, decoding through JUCE. This package writes the same
file from Node, decoding through ffmpeg.

## Why a second producer at all

pl8 is hosted. The engine is never in that image and never will be — it is an instrument on a
musician's machine. But pl8 holds the bytes, so the analysis of a freshly uploaded song has to
happen where the bytes are, or it does not happen at all. ffmpeg is already in the image for k7's
takes and z0's audio, so the decoder was the only piece missing.

The engine keeps its own path where it exists: it is faster, and it is already loaded.

## The arithmetic is a PORT, and that is a constraint

Every constant in `envelope.ts` — 256 frames a bucket, 8192 buckets, the 200 Hz and 4 kHz corners,
the 60–200 bpm range, Ellis's Gaussian prior at 120 — is `engine/moteur/engine/Waveform.cpp`'s.
Changing one on this side alone makes two producers of one file disagree about it.

Onset detection is **not** ported: `@studio/audio-probe`'s `detectTransients` is the reference
implementation that the C++ itself mirrors, so this package calls it rather than making a third
copy of eleven lines.

`fileFingerprint` matters most of all. It is what every reader checks to decide whether a sidecar
still describes the bytes beside it, and a divergence would not throw — it would make each side
quietly rebuild what the other just wrote.

## The mono sum is JUCE's, not ffmpeg's

ffmpeg's `-ac 1` applies a downmix matrix that weights a centre channel. JUCE averages the first
one or two channels and ignores the rest. The sum feeds every number in the sidecar, so this side
does it by hand from the interleaved stream and asks ffmpeg only to decode.

For the same reason there is no `-ar`: resampling would move every onset off the position the
engine reports for the same file.

## Frames come from the decode, not from ffprobe

A bucket boundary is arithmetic on the total frame count, and ffprobe reports a duration that
containers round. The mono signal is therefore accumulated in chunks and measured after, which
costs one float per frame — about 57 MB for five minutes — and is what keeps the geometry exact.

## No `node:` in @studio/audio-probe, and that is why this package exists

`audio-probe` MEASURES audio a caller already decoded, which is why a browser may import it. This
package spawns processes and writes files. Keeping them apart is what stops st0's clip panel from
pulling a decoder into the bundle.
