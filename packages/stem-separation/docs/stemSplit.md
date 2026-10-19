# Splitting a mix into stems

A separation runs HT-Demucs over an audio file on an ENGINE's machine and writes four 24-bit
WAVs — drums, bass, other, vocals — into `stems/` beside it. It is a **job to poll**, not a call
that answers with audio. The cut is the native supervisor's (`engine/k7-supervisor/src/Separation.cpp`
and its neighbours); this package is the seam a server hands it through.

## Why it is a module, and why it cannot be a plugin

A stem separator is the second **cold** module (`@studio/song`'s
[coldModules.md](../../song/docs/coldModules.md)), and it is cold for both reasons that
word covers at once: the answer needs the whole input, and the analysis is affordable once
over a file and hopeless per block.

But it is a shape the normaliser is not — **one input, four outputs** — and that is what
decides everything below. A chain step compiles to a serial insert on one Tracktion track
(`nodeProject.ts`): one buffer in, the same buffer out. There is no fan-out anywhere in
`ProjectDoc`, and the DSP graph has no output port index at all — `GraphBuilder.output()`
takes no port and `DspGraph.cpp` writes one stereo pair. A separator therefore **cannot be
a live plugin**, however the graph is drawn.

So its four outputs are four **files**, and the module says so with
`plugin: { type: offline }` — a third recognised plugin type meaning "no engine plugin; a
pass produces the outputs before the render". It is a word rather than a silence because
the compiler's gate drops any type it does not know, silently — an unrecognised type is how a
module vanishes from a compile with no warning at all.

The wiring is real: `graph.k7x` can key a module by its output
(`stemsplit#vocals: [ reverb ]`), the derivation carries that port along the edge, and
the graph draws a jack per stem. See `@studio/song`'s [ports.md](../../song/docs/ports.md).

## Why a job, when a render is not one

A render ([../../file-service/docs/renderers.md](../../file-service/docs/renderers.md)) needs no job registry: a
few files, seconds, a caller that can simply await it. A separation is the case that turns
every one of those over: **minutes** rather than seconds, a **person** waiting rather than a
call awaited, **four files** to hold, and a subprocess with progress worth reporting.

`separateJobs.ts` makes two choices of its own:

- **The id hashes the WORK** — `(user, source, model)` — not the destination. A separation
  collides over the *inference*, and a retry, a second tab or a remount would otherwise start
  another hour of arithmetic producing byte-identical files.
- **The job carries `files`.** Four stems are the thing the caller came for, and their names
  come from the model rather than from the request. The list is not a report: over `/process`
  it is what the media library COLLECTS, one GET per name, so a file produced but left out of it is written
  on this machine and never reaches the song's folder -- which is exactly how a fifth file,
  written and not listed, once went missing without a word.

## Why 24-bit WAV, and not float or FLAC

The format is decided by the **consumer**, and the consumer is a PLATTER: the desk's four
knobs make a stem something a deck opens
([packages/k7-plugins/docs/turntables/stems.md](../../../packages/k7-plugins/docs/turntables/stems.md)). Were another chain the only
destination, float32 would be the obvious answer — nothing downstream is ever worse than the
model's own output, so rounding on the way out is a loss taken for nobody. A deck loads the file
itself, and that decides it.

Tracktion reads WAV, AIFF and its own `FloatAudioFormat` **directly**, and decodes everything
else into a cached proxy first:

```cpp
// tracktion_AudioFile.cpp
needsCachedProxy = dynamic_cast<juce::WavAudioFormat*> (format) == nullptr
                      && dynamic_cast<juce::AiffAudioFormat*> (format) == nullptr
                      && dynamic_cast<FloatAudioFormat*> (format) == nullptr;
```

FLAC therefore reads, and costs a full decode into a second copy the first time a record goes
on — five of them per deck, since the mix and its four stems all land together. A quarter of
the volume saved, paid for at the one moment nobody has time. So the choice is among the
formats that need no proxy, and there 24 bits is simply the small one:

| | one stem, 4 min stereo | the four | thirty songs |
|---|---|---|---|
| float32 | 85 Mo | 339 Mo | ~10 Go |
| **24-bit** | 64 Mo | 254 Mo | ~7,5 Go |
| FLAC | ~20 Mo | ~85 Mo | ~2,5 Go — behind a proxy |

