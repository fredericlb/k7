# Ports — modules with more than one input

A module used to have exactly the ports its **type folder** gave it: one audio in for `audio/`,
one midi in for `instruments/`. That made the folder decide how many wires a module takes, which
is not what a folder is for — a crossfade is an audio effect like any other and needs **two**
audio inputs, and that was simply unsayable.

A module now declares its own:

```yaml
# modules/audio/crossfade/module.yaml
plugin: { type: jsdsp }
inputs:
  - { name: a, type: audio }
  - { name: b, type: audio, mandatory: false }
outputs:
  - { name: out, type: audio }
params:
  mix: 0.5
```

Declare neither and the type folder's defaults apply, which is every module written so far.
The two lists are independent: name your inputs and inherit your outputs.

`mandatory` is an **input's** business — an output is offered, never required — and defaults to
true, so a port you bothered to name has to be fed unless you say otherwise. A crossfade's second
input is exactly the case for `mandatory: false`: wiring one side and leaving the other silent is
a legitimate state, not a half-built chain.

## Wiring one: `#`

A chain carries **one** signal. A second input therefore has to arrive from somewhere else, and
the chains file says so by naming the port a destination lands on:

```yaml
tracks:
  deckA: [ crossfade ]      # the FLOW — lands on the first input
  deckB: [ crossfade#b ]    # a side input — lands on the port called `b`
modules:
  crossfade: [ OUT ]
```

`#` because the other two separators are spoken for: `:` joins a module to its instance and `/`
joins a namespace to a category to a name. A port is a third axis, so it needed a third
character — `@mediatek/audio/crossfade:live#b` has to stay readable as three separate facts.
Only the **last** `#` is the port, so nothing else in the ref is disturbed.

A bare destination feeds the first input, which is what every chains file written so far says.

## Flow and side input are not the same edge

This is the part that decides the shape of the derived graph.

`deriveChains` reasons about the **node**, never the port: `crossfade` fed twice is one meeting
point, not two nodes. But only **bare** destinations count as the flow. A destination naming a
port:

- does not make the target absorbed into that run — otherwise a run whose only destination was
  `crossfade#b` would swallow the crossfade as its next STEP, and its real flow input would go
  unnoticed;
- lands on the target's step as `in`, the list `validate()` checks against the port list;
- keeps its port on the `out` edge, so a renderer can draw the cable to the right jack.

In the example above the crossfade has one flow feeder (deckA), so it continues **deckA's**
chain as a step — and that step carries `in: ["deckB"]`. There is no chain *named* crossfade,
because it is not a meeting point. Add a second bare feeder and it becomes one, which is the
existing rule and is unchanged.

A module may also be keyed with a port on the **source** side (`deck#cue: [ phones ]`). Its
destinations are the union of every key naming it — keying on the raw string would have split
one module into two nodes that never met.

## What validates, and how loudly

`validate()` already knew how to check port arity and positional types; what it lacked was
anything that produced more than one source. It now gets them, and a mismatch **throws** rather
than warning: a chain wired to a port that is not there is not a song that plays imperfectly, it
is one the compiler cannot lay out at all.

The schema refuses a ref that is all separator (`#b`, `x#`) — those are typos with no reading,
and letting them through would make the node name empty. Whether the port `b` *exists* is not a
schema question: `chainsSchema` knows nothing about modules, and `validate()` is what has the
module map.

## The signal, and how it gets there

The audio flows through the second input. A module's DSP reads it with `input(1)`:

```ts
// modules/audio/crossfade/jsdsp.ts — the builder arrives as an argument, so a song folder
// still imports nothing at runtime (see dspRunner.mjs).
import type { GraphBuilder } from "@studio/dsp";

export default (g: GraphBuilder) => {
  const mix = g.param("Mix", { min: 0, max: 1, default: 0.5 });
  g.output(g.aadd(g.amul(g.input(0), g.sub(1, mix)), g.amul(g.input(1), mix)));
};
```

