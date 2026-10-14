# Engine performance — one integer

[quality.md](quality.md) rates the **link** to an engine; this rates the **machine** behind it.
Both are drawn side by side in the pickers, because they answer different questions: Q1 says you
can play through this engine from here, the performance score says how much the machine can
carry once you do — how many tracks, how heavy a chain, how fast a take lands on disk.

```
score = 1000 × Π (metric / reference) ^ weight        (weights sum to 1)
```

**1000 is the reference machine** — a mid-range 8-core laptop on an SSD — and every metric only
ever pushes the score up: more cores, a faster core, a faster disk, more memory each raise it.
Geometric rather than a sum, so doubling any one metric multiplies the score by the same factor
wherever the others stand, and no single figure (48 GB of RAM, say) can buy a high score alone.

| metric | measured as | reference | weight |
|---|---|---|---|
| `singleThread` | a biquad over 4096-sample blocks on ONE core, Msamples/s | 60 | 0.35 |
| `cores` | `os.availableParallelism()` | 8 | 0.25 |
| `diskWriteMBps` | 16 MB written to the state dir, fsync included | 500 | 0.15 |
| `fsyncPerSec` | 4 KB write + fsync, 32 times | 200 | 0.10 |
| `memoryGB` | `os.totalmem()` | 16 | 0.15 |

One core leads because the audio callback runs on one: a machine with many slow cores drops out
before a machine with few fast ones. The two disk figures are taken where `<state>/workspace`
lives, because that is where a take is written while it is being recorded.

The constants are `PERFORMANCE_REFERENCE` and `PERFORMANCE_WEIGHTS` in `../performance.ts`;
retuning them moves every machine's score at once, which is the point of keeping them in one place.

## Unmeasured is not slow

A disk that refuses the probe (read-only, full) reports `null`, and the score is computed over
the remaining metrics with their weights renormalised. Counting it as zero would sink the whole
product and rate a perfectly good machine as the slowest on the list — the same reason
[quality.md](quality.md) shows "latency unknown" rather than 0 ms.

**Reads are not measured**, on purpose: the file was just written, so the page cache would answer
and the figure would describe memory rather than the disk.

## Where it is measured, and where it is drawn

- **Measured once**, by the supervisor at startup (`engine/k7-supervisor/src/Performance.cpp`),
  **before** it starts the engine, so the CPU loop is not competing with a plugin scan. It takes
  well under a second, and the score is written to the merged log (`host | performance 1953`).
- **Carried** on every heartbeat as `performance`, validated and bounded by the registry — the
  heartbeat is open, so the number is a hint for a picker, never something to trust blindly.
- **Listed** on `PublicEngine.performance`; absent for a supervisor that predates it.
- **Drawn** as a `P 1240` badge beside the latency, the breakdown in its tooltip.

It is a snapshot of the machine at startup, not a live load figure: a machine busy with something
else when the supervisor started scores low until the next start.