What 24 bits costs is a quantisation floor at −144 dBFS, and even that is not paid in full: a
part is scaled by its knob, so its own noise enters in proportion to the knob and vanishes with
it ([song-schema/docs/stems.md](../../song-schema/docs/stems.md)). It is not
dithered, for the same order of magnitude — truncation at 24 bits is under the noise of any
converter this will come out of, and dither would put a floor there on purpose instead.

The one thing an integer file cannot do is carry an **overshoot**. The model is not
reconstructing the mix, so nothing holds its output inside ±1; `peakOf` measures each stem
before it is written and the job's `lines` say when one was clamped. Silence would be worse:
the alternative way to learn about it is a click at the loudest moment of the record.

## The rate they are written at, and the alignment story that is over

The model works at 44.1 kHz, so `decode()` resamples the input to reach the fixed input length.
The way BACK was missing for a long time: `wavPcm24` stamps `SAMPLE_RATE` into the header, so a
48 kHz master produced four 44.1 kHz stems and nothing said so. `probeRate()` asks ffprobe what
the source's rate is and `writeStem()` resamples on the way out when it differs; the rate goes
into the job's `lines` when it is not the model's. A source ffprobe cannot read falls back to the
model's rate.

That matters — four parts a few milliseconds apart are a flam on every hit — but it is not
*critical*, because the desk **plays the four parts** and never subtracts them from the record
([song-schema/docs/stems.md](../../song-schema/docs/stems.md) has the reasons and the numbers): a
subtraction would cancel only while the two signals stay aligned to the sample, which a
pitch-preserving stretch breaks as soon as the tempo moves.

**The mp3 encoder delay is real.** An mp3 carries it in its Xing/LAME `Info` tag — 1105 samples on
the record measured — and **ffmpeg trims it while JUCE does not**: `juce_MP3AudioFormat.cpp`
contains no gapless handling at all, and the engine's own `--decode` counts 11 526 192 frames in a
file ffmpeg decodes to 11 455 983. So **a song nobody separated starts 25 ms late in this engine**,
which is inaudible alone and matters only between two lanes — named here because the next person
to measure an mp3 against a wav will find it. And `stemsComplete()` asks the whole folder rather
than its existence: a deck plays the four parts in place of the
record, so three of four is a song missing an instrument, not a separation that half-worked.

## Windows, and how they are folded back — `SeparationAudio.cpp`

The graph's input length is fixed, so a five-minute song is cut into windows of exactly
`SEGMENT` samples and the results are folded back into one signal. Three details decide
whether that is audible.

**The last window is pulled back**, not run past the end. `windowStarts` ends the final window
*at* the file's end, so the tail is covered by real audio rather than by padding. A file shorter
than one window gets a single window at 0, which the caller pads — there is nothing to pull back
to.

**The weight is a triangle**, 0 at the edges and 1 in the middle, which is what makes the 25 %
overlap a crossfade rather than a seam. Each output sample is the weighted mean of every window
covering it, so a sample at the edge of one window — where the model had the least context — is
dominated by the window that saw it in the middle. The ends are nudged off zero on purpose: a
sample covered by exactly one window (the very first and last of a file) would otherwise divide
by a zero weight and come out as silence or NaN.

**The accumulator holds sums, not windows.** `OverlapAdd` keeps sum of (weight × sample) over
the top and sum of weight underneath, divided at the end — the standard overlap-add. Two flat
buffers per stem, because a five-minute song is 13 million samples per channel and keeping every
window alive would be several gigabytes. The weight ledger is per *position*, not per stem or
channel, since every stem sees the same windows.

The WAV writer is by hand: a 44-byte header is smaller than the argument for a dependency.

## Two callers, one job

A cut is asked for from two places: a project's `clip process`, in the account's file service, and
the media library's `POST /api/stems`, which holds the masters and drives the cut of a song in the library
(`apps/k7/backend/docs/media/stems.md`). The worker, the job and `stems/` below are the same either way — only
who is waiting differs.

