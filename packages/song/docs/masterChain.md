# `MIX` and `OUT` — the two outputs, and the chain between them

> The picture has the same pair, `RENDER` and `VIDEO_OUT`, built on everything this page says —
> with **one** difference that counts: it is added on its own.
> See [videoOutputs.md](videoOutputs.md).

A graph has **two** built-in outputs for the room's sound — plus `CUE`, the headphones, the only
one that really leaves the sum ([cue.md](cue.md)):

| name | what it is |
|---|---|
| `MIX` | the **mixer's sum** — where each track's chain ends. Carries no parameter: a level belongs to what goes **out** |
| `OUT` | the **real output**, the interface — and the only built-in node carrying a parameter, `Volume`, the song's output level ([masterVolume.md](masterVolume.md)). It is what the header meter answers for, and what its Fix button writes |

```k7x
// graph.k7x
modules({
  gtr: ["ampli"],
  ampli: ["MIX"], // the track reaches the sum, like every other
  MIX: ["compressor"], // …and here is the MASTER CHAIN
  compressor: ["eq"],
  eq: ["OUT"], // which goes back out to the interface
})
```

The run between the two is the **master chain**: its modules process the whole mix. That is the
reason for two names — an `OUT` alone leaves nowhere to put a treatment on the whole.

**A song without a master chain costs no sound.** `masterPlugins` starts empty, and `MIX` and `OUT`
are a single wire.

## What it is NOT

Worth stating plainly, because the natural reading of the two names is stronger than what the code
does:

> **Routing a track to `OUT` does not bypass the master chain.**

In Tracktion **every** track feeds the master bus, and the master chain sits on that bus's plugin
list. A track wired to `OUT` therefore passes through it like the others. The two names are a
**notation** — what makes the master run expressible — and not two distinct destinations.

A real bypass needs a track routed off the master bus, onto a separate output device. That
mechanism exists — `TrackDoc.outputChannels`, which [cue.md](cue.md) uses — but it is not wired to
`OUT`: only `CUE` names it. `OUT` at the end of a track chain therefore means the same as `MIX`.

Wiring it to `OUT` would be a decision about **every** project in the repository, not a notation to
correct — the same family as "make `out` serial", posed in [ports.md](ports.md).

## The order on the bus, and what it costs

```
tracks -> [ master chain ] -> masterVolume -> meter -> broadcast tap -> interface
```

The order follows the graph: `MIX -> [ chain ] -> OUT`, and `masterVolume` is the `Volume`
parameter `OUT` carries ([masterVolume.md](masterVolume.md)). Everything after that is the engine
watching the signal that **leaves** — which is the point of watching it.

- those plugins **are** the mix, and the output level is its last stage rather than a decision laid
  on top;
- the meter and the Fix button therefore answer for the processed mix, output included — and that
  is what lets Fix write `OUT` and see the clip indicator go out on the next pass;
- a listener on the stream hears what the room hears, output level included.

**The price, stated rather than hidden:** a limiter placed there is upstream of the meter, so the
clip indicator stops seeing the raw sum it exists to catch. Fix still works — it lowers the output,
downstream of the limiter — but it has little left to catch, and that is worth knowing before
placing a limiter.

## Reshaping the master chain STOPS playback

Adding, removing, reordering or reloading a master module forces a full rebuild — so playback
stops while the Edit is rebuilt. Deliberately coarser than the per-track plugin diff, which adds
and removes in place: reshaping the mix bus is a decision taken between two takes.

Turning a master module's knob or bypassing it does NOT: those are applied in place, like a
track's, since a rebuild for a knob costs seconds and cuts every tail
(`engine/k7-runtime/docs/projectDiff.md`).

**Order** is part of the comparison: swapping the compressor and the EQ leaves both keys present
and changes the sound, so an unordered comparison would conclude "nothing moved".

## `MIX: [ OUT ]` — the line every project carries

Every project written by a scaffold declares the run, **empty**:

