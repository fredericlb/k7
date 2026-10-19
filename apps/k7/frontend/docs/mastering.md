# The `mastering` surface — one node, drawn as three appliances

A project that declares `surfaces/<id>.k7x` with `type("mastering")` gets a page of its own
holding ten sliders in three boxes: the compressor, the spreader, the limiter — the three parts of
one `quick-master` node, in the order the signal meets them.

```k7x
// surfaces/master.k7x
type("mastering")
layout("split")
mapping({
  "comp.low": { module: "master_qm_1", param: "Low Amount" },
  "comp.mid": { module: "master_qm_1", param: "Mid Amount" },
  "comp.high": { module: "master_qm_1", param: "High Amount" },
  "comp.lowFreq": { module: "master_qm_1", param: "Low Freq" },
  "comp.highFreq": { module: "master_qm_1", param: "High Freq" },
  "spread.width": { module: "master_qm_1", param: "Width" },
  "spread.bassMono": { module: "master_qm_1", param: "Bass Mono" },
  "limiter.drive": { module: "master_qm_1", param: "Drive" },
  "limiter.ceiling": { module: "master_qm_1", param: "Ceiling" },
  "limiter.release": { module: "master_qm_1", param: "Release" },
})
```

Three files, and they are the whole surface:

| | |
|---|---|
| `src/mastering/controls.ts` | the ten ids, their parts, their fallback ranges and units |
| `src/mastering/bindings.ts` | the join to the compiled chains, and what a slider draws |
| `src/components/MasteringTab.tsx` | the screen |

## Why it needs a mapping at all

Everything else `surfaces/` declares draws something the PROJECT *is*: its lanes, its picture, its
decks. This draws one module's parameters — and a module's NAME is the project's to choose
(`packages/song/docs/nodes.md`), so nothing but the file can say which node this strip is a
picture of. That is the same reason the desk has a mapping, arrived at from the other end.

It is also why the gate asks for **all ten** — `unmappedControls` filters the required controls,
which are the ten sliders every quick-master has always had. Three more are OFFERED rather than
required, so a surface written before they existed still draws: `comp.lowCut`, `limiter.hfLimit`
and `limiter.output`, the low cut, HF limit and word length (`engine/k7-runtime/docs/quickMaster.md`).
The word length is a dropdown, being a choice and not a range. The desk's gate
filters a `REQUIRED_CONTROLS` subset in the same way. The desk (`packages/k7-plugins/src/turntables`) requires its faders and
merely offers its stem cuts, because a desk with no stem cuts is still a complete desk. There is
no smaller mastering strip: every control names the same node, so a missing
line is not a reduced strip, it is the same strip with a knob that does nothing. A knob that does
nothing is the hardest thing on a screen to diagnose, so the surface says what it is missing
instead of drawing itself.

## No normalisation, anywhere

This is the one place the surface deliberately departs from
[viewBindings.md](../../../../packages/song/docs/viewBindings.md).

There, a control declares a range of its own, the position is normalised to 0..1 by it, and the
widget's `min`/`max` expand it again. That is right for a desk: a crossfader is a *gesture*, and
what it drives is whatever the file says.

Here the control **is** the param. The slider's ends come from the module's own widget when it
draws one (`masterRange`), fall back to the control's declared range when it does not, and the
number under the slider is the number sent to the engine. A ceiling reading −0.3 dB sends −0.3 dB.

The reason is not tidiness. A master is judged against a meter, and a value that had been through
two scales cannot be compared with one. Pointing `limiter.ceiling` at a module whose ceiling goes
down to −24 dB gives a slider that goes to −24 dB, which is the widget saying what its own knob
covers — the adaptation happens by *reading* the target, not by rescaling into it.

## Where the value comes from

The order is `held ?? live ?? home`, and it is the same rule the desk follows
(`../../../../packages/k7-plugins/docs/turntables/deckSet.md`):

