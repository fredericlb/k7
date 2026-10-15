# The MIDI graph — what a `transformers/` module can be without any C++

`MidiGraphPlugin` runs a `DspGraph` over the note stream instead of the audio buffer. Same
description format, same JS build step, same parameters-read-from-the-description as the audio
one. What this page is about is the part that took a second pass: the phase has a **memory** and a
**clock**, and that is what lets a note *source* be written as a graph rather than compiled.

## The vocabulary

Nine nodes, in three groups.

**Stateless rewrites**, run once per block over the message list, in place: `transpose`,
`velocity`, `mchannel`. Their inputs are scalars and they have no `out` — the buffer *is* the
output. Anything that is a pure function of the messages in front of you is one of these, or a
composition of them with the ordinary control arithmetic.

**The two with state**, and the reason this page exists:

- **`mhold`** takes every note-on and note-off out of the stream and into the graph's held set.
  What is left is everything that is not a note. Alone it is a note swallower — which is a
  legitimate module, and a useful thing to be able to say in one node.
- **`mstrike(step, gate)`** plays that set: every `step` beats it releases what is sounding and
  strikes every held key, each note lasting `gate` of the step.

`mhold` before `mstrike` is the whole circuit. Reversed, the strike runs on a set nothing filled.

That pair is the note repeater's core (`packages/dsp/src/noteRepeat.ts`): hold, multiply two
parameters into a step, strike.

**The step rule**, four setters that say which strikes play and how loud — `mpattern(mode, length,
density, rotate)`, `maccent(count, low, opposite, keep)`, `mchance(p)`, `mdecay(d)`. Declared between
hold and strike; after the strike they would apply a block late.

## The step rule: fields set once a block, read per strike

A rhythm is a decision PER STEP — play this one, at this level — and a node runs once per block. So
the four setters do not decide anything: each writes fields of one `NoteSteps` on the graph
(`NoteSteps.h`), beside the `NoteClock`, and `mstrike` hands it to the clock, which asks it at each
strike. One rule per graph for the reason there is one clock per graph. Four nodes rather than one
with eleven inputs because they are four ideas a module may want separately — a humaniser is
`mchance` alone — and rather than a mode flag on `mstrike`, which would make one node do five jobs.

What each answers, and the choices behind it:

- **A rest TAKES its step.** A step the pattern skips, or the chance loses, still moves the clock, so
  the rhythm stays on the grid the rate describes. The cycle restarts with the hand — a key pressed
  on silence starts at step 1, as the arpeggiator does.
- **Euclid is the Bresenham form**, `(i·k) mod n < k`: the pulses spread as evenly as the steps
  allow, the first on step 1. **Burst** plays the cycle's first `k` steps and rests the rest. Both
  turn with `rotate`, a share of the cycle rounded to a step.
- **Accents are spread among the HITS**, by the same Euclid over the hit count, so "half accented"
  means every other note that plays, whatever the rhythm. `keep` spreads them over the STEPS instead,
  so moving the density leaves them where they were; `opposite` swaps which ones.
- **An accent is the velocity as played; the others drop to `low` of it.** A share rather than a
  level, so the hand's dynamics survive. The defaults — every hit accented, chance 1, no decay — are
  the repeater as it was.
- **Decay takes a share per repeat**, counted from the first strike: `(1 − d)^repeat`. Nothing goes
  under 1/127, because a note-on of velocity 0 is a note-off.
- **Chance is rolled per step for the whole chord** — a chord is struck together or not at all —
  with a fixed-seed xorshift, so a test can count on the sequence.

## Where the state lives: on the GRAPH, not the node

`NoteClock` — held keys, sounding copies, step clock — is **one per graph**, like the note stream
itself. The sample phase's wires work the same way, and for the same reason: the MIDI phase has
exactly one buffer, every node rewrites it in place, and `packages/dsp/docs/builder.md` already
argues that the `Midi` type carries no name because there is only ever one of it. A held set per
node would be a second thing to route, and nothing would route it.

The practical payoff is that `mhold` and `mstrike` need no wire between them. They are two facts
about one stream, in declared order, which is exactly what every other node here is.

`NoteClock.h` is JUCE-free and header-only, so the clock, the gate and the released-key bookkeeping
are tested in the fast binary (`studio_noteclock_tests`) without linking Tracktion. The nodes over
it need a `MidiMessageArray` and are in `studio_midigraph_tests`.

## The step is in BEATS, and the plugin is what makes it a time

`mstrike`'s step is a musical division, not a duration: a graph says "every eighth" and means it at
90 BPM and at 140. Turning that into seconds needs a tempo, and a graph cannot read one — it is
handed plain floats and never touches Tracktion, which is the rule that makes the description
portable in the first place.

So `processMidi` takes two more numbers: the block's length in seconds, and how long a beat is.
`MidiGraphPlugin::applyToBuffer` computes both — `bufferNumSamples / sampleRate` and
`edit.tempoSequence.getTempo(0)`, the single tempo a `ProjectDoc` carries. Read once per block on
the audio thread, off a plain number. Nothing follows a tempo sequence, because no document
expresses one.

Both are clamped where they land: the tempo between 20 and 300 BPM here, and the step again inside
`NoteClock` between 5 ms and 8 s, because it is handed a number and cannot know where it came from.

## What a division is worth is the PANEL's business

`Division` is a parameter in **beats** — `0.5` is an eighth — and not an index into a table of
divisions. The graph has no array to index and no `switch`, so a table would have to be seven
nested `select`s, which is unreadable and would put the same eight numbers in the engine, in the
builder and in the panel.

A panel's dropdown writes the value it labels (`options: [{label: "1/8", value: 0.5}]`), so the
label lives where labels belong and the graph multiplies. `Count × Division` is one `mul` in the
control phase, computed once a block and never per message.

## Why the buffer stops between steps

`mstrike` writes into an array sized once at `build()` (256 events) and checks the worst case of a
whole step before starting it: a 16-key chord released and taken is 32 events. Stopping halfway
through one would leave a key struck with a note-off owed to nobody — a stuck note that outlives
the block. The cost of stopping between steps instead is a skipped step at an absurd rate, which
is audible and recoverable.

`notePassThrough_` is `reserve`d in `prepare` for the reason a delay line is allocated there: a
message list that grows on the audio thread allocates on it.

## What is still compiled, and what it would take

The **arpeggiator** is still `ArpeggiatorPlugin` (`arpeggiator.md`). What it needs that this
vocabulary does not have is the **walk**: an arpeggiator strikes ONE slot per step, chosen by a
direction and a number of octaves, where `mstrike` takes the whole held set. That is a third node,
`mwalk(direction, octaves)`, sitting between hold and strike and narrowing what strike sees — not a
mode flag on `mstrike`, which would make one node do two jobs.

It is deliberately not built yet. The rule this followed is that the vocabulary earns its
generality by carrying something real first, and the note repeater is that something.
