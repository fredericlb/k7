# A deck's filter

One knob per deck, below the three of the EQ and separated from them by a rule — it is not a fourth
band, it is another instrument on the same strip. It drives a `sweep` module placed on that deck in
the graph, and like everything else on the desk the link is **declared** in `views/mix.k7x`.

## One parameter, and that constraint is what shapes the module

A desk control drives **at most one** parameter
([viewBindings.md](../../../../packages/song/docs/viewBindings.md)). So "low-pass or high-pass" cannot
be a second setting you toggle: the direction of the sweep has to be legible in the single number
sent.

Hence the shape: `Sweep` runs −100 to +100, and **both** filters are always in the chain. Left, a
low-pass walks down; right, a high-pass walks up; each parks out of the way when it is not its
turn:

| position | low-pass | high-pass | Q | what you hear |
|---|---|---|---|---|
| −100 | 30 Hz | 20 Hz | 6 | only the peak, whistling |
| 0 | 20 kHz | 20 Hz | 0.707 | **nothing** — both corners are outside the material |
| +100 | 20 kHz | 10 kHz | 6 | thin, only air left |

Not a compromise: it is also how the hardware this imitates works.

Neutral is **inaudible rather than bypassed**. There is no bypass in this vocabulary, and a module
you would have to remove to silence is a module a chain cannot automate from nothing. At 0 both
corners are simply beyond anything in the track.

It closes **far**: 30 Hz, not a few hundred hertz. A filter stopping higher leaves a muddy drone; a
DJ filter is expected to take the track away, and the last third of the travel — where only the
whistling peak is left — is exactly the part that gets used. The two halves are deliberately
asymmetric: the high-pass stops at 10 kHz. Past that only air is left, and sweeping the bass away
is a rise rather than a disappearance.

## What makes the *swoosh*: the resonance

A flat corner sliding over a track only smothers it, gradually and flatly — "a normal filter". The
swoosh is a **peak travelling with the corner**, lifting a narrow band as it passes. The peak IS
the effect.

Resonance **rises** with distance from centre: 0.707 (Butterworth, flat) at rest, 6 at the
extremes. A filter doing nothing therefore colours nothing, and the size of the gesture decides the
size of the song. Each half has its **own**: sharing one would leave the high-pass ringing at 20 Hz
while the low-pass walks down — a peak parked on the sub.

**Two stages per side**, so 24 dB/octave and not 12. One pole pair smothers; two are the wall a DJ
filter raises. The first stage of each pair stays **flat** and only the second resonates: two
resonant stages at the same frequency multiply their peaks (Q²), a filter that screams before it
sweeps.

**`glide` on both corners.** A biquad recomputes its coefficients per **block**, and this is a knob
you throw: a jump between two blocks is a click, and a burst of jumps is the zipper noise that
makes a filter sound broken rather than fast.

### Measured, not assumed

White noise through the filter, each band compared to the same band at neutral (so a peak shows as
a **positive** number):

| band | at Sweep = −50 |
|---|---|
| 250 Hz | −0.2 dB |
| 400 Hz | **+1.2 dB** |
| 600 Hz | **+3.7 dB** |
| 775 Hz | **+3.9 dB** ← the corner |
| 1 kHz | −2.2 dB |
| 1.3 kHz | −9.1 dB |
| 2.5 kHz | −21.0 dB |
| 10 kHz | −38.6 dB |

A sharp peak on a 24 dB/octave wall, flat below.

The final **trim** takes back only −3 dB at the extremes. At −6 it would eat the peak exactly where
the peak is the point (+1.2 dB at the corner, measured), and the clipping it would prevent is
theoretical: the filter removes 14 dB from the whole signal at that setting. What is left stops a Q
of 6 on a 30 Hz kick from costing someone their master.

### The trap that makes the filter silent

`geolerp` **sorts its two bounds** engine-side (`jmin`/`jmax`, so a graph cannot ask for a negative
ratio). A descending pair therefore does not break: it reads as its own mirror. Written the obvious
way — `geolerp(20000, 30, down)` — this filter parks at **30 Hz at rest** and opens as you sweep:
silence, knob at neutral. Measured at −62 dBFS against a −24 control.

To sweep down, keep the ascending pair and reverse the journey: `geolerp(30, 20000, sub(1, t))`.
The builder **refuses** a literal descending pair, with the message that gives the other spelling —
the error is caught where the author is. Two tests pin it.

⚠️ The mediatek's `audio/filter/lowpass` module has exactly the same defect:
`geolerp(20000, 200, t)`, so its `Amount` works **backwards** from what its doc announces (closed
at 0, open at 100). It is in the médiathèque's catalogue, not in this repository.

## The path, and sync both ways

It is a `jsdsp` module, so a **real plugin**: the compiler bakes its graph into the document
(2046 bytes), the engine loads it, and the knob takes the crossfader's path — `set-plugin-param`,
every pixel. Sync with the graph therefore comes free, by the same mechanism as the EQ: the engine
reports what a plugin is set to whatever surface set it, and desk and graph read the same
`deck.params`. Measured against the running engine: it loads the plugin, announces `Sweep` with its
−100…+100 range and its default 0, accepts −80 and reports it back.

That is the difference from the tempo, which needs a channel of its own because it compiles into no
plugin — see [deckSet.md](deckSet.md).

## Where it is in the chain

```
deckA → tempoA → eqA → filterA → crossfade → OUT
```

**Last of the three.** It is the effect a hand throws, the one you want on top of what the EQ has
already done — rather than equalising after the fact what the filter has just let through.
