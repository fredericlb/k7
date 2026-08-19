# One device, several sessions — measured

## The question

Several services (l8, pl8, m9) want an engine each, on one machine. The
obvious shape is N engine *processes*, and it runs straight into the constraint this repo
already documents:

> **An ASIO driver is single-client.** A remembered device gets reopened by *every* process
> that constructs an engine … the driver then stays wedged, and from that point on every
> engine start blocks **forever, with no output at all**.

Shared-mode WASAPI is multi-client — two processes on one device was measured working, both
at realtime, both producing signal. But WASAPI costs latency, and l8 and m9 are
exactly the two that cannot pay it.

So the question became: **can one process hold the ASIO device and host several projects?**

## The answer: yes

Tracktion's `DeviceManager` was built for it. Not a workaround — the design:

```cpp
juce::Array<EditPlaybackContext*> activeContexts;   // plural
...
for (auto c : activeContexts)
    c->fillNextNodeBlock (outputChannelData, totalNumOutputChannels, numSamples);
```

The audio callback iterates every registered context and sums them into one output buffer,
under a `shared_mutex`. `addContext`/`removeContext` are public on the DeviceManager. This
is how Waveform auditions a clip while an Edit plays.

## What was run

`studio-moteur --multi-edit-test <doc…> [--device N --device-type T] [--seconds S]`
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

Run 3 is the one that decides: four projects, one exclusive ASIO client, the buffer size
unchanged at 10 ms. No latency was traded away.

### Why run 1 failed, and why it is worth writing down

`playing=no` on both. Not a multi-Edit problem at all: `populateEdit` kicks off async
message-thread work — 4OSC and `SamplerPlugin` build their voices there — and the probe
went straight from populate to play without pumping the loop. `OfflineRender.cpp` already
records the same trap ("without one flush a rack track renders silent"); this probe walked
into it from the other direction. Pumping before `ensureContextAllocated`, again before
`play`, and again after, fixed it.

The lesson for the real implementation: **a session is not ready when `applyFull` returns.**

## What this changes

The isolation we wanted is at the level of the *project*, not the *process*. So:

* `EngineHost` grows from one `Edit` to a map of `sessionId → Edit`; `applyFull`/`apply`
  become per-session.
* The wire gains a session id on every message that addresses a project (`project`,
  `transport`, `set-plugin-param`, …). Both clients and the C++ move together.
* The broadcast tap becomes per-session, or every listener hears everyone's mix.
* The tray runs **one** engine and shows N sessions — simpler than N engines, and it
  deletes the whole per-engine device problem, the N pidfiles and the N ports.

## What it costs, honestly

* **No fault isolation.** A VST that crashes takes every session with it, not one. That is
  already true today with one engine, so it is not a regression — but it *was* an argument
  for N processes, and it falls.
* **One shared realtime budget.** A heavy session can make the others glitch: they are all
  in the same callback. N processes would have had the same problem on one device anyway,
  but with N devices they would not.
* **`--render` stays a separate process**, and should: it is offline, it opens no device,
  and it has no business in a realtime callback.

## The probe's own status

`MultiEditTest.cpp` and `--multi-edit-test` exist to answer this question and to catch a
regression while the real multi-session engine is built. Once `EngineHost` holds sessions
natively, the probe is redundant — delete it then, not before.
