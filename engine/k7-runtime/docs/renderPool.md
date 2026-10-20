# The render pool — four threads on a desktop, not every core

A playing Edit is rendered by Tracktion's node player: the audio thread plus a pool of workers that
take the graph's independent branches. Tracktion sizes that pool from
`EngineBehaviour::getNumberOfCPUsToUseForAudio()`, which answers **every core** unless the behaviour
says otherwise, and its workers wait between blocks under `lightweightSemHybrid` — a semaphore with
a spin in front of it. `ServerBehaviour` (`engine/EngineHostImpl.h`) says otherwise, through
`RenderPool.h`.

## What was decided

| | value | why |
|---|---|---|
| threads, desktop | **`min(cores, 4)`** | the callback costs the same as with every core, and the engine about half |
| threads, phone | every core | never measured there, and a phone's cores are not alike (big.LITTLE) |
| strategy | `lightweightSemHybrid`, Tracktion's own | at four threads the strategies are within noise of each other |

The audio thread counts as one of the four, as it does in Tracktion's own figure.

The hazard is the waiting, not the work. Twelve workers on a twelve-core machine each wake for every
block, find little to take, and spin before they sleep: the engine spent about **40 % of a core** on
that while rendering nothing more than four threads render. The cost grows as the buffer shrinks,
since the wake-ups are per block.

## Measured

`01.danse` (15 tracks, 62 plugin instances, two of them external VSTs) and `05.paradoxe`
(18 tracks, 48 instances), each played in the desktop app on a 12-core Windows machine through a
Focusrite ASIO interface. Engine CPU is the whole process, in % of ONE core; the callback is
`audio-cost`'s per-block mean and worst block over 24 s of playback. Two to three passes each, one
row per pass.

Buffer 256 at 48 kHz, a **5.33 ms** deadline:

| song | threads | strategy | engine stopped | engine playing | callback mean | worst block |
|---|---|---|---|---|---|---|
| danse | 12 | lightweightSemHybrid | 70 / 67 % | **83 / 81 %** | 0.83 / 0.84 ms | 1.48 / 1.51 ms (28 %) |
| danse | 12 | semaphore | 56 / 55 % | 68 / 71 % | 0.82 / 0.82 ms | 1.46 / 1.58 ms |
| danse | 12 | conditionVariable | 47 / 47 % | 61 / 65 % | 0.79 / 0.79 ms | 1.46 / 1.48 ms |
| danse | 12 | hybrid | 60 % | 75 % | 0.80 ms | 1.60 ms |
| danse | 6 | lightweightSemHybrid | 40 / 50 % | 54 / 61 % | 0.75 / 0.78 ms | 1.39 / 1.35 ms |
| danse | **4** | lightweightSemHybrid | 40 / 40 / 34 % | **46 / 46 / 42 %** | 0.77 / 0.79 / 0.78 ms | 1.69 / 1.35 / 1.45 ms (25–32 %) |
| danse | 4 | semaphore | 35 / 40 % | 45 / 49 % | 0.78 / 0.79 ms | 1.41 / 1.55 ms |
| danse | 4 | conditionVariable | 44 / 39 % | 43 / 48 % | 0.77 / 0.77 ms | 1.39 / 1.39 ms |
| danse | 4 | hybrid | 41 % | 49 % | 0.76 ms | 1.49 ms |
| danse | 2 | lightweightSemHybrid | 34 / 35 % | 44 / 46 % | 0.98 / 1.00 ms | 1.62 / 1.80 ms (34 %) |
| danse | 1 | lightweightSemHybrid | 36 / 34 % | 42 / 39 % | **1.84 / 1.87 ms** | **3.00 / 3.08 ms (58 %)** |
| paradoxe | 12 | lightweightSemHybrid | 74 / 69 % | **86 / 94 %** | 0.87 / 0.87 ms | 1.38 / 1.31 ms, and one 4.12 ms block stopped |
| paradoxe | 6 | lightweightSemHybrid | 58 / 47 % | 76 / 71 % | 0.77 / 0.76 ms | 1.36 / 1.25 ms |
| paradoxe | **4** | lightweightSemHybrid | 41 / 44 / 48 % | **56 / 61 / 64 %** | 0.85 / 0.84 / 0.83 ms | 1.73 / 1.59 / 1.56 ms (29–33 %) |

The interface's next size down, **144 frames** (a 3.0 ms deadline, `paradoxe`):

| threads | engine stopped | engine playing | callback mean | worst block |
|---|---|---|---|---|
| 12 | 90 % | **104 %** | 0.54 ms | 1.06 ms (35 %) |
| 6 | 61 % | 77 % | 0.47 ms | 0.98 ms (33 %) |
| **4** | 43 / 51 % | **63 / 63 %** | 0.51 / 0.50 ms | 1.05 / 1.05 ms (35 %) |

How to read it:

- **Fewer threads is the lever; the strategy is not.** It matters only while twelve workers are
  waiting, and a pool of four leaves little waiting to tune.
- **Four is where the callback stops paying.** Two threads lengthen the mean by a quarter and one
  doubles it, putting the worst block past half the deadline: the work has nowhere left to spread.
- **Four costs a heavy graph about 0.3 ms on its worst block at 256** (paradoxe, 1.56–1.73 ms against
  1.25–1.38), and nothing at 144, where every pool size lands on the same 35 %. That is the
  margin bought for half a core, and it is a third of the deadline.
- **Stopped is most of playing.** The callback still costs 0.60–0.75 ms a block with the transport
  stopped: the Edit keeps processing — every amp, reverb and synth on silence — which is what a live
  input monitored through its chain needs. No pool size changes that; it is the graph, not the pool.

## The run has two traps

- **A partial load measures another graph.** A fresh engine-home scans its plugins while the first
  project loads, and a run that measures before the scan lands plays without the external
  instruments: `danse` then costs 0.07 ms a block instead of 0.8, and reads as a miracle. The
  session's track count does not see it. Count the edit's plugin instances
  (`list-edit-plugins`, external ones are those with a native UI) and wait until the count holds still.
- **The engine is the supervisor's child, not the app's.** `STUDIO_ENGINE` points the supervisor at
  another build, and the pool variables reach the engine through the supervisor's environment.

## Changing it

`STUDIO_ENGINE_AUDIO_THREADS` (a count, capped at the machine's cores) and `STUDIO_ENGINE_AUDIO_POOL`
(a Tracktion strategy by name: `conditionVariable`, `realTime`, `hybrid`, `semaphore`,
`lightweightSemaphore`, `lightweightSemHybrid`) override the defaults; anything else leaves them.
They are read once, before any Edit plays, since Tracktion's strategy is process-wide. A machine
with many more cores than this one, or a graph far wider than these two songs, is where four would
be worth measuring again — with `audio-cost`'s worst block as the column that decides.
