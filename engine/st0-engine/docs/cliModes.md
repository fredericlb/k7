# The engine's offline CLI modes

Besides serving WebSocket clients, `st0-engine` runs a few one-shot jobs — the ones that need
what only it has: JUCE's decoders, the plugins it hosts, the Tracktion graph. What is MEASURED
from audio is not among them: that is `@studio/audio-analysis`'s, in TypeScript, because pl8
measures the same files with no engine at all and one implementation is all there should be.

## `--decode <file>`

The file's samples, for `@studio/audio-analysis`: one JSON line,
`{"sampleRate":…,"channels":…,"frames":…}`, then every frame as interleaved float32,
little-endian, every channel, at the file's own rate. The waveform sidecar and a cold module's
true peak are both built from it (`packages/audio-analysis/docs/analysis.md`).

It is here because the engine is what a musician's machine HAS: any format JUCE reads, no ffmpeg
to install. It decides nothing about the samples — no mono sum, no resampling — since anything
decided here would be a second place that analysis has to agree with.

On Windows stdout is switched to binary first: text mode turns every `0x0A` byte of a sample into
two. A header implausible enough to be a corrupt file — no channel, more than 32, a rate past
768 kHz, or longer than twelve hours — is refused before a byte of audio is written. The rate is
bounded for the length's sake too: the twelve hours are counted in frames AT that rate, so an
absurd rate would let an absurd length through.

## `--render`

It builds a **device-free** engine (`makeOfflineEngine`), an Edit populated from
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
UIBehaviour is a no-op, which is why this loop is hand-pumped at all — and a hand-pumped loop that
stops pumping stalls.

`renderTracks` therefore dispatches one message per block (`runDispatchLoopUntil(0)`, which takes
whatever is queued and returns) and gives up after `kStallTimeoutSeconds` without progress rather
than spinning. The cost is not measurable: 20 s of audio bounces in 3.9 s from a wav and 3.9 s from
a flac.

The stack of that stall, for recognition — the wait is `juce::Thread::sleep(1)` inlined, not a device and not
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
whole mix**: two different stems come out bit-identical, and a stem export writes one copy
of the mixdown per track. `trackBits()` here does it properly, against the array actually given.

### Draining, and why a perfect file can still fail

The render calls `drainMessageQueue()` after resetting the Edit. The bounce's own pump stops with the
render loop, so every `asyncUpdate` an external plugin posts while being torn down is still queued
when the Edit goes, and without the drain about half of all renders crash that way, *after* the wav
is fully written and its path printed. A perfect file and a non-zero exit at the caller is the worst shape a bug can
have, since `execFileSync` raises on the code and throws away an answer it already has. The general
rule is in AGENTS.md ("A CLI must drain the message queue before it returns").

## There is no `--normalize`, and that is the design

Normalising is a TREATMENT, and a treatment in this system is a chain. `track process` /
`clip process` bounce material through one, and the médiathèque ships a `normalize` module —
measured by `@studio/audio-analysis` off `--decode` above and rendered through `--render` like every other treatment. See
`packages/audio-passes/docs/processChain.md`.

What a dedicated mode could say and a chain cannot is **one gain across a SET of files**, so a
track's clips keep their relative levels. A chain renders each source on its own, so a track
processed through `normalize` brings every clip to the target independently. That is a real
difference and a deliberate trade: the chain buys a treatment that can be followed by another,
lands in a stamped render beside the source rather than over it, and leaves nothing hard-coded
in the engine.
