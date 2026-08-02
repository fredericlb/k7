# The engine's offline CLI modes

Besides serving WebSocket clients, `lanes-engine` runs a few one-shot jobs. The engine
owns them because it owns audio decoding — any format JUCE reads, not just WAV.

## `--waveform <file>`

Turn an audio file into a compact, **placement-independent** peak + RMS envelope and write
it beside the file as `{file}.cache` (JSON).

The sidecar is stamped with a cheap content fingerprint, and the file service recomputes
the SAME fingerprint to decide whether the cache is stale — see
`packages/file-service/src/waveformCache.ts`. **The two fingerprint definitions must stay
byte-for-byte identical.**

Clip-region slicing and the bar/beat grid stay in Node; this only produces the whole-file
envelope.

## `--normalize <targetPeak> <in1> <out1> [<in2> <out2> …]`

Peak-normalize a set of clips with a **single shared gain**: decode every input, find the
loudest peak across all of them, compute one `gain = targetPeak / maxPeak`, and write each
input scaled by it — preserving sample rate, channel count and bit depth. Prints a JSON
manifest `{ maxPeak, gain, count }`.

One shared gain is what lets a whole track's clips be normalized together: the loudest hits
the target and the rest keep their relative levels. The `normalize` command in the brain
decides *which* clips and updates the references to the new files.