**The chain is the account's answer.** `stemsChain` in the account's `preferences.yaml`, written
once by `system stems <chaîne>` — or `instrumentalChain`, written by `system instrumental` — is
what a cut falls back to when the caller names none (`packages/file-service/docs/processChain.md`).
Which module separates and which model it wants does not vary by set list, by project or by record,
so a caller made to name one would be asked the same question at every use.

The freshness check is the media library's: **it asks its own disk first**, and a song whose `stems/` already
holds audio never reaches an engine's machine at all.

## Where it runs: the engine's machine, always

A separation runs its model on the machine an ENGINE runs on — its CPU, its GPU, its downloaded
models — and never on the server that hosts the workspaces. The server-hosted file service still
starts and polls jobs through `startSeparate` / `separateJob`, but it installs a **runner**
(`setSeparationRunner`) that sends each one over the jobs channel of the engine it is bound to
(`packages/engine-tunnel/docs/jobs.md`), and the supervisor there runs it. The mix and the model
travel to that machine before the run, the stems back before the reply — so every caller works in
the server's paths.

With no engine bound the job fails at once and says so, rather than cutting on the server: a
server image carries neither the GPU nor, on Alpine, a build of the runtime.

## A thread of its own, and a run that can be told to stop

The supervisor is **shared**: it holds the engine, the tunnel and the heartbeats. An hour of
inference on its loop would stall all of it, so a separation runs on a thread of its own and the
asker polls it.

A thread cannot be killed, but an ONNX Runtime run can be told to stop (`RunOptions` terminate),
and that is what the job's hour uses: past it the job is failed and the run in progress aborted.

The timeout is an hour. That is not the five minutes `render.ts` uses, because it bounds a
different thing: a render taking five minutes has hung, while a separation taking five minutes is
a long song on a CPU. It is set past any honest run rather than near the expected one.

## The model

`htdemucs_fp16weights.onnx` — 166 MB, MIT, weights stored fp16. The graph's input is a
**fixed** `[1, 2, 343980]`: stereo, 44.1 kHz, 7.8 seconds. Not a hint — the graph will not
accept another length, which is why `SeparationAudio.cpp` is entirely about reaching exactly
it. The output is `[1, 4, 2, 343980]`, and the stem order is `[drums, bass, other, vocals]`.
Nothing in the tensor says so; `STEMS` is that knowledge, and getting it wrong silently
swaps two stems.

**What is written is what the chain's module declared**, which is those four unless it names
others. One name is not a stem: `instrumental`, the sum of every stem the voice is not, added
here rather than downstream because the parts are already in memory and a summed file is one
file instead of three to carry.

That sum **grazes full scale and is clamped there**, and it is left that way on purpose. Measured
on one record (The Antlers, *Kettering*): 145 samples of 27 million reach 0 dBFS, against 2 in the
master, at a mean level 1.2 dB below it. Attenuating the file to clear those would make it quieter
than the very recording it is switched against — the rehearsal songbook's player swaps one for the other on a
single element — so the overshoot is clamped and SAID in the job's lines rather than mixed away.

**Where it lives** is the one place this departs from
[moduleAssets.md](../../song/docs/moduleAssets.md). That page argues a module carries its
material — and the argument inverts past a few hundred megabytes, where the file would be
committed into a shared module's git repository and cloned whole by every machine that opens
it. So the module **declares** the model as an ordinary file-valued param (`onnx:`, exactly as
an amp names `model:`) and `<state>/models` holds the bytes. `resolveModuleAsset` tries the
module's own `assets/` first and falls back to the cache; a ref that climbs out of `assets/`
is still **refused**, never redirected.

## Execution providers

Asked for in order and taken on the first that builds. The default is **`cpu` alone, everywhere**.
ORT throws at session creation when a provider is unavailable, so trying is the only way to find out.

**Which one won is logged** into the job's `lines`. The difference is minutes per song, and
a silent fall back to CPU is indistinguishable from a slow machine.

### Why the default does not guess

Any order with `dml` first is a **guess about the hardware**, and the section below is a machine
where the guess is wrong in a way nothing recovers from: DirectML does not fail there, it hangs,
holding a thread and 26 GB of RSS until the job's hour is up. The two outcomes are not comparable,
so the guess is not worth making:

