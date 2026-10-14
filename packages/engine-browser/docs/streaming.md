# Listening to the engine over the network

This is a **mockup, not a design**: it exists to measure end-to-end latency, the CPU cost on
the audio thread, and what happens when a listener drops. Everything below is the browser half
and the reasoning behind every number in it. The engine half is
`engine/st0-engine/docs/broadcast.md`.

## Who listens

Two callers subscribe. The rehearsal recorder records a library chain from it
(`packages/ui-rehearsal/docs/chainSource.md`). And `engineOutput.ts` plays it for any page driving
an engine whose `whoami` says `audioToBrowser`: the server's own engine, whose device is a null sink
(`docs/server-engine.md` at the repo root). There, the broadcast is the ONLY way the music reaches a
person, so the measurements below are what a user hears, not a mockup's numbers.

## Why a binary frame on the existing socket

The engine already serves an IXWebSocket server that every client is already connected to.
A second channel would mean a second port, a second entry in the engine's web-UI allowlist, a second
thing to authenticate and a second thing to fail — for audio that is going to the same
place as the JSON.

So: **binary WebSocket messages on the same socket**. `ws.binaryType = "arraybuffer"` and
one branch in `onmessage`. Text is control, binary is audio, and nothing else has to change.

`binaryType` is load-bearing: without it a binary frame surfaces at `EngineClient` as a `Blob`,
which `String()` turns into `"[object Blob]"`, which fails `JSON.parse`, which the `catch`
swallows. The audio would be discarded in perfect silence.

## Why float32, uncompressed

48 kHz stereo float32 is 384 kB/s — about **3 Mbit/s**. On a LAN that is nothing. Over the
internet it is far too much, and that is when Opus earns its dependency.

For a *measurement* the uncompressed path is the right one, and not only because it is
simpler: the point of the exercise is to measure the **transport**, and a codec in the path
would fold its own latency and its own CPU into every number. Float32 also happens to be
what JUCE hands out and what `AudioWorklet` wants, so no conversion happens at either end
and the audio thread does nothing but copy.

The frame header carries a `codec` byte, and a decoder that meets a codec it does not know
returns `null` rather than playing the bytes. That is what makes Opus addable later without
a flag day: an old client goes quiet instead of playing compressed data as PCM.

## The frame

32 bytes of header then interleaved float32
(`packages/engine-protocol/stream.ts`). Two constraints shaped it:

* **32 is a multiple of 4**, so the payload can be read as a zero-copy `Float32Array` view
  over the same buffer. Had the header been 30 bytes, everything would still decode in the
  tests and throw in the browser.
* **The payload's byte order is the platform's**, because a `Float32Array` view has no
  endianness option. Every target that exists is little-endian, so rather than pay a
  per-sample `DataView` loop for a case that has never happened, the module asserts the
  assumption once at load and throws a named error if it is ever wrong.

`seq` is a 32-bit counter. Since the transport is TCP, **nothing is lost in flight** — a
gap in the sequence always means the *sender decided to drop*, under backpressure. That
distinction is why the number is there at all.

`captureMs` is the engine's steady clock, milliseconds since its own boot. It is useless on
its own: the two machines' epochs are unrelated, so the raw difference is a constant
offset, not a latency. Only *changes* in that difference mean anything, which is what
`StreamPlayer` measures.

## The split: policy on the main thread, a dumb ring on the audio thread

`streamPlayer.ts` decodes, counts, measures and decides. `streamSink.ts` holds an
`AudioWorkletProcessor` that does nothing but copy out of a preallocated ring.

That split is not tidiness. The worklet's `process()` runs on the audio thread, where an
allocation or a lock is a dropout; anything that can live outside it must. It also makes
the interesting half testable — `StreamPlayer` takes a `StreamSink` interface and a clock,
so every measurement above is pinned by a test that runs with no `AudioContext` at all.

### Why the processor is a string

`addModule` takes a URL. `new URL("./processor.js", import.meta.url)` needs a bundler
configured to emit the worklet as its own chunk — and these packages are consumed as **raw
TypeScript with no build step**, in four different apps. A Blob URL built from a source
string works identically everywhere and asks nothing of any app.

