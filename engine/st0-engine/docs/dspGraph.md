# The DSP graph — a module's DSP described as data

`engine/st0-engine/engine/DspGraph.{h,cpp}` is the interpreter; `GraphDspPlugin` exposes it as an audio
plugin and `MidiGraphPlugin` as a MIDI one. What the graph receives is the JSON `@studio/dsp` emits.

**The emitting side has its own page and it is not repeated here**:
[`packages/dsp/docs/builder.md`](../../../packages/dsp/docs/builder.md) holds the builder's reasons
— the three types, `geolerp` refusing a descending pair, `input(port)`, what the vocabulary refuses
to grow. This page holds what the **engine** does with the description once it has it.

## The experiment

Can a module's DSP be a **description** rather than a compiled plugin, so it can be written in JS
(or YAML) as a chain already is?

JS must never go near the audio thread. Throughput is not the problem — an auto-wah written in JS
measures 0.1 % of a 5.3 ms block — a garbage-collection pause is. So the JS runs **once**, at build
time, and emits this. Same shape as Strudel one layer down: JS produces data, the engine plays it.

## Three phases per block, plus a fourth

| phase | rate | what it does |
|---|---|---|
| `analysis` | per sample, on the input | writes scalars (an envelope follower) |
| `control` | once per block | scalar → scalar (arithmetic, mapping, smoothing) |
| `audio` | per sample, on the buffer | filters, gain, mixing |
| `sample` | per sample, single loop | what the other three cannot express |

The fourth exists for graphs the other three cannot express: a delay whose output returns to its own
input, a comb, a flanger. Those nodes run in **one** per-sample loop over the block, in declared
order, on their own bank of audio-wire registers.

## The order of `nodes` carries meaning

Feedback falls out of that loop rather than needing machinery: a node reading a wire written
**further down** the list gets the previous sample's value, and that is the unit delay every
feedback topology is built on. It is the standard reading of a signal-flow diagram, and it is why
nothing here needs to detect a cycle or sort anything.

Corollary: reordering `nodes` changes the **sound**, not just the scheduling.

## Modulation runs at sample rate

`alfo` is an LFO writing an **audio wire**, not a control node writing a scalar. A scalar changes
once per block, and on a delay TIME that is a ~10 ms staircase — audible as a zipper on exactly the
effects modulation exists for. Hence `alfo` in the per-sample loop, and `adelay` taking its time
from a wire when given one: that is what makes a flanger expressible at all.

## A graph pays for what it uses

With no sample-phase node at all, the audio phase stays **at block rate**: a biquad goes through
JUCE's vectorised `processSamples` and a gain through `FloatVectorOperations`. Adding a single `a*`
node switches that graph to per-sample dispatch.

The auto-wah therefore still renders **bit for bit** what the compiled plugin rendered, and that is
the regression this design is checked against.

Sample-phase nodes are collected at `build()` into `sampleNodes_`, in declared order, so the loop
iterates only those: walking every node and branching on its phase at each sample would make a graph
with two audio nodes pay for twelve at 48 kHz, for the same output.

## The primitives stay SMALL

A `shape` or `geomap` node would be one effect's step under a generic name, and that road ends at
one primitive per effect — which empties the idea of its meaning. An auto-wah's sensitivity curve
and its direction inverter therefore live in the description, as arithmetic, which is where an
effect's identity belongs.

It is also the argument `docs/quickMaster.md` invokes for compiling that module rather than adding
four node types for it.

## Registers, resolved to INDICES

Every input is either a register name or a literal; a literal gets its own preloaded register at
build time. Scalars live in a bank resolved to indices when the graph is built, so that `process()`
does **no lookup and no allocation**.

`sr` is predefined and holds the sample rate: a Nyquist clamp needs it and no literal can say it.
Parameters occupy the registers just after `sr`, in declared order.

That correspondence is **positional**: `process()` writes the nth parameter's value into register
n+1, never consulting a name. A name for which `reg()` returns an index that already exists
therefore shifts every following parameter onto another's register — a literal's included — and
nothing downstream can notice. `build()` refuses the two cases that produce it: a parameter declared
twice, and a parameter called `sr`. Refused while it is still only a description;
`DspGraph_test.cpp` pins both.

A node also carries a `mode`, one integer for three uses depending on its type: a `biquad`'s filter
kind (0 band-pass, 1 low-pass, 2 high-pass, 3 notch, 4 peak, 5 low shelf, 6 high shelf), an `alfo`'s waveform (0 sine, 1 triangle,
2 saw, 3 square), or an `ain`'s port number. `build()` translates the name written in the
description into that number.

Audio wires have their **own** namespace: a sample-phase node carries a stereo frame, a control node
a scalar, and letting one name mean either would be a silent type error in a text file. A
sample-phase node therefore puts its wires in `in` and its scalars in `k`.

## What the audio thread may not do

**It does not allocate and it does not block.** Three places carry that:

- Delay lines are sized at `prepare()`. That is the only thing in this interpreter big enough to be
  heard growing during a render. `maxMs` is a **ceiling**, not a suggestion.
- A block larger than the one announced at `prepare()` really does arrive — an offline render, a
  rack's render context, a device buffer that got ahead of a re-init. A `setSize` on the dry
  snapshot would then allocate on the audio thread, so `process()` **splits the block**: the control
  and analysis phases run once per slice, which is finer, not wrong.
- A biquad's coefficients are recomputed only when the frequency, Q or gain has moved. Redoing them every
  block costs a `sin`, a `cos` and a square root for a filter whose knob has not moved — and
  `setCoefficients` takes `juce::IIRFilter`'s spin lock, twice per channel, which the audio thread
  has no business doing for nothing.

