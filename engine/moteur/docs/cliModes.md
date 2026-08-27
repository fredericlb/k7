# The engine's offline CLI modes

Besides serving WebSocket clients, `studio-moteur` runs a few one-shot jobs. The engine
owns them because it owns audio decoding — any format JUCE reads, not just WAV.

## `--waveform <file> [<sensitivity>]`

Turn an audio file into a compact, **placement-independent** peak + RMS envelope, detect its
**transient onsets** and estimate its **tempo**, and write all of it beside the file as
`{file}.cache` (JSON, `"v":4`).

The version is a gate rather than a note. `waveformCache.ts` REQUIRES the current one: an older
sidecar has a matching fingerprint and would otherwise read as fresh for ever, missing whatever
the bump added. v2 added `transients` + `sensitivity`, v3 `bpm`, v4 the three band envelopes.

### Three bands, for colour

The envelope is also split into low / mid / high peaks in the same bucket space, so a consumer
indexes all four arrays the same way. The corners are 200 Hz and 4 kHz: 200 keeps kick and bass on
one side, 4 k puts cymbals and the top of a hi-hat on the other, and what is left in the middle is
where voices and snares live.

A drawing does not need steep filters — it needs the three to be COMPLEMENTARY, which two one-pole
followers are by construction: `low + mid + high` sums back to the signal exactly, so a column's
colour cannot invent energy the audio does not have. Their state is carried across read blocks, or
each band would restart every 64k frames. Peaks and not RMS per band, for the same reason the main
envelope uses them: a kick is an attack, and averaging it over a bucket loses the thing being drawn.

### The tempo, and the prior that makes it usable

The tempo is autocorrelation over a **second** envelope, at a fixed hop and therefore a fixed rate,
built in the same decode pass. The stored envelope is capped at 8192 buckets so a long file
coarsens — right for drawing, useless for finding a beat, since a five-minute track lands at ~27 Hz
and a beat would be a dozen samples wide. The fixed one stays at `sampleRate / 256` whatever the
length: ~187 Hz at 48 kHz, about 220 KB of float for five minutes. It is a half-wave-rectified first
difference, because a beat is where energy RISES; the raw envelope would correlate a sustained note
with itself and report its length as the tempo.

Correlation is then weighted by a Gaussian in log2-tempo centred on 120 bpm, sigma one octave —
Ellis's weighting. **A PRIOR, not a fold**, and the difference is measured:

- Hard-folding into a "tempo people tap" window (80–160) reports **174 as 87** and **75 as 150**. It
  breaks both of the cases it is meant to help.
- With no weighting at all, raw autocorrelation reports **140 as 70**: for a periodic signal the
  double lag correlates about as well, since every second beat lands on it.
- The prior settles that by preference rather than by decree, so a tempo far from 120 can still win
  if the audio insists.

What it does NOT fix is the far end: 174 still reads 87, because one octave out the prior favours
87 and nothing in an autocorrelation can tell a genre apart. That is a known limit of this class of
detector, acceptable here only because the number is a STARTING POINT the person edits in
`song.yaml`.

The winning lag is parabolically interpolated, which is not a refinement: at 187 Hz a whole-sample
lag is about 1 bpm at 120, and a tempo reading 119 when it is 120 drifts every grid derived from it.

`0` means none was found — silence, one sustained note, free time — and is never a guess. What the
detector gets right and what it does not, measured on click tracks, is in
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
resolution — not per clip region in Node, which resamples a short clip's envelope UP and makes
the same audio disagree with itself at two zoom levels. Clip-region slicing and the bar/beat
grid stay in Node; this only produces the whole-file envelope and its onsets.

## `--peak <file>`