The cost is real: nothing type-checks, lints or formats inside that string. It is kept
short enough to read in one screen, and that is the whole mitigation.

### What the processor does at the edges, and why

* **It waits for a cushion before starting** (`startFrames`, default **150 ms**). Starting
  on the first sample underruns on the very next block for any jitter at all, and 150 ms is
  what the measurements below ask for.
* **An underrun outputs silence, not a repeat of the last block.** A repeat sounds
  smoother — which is exactly the problem. This mockup exists to *find* dropouts, and a
  concealment that hides them would defeat it. When the measurements are in and the design
  is real, concealment is a reasonable thing to add.
* **An overrun drops the OLDEST frames**, not the newest. A listener who fell behind wants
  to catch up to live; replaying their backlog is the one thing they did not ask for.
* **Stats are posted ~7 times a second**, not per block: `postMessage` allocates, and the
  audio thread would pay for it 375 times a second otherwise.

## What is deliberately NOT here: drift correction

Two sound cards nominally at 48 kHz are two crystals. At 50 ppm they diverge by 3 ms per
minute — so a fixed cushion drains or overflows, and a session long enough to matter always
ends in a dropout.

The fix is either resampling on the fly, or a control loop that nudges playback rate, or
WebRTC (whose stack already does this). All three are real work, and **which one is right
depends on how much drift there actually is** between the machines in question. So this
mockup does not correct drift. It **measures** it: `StreamStats.driftMsPerMin`, reported as
`null` until a minute of stream has gone by, because below that the slope is jitter and a
number there would invite acting on noise.

That is the measurement that decides the real design. Take it before writing the fix.

## Reading the numbers

| what | where | what it decides |
|---|---|---|
| `jitterMs.max - jitterMs.min` | `StreamPlayer.snapshot()` | how deep the cushion must be |
| `driftMsPerMin` | same | resample, rate-nudge, or WebRTC |
| `dropped` | same | whether the sender's backpressure policy is right |
| `depth` | `sink.stats()` | the live latency, and where drift shows as a trend |
| `underruns` / `overruns` | same | whether the cushion above is actually enough |

A run that matters is a long one: minutes, not seconds, because drift is the thing that
only appears with time.

## What the measurements say

`node engine/st0-engine/scripts/listen-headless.mjs ws://HOST:PORT [seconds]` bundles *these*
modules with esbuild, serves them, and drives headless Chrome over CDP — so the worklet
below really renders, with nobody in the room. Against a live engine on loopback:

| | 30 s @ 50 ms | 110 s @ 50 ms | 120 s @ 150 ms |
|---|---|---|---|
| frames decoded | 2988 | 10995 | 12000 |
| dropped / undecodable / format changes | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| **jitter spread** | 22 ms | **66 ms** | 31 ms |
| **worklet underruns** | 0 | **1** | **0** |
| overruns | 0 | 0 | 0 |
| buffer depth (frames) | 1920 → 2144, min 1920 | 2240 → 3104, **min 64** | 7040 → 6400, **min 5600** |
| drift | — | −0.17 ms/min | −0.11 ms/min |

The third column is what settles the default: at 150 ms the ring never comes within 5600
frames of empty, where a 50 ms cushion reaches 64 and loses a block over a long run.

**The network is not the problem.** The sender's own jitter, measured from Node on the same
machine, is 2.2 ms. Through a browser it is 22 ms over 30 s and 66 ms over 110 s — because the
number being measured is the *listener's main thread*, which also runs everything else the page
does.

That is the whole shape of the lesson: a cushion is not sized against the network, it is
sized against the worst stall of the machine playing it back. Expect a real st0 tab, with
a React tree and a canvas, to be worse than this one.

**Drift, by contrast, is a non-event** — −0.17 ms/min here, −0.46 ms/min measured from
Node against the engine's own card. Both are small enough that a cushion outlives any
session, which is why there is no resampler.

Two caveats worth keeping: headless Chrome renders Web Audio to a null sink clocked by the
system timer, not by a sound card, so its drift figure is not a real two-crystal
measurement; and the harness's own CDP polling contributes some of the stall it reports.
Neither weakens the conclusion — a real tab has *more* to do, not less.
