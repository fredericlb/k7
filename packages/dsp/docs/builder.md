# The graph builder — why three types, and what they prevent

`packages/dsp/src/index.ts` is the whole library: a `GraphBuilder` whose every method adds a node,
and a `graph(fn)` that returns the JSON. The JS runs at **build** time and never goes near the
audio thread; what plays is the C++ of `engine/st0-engine/engine/DspGraph.h`.

This page holds the reasons the code carries in one line each.

## Three rates, three types — and that is not decoration

`Scalar` (control), `Audio` (a wire) and `Midi` (the note stream) are **distinct** types.

A single `Signal` type for all three silently breaks the first feedback graph that comes along:
`amul(fb, Feedback)` reads the **parameter** `Feedback` as an audio wire — a wire nobody writes, so
zero, so a loop that does not close and an echo that repeats once. The engine cannot catch it: on
both sides these are only names in a text file, and the result sounds plausible.

`Midi` is distinct for exactly the same reason: without it, `transpose(dry, Semitones)` would type-
check against an audio wire and emit a node the MIDI plugin ignores in silence. The note stream is
the buffer the plugin handed over, there is **one** of it per graph and every MIDI node rewrites it
in place — hence a type carrying no name, which can be neither forked nor mixed.

Making the three distinct turns those faults into compile errors, and that is the only reason to
have a library rather than writing the JSON by hand. The rest of the value is what any language
gives: names instead of literals, checked numbers, loops for the repetitive parts, and a `wah()`
called twice instead of a file copied.

## A builder, not free functions

Every helper is a **method** because a node has to be *registered* as much as returned: a graph is
an ordered list, and its order is its evaluation order. `sr` is exported at module level *and*
carried by the builder, because a module's source imports nothing at run time — everything it needs
arrives through that object.

## `geolerp` refuses a descending pair

The engine node **sorts** its two bounds before interpolating (`jmin`/`jmax`, so a graph can never
ask for a negative ratio). The price is that a descending pair does not fail: it silently reads as
its own mirror. `geolerp(20000, 200, t)` therefore sits at 200 Hz when `t` is 0 and **opens** as `t`
rises — the exact opposite of what the line says, with nothing on screen to suggest it.

It is refused **here**, where the author is, rather than absorbed over there. To sweep down, keep
the ascending pair and reverse the journey: `geolerp(200, 20000, g.sub(1, t))`. The error message
carries that spelling, because "this is wrong" is not actionable when the obvious spelling is the
wrong one.

What the fault gives without the guard: a DJ filter silent at its neutral position — measured at
−62 dBFS against a −24 dBFS control — and the published `lowpass` module, whose sweep runs backwards
(`docs/sweep.md`).

The guard speaks only about what it **sees**: two literals. The auto-wah's bounds are knobs
(`packages/dsp/src/autowah.ts`), and which is larger is up to the musician at run time; guessing
there would refuse a legitimate graph.

## `input(port)` — an index, not a name

`port` indexes the module's input ports (`inputs:` in its `module.yaml`): 0 is the chain's stream,
1 the first side input — see `packages/song/docs/ports.md`.

An index and not a name because the graph and the module file are **two documents**: the graph is
generated JSON the engine reads with no module in sight, and a name would have to be reconciled
across that gap by someone. Position is what the port list already is (validation checks its
sources positionally), so the index is the only fact both sides can hold alone.

The first port emits **no field**: a graph with one input is byte for byte what it would be without
the port layer, which matters because the committed `graphs/*.json` and the copy pasted into the
engine are what actually run.

A port nobody feeds reads silence instead of failing: `mandatory: false` says that wiring one side
and leaving the other silent is a legitimate state, and this is what it sounds like.

## Sample phase, and feedback

The `a*` nodes carry **audio**, not scalars, and run in one loop per sample, in declared order.
Reading a wire written by a node **further down** the list yields the previous sample — the unit
delay a feedback loop is built on — which is why `delay()` can be fed something depending on its own
output.

`wire(name)` reserves nothing and checks nothing: the name **is** the whole mechanism, and reading
it before its writer is exactly what gives the previous sample.

A sample-phase node puts its wires in `in` and its scalars in `k`. That separation is the whole
point of the two types.

`lfo()` runs at **sample** rate and not control rate, deliberately: a scalar changes once per block,
and on a delay time that is a ~10 ms staircase, audible as a zipper on exactly the effects
modulation exists for.

`delay()` allocates `maxMs` once at `prepare`: a ceiling, not a suggestion. The read time can be a
parameter or any control signal, and the read is interpolated so that moving it does not zipper.

## What the vocabulary refuses to grow

There is no `sqrt` among the primitives, and the crossfade
(`packages/dsp/src/crossfade.ts`) would have wanted one: a DJ crossfader usually takes the square
root of each side, so that two uncorrelated tracks keep steady loudness through the middle.
Inventing one for a single effect is exactly how a graph language ends up with one node per effect
(`engine/st0-engine/engine/DspGraph.h`). Equal gain therefore dips about 3 dB at centre for uncorrelated
material: a known shape, not a defect.

Same reason for the absence of `max`, which the DJ filter works around with a sum because only one
of its two halves is ever non-zero.

## The MIDI nodes

They run once per block over the note list, before any audio phase. They are methods of the **same**
builder because a MIDI module still declares parameters and still maps them with the control
arithmetic above: a transposer driven by an LFO is the same `param` and the same `lerp`.

They take **scalars and no wires** — the stream they act on is the plugin's buffer, not a value they
read — hence no `out`: there is nothing to name. And a literal passes as a **number**, not as its
text: the engine's `ref()` gives a number its own preloaded register and a string a named register,
so `"2"` would fetch a register nobody writes.

A note pushed past the edges of the keyboard by `transpose` is **clamped, not dropped**: dropping it
would leave its note-off orphaned and the voice stuck. `velocity` never reaches zero, because
velocity 0 is a note-off in MIDI.
