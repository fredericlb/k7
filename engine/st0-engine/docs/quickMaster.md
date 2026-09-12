# `Quick Master` — a master bus in one module

`QuickMasterPlugin` is an engine built-in (`studio_quickmaster`, `[audioEffect]`, category
`dynamics`). It chains three devices, in this order and this order only:

```
        ┌ 3-band compressor ───┐   ┌ widener ────┐   ┌ limiter ─┐
input → │  split → 3 detectors │ → │  M/S, width │ → │ lookahead│ → output
        │  → sum               │   │  bass mono  │   │ + ceiling│
        └──────────────────────┘   └─────────────┘   └──────────┘
```

Ten parameters, no routing, **neutral at its defaults**: the three amounts at zero, width at
100 %, drive at zero. A library's `audio/dynamics/quick-master` is a NAME and
DEFAULTS on top, exactly as `eq3` is on the 4-band equaliser — it is that module, not this plugin,
that settles a master.

## Why a compiled plugin and not a `jsdsp`

The first question to ask in this repo, and for once the answer is not "the engine already hosts
the effect". None of this is **describable** with `DspGraph.h`'s primitives:

| what is needed | what the graph has | why it does not do |
|---|---|---|
| split into bands and recombine | `biquad`, `gain` | those are SINKS: they treat the whole buffer in place, there is no parallel path |
| one detector per band | `envelope` | an analysis phase, on the graph's INPUT and on that alone — a band does not exist yet |
| a stereo widener | `amul`, `aadd`, `adelay`… | an audio wire is a PAIR treated identically; width lives entirely in the difference between the two channels, which nothing here reaches |

The alternative would be adding four node types to the interpreter (`abiquad`, `aswap`, a wire
detector, a gain computer). `DspGraph.h`'s header warns against exactly that path — "one primitive
per effect, which empties the idea of its meaning" — and four nodes serving one module, three of
them touching the per-sample loop of ALL existing graphs, is precisely that. `MixerPlugin` is the
model followed instead: same `add(id, name, lo, hi, def)` lambda, same `CachedValue`, same
recomputation of coefficients only when a knob moved.

## The band split: LR4, and the allpass that gets forgotten

Each crossover is a **4th-order Linkwitz-Riley** — two Butterworth sections (Q = 0.7071) in
cascade. It is the only split whose two halves resum to flat magnitude, and it needs no polarity
inversion (LR2 would).

The trap is the third path. An LR4 does not sum to 1: it sums to a **second-order allpass** at its
crossover. So, with `f1` the low crossover and `f2` the high:

```
low  = LP4(f1)                     mid = LP4(f2)·HP4(f1)     high = HP4(f2)·HP4(f1)
mid + high = AP2(f2)·HP4(f1)
low + mid + high                   ≠ AP2(f1)·x      ← a several-dB notch around f1
```

The low band never went through the second crossover and ends up phase-shifted against the other
two. The fix is one line: the low band goes through **the same AP2(f2)**, and the sum becomes
`AP2(f2)·AP2(f1)·x` — flat. That is `lowAp_` in `splitBands`, and it is the one thing in this file
you cannot see by reading the code without knowing what to look for.

The two crossovers cannot cross: `updateCoefficients` enforces `f2 ≥ 2·f1`. A "low" band above the
"high" one is a split with a hole in it and a band that does the opposite of what its knob says.

## What "amount" means

One knob per band, 0 to 100, driving three things at once:

| | at 0 | at 100 |
|---|---|---|
| threshold | −8 dB | −24 dB |
| ratio | **1** | 4 |
| makeup | 0 dB | ≈ +9 dB |

A ratio of exactly 1 at zero is what makes OFF exact: `compressBands` skips the band entirely and
resets its detector, so bringing the knob back up starts below threshold and settles in gently
instead of jumping to whatever level it last had.

Makeup gives back **half** of what the threshold cost (`-thrDb * (1 - 1/ratio) * 0.5`). A macro
compensating in full would only ever raise the volume, and you could no longer hear what it does.

The gain computer is written multiplicatively — `(threshold / level) ^ (1 − 1/ratio)` — rather
than in decibels: one `pow` per sample instead of a `log` and an `exp`, and only above threshold.

