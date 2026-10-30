# One device, several sessions — measured

## Why one process, and not one per service

Several services (k7, the media library, the DJ desk) want an engine each, on one machine. The obvious
shape is N engine *processes*, and it runs straight into the constraint this repo already
documents:

> **An ASIO driver is single-client.** A remembered device gets reopened by *every* process
> that constructs an engine … the driver then stays wedged, and from that point on every
> engine start blocks **forever, with no output at all**.

Shared-mode WASAPI is multi-client — two processes on one device play at realtime and both
produce signal. But WASAPI costs latency, and k7 and the desk are exactly the two that
cannot pay it.

So **one process holds the ASIO device and hosts several projects**.

## Tracktion is built for it

Not a workaround — the design:

```cpp
juce::Array<EditPlaybackContext*> activeContexts;   // plural
...
for (auto c : activeContexts)
    c->fillNextNodeBlock (outputChannelData, totalNumOutputChannels, numSamples);
```

The audio callback iterates every registered context and sums them into one output buffer,
under a `shared_mutex`. `addContext`/`removeContext` are public on the DeviceManager. This
is how Waveform auditions a clip while an Edit plays.

## The probe, and what it reports

`k7-runtime --multi-edit-test <doc…> [--device N --device-type T] [--seconds S]`
(`engine/MultiEditTest.cpp`). It builds one Edit per document, hangs a `LevelMeterPlugin` on
each master, allocates every context on the one DeviceManager, plays them all, and reports
each Edit's own peak. Per-edit level is the measurement on purpose: *"addContext did not
throw"* and *"the block is actually being filled"* are different claims, and only the second
one matters.

| run | device | sessions | result |
|---|---|---|---|
| 1 | Windows Audio, Focusrite | 2 | **silent, transport not rolling** — see below |
| 2 | Windows Audio, Focusrite | 2 | −3.89 dB / −3.88 dB, both playing |
| 3 | **Focusrite USB ASIO**, 480 @ 48 kHz = **10 ms** | **4** | −7.53 / −7.55 / −7.52 / −7.48 dB, all playing |

Row 3 is the one that decides: four projects, one exclusive ASIO client, the buffer size
unchanged at 10 ms. No latency is traded away.

### A session is not ready when `applyFull` returns

Row 1 is what a probe reads when it goes straight from populate to play: `playing=no` on
both, and nothing about multi-Edit. `populateEdit` kicks off async message-thread work —
4OSC and `SamplerPlugin` build their voices there — so the loop must be pumped before
`ensureContextAllocated`, again before `play`, and again after. `OfflineRender.cpp` records
the same trap from the other direction: without one flush a rack track renders silent.

## What follows from it

The isolation wanted here is at the level of the *project*, not the *process*. So:

* `EngineHost` holds a map of `sessionId → Edit` rather than one `Edit`; `applyFull`/`apply`
  are per-session.
* Every message that addresses a project carries a session id (`project`, `transport`,
  `set-plugin-param`, …). The clients and the C++ agree on it — `docs/protocol.md`.
* The broadcast tap is per-session, or every listener hears everyone's mix.
* The supervisor runs **one** engine and reports N sessions — simpler than N engines, and it
  deletes the whole per-engine device problem, the N pidfiles and the N ports.

## What it costs, honestly

* **No fault isolation.** A VST that crashes takes every session with it, not one. That is
  the price of the shape, and it is the one argument N processes had.
* **One shared realtime budget.** A heavy session can make the others glitch: they are all
  in the same callback. N processes would have had the same problem on one device anyway,
  but with N devices they would not.
* **`--render` stays a separate process**, and should: it is offline, it opens no device,
  and it has no business in a realtime callback.

## A stopped session still pays its whole graph

Every session's context stays in the callback, stopped or not: an idle k7 project, a médiathèque
preview and the DJ desk each render every amp, reverb and synth on silence, block after block
(`renderPool.md` measures a stopped graph at most of a playing one). The engine does **not** park a
stopped session, because "stopped" is not what says a session is silent here:

* **a deck plays with the transport stopped** — the turntable reads its own record at its own rate
  (`turntable.md`), and so does a pattern lane's audition;
* **a recorder node captures with the transport stopped** (`recorder.md`), and its ring must keep
  being written;
* **a monitored input** passes through its chain whatever the transport does, and its input
  instances live ON the playback context, so freeing the context drops them;
* **a tail rings out** after a stop: a reverb cut there clicks, and comes back stale on play.

The mechanism that would do it is Tracktion's own — `TransportControl::freePlaybackContext()` and
`ensureContextAllocated()` — and nothing in the engine calls the first today. Parking a session is
safe only when all of these hold at once, checked on the message thread: the transport stopped and
not recording; no track armed or monitored; no recorder node recording; no turntable spinning, no
pattern lane or preview auditioning, no live MIDI held; no broadcast listener; and the session's
output meter silent (−60 dB) for a few seconds, which is what says the tails are done. Un-parking is
`ensureContextAllocated()` followed by what `applyFull` does after it — the track inputs and outputs,
the record listener, the recorder taps — on play, monitor, arm, audition, a deck's start or a
listener. That is the change this page would need to describe; until a probe measures the wake-up
(the context build is the slow part of `applyFull`), it is not made.

## What the probe is for now

`MultiEditTest.cpp` and `--multi-edit-test` drive N contexts on one DeviceManager **without
going through `EngineHost`'s session map**, which is what makes the numbers above a property
of Tracktion rather than of our code. Run it when a device, a driver or a Tracktion bump puts
that in doubt.
