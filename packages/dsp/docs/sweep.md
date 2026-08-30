# The DJ filter — one knob, two filters, and a travelling resonance

`modules/audio/filter/sweep/` and `packages/dsp/src/sweep.ts` are the same graph written twice: a
module is a **folder you copy**, so it carries its own source rather than a pointer at the library,
and `packages/dsp/src/sweep.test.ts` holds the two to the same shape.

One knob that walks a **resonant** corner down to the left and up to the right, silent in the
middle. This page holds the numbers and the reasons; the code keeps one line of each.

## One knob, because a desk gives only one

A desk control drives **at most one parameter**
(`packages/song/docs/viewBindings.md`), so "low-pass or high-pass" cannot be a second setting. Both
filters are therefore always in the chain and what moves is where each one stands — which is also
how the hardware this imitates works. The parameter is signed, −100..+100, so the neutral position
is the **middle of the travel** and not an end.

## The resonance is the whole difference from a tone control

A flat corner sliding across a track only dulls it, gradually and without interest: "a normal
filter". The swoosh is a **peak travelling with the corner**, and the peak is the effect.

| | value | why |
|---|---|---|
| `Q_REST` | `0.707` | Butterworth, maximally flat: a filter doing nothing colours nothing either |
| `Q_MAX` | `6` | measured: at `Q = 4` only about +4 dB was left at the corner once the flat stage below had taken its 3 dB — audible, but nobody calls that a filter sweep |

At mid-travel, `Q = 6` gives **+3.9 dB at the corner and −21 dB an octave and a half above**.

The ramp counts as much as the value: a permanently resonant filter rings even parked out of the
way, and a permanently flat one is the "normal filter" this replaces.

**Each half has its own resonance.** Sharing one would leave the high-pass resonating at 20 Hz
while someone walks the low-pass down — a peak parked on the bass, that is, a boom nobody asked
for.

## The sweep bounds

| | open | closed |
|---|---|---|
| `LOW_SWEEP` (low-pass, left half) | 20 kHz | 30 Hz |
| `HIGH_SWEEP` (high-pass, right half) | 20 Hz | 10 kHz |

At rest both corners are **outside the material**: 20 kHz is above anything in a track, 20 Hz
below. The effect is off because it is **inaudible**, not because it is bypassed — there is no
bypass in this vocabulary, and a module you have to remove to silence it is a module a chain cannot
automate from nothing.

It closes **far further** than a tone control. A filter stopping a few hundred hertz higher leaves
a muddy boom; a DJ filter is meant to carry the track away, and the last part of the travel — where
only the peak is left whistling — is the part actually used.

## The pair is ASCENDING, and it is the journey that is reversed

Never `geolerp(20000, 30, down)`. The engine sorts a `geolerp`'s bounds, so a descending pair reads
as its own mirror: written the obvious way it parks this filter at 30 Hz **at rest** and opens it
when you sweep — that is, silence with the knob neutral, measured at −62 dBFS against a −24 dBFS
control. The builder refuses that pair ([builder.md](builder.md)), and the test additionally
pins the form written here, because a graph could be rewritten so as to pass the guard and still
sweep backwards.

`glide` on both corners: a biquad recomputes its coefficients **per block**, and this is a knob you
throw — a jump between two blocks is a click, and a sweep of jumps is the zipper noise that makes a
filter sound broken rather than fast.

## Two stages per side, only one of them resonant

24 dB/octave rather than 12: one pole pair dulls, two are the wall a DJ filter raises, and that is
what makes the last third of the travel sound like a removal and not a blanket. The two stages of
one side **share a corner** — two stages at different frequencies is not a slope.

The first of each pair stays **flat** and only the second resonates: two resonant stages at the
same frequency multiply their peaks — Q² — giving a filter that screams before it sweeps.

## The trim, last

`SWEEP_TRIM = 0.7`, i.e. −3 dB at the extremes, and it comes **after** the stages to take back part
of what they just added.

Measured, not guessed, and excess is the trap. A ramp down to −6 dB eats the peak exactly where the
peak is the point: white noise at mid-travel then shows only +1.2 dB at the corner. And there is no
clipping to guard against — at that setting the filter already takes 14 dB off the whole signal.

What is left is enough that a `Q` of 6 sitting on a 30 Hz kick does not cost someone their master,
and small enough that the swoosh survives it.