The file's TRUE peak — the loudest sample on any channel — as JSON on stdout:
`{"peak":…,"peakDb":…,"frames":…,"channels":…,"sampleRate":…}`. Read by a COLD module's measuring
pass (`@studio/commands`' `peakPass.ts`) to fill in the `Peak` its graph needs before a render.

It exists **because `--waveform` cannot answer this**, which is not obvious: that envelope
averages the channels into one signal before taking its per-bucket maximum, because it is
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

## `--render` and the freeze

Both build the same thing: a **device-free** engine (`makeOfflineEngine`), an Edit populated from
the doc, and `te::Renderer` pulling the graph directly. Why no device is opened, and why the hosted
audio interface is initialised with `useMidiDevices = false` before anything pumps the message
loop, are in AGENTS.md — those two are the most expensive traps in this engine and the page holds
the stacks and the shell command that confirm them. What follows is everything else.

### Any source that is not a wav plays off a PROXY, and the proxy needs the message loop

Tracktion decodes every clip whose source is not wav/aiff/float into a **cached proxy** — a wav
under `%APPDATA%/Studio/Temporary/edit_<id>/proxy_<hash>.wav`. `AudioFileInfo::needsCachedProxy`
is set for any other format, so mp3, flac and ogg all take that route and
`AudioClipBase::getPlaybackFile()` hands the WaveNode the proxy rather than the file the doc named.

Nothing renders that proxy synchronously. `createNewProxyAsync` starts a **600 ms `juce::Timer`**,
and it is the timer callback that queues the render job — so the proxy only ever begins to exist in
a process that dispatches messages. Meanwhile `WaveNode::isReadyToProcess()` stays false for as
long as its file has no reader (that check is live *only* during an offline render), and
`NodeRenderContext::renderNextBlock` answers "not ready" with `jobNeedsRunningAgain` after a 1 ms
sleep.

So a bare `while (task->runJob() == jobNeedsRunningAgain) {}` spins forever on a file nobody is
writing. It prints nothing, burns about a tenth of a core — all of it the sleep — and leaves
`mix.wav` created at 0 bytes. A wav bounces in seconds and the same audio as mp3 never returns,
which reads as a wedged machine rather than as one unsupported format. The real app never meets
this: `UIBehaviour::runTaskWithProgressBar` runs the task beside a live message loop. The headless
UIBehaviour is a no-op, which is why this loop is hand-pumped at all — and hand-pumping is what
dropped the loop.

`renderTracks` therefore dispatches one message per block (`runDispatchLoopUntil(0)`, which takes
whatever is queued and returns) and gives up after `kStallTimeoutSeconds` without progress rather
than spinning. The cost is not measurable: 20 s of audio bounces in 3.9 s from a wav and 3.9 s from
a flac, where the flac used to take forever.

The old stack, for recognition — the wait is `juce::Thread::sleep(1)` inlined, not a device and not
an RPC:

    NtWaitForSingleObject
      WaitForSingleObjectEx
      tracktion::engine::NodeRenderContext::renderNextBlock
      tracktion::engine::Renderer::RenderTask::renderAudio
      tracktion::engine::Renderer::RenderTask::runJob
      studio::renderTracks

The tell that separates it from the two AGENTS.md traps: the edit's temp directory stays **empty**
the whole time, so nothing is even trying to decode. A one-track doc rendered from a wav and from
the same audio as mp3 settles it in a minute.

### `te::toBitSet` is broken upstream — do not use it

`Renderer::Parameters::tracksToDo` is a bitset over `getAllTracks(edit)`, and Tracktion's helper for
building one iterates the EDIT's tracks instead of the argument it is handed:

```cpp
for (auto t : allTracks)
    if (int index = allTracks.indexOf (t); index >= 0)
        bitset.setBit (index);
```

So it sets every bit whatever you pass in, and **any render asking for a subset silently gets the
whole mix**: two different frozen tracks come out bit-identical, and a stem export writes one copy
of the mixdown per track. `trackBits()` here does it properly, against the array actually given.

### Freezing is the stem path with another destination

That is deliberate. A stem is already "this track through its own plugins, with no master", which
is exactly the freeze boundary. Nothing in the engine has to work out where a track's chain stops,
because the compiler settled it long before the doc arrived: a bus's modules live on the bus's own
return track, never on this one's plugin list, so "up to OUT, or up to a module fed by several
inputs" is simply what this track's plugins ARE.

**The caller neutralises the track's gain, pan, mute and every solo in the song** before handing the
doc over. Those stay live on a frozen track, so baking them in would apply each of them twice.

`--track` takes a track **id**, and the lane is found with `trackById` — the same doc-index map the
live engine uses. It used to compare the id against `Track::getName()`, which `populateEdit` sets
from the track's `name`: the two coincide only when a document omits the name, so freezing anything
else answered "no track '<id>' in the project". The name is still tried as a fallback.

A track that renders silent is refused rather than written: a file of zeroes would then play in
place of a track the user can still fix.

### Draining, and why a perfect file can still fail

Both paths call `drainMessageQueue()` after resetting the Edit. The bounce's own pump stops with the
render loop, so every `asyncUpdate` an external plugin posts while being torn down is still queued
when the Edit goes — roughly half of all freezes used to crash that way, *after* the wav was fully written
and its path printed. A perfect file and a non-zero exit at the caller is the worst shape a bug can
have, since `execFileSync` raises on the code and throws away an answer it already has. The general
rule is in AGENTS.md ("A CLI must drain the message queue before it returns").

## There is no `--normalize`, and that is the design

Normalising is a TREATMENT, and a treatment in this system is a chain. `track process` /
`clip process` bounce material through one, and the médiathèque ships a `normalize` module —
measured by `--peak` above and rendered through `--render` like every other treatment. See
`packages/audio-passes/docs/processChain.md`.

What a dedicated mode could say and a chain cannot is **one gain across a SET of files**, so a
track's clips keep their relative levels. A chain renders each source on its own, so a track
processed through `normalize` brings every clip to the target independently. That is a real
difference and a deliberate trade: the chain buys a treatment that can be followed by another,
lands in a stamped render beside the source rather than over it, and leaves nothing hard-coded
in the engine.