- **held** — the hand's value while a gesture is in flight. Optimistic, and dropped as soon as
  `engineAgrees`. An override that never yields is a control that has stopped listening: the
  engine clamps what it was sent, and the graph directly underneath draws the same node.
- **live** — what the engine says. It is the only thing that knows what a plugin is set to, and it
  says so whichever surface did the setting.
- **home** — the control's own resting value, drawn while nothing is known yet. Not zero: a width
  whose neutral is 100 % and a ceiling whose neutral is 0 dB would both jump on the first frame.

`engineAgrees`' epsilon is **relative to the range**, unlike the desk's fixed 0.05. These params
are not on one scale — 0.05 is a third of a Release's step and a thousandth of a crossover's — so
one absolute number would either never agree on the small controls or agree instantly on the
large.

### Two things that are easy to get wrong here

**Nothing arrives unless you ask.** The engine pushes a plugin's values only while something is
watching it, so `MasteringTab` calls `watchPluginParams(id, true)` itself. Without it every slider
sits on its `home` for as long as the project is open and looks like a working control the engine
happens to disagree with.

**The watch is keyed by a joined string**, not by the `bindings` array. That array is fresh on
every graph fetch, so an effect depending on it would unwatch and re-watch on each poll — a
subscription flickering twenty times a minute over a set of ids that has not changed.

Each slider subscribes to **its own** param (`usePluginParamValue`), not to the whole map. Ten
knobs over one plugin at ~20 frames a second is exactly the shape that store exists for: a frame
that did not move this number ends at `Object.is` and re-renders nothing.

## Live while it moves, written once on release

A slider sends `setPluginParam` on every step, and writes `node param "<module>" "<param>" <value>`
(`masterParamLine`) once, when the gesture ends — pointer up, key up or blur — through the shell's
quiet command, the same write a knob on the chains graph commits. A dropdown pick is a whole gesture
and is written at once. Writing on every step would be one file write and one revision per frame of
a drag; sending only live would leave the strip's settings in the engine and lose them on the next
reload. The write names the module the file names, never the engine's `chain:module` address.

## Why the shell draws it, not `SurfaceTab`

`SurfaceTab` picks a component for a `type` and hands it the deck, the mapping and the file
service's base. What this surface needs instead is the **engine link** — `setPluginParam`,
`watchPluginParams` and the params store — which lives in `App`. Threading it down through
`SurfaceTab` would give that component a second reason to exist.

So `MasteringTab` is mounted directly by `App`, beside `TimelineTab` and `ViewportTab`, and
`SurfaceTab`'s switch keeps an arm saying so. The arm is not decoration: the switch covering every
member of the enum is what stops a new type falling off the end silently.

## Where it sits

A full page, like every pane, and last in the ring before the graph: it is the last thing the signal
meets, so the ring reads in signal order. Every knob on it is a param on one module in the graph,
which the bottom panel's `graph` shows under it.

`ui mastering`, Tab and `/mastering` all reach it, through the pane ring like anything else.
It has **no number key**: 1–4 are spoken for, and this is a pane you set up once rather than one
you flip to mid-take.

## What it does NOT do

- **No meter.** The header already has one (`masterMeter.md`), it reads the master bus, and a
  second one inside this pane would be the same number twice with two chances to disagree.
- **No gain reduction display.** The engine's state frame carries transport and levels, not a
  plugin's internal detector, so drawing one would mean a new message on the hottest path there
  is. The knobs say what was asked for; the meter says what came out.
- **No warning when a project has a quick-master and no surface.** `surfaceIssues` warns about a
  missing timeline and a missing viewport because material on disk is drawn nowhere without them.
  A node with no surface is drawn perfectly well — its panel is on the graph, where every other
  module's is. This strip is a convenience, not a missing half.

See `packages/song/docs/surfaces.md` for the format and `engine/k7-runtime/docs/quickMaster.md` for
what the node actually does to the sound.
