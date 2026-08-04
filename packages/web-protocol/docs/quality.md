# Engine quality — Q1, Q2, Q3

How good a link to an engine is, as **one number and a band**. The number is milliseconds
from a gesture to a sound:

```
totalMs = the whoami round trip  +  2 × bufferFrames / sampleRate
          ── the network half ──     ─── the audio interface's half ───
```

| band | latency | what it means |
|---|---|---|
| **Q1** | < 20 ms | playable — you can perform through this engine |
| **Q2** | 20–50 ms | workable — editing, auditioning, mixing |
| **Q3** | ≥ 50 ms | for listening rather than playing |

## Why it replaced the tier

There used to be a locality TIER: loopback answered (1), a LAN address did (2), or nothing
did (3). It read as a proxy for speed and was not one. A gigabit LAN to a machine with a
tight interface ranked *below* the laptop in front of you running at 2048 frames — and the
laptop is the one you cannot play through. What a musician can and cannot do on an engine
is decided by the milliseconds, not by which cable they arrive over.

**Unreachable survived the tiers**, because it is not a slow link: nothing answered, so
there is no number. `RankedEngine.latency` is null there, and `isReachable()` narrows it.

## Why the audio half is doubled

A note goes IN, is handled a block late, and comes back a block later. One buffer period
would describe playback alone and quietly halve the figure the 20 ms threshold is read
against — which is the threshold that decides whether you can perform at all.

It is still a **floor**, not the truth: converters, drivers and the OS add their own, and
the engine reports the only part it knows.

## Zero means "not measured"

An engine whose audio device has not opened reports `bufferSize: 0`, and `audioLatencyMs`
answers 0 rather than pretending. Treating that as 0 ms would credit an engine that cannot
make a sound at all with the best latency on the list, so every surface shows "latency
unknown" instead of a band.

## Where it is measured, and where it is drawn

- **Measured once**, in `packages/engine-browser/src/probe.ts`, by the same round trip that
  identifies the engine — a second query would measure a second, warmer trip.
- **Drawn** in the pickers (fastest first, each row badged) and in the status bar of every
  service that drives an engine: l8, the médiathèque, m9. It belongs there because it
  describes the SESSION, not a screen.
- **Reported** to the backend on `select` (`latencyMs`), which is where the constraints this
  is for will live — "no take on a Q3 engine" is a question only the server can answer, and
  only if it was told the number.

## The engine's half of it

`whoami` carries `bufferSize` and `sampleRate` (`engine/moteur/server/main.cpp`), read off the
open device through `EngineHost::audioTiming()`. It is answered on the connection thread, not
posted to the message thread: posting would put the probe behind whatever the engine is doing
and turn the ping into a measure of its queue.

**The engine asks for 256 frames** (`kPreferredBufferFrames`, AudioDevices.cpp), on the first
open and on every later change of interface. At 48 kHz that is 10.7 ms — Q1 with room left for
the network. It matters because a Windows endpoint hands out 480 by default, which is 20 ms on
its own and lands the machine *in front of you* in Q2, measured:

```
before: {"bufferSize":480, …}  → 20.0 ms of interface  → Q2
after:  {"bufferSize":256, …}  → 10.7 ms of interface  → Q1
```

It is a preference, not a promise: the nearest size the device offers wins, ties go to the
larger (a dropout is worse than a millisecond), and some drivers — ASIO especially — own the
setting outright. Nothing pretends otherwise, because the number on screen is always read back
off the open device rather than assumed from the constant.