| the guess is wrong | it costs |
|---|---|
| CPU where DML would have been faster | a slower song, correctly separated |
| DML where it wedges | an hour of a held thread, and no stems |

A machine that has **measured** a faster provider says so once, and it survives every restart:

```bash
system onnx dml,cpu     # …or cuda,cpu, or coreml,cpu
system onnx ""          # back to the CPU
```

It lands in the **engine machine's** own settings, `<state>/engine-host.json`, as `onnxProviders`:
the verb runs on the server, and asks the bound machine over the tunnel (`onnx-providers`), because
the provider is a fact about the hardware that runs the separation and about no account. The
separate job reads it there. `STUDIO_ONNX_PROVIDERS` overrides it for one run — an escape hatch,
not how a machine is configured.

CoreML is offered on macOS and cannot compile HT-Demucs; the job says so and runs on the CPU.

### When DirectML is the slow one — measured, 2026-08

On a Ryzen 5 7600X with an RTX 5070 (GB205), `onnxruntime-node` 1.27.0, NVIDIA 610.88, one
window of this model:

| provider | session | per window | a 4-minute song, 41 windows |
|---|---|---|---|
| `cpu` | 4.5 s | **2.0 s** — 3.9× real time | **82 s** |
| `dml` | 4.1 s | never returned | — |

DirectML is not slow here, it **hangs**. Session creation is cheap and costs 800 MB of video
memory; the first `run()` then pins the GPU at 100 % and 250 W, grows to 11 GB of video memory
and 26 GB of RSS, and does not come back — observed past forty minutes, and reproduced outside
the service with the same signature. No `887A0007` is raised, because the fused graph is
submitted as dispatches each of which fits inside `TdrDelay`; only the total is hopeless.

Two consequences beyond the number.

**The run cannot be interrupted from JavaScript.** A promise raced against a timer never loses
the race: `sess.run()` blocks the thread, so the timer never fires. `separateJobs.ts`'s hour and
its `worker.terminate()` are the only things that end such a run, and a job that wedges this way
holds the worker until then.

**The fallback below does not catch it either.** A device removal is what that code is written
for, and this is not one — nothing throws, so nothing retries and nothing moves to the CPU.

Nothing in the process can rescue this, which is why nothing tries: `dml` is not asked for unless a
machine opts in, so this rig is the ordinary case and needs no variable in any launcher's
environment.

What this does *not* establish is whether the fault is DirectML's, this driver's, or this
architecture's. It was not chased further, because the provider that works is four times faster
than real time and the question stopped being expensive.

### Which GPU, when there are two

A machine with an APU and a graphics card has **two** D3D12 adapters, and ONNX Runtime's DirectML
option is a `deviceId` — an index into DXGI's adapter order — with no way to ask for a name, a
vendor or a class. So asking for `dml` and nothing else is asking for **whichever adapter is
first**, which on a laptop is the integrated one driving the panel.

So the supervisor asks DXGI itself (`chooseDml` in `OnnxSession.cpp`), in the order ORT indexes:
a software rasteriser is skipped, and the first adapter with a gigabyte of dedicated video memory
of its own is the one named — a machine old enough to have a discrete GPU under that is not one to
run a transformer on. The name and the index go into the job's line, so which card ran is never a
guess.

**A machine whose only GPU is integrated gets no DirectML at all** and separates on the CPU. That
is a choice rather than a fallback: what is asked of an adapter here is one dispatch covering 7.8
seconds of audio, and the section below is what an iGPU does with it.

### A device lost mid-song

Building a session is not the only way a GPU says no. DirectML also fails *during* a run, and
the way it does is a **device removal** — Windows resets a graphics device whose work exceeded
`TdrDelay` (two seconds by default), so ORT's `run()` throws `0x887A0007` and every later call on
that session throws too. It reads as a malformed command in `FormatMessage`; it is a timeout.

So the fallback is at the run as well as at the create, and it has **two steps rather than one**.
A device removal kills the *session*, not the GPU: the driver recovers in seconds and the adapter
is usable again. So the window is retried on a **fresh DirectML session** first, and only a second
failure moves the song to the CPU. Going straight to the CPU would answer a two-second glitch with
an hour of arithmetic.