That module is real and shipped: `engine/capot/songs/crossfade-demo` is two decks meeting at it,
and it is mirrored into every user's Examples workspace. The same graph is `@studio/dsp`'s
`crossfade()`, emitted to `packages/dsp/graphs/crossfade.json` — a module is a folder you can
copy, so it carries its own source rather than pointing at the library, and a test holds the two
to the same shape.

`input(n)` indexes the **port list above**, in order: 0 is the flow, 1 is `b`. An index and not a
name, because the graph and the module file are two documents — the graph is generated JSON the
engine reads with no `module.yaml` in sight — and position is the one fact both sides can hold on
their own. It is also what `validate()` already checks by: sources fill ports positionally.

The route from that to the engine, in one line each:

| piece | what it does |
|---|---|
| `@studio/dsp` | `input(n)` on the builder; port 0 emits no field, so no existing graph moved |
| `DspGraph` | `Kind::ain` carries a port index and reads channels 2n / 2n+1 |
| `GraphDspPlugin::getChannelNames` | a stereo PAIR per input port past the first |
| `GraphDspPlugin::canSidechain` | true when the graph declares more than one input |
| `PluginDoc.sidechainFrom` + `server/main.cpp` | the source track id, on the wire |
| `EditBuilder` | `setSidechainSourceID` plus its wires, in a pass after every lane exists |
| `nodeProject` | emits `sidechainFrom` from `step.in`, which this layer already produced |

Two of those read differently from the plan they came from. A **pair** per port, not one channel:
Tracktion's own default routing maps a source's L/R onto the two channels after the pair, which is
right for a crossfade, where the second input is a signal you hear — one mono channel would have
summed it, which is right only for a compressor's trigger. And `sidechainFrom` names a **track**:
a step's `in` names nodes (a chain, or the track feeding one), and the engine routes from a lane,
so the compiler resolves each down to the lane it compiles onto.

`engine/moteur/docs/sidechain.md` is the engine end of this — the buffer layout, why the wiring
gets a pass of its own, and why the source had to go into the plugin's diff identity.

### A deck feeding a port is still heard on its own

The rough edge, found by writing the demo rather than by reading the code. `out` compiles as a
**parallel** path: that is what makes a send a send — the dry signal carries on to the master
beside it — and a destination naming a port gets the same treatment. So a deck wired only to
`crossfade#b` reaches the master twice, once raw and once through the module, and pushing Mix to
0 does not take it away.

Muting that lane is what says "heard through the module only", and it works because Tracktion's
muting node deliberately still lets clips through to aux sends and sidechains. The demo does
exactly that, with the reason written on the track file.

Changing it would mean making `out` series rather than parallel, which is a decision about every
bus in the repo and not about ports. Stated here instead, because the alternative is a crossfade
that quietly does not cross.

### Where the limit actually is

Tracktion carries **one** sidechain source per plugin. So a module may declare a third port, be
wired to it, and be drawn with the cable — the layers above this one are indifferent to how many
there are — and only the first side input reaches the engine. That is a ceiling in Tracktion's
model, not in the syntax, and it is stated here rather than enforced, because refusing to load such
a song would take away the drawing too.

### What was measured

`crossfade-demo` rendered three times — a kick on all four beats through port `a`, a snare on the
backbeat through port `b` — reading the peak of each beat:

| Mix | beat 1 (kick) | beat 2 (kick + snare) |
|---|---|---|
| 0   | 0.483 | 0.483 |
| 0.5 | 0.242 | 0.392 |
| 1   | 0.000 | 0.374 |

Deck A alone, both at half, deck B alone. At Mix 1 the kick is gone entirely and the snare is at
full (0.528 through Tracktion's −3 dB pan law is 0.373), which is the assertion that matters: the
second port is carrying signal, and the first one can be turned off.

The engine's page has the smaller probe this started from — two copies of one sine, summed, twice
the level with `sidechainFrom` and once without.

What stays unverifiable is *listening*. A render can be measured; whether a crossfade sounds like
a crossfade cannot be, here.