Times are **fixed** and shorten going up (30/250 ms on the low, 15/150 on the mid, 5/80 on the
high). Exposing them would have meant thirteen knobs on a device whose whole argument is that you
set it and it works; a master is adjusted band by band in AMOUNT, not in attack.

Each detector is **stereo-linked**: one number for the pair. Two detectors would pull the channels
apart, and pulling a master's channels apart moves the image — the one thing a mastering
compressor must not do.

## The widener, and its half that narrows

Ordinary mid/side: `M = (L+R)/2`, `S = (L−R)/2`, then `L' = M + w·S`, `R' = M − w·S`. `Width` is in
percent, 100 % is identity — and at 100 % with no bass mono the function returns immediately, so
the signal is bit-for-bit what came in.

`Bass Mono` is the other half and works the other way: an LR4 high-pass on the **side alone**, so
below that frequency the two channels join at the centre. The mid keeps all its hertz. Below 20 Hz
the knob is **OFF** rather than "very low": a high-pass at 0 Hz has no coefficients, and that is
what the bottom of the travel means.

## The limiter, and what the ceiling actually guarantees

Two milliseconds of **lookahead** (`lookaheadMs`), a real delay line: the detector sees the sample,
the gain comes down while the signal waits. The release time constant is a quarter of the window,
so the gain is within 2 % of its target by the time the peak that caused it finally arrives.

Those two milliseconds are **declared** — `getLatencySeconds()` — and not silently absorbed. A
master bus is precisely where uncompensated latency stops being free: a parallel send would arrive
early.

Then a **clipper**, `jlimit(-ceil, +ceil)`, and it is what makes the ceiling a ceiling. The limiter
above does the musical work and normally leaves it nothing to do; what it catches is the fraction
of a dB a one-pole attack cannot take off a transient in time. Without it the ceiling would be an
intention, which is the most common way to make a master 0.2 dB wrong.

`Drive` is the input gain, applied before the detector AND before the delay line: it is what pushes
into the ceiling, and that is a level decision a settled module does not take on its own — hence
its default of 0.

## Verifying

There is no unit test: `QuickMasterPlugin` needs a live `te::Edit` to exist, which the repo's four
C++ suites do not build (see AGENTS.md, "Anything needing a live `te::Edit` is covered by CLI
smoke-runs instead").

What covers it:

```
cmake --build --preset windows-msvc
npm run gen:builtin-params --workspace st0-engine   # INSTANTIATES each built-in and reads its params
npx tsx engine/st0-engine/scripts/quick-master.ts   # RETURNS sound and measures it
```

The second line creates the plugin, reads its ten parameters and writes
`packages/song-schema/src/builtinParams.generated.ts`. A plugin that fails to instantiate, or
whose ranges are not what you thought, shows up there immediately — and that file is committed, so
`git diff` is the comparison.

The third is the real bench: two hard-panned tracks rendered offline through the plugin, and six
measurements:

```
no plugin              peak 0.4983  mid 0.1149  side 0.1148
neutral                peak 0.5003  mid 0.1149  side 0.1148
ceiling −12 dB         peak 0.2512  mid 0.0731  side 0.0732
width 0                peak 0.4833  mid 0.1148  side 0.0000
width 180              peak 0.8466  mid 0.1149  side 0.2066
```

- **neutral within 0.03 dB of the bare render.** That is `splitBands`'s allpass correction reading
  out: without it the three-band split notches several dB around `f1`, and this line would be
  negative.
- **ceiling held to a hundredth of a dB** (−12.00 for −12 asked), with 12 dB of drive over a
  signal already at −6 dBFS — so 18 dB of limiting.
- **width 0: side/mid at 0.0000** and the mid unchanged to a hundredth of a dB. Width 180 opens to
  1.80×, measured as the side/mid RATIO and not as absolute side, because the limiter is behind
  the widener and a wider image hitting the ceiling comes back down in level.

Two traps in the bench itself:

- **the render is 24-bit PCM**, not float. A hot signal clips at the format, and every measurement
  then compares two clipped waveforms. Hence the −12 dB on the slices, and the first check, which
  refuses a bare render above −0.4 dBFS.
- **an out-of-range value is CLAMPED by the AutomatableParameter**, silently. `Ceiling: -18` on a
  parameter that stops at −12 measures −12 dBFS and reads as a limiter 6 dB wrong.

The rest — whether it SOUNDS good — is not measured here. A render is measured, not judged.