Nothing already folded into `OverlapAdd` is lost either way — the throw happens before the window
is added, and the windows the GPU did produce are correct. Only the seam between two providers
differs, by less than the quantisation floor the file is written at.

When the second failure does come, the supervisor **remembers** for as long as it runs, and the
next job starts on the CPU without asking the GPU again. That is the difference between
`playlist stems` costing one device reset and costing thirty: a GPU that has now failed twice on
this model is not having a bad minute. Restarting the supervisor clears it, and it is deliberately not
a preference — the machine that answers "can this GPU do it" is the one that just tried.

What this is *not* is a slow-GPU story, and the arithmetic says so: one window is a few hundred
GFLOP, which any discrete card of this generation does in tens of milliseconds against a two-second
budget. A device reset on such a card points at the driver, or at another application on the same
adapter, rather than at the size of the work — which is why the first answer is to try again.

Raising `TdrDelay` (`HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers`, a DWORD of seconds,
reboot required) is the machine-side fix if the GPU is otherwise fast enough — it is a
system-wide change and nothing in this repo writes it.

## What fails hard, and why that is not a contradiction

ffmpeg decodes the input, and here it is a **hard** dependency — which looks like it
contradicts the rule stated in `@studio/take-render/render`, that a
missing ffmpeg costs the FORMAT and never the render.

It does not. That rule holds because there is always a lesser result to fall back to: the
wav. A separation has none — without a decode there is no input, and without the model
there is no output. So each gets its own sentence, the way a missing engine binary does,
and a missing model is a **503** rather than a failed separation: a machine that has not
downloaded a file is a fixable state, and reporting it as a failure sends the reader to
look at their audio.

## Packaging

ONNX Runtime is a prebuilt shared library, hash-pinned by the supervisor's CMake and **loaded** at
the first separation rather than linked, so a machine missing it still runs its engine and only the
cut says what is missing (`engine/k7-supervisor/docs/supervisor.md`).

**macOS is not covered by signing.** Nothing in this repo signs a third-party `.dylib`, so a
notarised `.app` carrying `libonnxruntime.dylib` is unsolved.

The decode is the one ffmpeg call in this repo that is **not** best-effort, for the reason the
section above gives: elsewhere a missing ffmpeg costs a format and the wav survives, here it costs
the only thing the request asked for. Resampling and mono-to-stereo are ffmpeg's job because the
model's input length is fixed — arriving at 48 kHz is not a quality question, it is the wrong
number of samples. The way back OUT is ffmpeg's job too, for the opposite reason — the
section above.

## The call site

`clip process <clip> <chain>` over a chain whose step is an offline module runs this.
`mediatekChain` diverts the step instead of resolving it to a plugin,
`coldPass.ts` says which model and whether this machine has it, and `processWithChain` runs the
pass in place of the bounce — no render, no repoint, four files under `stems/`. The rules that
follow (a chain separates or treats, never both; the pass runs before the engine check) are in
`@studio/commands`' [processChain.md](../../audio-passes/docs/processChain.md).

The running arrives **as a function**: the seam is `CommandHost.runColdStep`, and the file
service's implementation is the one place that knows what "run it" means — `startSeparate` + poll,
through the runner to the bound machine. So a `clip process` gets two properties for free: the id
hashes the WORK, so a retry or a second tab joins the run in flight, and the hour of arithmetic
runs on the engine's machine while the service answers everything else.

The cost, said out loud: one `/command` request stays open for the length of a separation. The
job registry exists precisely so that a *browser* need not — `POST /separate` is start-then-poll
for exactly that — but a command reports what it wrote, and a verb that returned a job id would
be a different verb.

**And a whole set at once** is `playlist stems <playlist> <chain>`, which runs this over every
song a set list names, on this machine's médiathèque cache. It is the preparation half of cutting
a stem live on a deck (`packages/song-schema/docs/stems.md`): a separated record is played as its four
parts rather than as itself, so the files have to be there before it goes on. Sequential, skipping what is
already done, and leaning on the id hashing the work so an interrupted evening resumes for free.