```k7x
modules({
  melody: ["synth-melody"],
  synth-melody: ["MIX"],
  MIX: ["OUT"], // the master chain: its place, with nothing on it
})
```

It costs **no sound** — `masterPlugins` stays empty and the compiled document is exactly that of a
project without it, which `masterChain.test.ts` pins. What it buys is elsewhere:

- the graph has an **`OUT` card** to draw, and that is the node carrying the output level
  ([masterVolume.md](masterVolume.md)) — without the run, nothing reaches `OUT` and the card does
  not exist;
- there is a **place to drop a master module**, written in advance, rather than a line to guess.

A place in the literal sense: the graph's `+` is offered **on that wire**, between the two built-in
cards (`insertFor`, `packages/ui-chains/docs/graphBuild.md`), and the click writes
`node insert MIX OUT <node>`. A project without the line sees the wire anyway — the graph draws it
as soon as something reaches the sum — and the verb writes it before inserting, so the `+` keeps
its promise of a single command.

The scaffolds write it — `scaffold.ts`, `scaffoldSet.ts` and `scaffoldLive.ts`, the last of which
is also what the bench opens on (`apps/k7/backend/docs/media/banc.md`).

One detail `validate()` has to carry: `from: MIX` is accepted. The sum is neither a track nor a
chain, it is where all of them arrive, and refusing it warns **every** project at once about the
one line that is always right.

## The layers crossed

| | |
|---|---|
| written | `graph.k7x` — a run from `MIX` to `OUT` |
| derived | `chainsGraph.ts`: `MIX` starts a run, like `@in` and like a track |
| compiled | `nodeProject.ts`: that run's owner is `@master`, and its steps become `masterPlugins` |
| the wire | `@studio/engine-protocol`'s `ProjectDoc.masterPlugins` — always sent, empty by default |
| decoded | `docFromJson` in `engine/k7-runtime/server/DocJson.cpp` (via `pluginFromJson`, shared with tracks) |
| placed | `populateMasterChain` in `EditBuilder.cpp`, at the head of the master list — followed by the output gain |
| drawn | the graph's `MIX` and `OUT` cards (`MAIN_OUT_UI` in `@studio/ui-chains`), the second with its fader |
| diffed | `ChangeKind::MasterChainChanged` — full rebuild; a knob or a bypass is `PluginParamChanged` / `PluginEnabledChanged`, in place |
| measured | `engine/k7-runtime/scripts/master-chain.ts` |

One nuance on the drawing side: **the graph draws no cable TO `MIX`**. Every track arrives there —
that is what the mixer is — so those arrows would say nothing the shape does not already say, one
per track, across the whole picture. Only the run LEAVING it is drawn,
`MIX → [ master chain ] → OUT`, independent of the rest. The routing does not move for that: the
engine reads the compiled document, where each of those tracks still arrives at the sum. See
`packages/ui-chains/docs/graphBuild.md`.

That has one price: the live cable's **ripple** propagates forward from the tracks the engine
measures, so a node nothing arrives at is a node it never reaches — the master run, the cable
carrying the whole song, would be the only still one during playback. `computeLive` therefore seeds
the walk at `MIX` too, as soon as one track is measured: not an approximation, since **every** track
feeds the master bus whatever its chain names.

## Checking it

The TypeScript suites prove the document, the C++ suite proves the diff, and **neither proves the
plugin landed on the bus**. That is what the harness measures:

```bash
npx tsx engine/k7-runtime/scripts/master-chain.ts
```

It renders the same note twice changing only `masterPlugins`, and compares the peaks. With a
`volume` of 0 on the master: −7.5 dBFS without the chain, −100 dBFS with.

A trap that holds for any module: the parameter is called **`Volume`**, with the capital the plugin
publishes (`builtinParams.generated.json`). A lower-case key matches nothing, raises no error, and the
render comes out **identical** — so nothing tells you the case is wrong.