Delay lines are rounded up to a power of two so that wrapping is a mask and not a modulo: the loop
otherwise does four integer divisions per sample per channel, each 20 to 40 cycles, for a wrap that
costs an AND. The memory waste is at most one extra delay line.

`GraphDspPlugin::applyToBuffer` sets a `juce::ScopedNoDenormals`. A decaying feedback delay — which
is what `adelay` and the wires are — is the canonical way to produce denormals: below ~1e-38 each
operation costs tens to hundreds of cycles instead of one, and the symptom is an engine that slows
down the longer it plays. `juce::IIRFilter` zeroes its own state, so the biquads were already safe;
nothing else was.

## `mix` is applied LAST

`mix` means "blend the GRAPH's output with what came in", and the graph's output does not exist
before every phase has run. Applied in the audio phase, it is a non-event for any graph with a
per-sample step: the blend would run on a buffer nothing has touched yet, so it would mix the dry
signal with an identical copy of itself, and `aout` would then overwrite the result — a flanger's
Mix knob doing strictly nothing, at any setting.

The dry snapshot is taken **before** any audio node, for the same reason. Whether a graph contains a
`mix` node is frozen at `build()` (`hasMix_`) rather than re-asked by a `std::any_of` every block.

## The numeric traps

- `juce::jlimit` **does not filter NaNs**: both its comparisons are false, so a 0/0 comes back out
  as it went in, and a NaN reaching `makeBandPass` poisons that filter's state for good. `linmap`
  therefore treats an empty range as 0 rather than as a division — and the published auto-wah
  computes its low bound with a `lerp`, so this is reachable, not theoretical.
- A biquad's frequency is clamped to a real, stable band: a cutoff at or beyond Nyquist makes the
  coefficients diverge, and it is fed by control nodes whose inputs are automatable.
- A peak or a shelf reads a THIRD input, its gain in dB, bounded to ±24; a pass filter reads two,
  so a graph written for those is unchanged. Their Q floor is 0.1 rather than 0.5: a broad bell or
  a gentle shelf is a normal setting, where a pass filter that low is a droop nobody asked for.
- `atanh` saturates, and that is what stops a feedback loop running away — and what makes it sound
  like a machine rather than a divergence.
- A delay read is **fractional and interpolated**: an integer-sample tap zippers as soon as the time
  moves, which is precisely a flanger's job.

## The input ports

`ain` names a **module port** (`packages/song/docs/ports.md`). Port n is the stereo pair of channels
2n / 2n+1: the chain's stream is 0/1, the first side input 2/3. Absent, the port is the first.

`DspGraph::inputs()` returns one more than the highest `port` named, and that is what tells the
plugin how many channels to ask for (`GraphDspPlugin::getChannelNames`), hence whether the module is
sidechainable at all. See `docs/sidechain.md`.

A port nobody feeds reads **silence** rather than running out of bounds: Tracktion caps a plugin
with no side source at two channels, so the number of available channels decides, per sample.

## The MIDI nodes

They run once per block and **rewrite the message list in place**. Their inputs are SCALARS: a MIDI
node has no wire to read, it acts on the buffer the plugin handed it — hence no `out`, there is
nothing to name.

`processMidi()` runs the **control** phase then the MIDI phase, and touches no wire, no delay line
and no filter. The control phase is what turns parameters into the numbers a transformation needs,
and that is why it is shared: `runControlNodes()` is extracted precisely so `processMidi()` does not
duplicate register loading, which is where the two entry points would drift apart.

`DspGraph::hasMidi()` is what decides whether a module is a transformer at all; a graph with no MIDI
node leaves the buffer alone.

Two rules the transformations keep, neither cosmetic:

- A note pushed off the keyboard by `transpose` is **clamped, not dropped**: dropping it would leave
  its note-off orphaned and the voice stuck. Both ends move together, so on and off still pair.
- `velocity` never reaches zero: velocity 0 **is** a note-off in MIDI, so fading a soft note to
  nothing would silence the voice and abandon its real note-off.

The transposer works in **whole** semitones: a fractional note number is not something MIDI carries,
and rounding here rather than at the parameter keeps the knob continuous for automation.

## The two plugins

`GraphDspPlugin` and `MidiGraphPlugin` share the same contract: the description is read **in the
constructor**, because the parameters it declares must exist before it returns — Tracktion creates
its `AutomatableParameter`s there and never after. That is why `EditBuilder::addPlugin` makes these
plugins from a `ValueTree` rather than from a type name, exactly as for `FaustPlugin`
(`docs/faust.md`).

A broken description leaves a plugin that **passes audio** and says so on the warning channel that
reaches the frontend: without that, it is a module that looks fine and does nothing. Likewise, a
graph with no MIDI node in a MIDI plugin is a module pointed at the wrong carrier, and saying so is
all that distinguishes it from a broken transposer.

`GraphDspPlugin`'s fallback is the auto-wah, **GENERATED**: it is `packages/dsp/graphs/autowah.json`
word for word, pasted rather than read because the engine reads no file, and `autowah.test.ts`
compares the two so the copy cannot drift. `MidiGraphPlugin`'s is a transposition of zero, written
by hand and tiny: there is nothing there worth generating.

`canSidechain()` would already answer yes from the channel count alone; saying it explicitly is what
makes the rule legible — a module is sidechainable exactly when its graph declares a second input
port.

## Checking

```
cmake --build --preset windows-msvc
cmake --build build/windows-msvc --config RelWithDebInfo --target \
      studio_dspgraph_tests studio_midigraph_tests
ctest --test-dir build/windows-msvc -C RelWithDebInfo -R 'studio_' --output-on-failure
```

`tests/DspGraph_test.cpp` covers the interpreter without a `te::Edit`: build, the phases, feedback,
the bounds. `tests/MidiGraph_test.cpp` does the same on the note side.
