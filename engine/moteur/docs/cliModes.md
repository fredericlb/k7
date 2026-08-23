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
`@studio/audio-probe/waveform` is the reference this file mirrors, and its unit test is the
contract. Changing either means changing both and bumping `"v"`.

`sensitivity` is the detector's threshold in standard deviations above the mean envelope
jump; omitted, it is **2**. It is written into the sidecar beside the onsets it produced, so
the setting is per source and survives until something asks for a different one.

Onsets are stored in FILE SECONDS. Detection happens here, once, at the file's own envelope
resolution — not per clip region in Node, which resampled a short clip's envelope UP and made
the same audio disagree with itself at two zoom levels. Clip-region slicing and the bar/beat
grid still stay in Node; this only produces the whole-file envelope and its onsets.

## `--peak <file>`

The file's TRUE peak — the loudest sample on any channel — as JSON on stdout:
`{"peak":…,"peakDb":…,"frames":…,"channels":…,"sampleRate":…}`. Read by a COLD module's measuring
pass (`@studio/commands`' `peakPass.ts`) to fill in the `Peak` its graph needs before a render.

It exists **because `--waveform` cannot answer this**, which is not obvious and was measured: that
envelope averages the channels into one signal before taking its per-bucket maximum, because it is
drawing a single waveform line. A peak on one channel of a stereo pair therefore reads 6 dB low
there, and two channels in anti-phase read as **silence** — 94 dB out on a file you can plainly
hear. It is also stored at four decimals. Right for drawing, useless for setting a gain.

This streams the file in blocks and takes `getMagnitude` across all channels, so it holds no more
than one block whatever the file's length. Silence reports the `-100` floor rather than negative infinity, which is the
same floor the `Peak` param declares. A float file over full scale is reported as measured: rounding
here would be this mode inventing a policy that belongs to the module.

## `--waveform-batch` (stdin)

One line per file, so a song with many fresh clips pays JUCE's startup once. A line is
`<path>` or `<path>\t<sensitivity>`; it prints `ok\t<path>` or `err\t<path>` per file, flushed,
and one bad file never aborts the batch.

The per-line threshold exists so a prewarm can rebuild a stale envelope **without resetting a
sensitivity somebody tuned** — the Node side reads each file's previous sidecar and sends it
back.

## `--normalize` was here, and is gone

It peak-normalized a set of clips with one **shared gain**, each inside its own window, writing
every file back over itself. Its only callers were the brain's `track normalize` and
`clip normalize`, and both were removed: normalising is a TREATMENT, and a treatment in this
system is a chain. `track process` / `clip process` bounce material through one, and the
médiathèque ships a `normalize` module — measured by `--peak` above and rendered through
`--render` like every other treatment. See `packages/audio-passes/docs/processChain.md`.

What that mode could say and a chain cannot is **one gain across a SET of files**, so a track's
clips keep their relative levels. A chain renders each source on its own, so a track processed
through `normalize` brings every clip to the target independently. That is a real difference and
a deliberate trade: it buys a treatment that can be followed by another, lands in a stamped
render beside the source rather than over it, and leaves nothing hard-coded in the engine.
